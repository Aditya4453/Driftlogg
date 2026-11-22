export const RULE_VERSION = "2026.11.1"

/**
 * Stage 4: Versioned Evidence-Backed Scoring Engine
 *
 * Evaluates security advisories (OSV, CISA KEV, EPSS), maintenance signals
 * (deprecation, libyears drift, Scorecard), and ecosystem metrics to produce
 * deterministic, evidence-backed risk scores and release readiness verdicts.
 */
export function scoreDependencies(
  dependencies,
  vulnMap,
  enrichMap,
  options = {},
  logger = null,
) {
  const { blockThresholdScore = 70, flagArchivedRepositories = true } = options

  const reports = []

  for (const dep of dependencies) {
    const secData = vulnMap.get(dep.name) || { vulns: [], isMalware: false }
    const enrichData = enrichMap.get(dep.name) || {}

    const vulns = secData.vulns || []
    const isMalware = Boolean(
      secData.isMalware || vulns.some((v) => v.isMalware),
    )
    const hasKev = Boolean(vulns.some((v) => v.kev === true))

    let score = 0
    const evidence = []
    const reasons = []

    // 1. Malware Detection (MAL-*) -> +95 pts
    if (isMalware) {
      score += 95
      evidence.push({
        rule: "malware-advisory",
        points: 95,
        detail:
          "Known malicious package identified in security advisories (MAL-*)",
      })
      reasons.push("Identified as malware in security advisory")
    }

    // 2. CISA KEV Active Exploit -> +75 pts
    if (hasKev) {
      const kevVuln = vulns.find((v) => v.kev)
      score += 75
      evidence.push({
        rule: "cisa-kev-exploited",
        points: 75,
        detail: `Actively exploited vulnerability listed on CISA KEV: ${kevVuln?.cve || kevVuln?.id || "Known CVE"}`,
      })
      reasons.push("Vulnerability actively exploited in the wild (CISA KEV)")
    }

    // 3. Vulnerability Severity: High EPSS (>= 0.5) or Critical/High CVSS (>= 7.0) -> +50 pts
    // Or moderate advisory -> +30 pts
    if (!isMalware && !hasKev && vulns.length > 0) {
      const hasHighExploit = vulns.some((v) => {
        if (typeof v.epss === "number" && v.epss >= 0.5) return true
        const sevStr = String(v.severity || "").toUpperCase()
        if (sevStr.includes("CRITICAL") || sevStr.includes("HIGH")) return true
        const numScore = parseFloat(v.severity)
        return !isNaN(numScore) && numScore >= 7.0
      })

      if (hasHighExploit) {
        score += 50
        evidence.push({
          rule: "high-exploit-likelihood",
          points: 50,
          detail:
            "Vulnerability with high exploit probability (EPSS >= 0.5) or Critical/High CVSS severity (>= 7.0)",
        })
        reasons.push("High exploit probability or critical/high CVSS severity")
      } else {
        score += 30
        evidence.push({
          rule: "moderate-advisory",
          points: 30,
          detail: "Moderate security vulnerability reported",
        })
        reasons.push("Moderate security vulnerability reported")
      }
    }

    // 4. Official npm Deprecation or Archived Repository -> +45 pts
    const isDeprecated = Boolean(enrichData.deprecated)
    const isArchived = Boolean(
      flagArchivedRepositories && enrichData.isArchived,
    )
    if (isDeprecated || isArchived) {
      score += 45
      const detail = isDeprecated
        ? `Officially deprecated on npm: ${enrichData.deprecated}`
        : "Source repository is archived by maintainers"
      evidence.push({
        rule: "deprecated-or-archived",
        points: 45,
        detail,
      })
      reasons.push(
        isDeprecated
          ? "Package officially marked deprecated on npm"
          : "Source repository is archived",
      )
    }

    // 5. Version Drift (libyears >= 2.0) -> +20 pts
    if (typeof enrichData.libyears === "number" && enrichData.libyears >= 2.0) {
      score += 20
      evidence.push({
        rule: "stale-libyears",
        points: 20,
        detail: `Version drift: ${enrichData.libyears} libyears behind latest release`,
      })
      reasons.push(
        `Package version is ${enrichData.libyears} years behind latest release`,
      )
    }

    // 6. Low OpenSSF Scorecard (scorecard < 4.0) -> +15 pts
    if (
      typeof enrichData.scorecard === "number" &&
      enrichData.scorecard > 0 &&
      enrichData.scorecard < 4.0
    ) {
      score += 15
      evidence.push({
        rule: "low-scorecard",
        points: 15,
        detail: `Low OpenSSF Scorecard maintenance score: ${enrichData.scorecard}/10`,
      })
      reasons.push(
        `Low maintainership and security health scorecard (${enrichData.scorecard}/10)`,
      )
    }

    // 7. Unpinned Wildcard (isUnpinned === true) -> +20 pts
    if (dep.isUnpinned === true) {
      score += 20
      evidence.push({
        rule: "unpinned-version",
        points: 20,
        detail:
          "Dependency declared with unpinned wildcard range (*, latest, x)",
      })
      reasons.push(
        "Unpinned dependency version wildcard allows untested upstream changes",
      )
    }

    // 8. Lifecycle Install Script (hasInstallScript === true) -> +10 pts
    if (enrichData.hasInstallScript === true) {
      score += 10
      evidence.push({
        rule: "install-script-present",
        points: 10,
        detail:
          "Package executes arbitrary lifecycle scripts during install (preinstall/install/postinstall)",
      })
      reasons.push("Executes install-time lifecycle scripts")
    }

    // Weight multiplier: 0.75x for transitive or devDependencies, unless malware or KEV
    if (
      (!dep.isDirect || dep.section === "devDependencies") &&
      !isMalware &&
      !hasKev
    ) {
      score = Math.round(score * 0.75)
    }

    // Clamp risk score to 0..100
    const riskScore = Math.min(100, Math.max(0, score))

    // Determine risk level (immediate high override for malware or active KEV exploit)
    let riskLevel = "low"
    if (isMalware || hasKev || riskScore >= blockThresholdScore) {
      riskLevel = "high"
    } else if (riskScore >= 35) {
      riskLevel = "medium"
    }

    // Generate plain-English actionable suggestion
    let suggestion =
      "No immediate action required. Maintain continuous monitoring."
    if (isMalware) {
      suggestion = "Remove immediately. Package identified as malicious."
    } else if (hasKev) {
      const fix = vulns.find((v) => v.fixedIn)?.fixedIn
      suggestion = fix
        ? `CRITICAL: Actively exploited vulnerability (CISA KEV). Upgrade immediately to version ${fix} or higher.`
        : "CRITICAL: Actively exploited vulnerability (CISA KEV). Isolate or replace this package immediately."
    } else if (vulns.some((v) => v.fixedIn)) {
      const fix = vulns.find((v) => v.fixedIn).fixedIn
      suggestion = `Upgrade to version ${fix} or higher to resolve known vulnerabilities.`
    } else if (enrichData.replacement) {
      suggestion = `Migrate to modern replacement: ${enrichData.replacement.name}.`
    } else if (isDeprecated) {
      suggestion = "Replace package: officially marked as deprecated on npm."
    } else if (enrichData.libyears >= 2.0) {
      suggestion = `Update package to close ${enrichData.libyears} libyears version drift.`
    } else if (dep.isUnpinned) {
      suggestion = "Pin package version to a concrete tested release."
    }

    reports.push({
      packageName: dep.name,
      version: dep.resolvedVersion || dep.declaredVersion || "unknown",
      dependencyType: dep.section || "dependencies",
      isDirect: dep.isDirect !== false,
      workspace: dep.workspace || undefined,
      riskLevel,
      riskScore,
      reasons: reasons.length > 0 ? reasons : ["No critical risks detected"],
      signals: {
        lastCommit: enrichData.lastCommit || null,
        openIssues: enrichData.openIssues || 0,
        lastRelease: enrichData.lastRelease || null,
        weeklyDownloads: enrichData.weeklyDownloads || 0,
        deprecated: isDeprecated,
        libyears: enrichData.libyears || 0,
        scorecard: enrichData.scorecard || null,
        hasInstallScript: Boolean(enrichData.hasInstallScript),
        isUnpinned: Boolean(dep.isUnpinned),
      },
      suggestion,
      evidence,
      replacement: enrichData.replacement || undefined,
      ruleVersion: RULE_VERSION,
    })
  }

  // Summary and release verdict metrics
  const highRiskCount = reports.filter((r) => r.riskLevel === "high").length
  const mediumRiskCount = reports.filter((r) => r.riskLevel === "medium").length
  const lowRiskCount = reports.filter((r) => r.riskLevel === "low").length

  const verdict =
    highRiskCount > 0 ? "blocked" : mediumRiskCount > 0 ? "review" : "ready"
  const overallScore =
    reports.length > 0
      ? Math.max(
          10,
          Math.min(
            100,
            Math.round(100 - (highRiskCount * 14 + mediumRiskCount * 4)),
          ),
        )
      : 100

  logger?.info("scoring", "Scoring engine evaluated dependencies", {
    highRiskCount,
    mediumRiskCount,
    lowRiskCount,
    overallScore,
    verdict,
    totalDependencies: reports.length,
  })

  return {
    reports,
    summary: {
      verdict,
      overallScore,
      totalDependencies: reports.length,
      highRiskCount,
      mediumRiskCount,
      lowRiskCount,
      ruleVersion: RULE_VERSION,
    },
  }
}
