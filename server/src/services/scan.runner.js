import mongoose from "mongoose"
import { markScanProcessing, completeScan, failScan } from "./scan.service.js"
import { runDependencyAnalysis } from "./analyzer/index.js"
import { createScanLogger } from "./scan.logger.js"

/**
 * Runs the 4-stage dependency analyzer pipeline in the background for a queued scan.
 * Handles state transitions (processing -> completed or failed), isolates execution
 * via setImmediate/detached promise, and ensures unhandled rejections never escape.
 *
 * @param {string|import("mongoose").Types.ObjectId} scanId
 * @param {object} project
 * @param {object} [payload={}]
 * @returns {Promise<void>} Resolves when the background analysis finishes
 */
export function executeScanInBackground(scanId, project, payload = {}) {
  const logger = createScanLogger(scanId)

  const task = async () => {
    try {
      if (mongoose.connection.readyState !== 1) return

      const sourceType = payload.sourceType || project.sourceType
      const repositoryUrl = payload.repositoryUrl || project.repositoryUrl

      logger.info("runner", "Scan execution pipeline started in background", {
        projectId: project?._id,
        projectName: project?.name,
        sourceType,
        repositoryUrl,
        hasInlinePackageJson: Boolean(payload.packageJson),
      })

      await markScanProcessing(scanId)
      logger.info("runner", "Scan transitioned to processing state")

      const input = {
        sourceType,
        repositoryUrl,
        packageJson:
          payload.packageJson !== undefined
            ? payload.packageJson
            : project.packageJson,
        packageLockJson:
          payload.packageLockJson !== undefined
            ? payload.packageLockJson
            : project.packageLockJson,
        options: {
          blockThresholdScore: payload.blockThresholdScore,
          flagArchivedRepositories: payload.flagArchivedRepositories,
          ...payload.options,
        },
      }

      const analysis = await runDependencyAnalysis(input, logger)

      if (mongoose.connection.readyState !== 1) return

      const totalDependencies = analysis.dependencies?.length || 0
      const directCount =
        analysis.dependencies?.filter((d) => d.isDirect !== false).length || 0
      const transitiveCount =
        analysis.dependencies?.filter((d) => d.isDirect === false).length || 0

      logger.info(
        "runner",
        "Dependency analysis completed across all 4 stages",
        {
          totalDependencies,
          directCount,
          transitiveCount,
          verdict: analysis.summary?.verdict,
          overallScore: analysis.summary?.overallScore,
          sourcesUnavailable: analysis.sourcesUnavailable,
        },
      )

      const results = {
        dependencies: analysis.dependencies,
        reports: analysis.reports,
        verdict: analysis.summary?.verdict,
        overallScore: analysis.summary?.overallScore,
        highRiskCount: analysis.summary?.highRiskCount,
        mediumRiskCount: analysis.summary?.mediumRiskCount,
        lowRiskCount: analysis.summary?.lowRiskCount,
        sourcesUnavailable: analysis.sourcesUnavailable,
        ruleVersion: analysis.ruleVersion,
      }

      logger.info(
        "persist",
        "Persisting dependency and risk report documents",
        {
          dependencyCount: results.dependencies.length,
          reportCount: results.reports.length,
        },
      )

      await completeScan(scanId, results)

      logger.info(
        "persist",
        "Scan completed and project snapshot updated successfully",
        {
          verdict: results.verdict,
          overallScore: results.overallScore,
        },
      )
    } catch (error) {
      logger.error(
        "runner",
        `Scan pipeline failed: ${error?.message || "Unknown error"}`,
        {
          message: error?.message,
          statusCode: error?.statusCode || 500,
          stack: error?.stack,
        },
      )

      if (mongoose.connection.readyState === 1) {
        try {
          await failScan(scanId, error?.message || "Dependency analysis failed")
        } catch (failErr) {
          if (mongoose.connection.readyState === 1) {
            console.error(
              `[scan.runner] Failed to mark scan ${scanId} as failed:`,
              failErr,
            )
          }
        }
      }
    } finally {
      await logger.flush()
    }
  }

  // Defer to next turn of event loop
  return new Promise((resolve) => {
    setImmediate(async () => {
      try {
        await task()
      } finally {
        resolve()
      }
    })
  })
}
