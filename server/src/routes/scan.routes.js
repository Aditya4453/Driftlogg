import { Router } from "express"
import { requireAuth } from "../middleware/auth.js"
import { validateObjectIds } from "../middleware/database.js"
import { scanLimiter, validatePackagePayload } from "../middleware/security.js"
import {
  getScanForUser,
  listProjectScans,
  startScan,
} from "../services/scan.service.js"
import { getProjectForUser } from "../services/project.service.js"
import { getLatestProjectReport } from "../services/report.service.js"
import { executeScanInBackground } from "../services/scan.runner.js"

const router = Router()

// All scan routes require authentication
router.use(requireAuth)

/**
 * Scan trigger handler:
 * Accepts package.json payload or triggers a repository scan.
 */
const triggerScan = async (req, res, next) => {
  try {
    const { sourceType, repositoryUrl, packageJson } = req.body || {}

    // Support both ('github' | 'upload') and ('github_repo' | 'package_json')
    let normalizedSourceType = sourceType
    if (sourceType === "github") normalizedSourceType = "github_repo"
    if (sourceType === "upload") normalizedSourceType = "package_json"

    const project = await getProjectForUser(req.user, req.params.projectId)

    const scan = await startScan(req.user, req.params.projectId, {
      sourceType: normalizedSourceType,
      repositoryUrl,
      packageJson,
    })

    // Phase 4: Trigger background dependency analyzer worker
    executeScanInBackground(scan._id, project, req.body)

    res.status(201).json(scan)
  } catch (err) {
    next(err)
  }
}

// POST /api/projects/:projectId/analyze -> start analysis scan
router.post(
  "/projects/:projectId/analyze",
  validateObjectIds("projectId"),
  scanLimiter,
  validatePackagePayload,
  triggerScan,
)

// POST /api/projects/:projectId/scans -> alias for frontend contract compatibility
router.post(
  "/projects/:projectId/scans",
  validateObjectIds("projectId"),
  scanLimiter,
  validatePackagePayload,
  triggerScan,
)

// GET /api/projects/:projectId/scans -> list all scans for a project
router.get(
  "/projects/:projectId/scans",
  validateObjectIds("projectId"),
  async (req, res, next) => {
    try {
      const limit = Number(req.query.limit) || 50
      const skip = Number(req.query.skip) || 0
      const scans = await listProjectScans(req.user, req.params.projectId, {
        limit,
        skip,
      })
      res.status(200).json(scans)
    } catch (err) {
      next(err)
    }
  },
)

// GET /api/scans/:scanId -> get a scan by ID for polling
router.get(
  "/scans/:scanId",
  validateObjectIds("scanId"),
  async (req, res, next) => {
    try {
      const scan = await getScanForUser(req.user, req.params.scanId)
      res.status(200).json(scan)
    } catch (err) {
      next(err)
    }
  },
)

// GET /api/projects/:projectId/report -> get latest project risk report
router.get(
  "/projects/:projectId/report",
  validateObjectIds("projectId"),
  async (req, res, next) => {
    try {
      const reports = await getLatestProjectReport(
        req.user,
        req.params.projectId,
      )
      res.status(200).json(reports || [])
    } catch (err) {
      next(err)
    }
  },
)

export default router
