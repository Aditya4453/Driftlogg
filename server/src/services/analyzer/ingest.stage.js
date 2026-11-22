import semver from "semver"
import { validateGitHubRepoUrl } from "../../middleware/security.js"
import { AppError } from "../../utils/errors.js"

const MAX_TRANSITIVE_PACKAGES = 250

/**
 * Extracts a map of resolved versions from package-lock.json.
 * Supports both npm lockfile v2/v3 (packages map) and v1 (dependencies tree).
 */
function extractLockfileVersions(lockfile) {
  if (!lockfile || typeof lockfile !== "object") return null
  const versionMap = new Map() // direct / preferred versions
  const allPackages = new Map() // all packages (including transitives)

  // 1. Lockfile v2 / v3: packages map
  if (lockfile.packages && typeof lockfile.packages === "object") {
    for (const [key, pkgInfo] of Object.entries(lockfile.packages)) {
      if (!key || key === "" || !pkgInfo || typeof pkgInfo.version !== "string")
        continue
      const lastIndex = key.lastIndexOf("node_modules/")
      if (lastIndex !== -1) {
        const pkgName = key.slice(lastIndex + "node_modules/".length)
        if (pkgName) {
          // Top-level node_modules/<pkgName> takes precedence
          const isTopLevel = !key.slice(0, lastIndex).includes("node_modules/")
          if (isTopLevel || !versionMap.has(pkgName)) {
            versionMap.set(pkgName, pkgInfo.version)
          }
          if (!allPackages.has(pkgName)) {
            allPackages.set(pkgName, pkgInfo.version)
          }
        }
      }
    }
  }

  // 2. Lockfile v1: nested dependencies tree
  function collectV1Deps(deps) {
    if (!deps || typeof deps !== "object") return
    for (const [name, info] of Object.entries(deps)) {
      if (!info || typeof info !== "object") continue
      if (typeof info.version === "string") {
        if (!versionMap.has(name)) {
          versionMap.set(name, info.version)
        }
        if (!allPackages.has(name)) {
          allPackages.set(name, info.version)
        }
      }
      if (info.dependencies) {
        collectV1Deps(info.dependencies)
      }
    }
  }

  if (lockfile.dependencies && typeof lockfile.dependencies === "object") {
    collectV1Deps(lockfile.dependencies)
  }

  return { versionMap, allPackages }
}

/**
 * Fetches and decodes a file from GitHub REST API.
 */
async function fetchGitHubFile(
  owner,
  repo,
  filePath,
  isOptional = false,
  branch = null,
  logger = null,
) {
  const refParam = branch ? `?ref=${encodeURIComponent(branch)}` : ""
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}${refParam}`
  const headers = {
    "User-Agent": "DriftLogg-Analyzer",
    Accept: "application/vnd.github.v3+json",
  }
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  }

  let res
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) })
  } catch (err) {
    logger?.error("ingest", `Network error fetching ${filePath} from GitHub`, {
      error: err.message,
    })
    if (isOptional) return null
    throw new AppError(
      `Failed to fetch ${filePath} from GitHub: ${err.message}`,
      400,
    )
  }

  const rateLimit = res.headers?.get
    ? res.headers.get("x-ratelimit-remaining")
    : (res.headers?.["x-ratelimit-remaining"] ?? null)
  const rateLimitMeta = {
    filePath,
    status: res.status,
    rateLimitRemaining: rateLimit !== null ? Number(rateLimit) : undefined,
  }

  if (res.status === 403) {
    logger?.warn(
      "ingest",
      `GitHub API rate limit (403) potentially hit while fetching ${filePath}`,
      rateLimitMeta,
    )
  } else if (!res.ok && !isOptional && res.status !== 404) {
    logger?.warn("ingest", `GitHub API error for ${filePath}`, rateLimitMeta)
  } else {
    logger?.info("ingest", `GitHub API response for ${filePath}`, rateLimitMeta)
  }

  if (!res.ok) {
    if (res.status === 404 && isOptional) return null
    if (res.status === 404)
      throw new AppError(`${filePath} not found in repository`, 400)
    throw new AppError(
      `GitHub API error (${res.status}) while fetching ${filePath}`,
      400,
    )
  }

  const text = await res.text()
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new AppError(`Invalid JSON in repository ${filePath}`, 400)
  }

  // Decode base64 content if GitHub REST API response
  if (
    parsed &&
    typeof parsed.content === "string" &&
    parsed.encoding === "base64"
  ) {
    try {
      const decoded = Buffer.from(parsed.content, "base64").toString("utf8")
      return JSON.parse(decoded)
    } catch {
      throw new AppError(
        `Failed to parse base64 JSON in repository ${filePath}`,
        400,
      )
    }
  }

  return parsed
}

/**
 * Queries GitHub Git Trees API for recursive repository structure.
 */
async function fetchGitHubTree(owner, repo, treeSha = "HEAD", logger = null) {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`
  const headers = {
    "User-Agent": "DriftLogg-Analyzer",
    Accept: "application/vnd.github.v3+json",
  }
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  }

  let res
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) })
  } catch (err) {
    logger?.error(
      "ingest",
      "Network error fetching repository tree from GitHub",
      {
        error: err.message,
      },
    )
    throw new AppError(
      `Failed to fetch repository tree from GitHub: ${err.message}`,
      400,
    )
  }

  const rateLimit = res.headers?.get
    ? res.headers.get("x-ratelimit-remaining")
    : (res.headers?.["x-ratelimit-remaining"] ?? null)
  const rateLimitMeta = {
    status: res.status,
    rateLimitRemaining: rateLimit !== null ? Number(rateLimit) : undefined,
  }

  if (res.status === 403) {
    logger?.warn(
      "ingest",
      "GitHub API rate limit (403) hit during Git Trees discovery",
      rateLimitMeta,
    )
  } else {
    logger?.info("ingest", "GitHub Trees API response received", rateLimitMeta)
  }

  if (!res.ok) {
    if (res.status === 404) {
      throw new AppError("No package.json found in this repository", 400)
    }
    throw new AppError(
      `GitHub API error (${res.status}) while fetching repository tree`,
      400,
    )
  }

  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new AppError("Invalid JSON returned by GitHub Trees API", 400)
  }
  return Array.isArray(data?.tree) ? data.tree : []
}

/**
 * Ingests and merges dependencies across multiple monorepo manifests (e.g., frontend/ and backend/).
 */
function mergeMonorepoManifests(repo, manifests, logger = null) {
  const unifiedDepsMap = new Map()
  let hasAnyLockfile = false
  const subdirs = []

  for (const manifest of manifests) {
    const { dir, pkgObj, lockObj } = manifest
    subdirs.push(dir || pkgObj?.name || "root")

    const lockfileData = lockObj ? extractLockfileVersions(lockObj) : null
    const hasLock = Boolean(lockfileData && lockfileData.versionMap.size > 0)
    if (hasLock) hasAnyLockfile = true

    const directNames = new Set()

    const extractSection = (sectionName, sectionKey) => {
      const group = pkgObj[sectionKey]
      if (!group || typeof group !== "object" || Array.isArray(group)) return

      for (const [name, declaredVersionRaw] of Object.entries(group)) {
        if (typeof name !== "string" || !name.trim()) continue
        const declaredVersion =
          typeof declaredVersionRaw === "string"
            ? declaredVersionRaw.trim()
            : String(declaredVersionRaw || "")
        directNames.add(name)

        let resolvedVersion = null
        let isUnpinned = false

        if (hasLock && lockfileData.versionMap.has(name)) {
          resolvedVersion = lockfileData.versionMap.get(name)
          isUnpinned = false
        } else {
          isUnpinned = isVersionUnpinned(declaredVersion)
          resolvedVersion = semver.coerce(declaredVersion)?.version || null
        }

        const newDep = {
          name,
          declaredVersion,
          resolvedVersion,
          section: sectionName,
          isDirect: true,
          isUnpinned,
          workspace: dir || null,
        }

        if (!unifiedDepsMap.has(name)) {
          unifiedDepsMap.set(name, newDep)
        } else {
          const existing = unifiedDepsMap.get(name)
          const isDirectMerged = existing.isDirect || newDep.isDirect
          const sectionMerged =
            existing.section === "dependencies" ||
            newDep.section === "dependencies"
              ? "dependencies"
              : "devDependencies"
          const resolvedMerged =
            existing.resolvedVersion || newDep.resolvedVersion
          const isUnpinnedMerged = existing.isUnpinned && newDep.isUnpinned

          unifiedDepsMap.set(name, {
            name,
            declaredVersion: existing.declaredVersion || newDep.declaredVersion,
            resolvedVersion: resolvedMerged,
            section: sectionMerged,
            isDirect: isDirectMerged,
            isUnpinned: isUnpinnedMerged,
            workspace:
              existing.workspace &&
              newDep.workspace &&
              existing.workspace !== newDep.workspace
                ? `${existing.workspace}, ${newDep.workspace}`
                : existing.workspace || newDep.workspace || null,
          })
        }
      }
    }

    extractSection("dependencies", "dependencies")
    extractSection("devDependencies", "devDependencies")

    // Transitive dependencies from lockfile
    if (hasLock) {
      let transitiveCount = 0
      for (const [
        name,
        resolvedVersion,
      ] of lockfileData.allPackages.entries()) {
        if (directNames.has(name)) continue
        if (transitiveCount >= MAX_TRANSITIVE_PACKAGES) break

        if (!unifiedDepsMap.has(name)) {
          unifiedDepsMap.set(name, {
            name,
            declaredVersion: resolvedVersion,
            resolvedVersion,
            section: "dependencies",
            isDirect: false,
            isUnpinned: false,
            workspace: dir || null,
          })
          transitiveCount += 1
        }
      }
    }
  }

  const projectName = `${repo} (${subdirs.join(", ")})`
  const dependencies = Array.from(unifiedDepsMap.values())
  const directCount = dependencies.filter((d) => d.isDirect).length
  const transitiveCount = dependencies.filter((d) => !d.isDirect).length

  logger?.info("ingest", "Monorepo manifests merged successfully", {
    projectName,
    hasLockfile: hasAnyLockfile,
    directCount,
    transitiveCount,
    totalDependencies: dependencies.length,
    directories: subdirs,
  })

  return {
    projectName,
    hasLockfile: hasAnyLockfile,
    enginesNode: null,
    dependencies,
  }
}

/**
 * Checks whether a declared version is an unpinned wildcard.
 */
function isVersionUnpinned(version) {
  if (!version || typeof version !== "string") return true
  const v = version.trim()
  return (
    v === "*" ||
    v === "latest" ||
    v === "x" ||
    v === "X" ||
    v === "" ||
    v === "^*"
  )
}

/**
 * Stage 1: Lockfile-First Manifest Ingest
 *
 * Ingests package.json and optional package-lock.json from upload or GitHub repo,
 * resolves exact package versions via lockfile with semver fallback,
 * and extracts direct and capped transitive dependencies.
 *
 * @param {object} input
 * @param {object} [logger=null]
 */
export async function ingestManifest(
  { sourceType, repositoryUrl, packageJson, packageLockJson },
  logger = null,
) {
  let pkgObj = null
  let lockObj = null

  // 1. Ingest from GitHub (root repo, subfolder /tree/..., or direct /blob/... link)
  if (sourceType === "github" || sourceType === "github_repo") {
    const gh = validateGitHubRepoUrl(repositoryUrl)
    if (!gh) {
      throw new AppError("Invalid GitHub repository URL", 400)
    }
    const { owner, repo, branch, subpath } = gh

    logger?.info("ingest", "Parsed GitHub repository target", {
      owner,
      repo,
      branch: branch || "default",
      subpath: subpath || "root",
    })

    // A. Subpath specified (e.g., /tree/main/frontend or /blob/main/backend/package.json)
    if (subpath) {
      const pkgPath = `${subpath}/package.json`
      const lockPath = `${subpath}/package-lock.json`
      pkgObj = await fetchGitHubFile(
        owner,
        repo,
        pkgPath,
        false,
        branch,
        logger,
      )
      lockObj = await fetchGitHubFile(
        owner,
        repo,
        lockPath,
        true,
        branch,
        logger,
      )
    } else {
      // B. Root repository: check root package.json first
      pkgObj = await fetchGitHubFile(
        owner,
        repo,
        "package.json",
        true,
        branch,
        logger,
      )
      if (pkgObj) {
        lockObj = await fetchGitHubFile(
          owner,
          repo,
          "package-lock.json",
          true,
          branch,
          logger,
        )

        const rootDepsCount =
          Object.keys(pkgObj.dependencies || {}).length +
          Object.keys(pkgObj.devDependencies || {}).length

        // If root package.json has <= 2 dependencies (e.g. monorepo root) or declared workspaces,
        // search for sub-project manifests (e.g. my-app/package.json, frontend/package.json, backend/package.json)
        if (rootDepsCount <= 2 || Boolean(pkgObj.workspaces)) {
          try {
            logger?.info(
              "ingest",
              "Scanning Git tree for sub-project manifests (monorepo check)",
              { rootDepsCount, hasWorkspaces: Boolean(pkgObj.workspaces) },
            )
            const tree = await fetchGitHubTree(
              owner,
              repo,
              branch || "HEAD",
              logger,
            )
            const subPaths = tree
              .filter((item) => {
                if (!item || typeof item.path !== "string") return false
                const p = item.path
                if (item.type && item.type !== "blob") return false
                if (p.includes("node_modules/")) return false
                return p !== "package.json" && p.endsWith("/package.json")
              })
              .map((item) => item.path)

            if (subPaths.length > 0) {
              logger?.info(
                "ingest",
                `Found ${subPaths.length} monorepo package.json manifest(s) in repository tree`,
                { subPaths },
              )
              const manifests = [
                { dir: "root", pkgPath: "package.json", pkgObj, lockObj },
              ]
              for (const subPath of subPaths) {
                const dir = subPath.slice(0, subPath.lastIndexOf("/"))
                const subPkg = await fetchGitHubFile(
                  owner,
                  repo,
                  subPath,
                  true,
                  branch,
                  logger,
                )
                if (
                  !subPkg ||
                  typeof subPkg !== "object" ||
                  Array.isArray(subPkg)
                )
                  continue
                const subLockPath = `${dir}/package-lock.json`
                const subLock = await fetchGitHubFile(
                  owner,
                  repo,
                  subLockPath,
                  true,
                  branch,
                  logger,
                )
                manifests.push({
                  dir,
                  pkgPath: subPath,
                  pkgObj: subPkg,
                  lockObj: subLock,
                })
              }

              if (manifests.length > 1) {
                return mergeMonorepoManifests(repo, manifests, logger)
              }
            }
          } catch {
            // If tree discovery fails, continue cleanly with root package
          }
        }
      } else {
        // C. Root package.json returned 404: Auto-discover via GitHub Trees API
        logger?.info(
          "ingest",
          "Root package.json not found; discovering manifests via Git Trees API",
        )
        const tree = await fetchGitHubTree(
          owner,
          repo,
          branch || "HEAD",
          logger,
        )
        const packagePaths = tree
          .filter((item) => {
            if (!item || typeof item.path !== "string") return false
            const p = item.path
            if (item.type && item.type !== "blob") return false
            if (p.includes("node_modules/")) return false
            return p === "package.json" || p.endsWith("/package.json")
          })
          .map((item) => item.path)

        if (packagePaths.length === 0) {
          throw new AppError("No package.json found in this repository", 400)
        }

        logger?.info(
          "ingest",
          `Discovered ${packagePaths.length} package.json file(s) in repository`,
          { packagePaths },
        )

        if (packagePaths.length === 1) {
          const singlePath = packagePaths[0]
          const dir = singlePath.includes("/")
            ? singlePath.slice(0, singlePath.lastIndexOf("/"))
            : ""
          pkgObj = await fetchGitHubFile(
            owner,
            repo,
            singlePath,
            false,
            branch,
            logger,
          )
          const lockPath = dir
            ? `${dir}/package-lock.json`
            : "package-lock.json"
          lockObj = await fetchGitHubFile(
            owner,
            repo,
            lockPath,
            true,
            branch,
            logger,
          )
        } else {
          // Multiple package.json manifests: merge into unified project dependencies
          const manifests = []
          for (const pkgPath of packagePaths) {
            const dir = pkgPath.includes("/")
              ? pkgPath.slice(0, pkgPath.lastIndexOf("/"))
              : ""
            const pkg = await fetchGitHubFile(
              owner,
              repo,
              pkgPath,
              true,
              branch,
              logger,
            )
            if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) continue
            const lockPath = dir
              ? `${dir}/package-lock.json`
              : "package-lock.json"
            const lock = await fetchGitHubFile(
              owner,
              repo,
              lockPath,
              true,
              branch,
              logger,
            )
            manifests.push({ dir, pkgPath, pkgObj: pkg, lockObj: lock })
          }

          if (manifests.length === 0) {
            throw new AppError("No package.json found in this repository", 400)
          }

          return mergeMonorepoManifests(repo, manifests, logger)
        }
      }
    }
  }
  // 2. Ingest from Upload / inline payload
  else if (
    sourceType === "upload" ||
    sourceType === "package_json" ||
    packageJson
  ) {
    logger?.info("ingest", "Ingesting manifest from uploaded / inline JSON", {
      hasPackageJson: Boolean(packageJson),
      hasPackageLockJson: Boolean(packageLockJson),
    })

    if (typeof packageJson === "string") {
      try {
        pkgObj = JSON.parse(packageJson)
      } catch {
        throw new AppError("package.json is not valid JSON", 400)
      }
    } else if (packageJson && typeof packageJson === "object") {
      pkgObj = packageJson
    } else {
      throw new AppError("package.json is required", 400)
    }

    if (packageLockJson) {
      if (typeof packageLockJson === "string") {
        try {
          lockObj = JSON.parse(packageLockJson)
        } catch {
          lockObj = null
        }
      } else if (typeof packageLockJson === "object") {
        lockObj = packageLockJson
      }
    }
  } else {
    throw new AppError("Invalid sourceType. Must be 'github' or 'upload'", 400)
  }

  if (!pkgObj || typeof pkgObj !== "object" || Array.isArray(pkgObj)) {
    throw new AppError("package.json must be a JSON object", 400)
  }

  const projectName =
    typeof pkgObj.name === "string" && pkgObj.name.trim()
      ? pkgObj.name.trim()
      : "unnamed-project"
  const enginesNode = pkgObj.engines?.node || null

  const lockfileData = lockObj ? extractLockfileVersions(lockObj) : null
  const hasLockfile = Boolean(lockfileData && lockfileData.versionMap.size > 0)

  const dependencies = []
  const directNames = new Set()

  // Helper to extract sections
  const extractSection = (sectionName, sectionKey) => {
    const group = pkgObj[sectionKey]
    if (!group || typeof group !== "object" || Array.isArray(group)) return

    for (const [name, declaredVersionRaw] of Object.entries(group)) {
      if (typeof name !== "string" || !name.trim()) continue
      const declaredVersion =
        typeof declaredVersionRaw === "string"
          ? declaredVersionRaw.trim()
          : String(declaredVersionRaw || "")
      directNames.add(name)

      let resolvedVersion = null
      let isUnpinned = false

      if (hasLockfile && lockfileData.versionMap.has(name)) {
        resolvedVersion = lockfileData.versionMap.get(name)
        isUnpinned = false
      } else {
        isUnpinned = isVersionUnpinned(declaredVersion)
        resolvedVersion = semver.coerce(declaredVersion)?.version || null
      }

      dependencies.push({
        name,
        declaredVersion,
        resolvedVersion,
        section: sectionName,
        isDirect: true,
        isUnpinned,
      })
    }
  }

  extractSection("dependencies", "dependencies")
  extractSection("devDependencies", "devDependencies")

  // Lockfile-First: Extract transitive dependencies
  if (hasLockfile) {
    let transitiveCount = 0
    for (const [name, resolvedVersion] of lockfileData.allPackages.entries()) {
      if (directNames.has(name)) continue
      if (transitiveCount >= MAX_TRANSITIVE_PACKAGES) break

      dependencies.push({
        name,
        declaredVersion: resolvedVersion,
        resolvedVersion,
        section: "dependencies",
        isDirect: false,
        isUnpinned: false,
      })
      transitiveCount += 1
    }
  }

  const directCount = dependencies.filter((d) => d.isDirect).length
  const transitiveCount = dependencies.filter((d) => !d.isDirect).length

  logger?.info("ingest", "Manifest ingest stage completed", {
    projectName,
    hasLockfile,
    directCount,
    transitiveCount,
    totalDependencies: dependencies.length,
  })

  return {
    projectName,
    hasLockfile,
    enginesNode,
    dependencies,
  }
}
