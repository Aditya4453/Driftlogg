import { rateLimit } from "express-rate-limit"
import { AppError } from "../utils/errors.js"

export const MAX_PACKAGE_JSON_BYTES = 200 * 1024 // 200 KB
export const MAX_PACKAGE_LOCK_BYTES = 5 * 1024 * 1024 // 5 MB

/**
 * Auth rate limiter: max 20 requests per 15 minutes per IP.
 * Applied to sensitive endpoints (/api/auth/login, /api/auth/register).
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many authentication attempts, please try again in 15 minutes",
  },
  skip: () =>
    process.env.NODE_ENV === "test" && process.env.TEST_RATE_LIMIT !== "true",
})

/**
 * Scan trigger rate limiter: max 15 scans per 15 minutes per user/IP.
 * Protects compute resources and external API quotas.
 */
export const scanLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Scan rate limit exceeded, maximum 15 scans per 15 minutes",
  },
  keyGenerator: (req) => (req.user?._id ? String(req.user._id) : req.ip),
  validate: { keyGeneratorIpFallback: false },
  skip: () =>
    process.env.NODE_ENV === "test" && process.env.TEST_RATE_LIMIT !== "true",
})

/**
 * Strict universal GitHub repository URL validator and parser:
 * Strictly allows only https://github.com/<owner>/<repo> with optional:
 * - Root repo: https://github.com/<owner>/<repo> (optional .git or trailing /)
 * - Subdirectory link: https://github.com/<owner>/<repo>/tree/<branch>/<subpath>
 * - Direct manifest file link: https://github.com/<owner>/<repo>/blob/<branch>/<subpath>/package.json (or /package.json at root)
 *
 * Rejects non-github.com host, non-HTTPS scheme, query string, hash fragment, and path traversal (..).
 *
 * Returns { owner, repo, branch: branch || null, subpath: normalizedSubpath } on success, or false on failure.
 */
export function validateGitHubRepoUrl(url) {
  if (typeof url !== "string") return false
  const trimmed = url.trim()
  if (!trimmed) return false

  // Reject query string or hash fragment (prevent SSRF query injection)
  if (trimmed.includes("?") || trimmed.includes("#")) return false

  // Reject path traversal before WHATWG URL normalization resolves '..'
  if (/\/\.\.(\/|$)/.test(trimmed) || /\/\.(\/|$)/.test(trimmed)) return false

  let parsedUrl
  try {
    parsedUrl = new URL(trimmed)
  } catch {
    return false
  }

  if (parsedUrl.protocol !== "https:") return false
  if (parsedUrl.hostname !== "github.com") return false
  if (parsedUrl.port && parsedUrl.port !== "443") return false
  if (parsedUrl.username || parsedUrl.password) return false

  // Split path segments and ignore empty segments
  const rawSegments = parsedUrl.pathname.split("/").filter(Boolean)
  if (rawSegments.length < 2) return false

  const [owner, rawRepo, ...rest] = rawSegments

  // Validate owner
  if (!/^[a-zA-Z0-9_-]+$/.test(owner)) return false

  // Validate repo (strip .git suffix if present)
  let repo = rawRepo
  if (repo.endsWith(".git")) {
    repo = repo.slice(0, -4)
  }
  if (
    !repo ||
    repo === "." ||
    repo === ".." ||
    !/^[a-zA-Z0-9_.-]+$/.test(repo)
  ) {
    return false
  }

  // Reject path traversal anywhere in the remaining path
  for (const seg of rest) {
    if (seg === "." || seg === ".." || seg.includes("\\")) return false
  }

  // Case 1: Root repo (e.g., https://github.com/owner/repo)
  if (rest.length === 0) {
    return {
      owner,
      repo,
      branch: null,
      subpath: "",
    }
  }

  // Suffix must be either 'tree' (directory) or 'blob' (file)
  const action = rest[0]
  if (action !== "tree" && action !== "blob") {
    return false
  }

  // Must have a branch specified
  if (rest.length < 2) return false
  const branch = rest[1]
  if (!branch || branch === "." || branch === "..") return false

  // Path inside repository
  const pathSegments = rest.slice(2)
  let subpath = pathSegments.join("/")

  // Normalize subpath:
  // /blob/.../frontend/package.json -> 'frontend'
  // /blob/.../package.json -> ''
  if (subpath.endsWith("/package.json")) {
    subpath = subpath.slice(0, -"/package.json".length)
  } else if (subpath === "package.json") {
    subpath = ""
  }

  // Strip trailing slashes
  subpath = subpath.replace(/\/+$/, "")

  return {
    owner,
    repo,
    branch: branch || null,
    subpath,
  }
}

/**
 * Validates payload sizes for inline package files:
 * - package.json must not exceed 200 KB
 * - package-lock.json must not exceed 5 MB
 */
export function validatePackagePayload(req, _res, next) {
  const { packageJson, packageLockJson } = req.body || {}

  if (packageJson !== undefined && packageJson !== null) {
    const raw =
      typeof packageJson === "string"
        ? packageJson
        : JSON.stringify(packageJson)
    if (Buffer.byteLength(raw, "utf8") > MAX_PACKAGE_JSON_BYTES) {
      return next(
        new AppError("package.json exceeds maximum size limit of 200 KB", 400),
      )
    }
  }

  if (packageLockJson !== undefined && packageLockJson !== null) {
    const raw =
      typeof packageLockJson === "string"
        ? packageLockJson
        : JSON.stringify(packageLockJson)
    if (Buffer.byteLength(raw, "utf8") > MAX_PACKAGE_LOCK_BYTES) {
      return next(
        new AppError(
          "package-lock.json exceeds maximum size limit of 5 MB",
          400,
        ),
      )
    }
  }

  next()
}
