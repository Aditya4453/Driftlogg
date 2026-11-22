/**
 * Deployment Error Pipeline - Finding Schema & Helpers
 *
 * Every finding strictly conforms to:
 * { ruleId, stage, severity, confidence, file, line, snippet, platform, message, fix }
 */

export const SEVERITIES = Object.freeze(["blocker", "warning", "info"])
export const CONFIDENCES = Object.freeze(["confirmed", "likely", "advisory"])
export const STAGES = Object.freeze([
  "ingest",
  "config",
  "code",
  "boot",
  "scoring",
])
export const PLATFORMS = Object.freeze([
  "render",
  "vercel",
  "docker",
  "railway",
  "all",
])

/**
 * Creates and validates a single deployment pipeline finding.
 */
export function createFinding({
  ruleId,
  aliases = [],
  stage,
  severity,
  confidence,
  file,
  line = 1,
  snippet = "",
  platform = "all",
  message,
  fix = null,
}) {
  if (!ruleId || typeof ruleId !== "string") {
    throw new Error("createFinding: ruleId is required")
  }
  if (!STAGES.includes(stage)) {
    throw new Error(`createFinding: invalid stage "${stage}"`)
  }
  if (!SEVERITIES.includes(severity)) {
    throw new Error(`createFinding: invalid severity "${severity}"`)
  }
  if (!CONFIDENCES.includes(confidence)) {
    throw new Error(`createFinding: invalid confidence "${confidence}"`)
  }
  if (!file || typeof file !== "string") {
    file = "repo"
  }

  const validFix =
    fix && fix.description
      ? {
          description: String(fix.description),
          patch: typeof fix.patch === "string" ? fix.patch : "",
        }
      : null

  return Object.freeze({
    ruleId,
    aliases: Object.freeze(Array.isArray(aliases) ? [...aliases] : []),
    stage,
    severity,
    confidence,
    file,
    line: Math.max(1, Number(line) || 1),
    snippet: typeof snippet === "string" ? snippet : "",
    platform: PLATFORMS.includes(platform) ? platform : "all",
    message: String(message || ""),
    fix: validFix,
  })
}

/**
 * Creates a valid unified diff string for a file fix.
 * @param {object} opts
 * @param {string} opts.file - Relative file path (e.g. "server.js")
 * @param {number} [opts.originalLine=1] - 1-based original line number
 * @param {string} opts.originalText - Text to be replaced
 * @param {string} opts.newText - Replacement text
 * @returns {string} Unified diff patch
 */
export function createUnifiedDiff({
  file,
  originalLine = 1,
  originalText = "",
  newText = "",
}) {
  const cleanFile = (file || "file").replace(/^\/+/, "")
  const oldLines = originalText ? originalText.split(/\r?\n/) : []
  const newLines = newText ? newText.split(/\r?\n/) : []

  const oldLen = oldLines.length
  const newLen = newLines.length
  const startLine = Math.max(1, originalLine)

  let diff = `--- a/${cleanFile}\n+++ b/${cleanFile}\n@@ -${startLine},${oldLen} +${startLine},${newLen} @@\n`

  for (const line of oldLines) {
    diff += `-${line}\n`
  }
  for (const line of newLines) {
    diff += `+${line}\n`
  }

  return diff
}

/**
 * Formats a finding into a single streamable trace line:
 * "[deploy-<stage>] [<CONFIDENCE>] <severity>: <message>"
 */
export function formatTraceLine(stage, finding) {
  const conf = (finding.confidence || "advisory").toUpperCase()
  const sev = finding.severity || "info"
  const fileStr =
    finding.file && finding.file !== "repo"
      ? ` (${finding.file}:${finding.line})`
      : ""
  return `[deploy-${stage}] [${conf}] ${sev}: ${finding.message}${fileStr}`
}

/**
 * Sorts findings by severity (blocker -> warning -> info)
 * then by confidence (confirmed -> likely -> advisory).
 */
export function sortFindings(findings = []) {
  const severityRank = { blocker: 0, warning: 1, info: 2 }
  const confidenceRank = { confirmed: 0, likely: 1, advisory: 2 }

  return [...findings].sort((a, b) => {
    const sA = severityRank[a.severity] ?? 3
    const sB = severityRank[b.severity] ?? 3
    if (sA !== sB) return sA - sB

    const cA = confidenceRank[a.confidence] ?? 3
    const cB = confidenceRank[b.confidence] ?? 3
    if (cA !== cB) return cA - cB

    return a.file.localeCompare(b.file) || a.line - b.line
  })
}
