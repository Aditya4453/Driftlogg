/**
 * Deployment Error Pipeline - Master Orchestrator
 *
 * Statically analyzes repositories to predict deploy failures.
 * Plain Node.js (ESM), zero framework assumptions.
 */

import { runIngestStage } from "./deploy.ingest.stage.js"
import { runConfigStage } from "./deploy.config.stage.js"
import { runCodeStage } from "./deploy.code.stage.js"
import { runBootStage } from "./deploy.boot.stage.js"
import { runScoringStage } from "./deploy.scoring.stage.js"
import { formatTraceLine } from "./findings.js"

export * from "./findings.js"
export * from "./repo-snapshot.js"
export * from "./deploy.ingest.stage.js"
export * from "./deploy.config.stage.js"
export * from "./deploy.code.stage.js"
export * from "./deploy.boot.stage.js"
export * from "./deploy.scoring.stage.js"
export * from "./rules/index.js"

/**
 * Runs the complete 5-stage Deployment Error Pipeline.
 *
 * @param {string|object} input - GitHub URL, repo coordinates, or in-memory snapshot fixture
 * @param {object} [options]
 * @param {Function} [options.onTrace] - Real-time streaming trace line callback
 * @returns {Promise<object>} Complete deployment readiness assessment report
 */
export async function runDeploymentErrorPipeline(input, options = {}) {
  const onTrace = options.onTrace || (() => {})
  const emitTrace = (stage, msg) => onTrace(`[deploy-${stage}] ${msg}`)
  const emitFindingTrace = (stage, finding) =>
    onTrace(formatTraceLine(stage, finding))

  emitTrace("ingest", "Starting Deployment Error Pipeline execution...")

  // STAGE 1: Lockfile-First Ingest & RepoSnapshot Generation
  const ingestResult = await runIngestStage(input, {
    ...options,
    onTrace: (line) => onTrace(line),
  })

  const snapshot = ingestResult.snapshot
  const ingestFindings = ingestResult.findings || []
  for (const f of ingestFindings) {
    emitFindingTrace("ingest", f)
  }

  // STAGES 2 & 3: Run Config & Secrets and Code Traps concurrently in parallel
  emitTrace(
    "config",
    "Launching Stage 2 (Config) and Stage 3 (Code) in parallel...",
  )
  const [configFindings, codeFindings] = await Promise.all([
    runConfigStage(snapshot, {
      ...options,
      onTrace: (line) => onTrace(line),
    }),
    runCodeStage(snapshot, {
      ...options,
      onTrace: (line) => onTrace(line),
    }),
  ])

  for (const f of configFindings) {
    emitFindingTrace("config", f)
  }
  for (const f of codeFindings) {
    emitFindingTrace("code", f)
  }

  // STAGE 4: Boot & Health Simulation
  emitTrace("boot", "Launching Stage 4 (Boot & Health Simulation)...")
  const bootFindings = await runBootStage(snapshot, {
    ...options,
    onTrace: (line) => onTrace(line),
  })

  for (const f of bootFindings) {
    emitFindingTrace("boot", f)
  }

  // Aggregate all findings across stages
  const allFindings = [
    ...ingestFindings,
    ...configFindings,
    ...codeFindings,
    ...bootFindings,
  ]

  // STAGE 5: Scoring & Fix Plan
  emitTrace(
    "score",
    "Evaluating final gated deployment score and generating fix plan...",
  )
  const report = await runScoringStage(snapshot, allFindings, {
    ...options,
    onTrace: (line) => onTrace(line),
  })

  emitTrace(
    "score",
    `Pipeline completed: verdict=${report.verdict}, score=${report.score}/100, findings=${report.findings.length}`,
  )

  return report
}
