import mongoose from "mongoose"
import { DEFAULT_DB_NAME, env } from "./env.js"
import { models } from "../models/index.js"
import dns from "node:dns"

mongoose.set("strictQuery", true)
// Configure DNS servers before connecting to MongoDB Atlas.
if (env.dnsServers?.length) {
  dns.setServers(env.dnsServers)
  console.log("[db] DNS servers configured:", dns.getServers())
}

// Placeholder values copied from .env.example that were never replaced.
const PLACEHOLDER_PATTERN = /USERNAME:PASSWORD@CLUSTER|<username>|<password>|<db_password>/i

/** Returns the database name written in the URI path, or "" when there is none. */
export function getDbNameFromUri(uri) {
  const match = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]*)/.exec(uri)
  return match ? decodeURIComponent(match[1]) : ""
}

/** Removes credentials so a URI can be logged safely. */
export function redactUri(uri) {
  return uri.replace(/\/\/([^@/]+)@/, "//****:****@")
}

/** Translates common Atlas/driver errors into a short, actionable hint. */
export function connectionHint(error) {
  const text = `${error?.name || ""} ${error?.message || ""} ${error?.cause?.message || ""}`
  if (/MONGO_URI is not set|placeholders/.test(text))
    return "Open server/.env and set MONGO_URI to your real connection string (see README, section E)."
  if (/bad auth|Authentication failed|auth failed/i.test(text))
    return "Wrong database username or password. Check the Atlas database user and URL-encode special characters in the password."
  if (/querySrv|ENOTFOUND|EAI_AGAIN/i.test(text))
    return "Cluster host not found. Check the cluster address in MONGO_URI and your internet/DNS connection."
  if (/ECONNREFUSED/i.test(text))
    return "Connection refused. If you use local MongoDB, make sure the MongoDB service is running."
  if (/whitelist|IP.*access|ServerSelection|timed out|ReplicaSetNoPrimary/i.test(text))
    return "Server not reachable. In Atlas > Network Access, allow your current IP address, then try again."
  if (/Invalid scheme|Invalid connection string|URI malformed|must be URL encoded/i.test(text))
    return "MONGO_URI is malformed. It must start with mongodb:// or mongodb+srv:// and special password characters must be URL-encoded."
  return "Check MONGO_URI in server/.env."
}

// MongoDB error codes for "an index with this name/key already exists with other options".
const INDEX_CONFLICT_CODES = new Set([85, 86])

/** Creates collections and indexes. Non-destructive: never drops data or indexes. */
export async function initializeDatabase() {
  for (const model of models) {
    await model.init() // creates the collection if it does not exist yet
    try {
      await model.createIndexes() // adds missing indexes only (unlike syncIndexes, never drops)
    } catch (error) {
      if (!INDEX_CONFLICT_CODES.has(error?.code)) throw error
      // An older index with different options exists. Keep it rather than dropping anything.
      console.warn(`[db] ${model.modelName}: existing index differs from the schema and was left unchanged (${error.codeName})`)
    }
  }
}

/**
 * Connects Mongoose to MongoDB. Uses MONGO_URI from server/.env.
 * Falls back to the "driftlogg" database when the URI has no database name.
 */
export async function connectDatabase(uri = env.mongoUri, options = {}) {
  if (!uri) {
    throw new Error("MONGO_URI is not set. Copy server/.env.example to server/.env and paste your connection string.")
  }
  if (PLACEHOLDER_PATTERN.test(uri)) {
    throw new Error("MONGO_URI still contains the example placeholders. Replace USERNAME, PASSWORD and CLUSTER with your Atlas values.")
  }

  const dbName = options.dbName || env.mongoDbName || getDbNameFromUri(uri) || DEFAULT_DB_NAME

  await mongoose.connect(uri, {
    dbName,
    serverSelectionTimeoutMS: options.serverSelectionTimeoutMS ?? 10000,
    autoIndex: false, // indexes are created once, explicitly, in initializeDatabase()
  })
  await initializeDatabase()
  return mongoose.connection
}

export async function disconnectDatabase() {
  await mongoose.disconnect()
}

export function isDatabaseConnected() {
  return mongoose.connection.readyState === 1
}
