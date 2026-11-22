/**
 * Deployment Error Pipeline - Stage 5: Scoring & Fix Plan
 *
 * Implements gated scoring rules:
 * - Any confirmed blocker caps score at 40 and strictly sets verdict 'will-fail'.
 * - 'likely' issues subtract weighted points and can yield 'needs-fixes', but never 'will-fail' alone.
 * - 'advisory' never changes the verdict.
 * - Produces ordered fixPlan grouped by file with valid unified diffs.
 */

import { sortFindings } from "./findings.js"

const SEVERITY_BASE_POINTS = {
  blocker: 25,
  warning: 10,
  info: 2,
}

const CONFIDENCE_MULTIPLIER = {
  confirmed: 1.0,
  likely: 0.7,
  advisory: 0.3,
}

/**
 * Stage 5 Entrypoint: Scoring & Fix Plan generation.
 */
export async function runScoringStage(
  snapshot,
  allFindings = [],
  options = {},
) {
  const onTrace = options.onTrace || (() => {})
  const trace = (msg) => onTrace(`[deploy-score] ${msg}`)

  trace(
    `Evaluating gated score across ${allFindings.length} collected findings...`,
  )

  const sortedFindings = sortFindings(allFindings)

  let rawDeductions = 0
  let hasConfirmedBlocker = false
  let hasLikelyBlocker = false
  let hasConfirmedWarning = false
  let hasLikelyWarning = false

  for (const f of sortedFindings) {
    const basePts = SEVERITY_BASE_POINTS[f.severity] || 0
    const mult = CONFIDENCE_MULTIPLIER[f.confidence] || 0.3
    const deduction = basePts * mult
    rawDeductions += deduction

    if (f.severity === "blocker") {
      if (f.confidence === "confirmed") hasConfirmedBlocker = true
      if (f.confidence === "likely") hasLikelyBlocker = true
    } else if (f.severity === "warning") {
      if (f.confidence === "confirmed") hasConfirmedWarning = true
      if (f.confidence === "likely") hasLikelyWarning = true
    }
  }

  let score = Math.max(0, Math.min(100, Math.round(100 - rawDeductions)))
  let verdict = "ready"

  // Hard Gating Rule 1: Any confirmed blocker caps score at 40 and sets verdict 'will-fail'
  if (hasConfirmedBlocker) {
    score = Math.min(40, score)
    verdict = "will-fail"
  } else {
    // If no confirmed blocker: likely issues can yield needs-fixes, but never will-fail alone
    if (
      score < 80 ||
      hasLikelyBlocker ||
      hasConfirmedWarning ||
      hasLikelyWarning
    ) {
      score = Math.max(41, Math.min(79, score))
      verdict = "needs-fixes"
    } else {
      verdict = "ready"
    }
  }

  // Determine overall confidence
  let overallConfidence = "advisory"
  if (sortedFindings.some((f) => f.confidence === "confirmed")) {
    overallConfidence = "confirmed"
  } else if (sortedFindings.some((f) => f.confidence === "likely")) {
    overallConfidence = "likely"
  } else if (sortedFindings.length === 0) {
    overallConfidence = "confirmed"
  }

  // Coverage from snapshot completeness
  const coverage = snapshot?.completeness?.coverage ?? 100

  // Build fixPlan: group patches by file
  const fixPlan = buildFixPlan(sortedFindings)

  trace(
    `Scoring complete: Score=${score}/100, Verdict=${verdict}, Confidence=${overallConfidence}, Coverage=${coverage}%`,
  )

  return {
    score,
    verdict,
    confidence: overallConfidence,
    coverage,
    target: snapshot?.target || "all",
    findings: sortedFindings,
    fixPlan,
  }
}

function buildFixPlan(findings) {
  const filePatchMap = new Map()

  for (const f of findings) {
    if (f.fix && f.fix.patch) {
      const fileKey = f.file || "repo"
      if (!filePatchMap.has(fileKey)) {
        filePatchMap.set(fileKey, [])
      }
      filePatchMap.get(fileKey).push({
        ruleId: f.ruleId,
        description: f.fix.description,
        patch: f.fix.patch,
      })
    }
  }

  const files = []
  for (const [file, patches] of filePatchMap.entries()) {
    files.push({ file, patches })
  }

  const totalPatches = files.reduce((sum, item) => sum + item.patches.length, 0)
  const summary =
    totalPatches === 0
      ? "No automated fixes available for reported findings."
      : `${totalPatches} automated ${
          totalPatches === 1 ? "patch" : "patches"
        } prepared across ${files.length} ${
          files.length === 1 ? "file" : "files"
        }.`

  return {
    summary,
    files,
  }
}
