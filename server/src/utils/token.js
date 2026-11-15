import jwt from "jsonwebtoken"
import { getJwtSecret, isProduction } from "../config/env.js"

export const TOKEN_COOKIE = "token"
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

// Cookie options from the handover spec. Production: secure + SameSite=None (frontend
// and API on different domains). Localhost: SameSite=Lax so the browser keeps the cookie.
function cookieOptions() {
  const prod = isProduction()
  return { httpOnly: true, secure: prod, sameSite: prod ? "none" : "lax", path: "/" }
}

export function signToken(user) {
  return jwt.sign({ id: String(user._id), role: user.role }, getJwtSecret(), { expiresIn: "7d" })
}

export function verifyToken(token) {
  return jwt.verify(token, getJwtSecret())
}

/** Signs a JWT { id, role } and stores it in the httpOnly "token" cookie. */
export const sendTokenCookie = (res, user) => {
  const token = signToken(user)
  res.cookie(TOKEN_COOKIE, token, { ...cookieOptions(), maxAge: SEVEN_DAYS_MS })
  return token
}

/** Clears the cookie. Options must match the ones used when it was set. */
export const clearTokenCookie = (res) => {
  res.clearCookie(TOKEN_COOKIE, cookieOptions())
}
