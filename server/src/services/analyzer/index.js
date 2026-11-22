import { ingestManifest } from "./ingest.stage.js"
import { analyzeSecurity } from "./security.stage.js"
import { enrichDependencies } from "./enrich.stage.js"
import { scoreDependencies, RULE_VERSION } from "./scoring.stage.js"

export * from "./ingest.stage.js"
export * from "./security.stage.js"
export * from "./enrich.stage.js"
export * from "./scoring.stage.js"

/**
 * Executes the complete 4-stage dependency analysis pipeline:
 * Stage 1: Manifest Ingest (lockfile-first)
 * Stage 2: Security Sweep (OSV, CISA KEV, EPSS)
 * Stage 3: Ecosystem Enrichment (npm registry, deps.dev, e18e)
 * Stage 4: Evidence-Backed Scoring & Release Verdict
 *
 * @param {object} input
 * @param {object} [logger=null] Optional scan logger
 */
export async function runDependencyAnalysis(input, logger = null) {
  // Stage 1: Manifest Ingest
  const manifest = await ingestManifest(input, logger)

  // Stage 2: Security Sweep
  const security = await analyzeSecurity(manifest.dependencies, logger)

  // Stage 3: Ecosystem Enrichment
  const enrichment = await enrichDependencies(manifest.dependencies, logger)

  // Stage 4: Evidence-Backed Scoring
  const scored = scoreDependencies(
    manifest.dependencies,
    security.vulnMap,
    enrichment.enrichMap,
    input?.options,
    logger,
  )

  // Consolidated upstream telemetry
  const sourcesUnavailable = Array.from(
    new Set([...security.sourcesUnavailable, ...enrichment.sourcesUnavailable]),
  )

  return {
    projectName: manifest.projectName,
    hasLockfile: manifest.hasLockfile,
    enginesNode: manifest.enginesNode,
    dependencies: manifest.dependencies,
    reports: scored.reports,
    summary: scored.summary,
    sourcesUnavailable,
    ruleVersion: RULE_VERSION,
  }
}
