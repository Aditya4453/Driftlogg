import { Membership, User, Workspace } from "../models/index.js"
import { MEMBERSHIP_ROLES } from "../models/Membership.js"
import { AppError, assertObjectId, notFound, slugify } from "../utils/errors.js"
import { assertCanManageWorkspace, assertCanViewWorkspace } from "./access.service.js"

async function uniqueSlug(name) {
  const base = slugify(name)
  let slug = base
  for (let i = 2; await Workspace.exists({ slug }); i += 1) slug = `${base}-${i}`
  return slug
}

/** Creates a workspace and makes the owner its first Team Admin. */
export async function createWorkspace({ name, description, ownerId, isPersonal = false }) {
  assertObjectId(ownerId, "owner id")
  // Retry if two requests race for the same slug.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const workspace = await Workspace.create({ name, description, owner: ownerId, isPersonal, slug: await uniqueSlug(name) })
      try {
        await Membership.create({ workspace: workspace._id, user: ownerId, role: "team_admin", addedBy: ownerId })
      } catch (error) {
        await Workspace.deleteOne({ _id: workspace._id }) // undo the half-created workspace
        throw error
      }
      return workspace
    } catch (error) {
      if (error?.code === 11000 && error?.keyPattern?.slug) continue
      throw error
    }
  }
  throw new AppError("Could not create a unique workspace slug, please try another name", 409)
}

export function getPersonalWorkspace(userId) {
  return Workspace.findOne({ owner: userId, isPersonal: true })
}

/** Workspaces the user is an active member of, with the user's role in each. */
export async function listUserWorkspaces(userId) {
  const memberships = await Membership.find({ user: userId, status: "active" }).populate("workspace").sort({ createdAt: 1 })
  return memberships
    .filter((m) => m.workspace)
    .map((m) => ({ ...m.workspace.toJSON(), membershipRole: m.role }))
}

export async function listMembers(actor, workspaceId) {
  assertObjectId(workspaceId, "workspace id")
  await assertCanViewWorkspace(actor, workspaceId)
  return Membership.find({ workspace: workspaceId, status: "active" }).populate("user", "name email role").sort({ createdAt: 1 })
}

/** Adds a user to a team (or re-activates a removed member). Team Admin only. */
export async function addMember(actor, workspaceId, userId, role = "developer") {
  assertObjectId(workspaceId, "workspace id")
  assertObjectId(userId, "user id")
  if (!MEMBERSHIP_ROLES.includes(role)) throw new AppError("Invalid membership role")
  await assertCanManageWorkspace(actor, workspaceId)
  const workspace = await Workspace.findById(workspaceId)
  if (!workspace) throw notFound("Workspace")
  if (workspace.isPersonal) throw new AppError("Members cannot be added to a personal workspace")
  if (!(await User.exists({ _id: userId }))) throw notFound("User")

  return Membership.findOneAndUpdate(
    { workspace: workspaceId, user: userId },
    { $set: { role, status: "active", addedBy: actor._id } },
    { upsert: true, returnDocument: "after", runValidators: true, setDefaultsOnInsert: true },
  )
}

async function assertNotLastTeamAdmin(workspaceId, userId) {
  const admins = await Membership.countDocuments({ workspace: workspaceId, status: "active", role: "team_admin", user: { $ne: userId } })
  if (admins === 0) throw new AppError("A workspace must keep at least one team admin", 409)
}

export async function updateMemberRole(actor, workspaceId, userId, role) {
  assertObjectId(workspaceId, "workspace id")
  assertObjectId(userId, "user id")
  if (!MEMBERSHIP_ROLES.includes(role)) throw new AppError("Invalid membership role")
  await assertCanManageWorkspace(actor, workspaceId)
  const membership = await Membership.findOne({ workspace: workspaceId, user: userId, status: "active" })
  if (!membership) throw notFound("Membership")
  if (membership.role === "team_admin" && role !== "team_admin") await assertNotLastTeamAdmin(workspaceId, userId)
  membership.role = role
  return membership.save()
}

/** Soft-removes a member (status = "removed") so history stays intact. */
export async function removeMember(actor, workspaceId, userId) {
  assertObjectId(workspaceId, "workspace id")
  assertObjectId(userId, "user id")
  await assertCanManageWorkspace(actor, workspaceId)
  const workspace = await Workspace.findById(workspaceId)
  if (!workspace) throw notFound("Workspace")
  if (String(workspace.owner) === String(userId)) throw new AppError("The workspace owner cannot be removed", 409)
  const membership = await Membership.findOne({ workspace: workspaceId, user: userId, status: "active" })
  if (!membership) throw notFound("Membership")
  if (membership.role === "team_admin") await assertNotLastTeamAdmin(workspaceId, userId)
  membership.status = "removed"
  return membership.save()
}
