import { registerUser, verifyCredentials } from "../services/user.service.js"
import { clearTokenCookie, sendTokenCookie } from "../utils/token.js"

// POST /api/auth/register -> 201 + user (no password), sets the token cookie
export async function register(req, res) {
  const { name, email, password } = req.body || {}
  if (!name || !email || !password) {
    return res.status(400).json({ message: "Name, email and password are required" })
  }
  const user = await registerUser({ name, email, password }) // duplicate email -> 400
  sendTokenCookie(res, user)
  res.status(201).json(user) // toJSON removes the password hash
}

// POST /api/auth/login -> 200 + user, sets the token cookie
export async function login(req, res) {
  const { email, password } = req.body || {}
  const user = await verifyCredentials(email, password)
  if (!user) return res.status(401).json({ message: "Invalid email or password" })
  sendTokenCookie(res, user)
  res.status(200).json(user)
}

// POST /api/auth/logout -> clears the cookie
export function logout(_req, res) {
  clearTokenCookie(res)
  res.status(200).json({ message: "Logged out successfully" })
}

// GET /api/auth/me -> current user (requireAuth already loaded it without password)
export function me(req, res) {
  res.status(200).json(req.user)
}
