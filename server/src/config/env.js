import path from "node:path"
import { fileURLToPath } from "node:url"
import dotenv from "dotenv"

// Always load server/.env, no matter which folder the command is run from.
const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
dotenv.config({ path: path.join(serverRoot, ".env"), quiet: true })

export const DEFAULT_DB_NAME = "driftlogg"

// Development-only fallback from the handover spec. Production must set JWT_SECRET.
export const DEV_JWT_SECRET = "driftlogg_secret_key_123"

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT) || 5000,
  mongoUri: (process.env.MONGO_URI || "").trim(),
  mongoDbName: (process.env.MONGO_DB_NAME || "").trim(),
  dnsServers: (process.env.DNS_SERVERS || "")
    .split(",")
    .map(server => server.trim())
    .filter(Boolean),
  // CLIENT_URL is the handover name; CLIENT_ORIGIN is still accepted.
  clientUrl: process.env.CLIENT_URL || process.env.CLIENT_ORIGIN || "http://localhost:5173",
}

export const isProduction = () => process.env.NODE_ENV === "production"

/** JWT secret: required in production, falls back to the spec's dev secret otherwise. */
export function getJwtSecret() {
  const secret = (process.env.JWT_SECRET || "").trim()
  if (secret) return secret
  if (isProduction()) throw new Error("JWT_SECRET must be set in production")
  return DEV_JWT_SECRET
}
