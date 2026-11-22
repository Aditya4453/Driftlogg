// Scan lifecycle: startScan -> markScanProcessing -> saveDependencies -> completeScan (or failScan).

// Every call to startScan creates a NEW Scan document; older scans and their reports are never overwritten.

import { Dependency, Project, RiskReport, Scan } from "../models/index.js"

import { DEPENDENCY_TYPES } from "../models/Dependency.js"

import { RISK_LEVELS } from "../models/shared.js"

import { AppError, assertObjectId, notFound } from "../utils/errors.js"

import { getProjectForUser } from "./project.service.js"

/** Converts a package.json object or string into dependency rows. */

export function extractDependencies(packageJson) {
  let parsed = packageJson

  if (typeof packageJson === "string") {
    try {
      parsed = JSON.parse(packageJson)
    } catch {
      throw new AppError("package.json must be a JSON object")
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AppError("package.json must be a JSON object")
  }

  const rows = []

  for (const dependencyType of DEPENDENCY_TYPES) {
    const group = parsed[dependencyType]

    if (group === undefined) continue

    if (!group || typeof group !== "object" || Array.isArray(group)) {
      throw new AppError(`package.json "${dependencyType}" must be an object`)
    }

    for (const [name, version] of Object.entries(group)) {
      if (typeof version !== "string")
        throw new AppError(`Version of "${name}" must be a string`)

      rows.push({ name, version, dependencyType })
    }
  }

  return rows
}

async function getScanOrThrow(scanId) {
  assertObjectId(scanId, "scan id")

  const scan = await Scan.findById(scanId)

  if (!scan) throw notFound("Scan")

  return scan
}

function assertScanOpen(scan) {
  if (scan.status === "completed" || scan.status === "failed") {
    throw new AppError(`Scan is already ${scan.status}`, 409)
  }
}

/** Creates a new queued scan with the next scan number for the project. */

export async function startScan(
  actor,
  projectId,
  { sourceType, repositoryUrl, packageJson } = {},
) {
  const project = await getProjectForUser(actor, projectId)

  const dependencyRows =
    packageJson && typeof packageJson === "object"
      ? extractDependencies(packageJson)
      : []

  let scan

  for (let attempt = 0; attempt < 5 && !scan; attempt += 1) {
    const last = await Scan.findOne({ project: project._id })
      .sort({ scanNumber: -1 })
      .select("scanNumber")

    try {
      scan = await Scan.create({
        project: project._id,

        workspace: project.workspace,

        triggeredBy: actor._id,

        scanNumber: (last?.scanNumber ?? 0) + 1,

        sourceType: sourceType || project.sourceType,

        repositoryUrl: repositoryUrl || project.repositoryUrl,
      })
    } catch (error) {
      if (error?.code !== 11000) throw error // duplicate scanNumber from a parallel request: retry
    }
  }

  if (!scan) throw new AppError("Could not start scan, please retry", 409)

  await Project.updateOne({ _id: project._id }, {
    $set: { status: "analyzing" },
  })

  if (dependencyRows.length) await saveDependencies(scan._id, dependencyRows)

  return scan
}

export async function markScanProcessing(scanId) {
  const scan = await getScanOrThrow(scanId)

  assertScanOpen(scan)

  scan.status = "processing"

  return scan.save()
}

/** Stores the dependency snapshot of a scan. Existing rows for the same package are left unchanged. */

export async function saveDependencies(scanId, rows) {
  const scan = await getScanOrThrow(scanId)

  assertScanOpen(scan)

  if (!Array.isArray(rows)) throw new AppError("Dependencies must be an array")

  const operations = rows.map((row) => ({
    updateOne: {
      filter: {
        scan: scan._id,
        name: row.name,
        dependencyType: row.dependencyType || "dependencies",
      },

      update: {
        $setOnInsert: {
          project: scan.project,

          scan: scan._id,

          name: row.name,

          version: row.version,

          dependencyType: row.dependencyType || "dependencies",

          rawData: row.rawData,
        },
      },

      upsert: true,
    },
  }))

  // Validate every row with the schema before writing anything.

  await Promise.all(
    rows.map((row) =>
      new Dependency({
        ...row,
        project: scan.project,
        scan: scan._id,
      }).validate(),
    ),
  )

  if (operations.length)
    await Dependency.bulkWrite(operations, { ordered: false })

  return Dependency.find({ scan: scan._id }).sort({ name: 1 })
}

function summarize(reports) {
  const summary = {
    totalDependencies: reports.length,
    high: 0,
    medium: 0,
    low: 0,
    averageRiskScore: 0,
  }

  let total = 0

  for (const report of reports) {
    summary[report.riskLevel] += 1

    total += report.riskScore
  }

  summary.averageRiskScore = reports.length
    ? Math.round((total / reports.length) * 10) / 10
    : 0

  return summary
}

/** Points the project at its newest completed scan and copies that scan's summary. */

async function refreshProjectSnapshot(projectId) {
  const latest = await Scan.findOne({
    project: projectId,
    status: "completed",
  }).sort({ scanNumber: -1 })

  if (!latest) return

  await Project.updateOne(
    { _id: projectId },

    {
      $set: {
        latestScan: latest._id,
        lastScannedAt: latest.completedAt,
        summary: latest.summary,
        status: "completed",
      },
    },
  )
}

/**
 * Completes a scan and stores one immutable RiskReport per analysed package.
 * results: Array of report objects, or results object { dependencies, reports, verdict, overallScore, sourcesUnavailable, ruleVersion, ... }
 */

export async function completeScan(scanId, results) {
  const scan = await getScanOrThrow(scanId)

  assertScanOpen(scan)

  let reportList = []

  let verdict

  let overallScore

  let sourcesUnavailable = []

  let ruleVersion

  let rawDependencies = []

  let highRiskCount

  let mediumRiskCount

  let lowRiskCount

  if (Array.isArray(results)) {
    reportList = results
  } else if (results && typeof results === "object") {
    reportList = Array.isArray(results.reports) ? results.reports : []

    verdict = results.verdict || results.summary?.verdict

    overallScore = results.overallScore ?? results.summary?.overallScore

    sourcesUnavailable = results.sourcesUnavailable || []

    ruleVersion = results.ruleVersion || results.summary?.ruleVersion

    rawDependencies = results.dependencies || []

    highRiskCount = results.highRiskCount ?? results.summary?.highRiskCount

    mediumRiskCount =
      results.mediumRiskCount ?? results.summary?.mediumRiskCount

    lowRiskCount = results.lowRiskCount ?? results.summary?.lowRiskCount
  } else {
    throw new AppError("Scan results must be an array or results object")
  }

  for (const result of reportList) {
    const level = String(result.riskLevel || "").toLowerCase()

    if (!RISK_LEVELS.includes(level))
      throw new AppError(`Invalid risk level for "${result.packageName}"`)

    result.riskLevel = level
  }

  // If rawDependencies are provided from the manifest/analyzer, persist them

  if (rawDependencies.length) {
    const missingRaw = []

    for (const dep of rawDependencies) {
      const exists = await Dependency.exists({ scan: scan._id, name: dep.name })

      if (!exists) {
        missingRaw.push({
          name: dep.name,

          version: dep.resolvedVersion || dep.declaredVersion || "unknown",

          dependencyType: dep.section || "dependencies",

          rawData: dep,
        })
      }
    }

    if (missingRaw.length) await saveDependencies(scan._id, missingRaw)
  }

  // Make sure every analysed package has a Dependency row in this scan.

  const missing = []

  for (const result of reportList) {
    const exists = await Dependency.exists({
      scan: scan._id,
      name: result.packageName,
    })

    if (!exists)
      missing.push({
        name: result.packageName,
        version: result.version,
        dependencyType: result.dependencyType,
      })
  }

  if (missing.length) await saveDependencies(scan._id, missing)

  const dependencies = await Dependency.find({ scan: scan._id })

  const byName = new Map(dependencies.map((d) => [d.name, d]))

  const documents = reportList.map((result) => {
    const dependency = byName.get(result.packageName)

    return {
      scan: scan._id,

      project: scan.project,

      workspace: scan.workspace,

      dependency: dependency._id,

      packageName: result.packageName,

      version: result.version || dependency.version,

      riskLevel: result.riskLevel,

      riskScore: result.riskScore,

      reasons: result.reasons || [],

      signals: result.signals || {},

      suggestion: result.suggestion || "",

      evidence: result.evidence || [],

      replacement: result.replacement || undefined,

      ruleVersion: result.ruleVersion || ruleVersion || undefined,

      verdict: result.verdict || verdict || undefined,

      isDirect: result.isDirect !== undefined ? result.isDirect : true,

      dependencyType:
        result.dependencyType ||
        (dependency && dependency.dependencyType) ||
        "dependencies",
    }
  })

  try {
    await RiskReport.insertMany(documents, { ordered: true })
  } catch (error) {
    await RiskReport.deleteMany({ scan: scan._id }) // remove partial reports of THIS scan only

    await failScan(scan._id, "Saving risk reports failed")

    throw error
  }

  const completedAt = new Date()

  scan.status = "completed"

  scan.completedAt = completedAt

  scan.durationMs = Math.max(0, completedAt - scan.startedAt)

  const summary = summarize(documents)

  scan.summary = summary

  scan.verdict =
    verdict ||
    (summary.high > 0 ? "blocked" : summary.medium > 0 ? "review" : "ready")

  scan.overallScore =
    overallScore !== undefined
      ? overallScore
      : documents.length > 0
        ? Math.max(
            10,
            Math.min(
              100,
              Math.round(100 - (summary.high * 14 + summary.medium * 4)),
            ),
          )
        : 100

  if (sourcesUnavailable?.length) scan.sourcesUnavailable = sourcesUnavailable

  if (ruleVersion) scan.ruleVersion = ruleVersion

  await scan.save()

  await refreshProjectSnapshot(scan.project)

  return scan
}

export async function failScan(scanId, errorMessage = "Scan failed") {
  const scan = await getScanOrThrow(scanId)

  assertScanOpen(scan)

  scan.status = "failed"

  scan.completedAt = new Date()

  scan.errorMessage = String(errorMessage).slice(0, 1000)

  await scan.save()

  // Keep "completed" if an earlier scan succeeded; otherwise mark the project failed.

  const hasCompleted = await Scan.exists({
    project: scan.project,
    status: "completed",
  })

  await Project.updateOne({ _id: scan.project }, {
    $set: { status: hasCompleted ? "completed" : "failed" },
  })

  if (hasCompleted) await refreshProjectSnapshot(scan.project)

  return scan
}

/** Loads a scan and checks the actor may view its project. */

export async function getScanForUser(actor, scanId) {
  const scan = await getScanOrThrow(scanId)

  await getProjectForUser(actor, scan.project)

  return scan
}

/** Scan history of a project, newest first. */

export async function listProjectScans(
  actor,
  projectId,
  { limit = 50, skip = 0 } = {},
) {
  const project = await getProjectForUser(actor, projectId)

  return Scan.find({ project: project._id })
    .sort({ scanNumber: -1 })
    .skip(skip)
    .limit(Math.min(limit, 200))
}
