const CISA_KEV_URL =
  "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"
const OSV_QUERY_BATCH_URL = "https://api.osv.dev/v1/querybatch"
const OSV_VULN_BASE_URL = "https://api.osv.dev/v1/vulns"
const EPSS_BASE_URL = "https://api.first.org/data/v1/epss"

const CISA_CACHE_TTL_MS = 12 * 60 * 60 * 1000 // 12 hours

// In-memory cache for CISA Known Exploited Vulnerabilities
let cisaKevCache = {
  cves: new Set(),
  lastFetched: 0,
}

/**
 * Resets the CISA KEV in-memory cache (primarily for unit/integration testing).
 */
export function _resetCisaCacheForTesting() {
  cisaKevCache = {
    cves: new Set(),
    lastFetched: 0,
  }
}

/**
 * Fetches or returns cached CISA KEV CVE list.
 */
async function getCisaKevCves(sourcesUnavailable) {
  const now = Date.now()
  if (
    cisaKevCache.cves.size > 0 &&
    now - cisaKevCache.lastFetched < CISA_CACHE_TTL_MS
  ) {
    return cisaKevCache.cves
  }

  try {
    const res = await fetch(CISA_KEV_URL, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "DriftLogg-Analyzer" },
    })

    if (!res.ok) {
      sourcesUnavailable.push("cisa-kev")
      return cisaKevCache.cves // fallback to stale cache if available
    }

    const data = await res.json()
    const cves = new Set()
    if (Array.isArray(data?.vulnerabilities)) {
      for (const item of data.vulnerabilities) {
        if (item?.cveID) cves.add(item.cveID.toUpperCase())
      }
    }

    cisaKevCache = { cves, lastFetched: now }
    return cves
  } catch {
    sourcesUnavailable.push("cisa-kev")
    return cisaKevCache.cves
  }
}

/**
 * Extracts a fixed version string from OSV affected ranges.
 */
function extractFixedVersion(affected) {
  if (!Array.isArray(affected)) return null
  for (const item of affected) {
    if (!Array.isArray(item?.ranges)) continue
    for (const range of item.ranges) {
      if (!Array.isArray(range?.events)) continue
      for (const event of range.events) {
        if (event?.fixed) return String(event.fixed)
      }
    }
  }
  return null
}

/**
 * Extracts CVSS or severity representation from OSV vulnerability record.
 */
function extractSeverity(vulnData) {
  if (Array.isArray(vulnData?.severity) && vulnData.severity.length > 0) {
    const cvss =
      vulnData.severity.find((s) => s.type?.includes("CVSS")) ||
      vulnData.severity[0]
    if (cvss?.score) return cvss.score
  }
  if (vulnData?.database_specific?.severity) {
    return String(vulnData.database_specific.severity)
  }
  return null
}

/**
 * Batch queries FIRST.org EPSS scores in chunks keeping URL length under 1,800 characters.
 */
async function fetchEpssScores(cveList, sourcesUnavailable) {
  const epssMap = new Map()
  if (!cveList || cveList.length === 0) return epssMap

  // Chunk CVEs into batches of ~50 to ensure URL stays well under 1,800 characters
  const chunks = []
  let currentChunk = []
  let currentLength = EPSS_BASE_URL.length + 6 // "?cve="

  for (const cve of cveList) {
    const addedLength = cve.length + 1
    if (currentLength + addedLength > 1750 || currentChunk.length >= 50) {
      chunks.push(currentChunk)
      currentChunk = [cve]
      currentLength = EPSS_BASE_URL.length + 6 + cve.length
    } else {
      currentChunk.push(cve)
      currentLength += addedLength
    }
  }
  if (currentChunk.length > 0) chunks.push(currentChunk)

  for (const chunk of chunks) {
    try {
      const url = `${EPSS_BASE_URL}?cve=${chunk.join(",")}`
      const res = await fetch(url, {
        signal: AbortSignal.timeout(8000),
        headers: { "User-Agent": "DriftLogg-Analyzer" },
      })

      if (!res.ok) {
        if (!sourcesUnavailable.includes("epss"))
          sourcesUnavailable.push("epss")
        continue
      }

      const body = await res.json()
      if (Array.isArray(body?.data)) {
        for (const item of body.data) {
          if (item?.cve && item?.epss !== undefined) {
            epssMap.set(item.cve.toUpperCase(), parseFloat(item.epss))
          }
        }
      }
    } catch {
      if (!sourcesUnavailable.includes("epss")) sourcesUnavailable.push("epss")
    }
  }

  return epssMap
}

/**
 * Stage 2: Exploit-Aware Security Sweep
 *
 * 1. Batch queries OSV.dev for known vulnerabilities.
 * 2. Fetches detailed advisory metadata (aliases, severity, fix version, MAL-* detection).
 * 3. Cross-references CVEs with CISA Known Exploited Vulnerabilities (KEV).
 * 4. Queries FIRST.org EPSS for exploit prediction scores.
 * 5. Returns a package-level vulnerability map and graceful tracking of failed sources.
 */
export async function analyzeSecurity(dependencies, logger = null) {
  const sourcesUnavailable = []
  const vulnMap = new Map()

  if (!Array.isArray(dependencies) || dependencies.length === 0) {
    return { vulnMap, sourcesUnavailable }
  }

  // Filter dependencies that have a resolved version
  const resolvableDeps = dependencies.filter(
    (d) => d && d.name && d.resolvedVersion,
  )
  if (resolvableDeps.length === 0) {
    return { vulnMap, sourcesUnavailable }
  }

  // 1. Batch OSV query
  let batchResults = []
  try {
    const queries = resolvableDeps.map((d) => ({
      package: { name: d.name, ecosystem: "npm" },
      version: d.resolvedVersion,
    }))

    logger?.info("security", "Dispatching OSV batch vulnerability query", {
      packageCount: queries.length,
    })

    const res = await fetch(OSV_QUERY_BATCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "DriftLogg-Analyzer",
      },
      body: JSON.stringify({ queries }),
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) {
      sourcesUnavailable.push("osv")
      logger?.warn("security", `OSV batch query returned HTTP ${res.status}`, {
        status: res.status,
      })
    } else {
      const data = await res.json()
      batchResults = Array.isArray(data?.results) ? data.results : []
      logger?.info("security", "OSV batch query responded successfully", {
        status: res.status,
        packageQueriesCount: queries.length,
      })
    }
  } catch (err) {
    sourcesUnavailable.push("osv")
    logger?.warn("security", "OSV batch query network failure", {
      error: err.message,
    })
  }

  // Collect unique vulnerability IDs across all dependencies
  const uniqueVulnIds = new Set()
  const depVulnIdsMap = new Map() // depName -> Array of OSV vuln IDs

  for (let i = 0; i < resolvableDeps.length; i += 1) {
    const dep = resolvableDeps[i]
    const resultItem = batchResults[i]
    const vulns = Array.isArray(resultItem?.vulns) ? resultItem.vulns : []

    const ids = []
    for (const v of vulns) {
      if (v?.id) {
        ids.push(v.id)
        uniqueVulnIds.add(v.id)
      }
    }
    depVulnIdsMap.set(dep.name, ids)
  }

  logger?.info("security", "OSV candidate advisory identification complete", {
    uniqueAdvisoriesFound: uniqueVulnIds.size,
    packagesWithAdvisories: Array.from(depVulnIdsMap.values()).filter(
      (ids) => ids.length > 0,
    ).length,
  })

  // 2. Fetch detailed vulnerability information for unique advisory IDs
  const vulnDetailsMap = new Map()
  const detailPromises = Array.from(uniqueVulnIds).map(async (id) => {
    try {
      const res = await fetch(
        `${OSV_VULN_BASE_URL}/${encodeURIComponent(id)}`,
        {
          signal: AbortSignal.timeout(8000),
          headers: { "User-Agent": "DriftLogg-Analyzer" },
        },
      )
      if (res.ok) {
        const detail = await res.json()
        vulnDetailsMap.set(id, detail)
      } else {
        vulnDetailsMap.set(id, { id })
      }
    } catch {
      vulnDetailsMap.set(id, { id })
    }
  })

  await Promise.allSettled(detailPromises)

  // 3. CISA KEV Check
  const cisaKevSet = await getCisaKevCves(sourcesUnavailable)
  logger?.info(
    "security",
    "CISA Known Exploited Vulnerabilities catalog loaded",
    {
      totalKevCvesInFeed: cisaKevSet.size,
    },
  )

  // 4. Collect unique CVEs for FIRST EPSS lookup
  const allCveIds = new Set()
  for (const [, detail] of vulnDetailsMap.entries()) {
    const aliases = Array.isArray(detail?.aliases) ? detail.aliases : []
    for (const alias of aliases) {
      if (typeof alias === "string" && alias.toUpperCase().startsWith("CVE-")) {
        allCveIds.add(alias.toUpperCase())
      }
    }
    if (
      typeof detail?.id === "string" &&
      detail.id.toUpperCase().startsWith("CVE-")
    ) {
      allCveIds.add(detail.id.toUpperCase())
    }
  }

  const epssMap = await fetchEpssScores(
    Array.from(allCveIds),
    sourcesUnavailable,
  )
  logger?.info("security", "FIRST EPSS scores queried", {
    cveCount: allCveIds.size,
    epssScoresResolved: epssMap.size,
  })

  // 5. Construct final vulnMap per dependency
  let totalAdvisoriesAttached = 0
  let totalMalwareCount = 0
  let totalKevCount = 0

  for (const dep of dependencies) {
    const rawIds = depVulnIdsMap.get(dep.name) || []
    if (rawIds.length === 0) continue

    const vulns = []
    let isMalware = false

    for (const id of rawIds) {
      const detail = vulnDetailsMap.get(id) || { id }
      const aliases = Array.isArray(detail.aliases) ? detail.aliases : []
      const cve =
        aliases.find(
          (a) => typeof a === "string" && a.toUpperCase().startsWith("CVE-"),
        ) || (id.toUpperCase().startsWith("CVE-") ? id : null)

      const vulnIsMalware =
        id.toUpperCase().startsWith("MAL-") ||
        aliases.some(
          (a) => typeof a === "string" && a.toUpperCase().startsWith("MAL-"),
        )

      if (vulnIsMalware) {
        isMalware = true
        totalMalwareCount += 1
      }

      // Check if CVE is listed in CISA KEV
      const isKev = Boolean(
        (cve && cisaKevSet.has(cve.toUpperCase())) ||
          aliases.some(
            (a) => typeof a === "string" && cisaKevSet.has(a.toUpperCase()),
          ) ||
          cisaKevSet.has(id.toUpperCase()),
      )
      if (isKev) totalKevCount += 1

      // Get EPSS score
      let epss = null
      if (cve && epssMap.has(cve.toUpperCase())) {
        epss = epssMap.get(cve.toUpperCase())
      } else if (id && epssMap.has(id.toUpperCase())) {
        epss = epssMap.get(id.toUpperCase())
      }

      vulns.push({
        id,
        aliases,
        cve,
        summary: detail.summary || detail.details || "",
        severity: extractSeverity(detail),
        fixedIn: extractFixedVersion(detail.affected),
        kev: isKev,
        epss,
        isMalware: vulnIsMalware,
      })
      totalAdvisoriesAttached += 1
    }

    vulnMap.set(dep.name, {
      vulns,
      isMalware,
    })
  }

  logger?.info("security", "Security sweep stage completed", {
    totalPackagesAnalyzed: dependencies.length,
    vulnerabilitiesFound: totalAdvisoriesAttached,
    malwarePackagesDetected: totalMalwareCount,
    cisaKevExploitsDetected: totalKevCount,
    sourcesUnavailable,
  })

  if (sourcesUnavailable.length > 0) {
    logger?.warn(
      "security",
      "One or more security upstream sources were unavailable",
      { sourcesUnavailable },
    )
  }

  return {
    vulnMap,
    sourcesUnavailable,
  }
}
