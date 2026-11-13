import mongoose from "mongoose"
import { isDatabaseConnected } from "../config/db.js"
import { AppError } from "../utils/errors.js"

/** Returns 503 instead of hanging when MongoDB is temporarily unavailable. */
export function requireDatabase(_req, _res, next) {
  if (!isDatabaseConnected()) return next(new AppError("Database is temporarily unavailable", 503))
  next()
}

/** Rejects invalid ObjectIds in route params, e.g. validateObjectIds("projectId"). */
export function validateObjectIds(...paramNames) {
  return (req, _res, next) => {
    for (const name of paramNames) {
      if (req.params[name] !== undefined && !mongoose.isValidObjectId(req.params[name])) {
        return next(new AppError(`Invalid ${name}`, 400))
      }
    }
    next()
  }
}

/** Converts Mongoose/MongoDB errors into clean JSON responses without leaking internals. */
// eslint-disable-next-line no-unused-vars
export function errorHandler(error, _req, res, _next) {
  if (error instanceof AppError) return res.status(error.status).json({ message: error.message })

  if (error instanceof mongoose.Error.ValidationError) {
    const details = Object.values(error.errors).map((e) => e.message)
    return res.status(400).json({ message: "Validation failed", errors: details })
  }
  if (error instanceof mongoose.Error.CastError) {
    return res.status(400).json({ message: `Invalid value for ${error.path}` })
  }
  if (error?.code === 11000) {
    return res.status(409).json({ message: "A record with these values already exists" })
  }
  if (error?.type === "entity.parse.failed") {
    return res.status(400).json({ message: "Request body is not valid JSON" })
  }

  console.error("[server] Unexpected error:", error)
  return res.status(500).json({ message: "Internal server error" })
}
