import mongoose from "mongoose"
import { Scan } from "../models/Scan.js"

const REDACTED_KEYWORDS = [
  "token",
  "authorization",
  "auth",
  "secret",
  "password",
  "cookie",
  "key",
  "github_token",
]

function sanitizeMeta(meta) {
  if (meta === null || meta === undefined) return undefined
  if (typeof meta !== "object") return meta

  try {
    const copy = JSON.parse(JSON.stringify(meta))
    const redact = (obj) => {
      if (!obj || typeof obj !== "object") return
      for (const [k, v] of Object.entries(obj)) {
        if (
          REDACTED_KEYWORDS.some((kw) =>
            k.toLowerCase().includes(kw.toLowerCase()),
          )
        ) {
          obj[k] = "[REDACTED]"
        } else if (v && typeof v === "object") {
          redact(v)
        }
      }
    }
    redact(copy)
    return copy
  } catch {
    return "[Unserializable metadata]"
  }
}

/**
 * Creates a structured logger for a specific scan execution.
 * Prints formatted lines to the server console and persists entries into Scan.logs.
 *
 * @param {string|import("mongoose").Types.ObjectId} scanId
 * @returns {object} Scan logger with log, info, warn, error, and flush methods
 */
export function createScanLogger(scanId) {
  const shortId = String(scanId).slice(-6)
  const buffer = []
  let flushChain = Promise.resolve()

  const persistBatch = async (batch) => {
    if (!batch.length) return
    if (mongoose.connection.readyState !== 1) return

    try {
      await Scan.findByIdAndUpdate(
        scanId,
        {
          $push: { logs: { $each: batch } },
        },
        { timestamps: false },
      )
    } catch (err) {
      // Logging should never crash the runner
      console.error(
        `[Scan:${shortId}][logger] Failed to persist ${batch.length} logs to database:`,
        err.message,
      )
    }
  }

  const scheduleFlush = () => {
    if (!buffer.length) return
    const batch = buffer.splice(0, buffer.length)
    flushChain = flushChain.then(() => persistBatch(batch))
  }

  const log = (stage, message, meta = null, level = "info") => {
    const validLevel = ["info", "warn", "error"].includes(level)
      ? level
      : "info"
    const sanitizedMeta = sanitizeMeta(meta)

    // 1. Server console formatting
    const prefix = `[Scan:${shortId}][${stage}]`
    const metaStr =
      sanitizedMeta !== undefined
        ? ` ${
            typeof sanitizedMeta === "string"
              ? sanitizedMeta
              : JSON.stringify(sanitizedMeta)
          }`
        : ""

    if (validLevel === "error") {
      console.error(`${prefix} ❌ ${message}${metaStr}`)
    } else if (validLevel === "warn") {
      console.warn(`${prefix} ⚠️  ${message}${metaStr}`)
    } else {
      console.log(`${prefix} ℹ️  ${message}${metaStr}`)
    }

    // 2. Queue for database persistence
    buffer.push({
      timestamp: new Date(),
      stage: String(stage || "runner").toLowerCase(),
      level: validLevel,
      message: String(message || ""),
      meta: sanitizedMeta,
    })

    scheduleFlush()
  }

  const info = (stage, message, meta = null) =>
    log(stage, message, meta, "info")
  const warn = (stage, message, meta = null) =>
    log(stage, message, meta, "warn")
  const error = (stage, message, meta = null) =>
    log(stage, message, meta, "error")

  const flush = async () => {
    scheduleFlush()
    await flushChain
  }

  return {
    log,
    info,
    warn,
    error,
    flush,
  }
}

export default createScanLogger
