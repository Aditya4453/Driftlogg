import mongoose from "mongoose"
import { DeploymentScan } from "../models/DeploymentScan.js"
import { validateGitHubRepoUrl } from "../middleware/security.js"
import { runDeploymentErrorPipeline } from "../deploy/index.js"

/**
 * Executes a 5-stage deployment error pipeline scan in the background.
 * Uses setImmediate to prevent blocking the event loop and guards against
 * disconnected databases during test runs.
 *
 * @param {string|import("mongoose").Types.ObjectId} deploymentScanId
 * @param {object} project
 * @param {object} [options={}]
 * @returns {void}
 */
export function executeDeploymentScanInBackground(
  deploymentScanId,
  project,
  options = {},
) {
  const shortId = String(deploymentScanId).slice(-6)
  const logBuffer = []
  let flushPromise = Promise.resolve()

  const persistLogBatch = async (batch) => {
    if (!batch.length || mongoose.connection.readyState !== 1) return
    try {
      await DeploymentScan.findByIdAndUpdate(
        deploymentScanId,
        { $push: { logs: { $each: batch } } },
        { timestamps: false },
      )
    } catch {
      // Ignore background persistence errors during teardown
    }
  }

  const enqueueLog = (stage, message, level = "info", meta = null) => {
    const entry = {
      timestamp: new Date(),
      stage,
      level,
      message,
      meta,
    }
    logBuffer.push(entry)
    if (logBuffer.length >= 5) {
      const batch = logBuffer.splice(0, logBuffer.length)
      flushPromise = flushPromise.then(() => persistLogBatch(batch))
    }
  }

  const flushLogs = async () => {
    if (logBuffer.length > 0) {
      const batch = logBuffer.splice(0, logBuffer.length)
      flushPromise = flushPromise.then(() => persistLogBatch(batch))
    }
    await flushPromise
  }

  const handleTraceLine = (line) => {
    // Print to server terminal
    console.log(`[DeployScan:${shortId}] ${line}`)

    // Extract stage from [deploy-<stage>]
    let stage = "runner"
    let level = "info"
    const stageMatch = line.match(/^\[deploy-([a-z]+)\]\s*(.*)$/i)
    let cleanMessage = line

    if (stageMatch) {
      stage = stageMatch[1].toLowerCase()
      cleanMessage = stageMatch[2]
      if (/blocker/i.test(cleanMessage) || /failed/i.test(cleanMessage)) {
        level = "error"
      } else if (
        /warning/i.test(cleanMessage) ||
        /likely/i.test(cleanMessage)
      ) {
        level = "warn"
      }
    }

    enqueueLog(stage, cleanMessage, level)
  }

  setImmediate(async () => {
    try {
      if (mongoose.connection.readyState !== 1) return

      // 1. Mark scan as processing
      await DeploymentScan.findByIdAndUpdate(deploymentScanId, {
        status: "processing",
        startedAt: new Date(),
      })

      enqueueLog("runner", "Deployment scan transitioned to processing state")

      // 2. Prepare pipeline input
      let pipelineInput = null
      const requestedTarget =
        options.target && options.target !== "auto" ? options.target : undefined

      if (options.files || options.tree) {
        pipelineInput = {
          files: options.files,
          tree: options.tree,
          target: requestedTarget,
        }
      } else if (
        project.sourceType === "github_repo" ||
        project.repositoryUrl
      ) {
        const parsedGithub = validateGitHubRepoUrl(project.repositoryUrl)
        if (!parsedGithub) {
          throw new Error(
            `Invalid or non-canonical GitHub repository URL: "${project.repositoryUrl}"`,
          )
        }
        pipelineInput = {
          owner: parsedGithub.owner,
          repo: parsedGithub.repo,
          branch: parsedGithub.branch || "main",
          target: requestedTarget,
        }
      } else if (project.packageJson || options.packageJson) {
        const rawPkg = options.packageJson || project.packageJson
        const rawLock = options.packageLockJson || project.packageLockJson
        const pkgContent =
          typeof rawPkg === "string" ? rawPkg : JSON.stringify(rawPkg || {})
        const files = {
          "package.json": pkgContent,
        }
        if (rawLock) {
          files["package-lock.json"] =
            typeof rawLock === "string" ? rawLock : JSON.stringify(rawLock)
        }
        pipelineInput = {
          files,
          target: requestedTarget,
        }
      } else {
        throw new Error(
          "Project has neither a valid GitHub repository URL nor an uploaded manifest.",
        )
      }

      // 3. Execute 5-stage pipeline
      const report = await runDeploymentErrorPipeline(pipelineInput, {
        onTrace: handleTraceLine,
      })

      if (mongoose.connection.readyState !== 1) return

      await flushLogs()

      // 4. Update scan to completed
      await DeploymentScan.findByIdAndUpdate(deploymentScanId, {
        status: "completed",
        score: report.score,
        verdict: report.verdict,
        coverage: report.coverage,
        target: report.target || requestedTarget || "render",
        commitSha: report.snapshot?.ref || "",
        appShape: report.snapshot?.appShape || "",
        packageManager: report.snapshot?.packageManager || "npm",
        findings: report.findings || [],
        fixPlan: report.fixPlan || null,
        completedAt: new Date(),
      })

      console.log(
        `[DeployScan:${shortId}] Completed successfully: verdict=${report.verdict}, score=${report.score}/100, findings=${report.findings?.length || 0}`,
      )
    } catch (err) {
      console.error(`[DeployScan:${shortId}] Execution failed:`, err.message)
      enqueueLog("runner", `Execution failed: ${err.message}`, "error")
      await flushLogs()

      if (mongoose.connection.readyState === 1) {
        try {
          await DeploymentScan.findByIdAndUpdate(deploymentScanId, {
            status: "failed",
            errorMessage: err.message,
            completedAt: new Date(),
          })
        } catch {
          // Ignore
        }
      }
    }
  })
}
