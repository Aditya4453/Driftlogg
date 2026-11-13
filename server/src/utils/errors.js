import mongoose from "mongoose"

/** Error with an HTTP status code, thrown by services and handled by errorHandler. */
export class AppError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.name = "AppError"
    this.status = status
  }
}

export const notFound = (what) => new AppError(`${what} not found`, 404)
export const forbidden = (message = "You do not have permission to perform this action") => new AppError(message, 403)

/** Throws 400 when id is not a valid MongoDB ObjectId. */
export function assertObjectId(id, label = "id") {
  if (!mongoose.isValidObjectId(id)) throw new AppError(`Invalid ${label}`, 400)
}

export function slugify(text) {
  return String(text)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "workspace"
}
