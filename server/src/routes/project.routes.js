import { Router } from "express"
import { requireAuth } from "../middleware/auth.js"
import { validateObjectIds } from "../middleware/database.js"
import { validateGitHubRepoUrl } from "../middleware/security.js"
import {
  createProject,
  deleteProject,
  getProjectForUser,
  listProjectsForUser,
} from "../services/project.service.js"
import { AppError } from "../utils/errors.js"

const router = Router()

// All project routes require authentication
router.use(requireAuth)

// GET /api/projects -> list projects for the authenticated user
router.get("/", async (req, res, next) => {
  try {
    const projects = await listProjectsForUser(req.user)
    res.status(200).json(projects)
  } catch (err) {
    next(err)
  }
})

// POST /api/projects -> create a new project
router.post("/", async (req, res, next) => {
  try {
    const {
      name,
      sourceType,
      repositoryUrl,
      description,
      workspaceId,
      packageJson,
      packageLockJson,
    } = req.body || {}

    if (!name || typeof name !== "string" || !name.trim()) {
      return next(new AppError("Project name is required", 400))
    }

    // Support both ('github' | 'upload') and canonical ('github_repo' | 'package_json')
    let normalizedSourceType = sourceType
    if (sourceType === "github" || sourceType === "github_repo") {
      normalizedSourceType = "github_repo"
      if (!repositoryUrl || !validateGitHubRepoUrl(repositoryUrl)) {
        return next(
          new AppError(
            "Valid GitHub repository URL is required (e.g., https://github.com/owner/repo)",
            400,
          ),
        )
      }
    } else if (sourceType === "upload" || sourceType === "package_json") {
      normalizedSourceType = "package_json"
    } else {
      return next(
        new AppError("Invalid sourceType. Must be 'github' or 'upload'", 400),
      )
    }

    const project = await createProject(req.user, {
      name: name.trim(),
      description: typeof description === "string" ? description.trim() : "",
      sourceType: normalizedSourceType,
      repositoryUrl:
        normalizedSourceType === "github_repo" ? repositoryUrl.trim() : "",
      workspaceId,
      packageJson,
      packageLockJson,
    })

    res.status(201).json(project)
  } catch (err) {
    next(err)
  }
})

// GET /api/projects/:projectId -> get single project
router.get(
  "/:projectId",
  validateObjectIds("projectId"),
  async (req, res, next) => {
    try {
      const project = await getProjectForUser(req.user, req.params.projectId)
      res.status(200).json(project)
    } catch (err) {
      next(err)
    }
  },
)

// DELETE /api/projects/:projectId -> delete project and its associated data
router.delete(
  "/:projectId",
  validateObjectIds("projectId"),
  async (req, res, next) => {
    try {
      await deleteProject(req.user, req.params.projectId)
      res.status(200).json({ message: "Project deleted successfully" })
    } catch (err) {
      next(err)
    }
  },
)

export default router
