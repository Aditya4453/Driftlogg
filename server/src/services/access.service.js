// Role checks from the DriftLogg permission table:
//   Developer   -> own projects and reports
//   Team Admin  -> team (workspace) projects and members
//   Super Admin -> all users, teams and global statistics
import { Membership } from "../models/index.js"
import { forbidden } from "../utils/errors.js"

const idOf = (value) => String(value?._id ?? value)

export const isSuperAdmin = (user) => user?.role === "admin"

export function getActiveMembership(userId, workspaceId) {
  return Membership.findOne({ user: idOf(userId), workspace: idOf(workspaceId), status: "active" })
}

export async function isTeamAdmin(user, workspaceId) {
  if (!workspaceId) return false
  const membership = await getActiveMembership(user, workspaceId)
  return membership?.role === "team_admin"
}

export async function canViewWorkspace(user, workspaceId) {
  if (isSuperAdmin(user)) return true
  if (!workspaceId) return false
  return Boolean(await getActiveMembership(user, workspaceId))
}

export async function canManageWorkspace(user, workspaceId) {
  if (isSuperAdmin(user)) return true
  return isTeamAdmin(user, workspaceId)
}

export async function canViewProject(user, project) {
  if (isSuperAdmin(user) || idOf(project.user) === idOf(user)) return true
  return canViewWorkspace(user, project.workspace)
}

export async function canManageProject(user, project) {
  if (isSuperAdmin(user) || idOf(project.user) === idOf(user)) return true
  return isTeamAdmin(user, project.workspace)
}

export async function assertCanViewWorkspace(user, workspaceId) {
  if (!(await canViewWorkspace(user, workspaceId))) throw forbidden("You are not a member of this workspace")
}

export async function assertCanManageWorkspace(user, workspaceId) {
  if (!(await canManageWorkspace(user, workspaceId))) throw forbidden("Only a team admin can manage this workspace")
}

export async function assertCanViewProject(user, project) {
  if (!(await canViewProject(user, project))) throw forbidden("You do not have access to this project")
}

export async function assertCanManageProject(user, project) {
  if (!(await canManageProject(user, project))) throw forbidden("Only the project owner or a team admin can change this project")
}

export function assertSuperAdmin(user) {
  if (!isSuperAdmin(user)) throw forbidden("Super admin access required")
}
