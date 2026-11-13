import { Dependency, Membership, Project, RiskReport, Scan, Workspace } from "../models/index.js"
import { AppError, assertObjectId, notFound } from "../utils/errors.js"
import { assertCanManageProject, assertCanViewProject, assertCanViewWorkspace, isSuperAdmin } from "./access.service.js"
import { getPersonalWorkspace } from "./workspace.service.js"

const EDITABLE_FIELDS = ["name", "description", "repositoryUrl"]

/** Creates a project in the given workspace, or in the user's personal workspace. */
export async function createProject(actor, { name, description, sourceType, repositoryUrl, workspaceId }) {
  let workspace
  if (workspaceId) {
    assertObjectId(workspaceId, "workspace id")
    workspace = await Workspace.findById(workspaceId)
  } else {
    workspace = await getPersonalWorkspace(actor._id)
  }
  if (!workspace) throw notFound("Workspace")
  await assertCanViewWorkspace(actor, workspace._id)

  try {
    return await Project.create({ workspace: workspace._id, user: actor._id, name, description, sourceType, repositoryUrl })
  } catch (error) {
    if (error?.code === 11000) throw new AppError("A project with this name already exists in this workspace", 409)
    throw error
  }
}

/** Super Admin sees all projects; everyone else sees projects of their workspaces. */
export async function listProjectsForUser(actor, { workspaceId, includeArchived = false } = {}) {
  const filter = includeArchived ? {} : { isArchived: false }
  if (workspaceId) {
    assertObjectId(workspaceId, "workspace id")
    await assertCanViewWorkspace(actor, workspaceId)
    filter.workspace = workspaceId
  } else if (!isSuperAdmin(actor)) {
    // Own projects + projects of every team the user belongs to.
    const workspaceIds = await Membership.find({ user: actor._id, status: "active" }).distinct("workspace")
    filter.$or = [{ user: actor._id }, { workspace: { $in: workspaceIds } }]
  }
  return Project.find(filter).sort({ updatedAt: -1 })
}

/** Loads a project and checks the actor may view it. */
export async function getProjectForUser(actor, projectId) {
  assertObjectId(projectId, "project id")
  const project = await Project.findById(projectId)
  if (!project) throw notFound("Project")
  await assertCanViewProject(actor, project)
  return project
}

export async function updateProject(actor, projectId, updates = {}) {
  const project = await getProjectForUser(actor, projectId)
  await assertCanManageProject(actor, project)
  for (const field of EDITABLE_FIELDS) {
    if (updates[field] !== undefined) project[field] = updates[field]
  }
  try {
    return await project.save()
  } catch (error) {
    if (error?.code === 11000) throw new AppError("A project with this name already exists in this workspace", 409)
    throw error
  }
}

/** Soft delete: hides the project but keeps all scans and reports. */
export async function archiveProject(actor, projectId, archived = true) {
  const project = await getProjectForUser(actor, projectId)
  await assertCanManageProject(actor, project)
  project.isArchived = archived
  return project.save()
}

/** Permanent delete, only on an explicit user request. Removes the project's scans, dependencies and reports. */
export async function deleteProject(actor, projectId) {
  const project = await getProjectForUser(actor, projectId)
  await assertCanManageProject(actor, project)
  await RiskReport.deleteMany({ project: project._id })
  await Dependency.deleteMany({ project: project._id })
  await Scan.deleteMany({ project: project._id })
  await Project.deleteOne({ _id: project._id })
}
