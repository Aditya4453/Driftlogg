import pLimit from "p-limit"
import semver from "semver"
import { all } from "module-replacements"
import { PackageCache } from "../../models/PackageCache.js"

const NPM_REGISTRY_BASE = "https://registry.npmjs.org"
const DEPS_DEV_BASE = "https://api.deps.dev/v3/systems/npm/packages"
const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6 hours

/**
 * Calculates libyears (approximate age in years between resolved version and latest).
 */
function calculateLibyears(timeMap, resolvedVersion, latestVersion) {
  if (
    timeMap &&
    resolvedVersion &&
    latestVersion &&
    timeMap[resolvedVersion] &&
    timeMap[latestVersion]
  ) {
    const diffMs =
      new Date(timeMap[latestVersion]).getTime() -
      new Date(timeMap[resolvedVersion]).getTime()
    return Math.max(
      0,
      Math.round((diffMs / (365.25 * 24 * 3600 * 1000)) * 10) / 10,
    )
  }

  // Fallback estimation using semver difference if publication timestamps are absent
  if (resolvedVersion && latestVersion) {
    const rSem = semver.coerce(resolvedVersion)
    const lSem = semver.coerce(latestVersion)
    if (rSem && lSem) {
      const majorDiff = Math.max(0, lSem.major - rSem.major)
      const minorDiff = Math.max(0, lSem.minor - rSem.minor)
      return Math.round((majorDiff * 1.0 + minorDiff * 0.1) * 10) / 10
    }
  }

  return 0
}

/**
 * Stage 3: Registry, deps.dev Scorecard & e18e Replacement Enrichment
 *
 * Enriches dependencies with npm registry metadata (deprecated, install scripts, libyears),
 * OpenSSF Scorecard metrics from deps.dev, and modern module replacements from e18e.
 * Backed by a MongoDB PackageCache with 6-hour TTL and bounded by p-limit(10).
 */
export async function enrichDependencies(dependencies, logger = null) {
  const sourcesUnavailable = new Set()
  const enrichMap = new Map()

  if (!Array.isArray(dependencies) || dependencies.length === 0) {
    return { enrichMap, sourcesUnavailable: [] }
  }

  const limit = pLimit(10)
  let cacheHits = 0
  let cacheMisses = 0
  let e18eMatches = 0

  const tasks = dependencies.map((dep) =>
    limit(async () => {
      const versionKey = dep.resolvedVersion || dep.declaredVersion || "latest"
      const cacheKey = `npm:${dep.name}@${versionKey}`

      // 1. Check PackageCache
      try {
        const cached = await PackageCache.findOne({ cacheKey })
        if (cached && cached.data && cached.expiresAt > new Date()) {
          enrichMap.set(dep.name, cached.data)
          cacheHits += 1
          return
        }
      } catch {
        // Cache read failure shouldn't fail analysis
      }

      cacheMisses += 1

      // 2. e18e Replacement Lookup (Local in-memory, synchronous)
      let replacement = null
      const e18eMatch = all?.mappings?.[dep.name]
      if (e18eMatch) {
        e18eMatches += 1
        const replacementNames = Array.isArray(e18eMatch.replacements)
          ? e18eMatch.replacements.join(", ")
          : String(e18eMatch.replacements || "")
        replacement = {
          name: replacementNames,
          reason: e18eMatch.type
            ? `Modern replacement available for legacy ${e18eMatch.type}`
            : "Modern replacement recommended",
          source: "e18e",
        }
      }

      // 3. Parallel Upstream Fetching: npm Registry & deps.dev
      const [npmResult, depsDevResult] = await Promise.allSettled([
        // npm registry abbreviated metadata
        fetch(`${NPM_REGISTRY_BASE}/${encodeURIComponent(dep.name)}`, {
          headers: {
            Accept: "application/vnd.npm.install-v1+json",
            "User-Agent": "DriftLogg-Analyzer",
          },
          signal: AbortSignal.timeout(6000),
        }),
        // deps.dev v3 API
        fetch(
          `${DEPS_DEV_BASE}/${encodeURIComponent(dep.name)}/versions/${encodeURIComponent(dep.resolvedVersion || "latest")}`,
          {
            headers: { "User-Agent": "DriftLogg-Analyzer" },
            signal: AbortSignal.timeout(6000),
          },
        ),
      ])

      let latestVersion = null
      let deprecated = null
      let hasInstallScript = false
      let libyears = 0
      let lastRelease = null

      // Process npm registry response
      if (npmResult.status === "fulfilled") {
        const res = npmResult.value
        if (res.ok) {
          try {
            const data = await res.json()
            latestVersion = data["dist-tags"]?.latest || null
            const verObj =
              (dep.resolvedVersion && data.versions?.[dep.resolvedVersion]) ||
              (latestVersion && data.versions?.[latestVersion]) ||
              {}

            deprecated =
              (typeof verObj.deprecated === "string"
                ? verObj.deprecated
                : null) ||
              (typeof data.deprecated === "string" ? data.deprecated : null)

            hasInstallScript = Boolean(
              verObj.hasInstallScript ||
                verObj.scripts?.preinstall ||
                verObj.scripts?.install ||
                verObj.scripts?.postinstall,
            )

            libyears = calculateLibyears(
              data.time,
              dep.resolvedVersion,
              latestVersion,
            )
            lastRelease = data.time?.[latestVersion] || null
          } catch {
            sourcesUnavailable.add("npm-registry")
          }
        } else if (res.status !== 404) {
          sourcesUnavailable.add("npm-registry")
        }
      } else {
        sourcesUnavailable.add("npm-registry")
      }

      // Process deps.dev response
      let scorecard = null
      let openIssues = 0
      let isArchived = false

      if (depsDevResult.status === "fulfilled") {
        const res = depsDevResult.value
        if (res.ok) {
          try {
            const data = await res.json()
            if (data.scorecard) {
              const score =
                typeof data.scorecard.overallScore === "number"
                  ? data.scorecard.overallScore
                  : typeof data.scorecard.score === "number"
                    ? data.scorecard.score
                    : null
              scorecard = score !== null ? Math.round(score * 10) / 10 : null
            }
            openIssues =
              data.openIssuesCount ||
              data.relatedProjects?.[0]?.openIssuesCount ||
              0
            isArchived = Boolean(
              data.archived ||
                data.isArchived ||
                data.projectKey?.archived ||
                data.relatedProjects?.[0]?.archived,
            )
          } catch {
            sourcesUnavailable.add("deps.dev")
          }
        } else if (res.status !== 404) {
          sourcesUnavailable.add("deps.dev")
        }
      } else {
        sourcesUnavailable.add("deps.dev")
      }

      const enrichmentData = {
        name: dep.name,
        latestVersion,
        deprecated,
        hasInstallScript,
        libyears,
        scorecard,
        openIssues,
        isArchived,
        replacement,
        lastRelease,
      }

      enrichMap.set(dep.name, enrichmentData)

      // 4. Save to PackageCache (TTL 6 hours)
      try {
        await PackageCache.updateOne(
          { cacheKey },
          {
            $set: {
              cacheKey,
              data: enrichmentData,
              expiresAt: new Date(Date.now() + CACHE_TTL_MS),
            },
          },
          { upsert: true },
        )
      } catch {
        // DB cache errors never break analysis
      }
    }),
  )

  await Promise.allSettled(tasks)

  logger?.info("enrich", "Ecosystem enrichment stage completed", {
    totalDependencies: dependencies.length,
    cacheHits,
    cacheMisses,
    e18eReplacementsMatched: e18eMatches,
    sourcesUnavailable: Array.from(sourcesUnavailable),
  })

  if (sourcesUnavailable.size > 0) {
    logger?.warn(
      "enrich",
      "One or more ecosystem enrichment sources were unavailable",
      {
        sourcesUnavailable: Array.from(sourcesUnavailable),
      },
    )
  }

  return {
    enrichMap,
    sourcesUnavailable: Array.from(sourcesUnavailable),
  }
}
