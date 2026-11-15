import { User } from "../models/index.js"
import { USER_ROLES } from "../models/User.js"
import { AppError, assertObjectId, notFound } from "../utils/errors.js"
import { assertSuperAdmin } from "./access.service.js"
import { createWorkspace } from "./workspace.service.js"

/**
 * Registers a user with a bcrypt-hashed password and a personal workspace.
 * New users are always Developers ("user"); promote with setUserRole().
 */
export async function registerUser({ name, email, password }) {
  if (!name || !email || !password) throw new AppError("Name, email and password are required", 400)
  const normalizedEmail = String(email).trim().toLowerCase()
  if (await User.exists({ email: normalizedEmail })) {
    throw new AppError("An account with this email already exists", 400)
  }

  const user = new User({ name, email: normalizedEmail, role: "user" })
  await user.setPassword(String(password))
  try {
    await user.save()
  } catch (error) {
    if (error?.code === 11000) throw new AppError("An account with this email already exists", 400)
    throw error
  }

  try {
    await createWorkspace({ name: `${user.name}'s workspace`, ownerId: user._id, isPersonal: true })
  } catch (error) {
    await User.deleteOne({ _id: user._id }) // keep the database consistent
    throw error
  }
  return user
}

/** Returns the user when email + password match, otherwise null. */
export async function verifyCredentials(email, password) {
  if (!email || !password) return null
  const user = await User.findOne({ email: String(email).trim().toLowerCase(), isActive: true })
  if (!user || !(await user.comparePassword(String(password)))) return null
  await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } })
  return User.findById(user._id).select("-password")
}

export async function getUserById(userId) {
  assertObjectId(userId, "user id")
  const user = await User.findById(userId)
  if (!user) throw notFound("User")
  return user
}

/** Super Admin: list every user. */
export async function listUsers(actor, { limit = 100, skip = 0 } = {}) {
  assertSuperAdmin(actor)
  return User.find().sort({ createdAt: -1 }).skip(skip).limit(Math.min(limit, 500))
}

/** Super Admin: change a user's global role ("user" or "admin"). */
export async function setUserRole(actor, userId, role) {
  assertSuperAdmin(actor)
  if (!USER_ROLES.includes(role)) throw new AppError("Invalid role")
  const user = await getUserById(userId)
  user.role = role
  return user.save()
}

/** Super Admin: deactivate instead of deleting, so projects and scan history remain. */
export async function deactivateUser(actor, userId) {
  assertSuperAdmin(actor)
  const user = await getUserById(userId)
  user.isActive = false
  return user.save()
}
