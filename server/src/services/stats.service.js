import { Project, Scan, User, Workspace } from "../models/index.js"
import { assertSuperAdmin } from "./access.service.js"

/** Super Admin: global statistics (matches the frontend SystemStats type). */
export async function getSystemStats(actor) {
  assertSuperAdmin(actor)
  const [totalUsers, totalWorkspaces, totalProjects, totalScans, highRisk] = await Promise.all([
    User.countDocuments(),
    Workspace.countDocuments({ isPersonal: false }),
    Project.countDocuments({ isArchived: false }),
    Scan.countDocuments(),
    // High-risk packages in each project's latest scan.
    Project.aggregate([{ $match: { isArchived: false } }, { $group: { _id: null, total: { $sum: "$summary.high" } } }]),
  ])
  return { totalUsers, totalTeams: totalWorkspaces, totalProjects, totalScans, highRiskCount: highRisk[0]?.total ?? 0 }
}

/** Super Admin: every project across all workspaces. */
export async function listAllProjects(actor) {
  assertSuperAdmin(actor)
  return Project.find().sort({ updatedAt: -1 }).populate("workspace", "name slug").populate("user", "name email")
}

/** Super Admin: every team workspace. */
export async function listAllWorkspaces(actor) {
  assertSuperAdmin(actor)
  return Workspace.find({ isPersonal: false }).sort({ createdAt: -1 }).populate("owner", "name email")
}
