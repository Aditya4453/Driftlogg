import { Router } from "express"
import { requireAdmin, requireAuth } from "../middleware/auth.js"
import { getSystemStats, listAllProjects } from "../services/stats.service.js"
import { listUsers } from "../services/user.service.js"

const router = Router()

// All admin routes require authentication and admin privileges
router.use(requireAuth, requireAdmin)

// GET /api/admin/stats -> platform-wide metrics
router.get("/stats", async (req, res, next) => {
  try {
    const stats = await getSystemStats(req.user)
    res.status(200).json(stats)
  } catch (err) {
    next(err)
  }
})

// GET /api/admin/users -> all registered users (excluding password hashes)
router.get("/users", async (req, res, next) => {
  try {
    const limit = Number(req.query.limit) || 100
    const skip = Number(req.query.skip) || 0
    const users = await listUsers(req.user, { limit, skip })
    res.status(200).json(users)
  } catch (err) {
    next(err)
  }
})

// GET /api/admin/projects -> all projects across the platform
router.get("/projects", async (req, res, next) => {
  try {
    const projects = await listAllProjects(req.user)
    res.status(200).json(projects)
  } catch (err) {
    next(err)
  }
})

export default router
