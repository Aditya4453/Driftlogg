import { User, Scan, RiskReport } from "../models/index.js"

import { USER_ROLES } from "../models/User.js"

import { AppError, assertObjectId, notFound } from "../utils/errors.js"

import { assertSuperAdmin } from "./access.service.js"

import { createWorkspace } from "./workspace.service.js"

import { listProjectsForUser } from "./project.service.js"

/**
 * Registers a user with a bcrypt-hashed password and a personal workspace.
 * New users are always Developers ("user"); promote with setUserRole().
 */

export async function registerUser({ name, email, password }) {
  if (!name || !email || !password)
    throw new AppError("Name, email and password are required", 400)

  const normalizedEmail = String(email).trim().toLowerCase()

  if (await User.exists({ email: normalizedEmail })) {
    throw new AppError("An account with this email already exists", 400)
  }

  const user = new User({ name, email: normalizedEmail, role: "user" })

  await user.setPassword(String(password))

  try {
    await user.save()
  } catch (error) {
    if (error?.code === 11000)
      throw new AppError("An account with this email already exists", 400)

    throw error
  }

  try {
    await createWorkspace({
      name: `${user.name}'s workspace`,
      ownerId: user._id,
      isPersonal: true,
    })
  } catch (error) {
    await User.deleteOne({ _id: user._id }) // keep the database consistent

    throw error
  }

  return user
}

/** Returns the user when email + password match, otherwise null. */

export async function verifyCredentials(email, password) {
  if (!email || !password) return null

  const user = await User.findOne({
    email: String(email).trim().toLowerCase(),
    isActive: true,
  })

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

  return User.find()
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(Math.min(limit, 500))
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

/**
 * Computes live account and workspace summary metrics strictly for the authenticated user.
 */
export async function getUserSummary(user) {
  const projects = await listProjectsForUser(user)
  const totalProjects = projects.length
  const projectIds = projects.map((p) => p._id)

  const totalScansRun = projectIds.length
    ? await Scan.countDocuments({ project: { $in: projectIds } })
    : 0

  const now = new Date()
  const startOfMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  )
  const monthlyScansUsed = projectIds.length
    ? await Scan.countDocuments({
        project: { $in: projectIds },
        createdAt: { $gte: startOfMonth },
      })
    : 0

  const monthlyScanLimit = 25
  const nextMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  )
  const daysUntilReset = Math.max(
    1,
    Math.ceil((nextMonth.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
  )

  // Compute risksResolved across consecutive scans for user's projects
  let risksResolved = 0
  if (projectIds.length) {
    for (const projId of projectIds) {
      const scans = await Scan.find({ project: projId, status: "completed" })
        .sort({ scanNumber: 1 })
        .select("_id scanNumber")

      if (scans.length >= 2) {
        for (let i = 0; i < scans.length - 1; i += 1) {
          const prevReports = await RiskReport.find({ scan: scans[i]._id })
          const currReports = await RiskReport.find({ scan: scans[i + 1]._id })

          const prevRisky = new Map()
          for (const r of prevReports) {
            if (r.riskLevel === "high" || r.riskLevel === "medium") {
              prevRisky.set(r.packageName, r.riskLevel)
            }
          }

          const currReportMap = new Map(
            currReports.map((r) => [r.packageName, r]),
          )

          for (const [pkgName] of prevRisky.entries()) {
            const curr = currReportMap.get(pkgName)
            if (!curr || curr.riskLevel === "low") {
              risksResolved += 1
            }
          }
        }
      }
    }
  }

  return {
    totalProjects,
    totalScansRun,
    monthlyScansUsed,
    monthlyScanLimit,
    daysUntilReset,
    risksResolved,
    memberSince: user.createdAt || new Date().toISOString(),
    user: {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      timezone: user.timezone || "UTC",
      twoFactorEnabled: Boolean(user.twoFactorEnabled),
      createdAt: user.createdAt,
    },
  }
}

/**
 * Updates profile fields (name, timezone) for a user.
 */
export async function updateUserProfile(userId, { name, timezone }) {
  assertObjectId(userId, "user id")
  const update = {}
  if (typeof name === "string" && name.trim()) {
    update.name = name.trim()
  }
  if (typeof timezone === "string" && timezone.trim()) {
    update.timezone = timezone.trim()
  }
  if (Object.keys(update).length === 0) {
    throw new AppError("No valid profile fields provided for update", 400)
  }

  const user = await User.findByIdAndUpdate(userId, { $set: update }, {
    new: true,
    runValidators: true,
  }).select("-password")

  if (!user) throw notFound("User")
  return user
}
