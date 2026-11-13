import { User } from "../models/index.js"
import { verifyToken } from "../utils/token.js"

/** Reads the "token" cookie, verifies it and puts the user (without password) on req.user. */
export const requireAuth = async (req, res, next) => {
  try {
    const token = req.cookies?.token
    if (!token) {
      return res.status(401).json({ message: "Authentication required. No token found." })
    }

    const decoded = verifyToken(token)
    const user = await User.findById(decoded.id).select("-password")

    if (!user || user.isActive === false) {
      return res.status(401).json({ message: "User belonging to this token no longer exists." })
    }

    req.user = user
    next()
  } catch {
    return res.status(401).json({ message: "Invalid or expired token." })
  }
}

/** Use after requireAuth. Allows Super Admins (role "admin") only. */
export const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden. Admin privileges required." })
  }
  next()
}
