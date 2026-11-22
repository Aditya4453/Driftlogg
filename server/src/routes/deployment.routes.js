import { Router } from "express"
import { requireAuth } from "../middleware/auth.js"
import { validateObjectIds } from "../middleware/database.js"
import { scanLimiter } from "../middleware/security.js"
import { getProjectForUser } from "../services/project.service.js"
import { DeploymentScan } from "../models/DeploymentScan.js"
import { executeDeploymentScanInBackground } from "../services/deployment.runner.js"
import { notFound } from "../utils/errors.js"

const router = Router()

// All deployment scan routes require authentication
router.use(requireAuth)

/**
 * POST /api/projects/:projectId/deployment-scan
 * Triggers a deployment error pipeline scan in the background.
 */
router.post(
  "/projects/:projectId/deployment-scan",
  validateObjectIds("projectId"),
  scanLimiter,
  async (req, res, next) => {
    try {
      const project = await getProjectForUser(req.user, req.params.projectId)
      const target = req.body?.target || "auto"

      const scan = await DeploymentScan.create({
        projectId: project._id,
        triggeredBy: req.user._id,
        status: "queued",
        target,
      })

      // Run 5-stage deployment pipeline in background
      executeDeploymentScanInBackground(scan._id, project, req.body || {})

      res.status(201).json(scan)
    } catch (err) {
      next(err)
    }
  },
)

/**
 * GET /api/deployment-scans/:scanId
 * Polls status, findings, and logs for an active or completed deployment scan.
 */
router.get(
  "/deployment-scans/:scanId",
  validateObjectIds("scanId"),
  async (req, res, next) => {
    try {
      const scan = await DeploymentScan.findById(req.params.scanId)
      if (!scan) {
        throw notFound("Deployment scan")
      }

      // Verify the requesting user has access to the associated project
      await getProjectForUser(req.user, scan.projectId)

      res.status(200).json(scan)
    } catch (err) {
      next(err)
    }
  },
)

/**
 * GET /api/projects/:projectId/deployment-report
 * Fetches the latest completed deployment report for a project.
 */
router.get(
  "/projects/:projectId/deployment-report",
  validateObjectIds("projectId"),
  async (req, res, next) => {
    try {
      const project = await getProjectForUser(req.user, req.params.projectId)

      const latest = await DeploymentScan.findOne({
        projectId: project._id,
        status: "completed",
      }).sort({ createdAt: -1 })

      res.status(200).json(latest || null)
    } catch (err) {
      next(err)
    }
  },
)

export default router
