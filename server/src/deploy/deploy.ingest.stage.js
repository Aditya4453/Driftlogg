/**
 * Deployment Error Pipeline - Stage 1: Ingest
 *
 * Resolves repository, pins commit SHA, fetches tree, classifies platform/shape,
 * skips binaries and bulk assets, fetches files with bounded concurrency,
 * and produces the immutable RepoSnapshot.
 */

import pLimit from "p-limit"
import { RepoSnapshot } from "./repo-snapshot.js"
import { createFinding, formatTraceLine } from "./findings.js"

const MAX_FILE_SIZE_BYTES = 300 * 1024 // 300 KB
const MAX_CONCURRENT_FETCHES = 8
const MAX_RETRIES = 3

const SKIP_DIR_PREFIXES = [
  "node_modules/",
  "dist/",
  "build/",
  ".next/",
  ".git/",
  "coverage/",
  ".turbo/",
  ".nuxt/",
  "vendor/",
]

const BINARY_IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".webp",
  ".svg",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".7z",
  ".rar",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".mp3",
  ".mp4",
  ".wasm",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
])

const LOCKFILE_NAMES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "bun.lock",
])

/**
 * Stage 1 Entrypoint: ingest repository and build RepoSnapshot.
 */
export async function runIngestStage(input, options = {}) {
  const onTrace = options.onTrace || (() => {})
  const trace = (msg) => onTrace(`[deploy-ingest] ${msg}`)

  trace("Resolving input source and pinning commit SHA...")

  let apiCallsUsed = 0
  let rateLimitRemaining = null

  const trackResponseHeaders = (res) => {
    apiCallsUsed += 1
    const remaining =
      res.headers?.get?.("x-ratelimit-remaining") ??
      res.headers?.["x-ratelimit-remaining"]
    if (remaining !== null && remaining !== undefined) {
      rateLimitRemaining = Number(remaining)
    }
  }

  // Case 1: In-memory fixtures (useful for fast unit tests)
  if (input && (input.tree || input.files || input instanceof RepoSnapshot)) {
    trace("Ingesting synthetic in-memory snapshot fixture...")
    const snapshot =
      input instanceof RepoSnapshot
        ? input
        : buildSnapshotFromFixture(input, trace)
    trace(
      `Snapshot built from fixture: ${snapshot.tree.length} entries, pinned ref ${snapshot.ref}`,
    )
    const fixtureFindings = []
    if (snapshot.completeness.truncated) {
      fixtureFindings.push(
        createFinding({
          ruleId: "INGEST_TREE_TRUNCATED",
          stage: "ingest",
          severity: "info",
          confidence: "advisory",
          file: "repo",
          line: 1,
          snippet: "Git Trees API returned truncated=true",
          platform: "all",
          message:
            "Repository tree was truncated by GitHub API. Static analysis coverage may be incomplete.",
          fix: null,
        }),
      )
    }
    if (snapshot.completeness.failedCount > 0) {
      fixtureFindings.push(
        createFinding({
          ruleId: "INGEST_FILE_FETCH_FAILED",
          stage: "ingest",
          severity: "info",
          confidence: "advisory",
          file: "repo",
          line: 1,
          snippet: `${snapshot.completeness.failedCount} files failed to fetch`,
          platform: "all",
          message: `${snapshot.completeness.failedCount} repository files could not be retrieved from source.`,
          fix: null,
        }),
      )
    }
    return { snapshot, findings: fixtureFindings }
  }

  // Case 2: GitHub Repository URL or params
  const ghConfig = parseGitHubInput(input)
  if (!ghConfig) {
    throw new Error(
      "Invalid ingest input: expected GitHub repository URL, { owner, repo }, or snapshot fixture.",
    )
  }

  const { owner, repo, token } = ghConfig
  const requestedRef = ghConfig.branch || ghConfig.ref || "HEAD"

  const headers = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "DriftLogg-Deployment-Pipeline/1.0",
  }
  const effectiveToken =
    token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (effectiveToken) {
    headers["Authorization"] = `token ${effectiveToken}`
  }

  // 1. Pin Commit SHA
  trace(`Pinning commit SHA for ${owner}/${repo} at ref "${requestedRef}"...`)
  const pinUrl = `https://api.github.com/repos/${owner}/${repo}/commits/${requestedRef}`
  const pinRes = await fetchWithRetry(pinUrl, { headers }, MAX_RETRIES)
  trackResponseHeaders(pinRes)

  if (!pinRes.ok) {
    throw new Error(
      `Failed to pin commit for ${owner}/${repo}@${requestedRef}: HTTP ${pinRes.status}`,
    )
  }

  const commitData = await pinRes.json()
  const pinnedSha =
    commitData.sha ||
    (typeof commitData === "string" ? commitData : "0".repeat(40))
  trace(`Pinned commit SHA: ${pinnedSha}`)

  // 2. Fetch Recursive Tree
  trace(`Fetching repository tree at commit ${pinnedSha}...`)
  const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${pinnedSha}?recursive=1`
  const treeRes = await fetchWithRetry(treeUrl, { headers }, MAX_RETRIES)
  trackResponseHeaders(treeRes)

  if (!treeRes.ok) {
    throw new Error(
      `Failed to fetch tree for ${owner}/${repo}@${pinnedSha}: HTTP ${treeRes.status}`,
    )
  }

  const treeJson = await treeRes.json()
  let rawTree = Array.isArray(treeJson.tree) ? treeJson.tree : []
  let isTruncated = Boolean(treeJson.truncated)
  const completenessWarnings = []

  if (isTruncated) {
    trace(
      "Tree was truncated by GitHub API! Falling back to subtree directory walk...",
    )
    completenessWarnings.push(
      "Git tree response was truncated by GitHub API; coverage reduced.",
    )
    // Walk first-level subtrees if truncated
    try {
      const subTreePromises = rawTree
        .filter((e) => e.type === "tree")
        .slice(0, 10)
        .map(async (dirEntry) => {
          const subUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${dirEntry.sha}?recursive=1`
          const subRes = await fetchWithRetry(subUrl, { headers }, 2)
          trackResponseHeaders(subRes)
          if (subRes.ok) {
            const subJson = await subRes.json()
            return (subJson.tree || []).map((e) => ({
              ...e,
              path: `${dirEntry.path}/${e.path}`,
            }))
          }
          return []
        })
      const additionalTrees = await Promise.all(subTreePromises)
      for (const list of additionalTrees) {
        rawTree.push(...list)
      }
    } catch {
      trace(
        "Subtree walk encountered partial errors; proceeding with partial tree.",
      )
    }
  }

  // 3. Classify tree entries and pre-filter
  const casePreservedTree = []
  const entriesToFetch = []
  const filesMap = new Map()

  let skippedCount = 0
  let failedCount = 0

  for (const entry of rawTree) {
    if (!entry || !entry.path) continue
    const path = entry.path

    // Submodules or symlinks
    if (entry.mode === "160000" || entry.mode === "120000") {
      skippedCount += 1
      continue
    }

    if (entry.type !== "blob") {
      casePreservedTree.push(entry)
      continue
    }

    casePreservedTree.push(entry)

    // Skip directories: node_modules, dist, .next, etc.
    if (
      SKIP_DIR_PREFIXES.some(
        (prefix) => path.startsWith(prefix) || path.includes(`/${prefix}`),
      )
    ) {
      skippedCount += 1
      continue
    }

    // Skip lockfile contents (record presence only)
    const baseName = path.split("/").pop()
    if (LOCKFILE_NAMES.has(baseName)) {
      filesMap.set(path, {
        content: null,
        status: "skipped",
        reason: "lockfile-metadata-only",
      })
      skippedCount += 1
      continue
    }

    // Skip minified files
    if (path.endsWith(".min.js") || path.endsWith(".min.css")) {
      skippedCount += 1
      continue
    }

    // Skip binaries and images
    const extMatch = path.match(/\.[^./]+$/)
    const ext = extMatch ? extMatch[0].toLowerCase() : ""
    if (BINARY_IMAGE_EXTENSIONS.has(ext)) {
      skippedCount += 1
      continue
    }

    // Skip files exceeding 300 KB
    if (typeof entry.size === "number" && entry.size > MAX_FILE_SIZE_BYTES) {
      filesMap.set(path, {
        content: null,
        status: "skipped",
        reason: `file size ${entry.size} exceeds 300KB limit`,
      })
      skippedCount += 1
      continue
    }

    // Filter relevant files to fetch: configs, code, manifests, documentation
    if (isCodeOrConfigFile(path)) {
      entriesToFetch.push(entry)
    }
  }

  // Prioritize and cap file fetches at 80 files across discovered service directories
  entriesToFetch.sort(
    (a, b) => getFileFetchPriority(b.path) - getFileFetchPriority(a.path),
  )
  const entriesToFetchBounded = entriesToFetch.slice(0, 80)

  // 4. Batch content fetching with bounded concurrency
  trace(
    `Fetching ${entriesToFetchBounded.length} file contents (concurrency max ${MAX_CONCURRENT_FETCHES}, capped at 80)...`,
  )
  const limit = pLimit(MAX_CONCURRENT_FETCHES)

  const fetchPromises = entriesToFetchBounded.map((entry) =>
    limit(async () => {
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${pinnedSha}/${entry.path}`
      try {
        const res = await fetchWithRetry(rawUrl, { headers }, MAX_RETRIES)
        trackResponseHeaders(res)
        if (res.ok) {
          const content = await res.text()
          filesMap.set(entry.path, { content, status: "ok" })
        } else {
          failedCount += 1
          filesMap.set(entry.path, {
            content: null,
            status: "failed",
            reason: `HTTP ${res.status}`,
          })
        }
      } catch (err) {
        failedCount += 1
        filesMap.set(entry.path, {
          content: null,
          status: "failed",
          reason: err.message,
        })
      }
    }),
  )

  await Promise.all(fetchPromises)

  // 5. Discover services and classify AFTER fetching content
  const services = discoverServices(casePreservedTree, filesMap)
  const target = detectTargetPlatform(casePreservedTree, services)
  const appShape = detectAppShape(casePreservedTree, services)
  const packageManager = detectPackageManager(casePreservedTree)
  const workspaces = detectWorkspaces(casePreservedTree)

  trace(
    `Classification: target="${target}", shape="${appShape}", pm="${packageManager}", services=${services.length}, workspaces=${workspaces.length}`,
  )

  trace(
    `API calls used: ${apiCallsUsed}, rate limit remaining: ${rateLimitRemaining ?? "unknown"}`,
  )

  const snapshot = new RepoSnapshot({
    source: {
      type: "github",
      owner,
      repo,
      ref: pinnedSha,
      url: `https://github.com/${owner}/${repo}`,
    },
    ref: pinnedSha,
    tree: casePreservedTree,
    files: filesMap,
    target,
    appShape,
    packageManager,
    workspaces,
    services,
    completeness: {
      truncated: isTruncated,
      skippedCount,
      failedCount,
      warnings: completenessWarnings,
    },
  })

  const findings = []
  if (isTruncated) {
    findings.push(
      createFinding({
        ruleId: "INGEST_TREE_TRUNCATED",
        stage: "ingest",
        severity: "info",
        confidence: "advisory",
        file: "repo",
        line: 1,
        snippet: "Git Trees API returned truncated=true",
        platform: "all",
        message:
          "Repository tree was truncated by GitHub API. Static analysis coverage may be incomplete.",
        fix: null,
      }),
    )
  }

  if (failedCount > 0) {
    findings.push(
      createFinding({
        ruleId: "INGEST_FILE_FETCH_FAILED",
        stage: "ingest",
        severity: "info",
        confidence: "advisory",
        file: "repo",
        line: 1,
        snippet: `${failedCount} files failed to fetch`,
        platform: "all",
        message: `${failedCount} repository files could not be retrieved from source.`,
        fix: null,
      }),
    )
  }

  return { snapshot, findings }
}

/**
 * Builds a RepoSnapshot from an in-memory test fixture.
 */
function buildSnapshotFromFixture(input, trace) {
  const tree = []
  const filesMap = new Map()

  const ref = input.ref || "a".repeat(40)
  const rawFiles =
    input.files instanceof Map ? input.files : Object.entries(input.files || {})

  for (const [p, val] of rawFiles instanceof Map
    ? rawFiles.entries()
    : rawFiles) {
    const cleanPath = p.replace(/^\.\//, "")
    const content = typeof val === "string" ? val : (val?.content ?? null)
    const status = val?.status || (content !== null ? "ok" : "failed")
    const reason = val?.reason || undefined

    tree.push({
      path: cleanPath,
      type: "blob",
      size: content ? content.length : 0,
    })
    filesMap.set(cleanPath, { content, status, reason })
  }

  if (Array.isArray(input.tree)) {
    for (const entry of input.tree) {
      if (!filesMap.has(entry.path)) {
        tree.push(entry)
      }
    }
  }

  const services = input.services || discoverServices(tree, filesMap)
  const target = input.target || detectTargetPlatform(tree, services)
  const appShape = input.appShape || detectAppShape(tree, services)
  const packageManager = input.packageManager || detectPackageManager(tree)
  const workspaces = input.workspaces || detectWorkspaces(tree)

  return new RepoSnapshot({
    source: input.source || { type: "files", ref },
    ref,
    tree,
    files: filesMap,
    target,
    appShape,
    packageManager,
    workspaces,
    services,
    completeness: input.completeness || {},
  })
}

function getFileFetchPriority(path) {
  const base = path.split("/").pop()
  const lowerBase = base.toLowerCase()

  // Highest priority: manifests and platform configs
  if (
    base === "package.json" ||
    lowerBase === "dockerfile" ||
    base === "render.yaml" ||
    base === "render.yml" ||
    base === "vercel.json" ||
    base === "railway.json" ||
    base === "railway.toml" ||
    base === "Procfile" ||
    base === "tsconfig.json" ||
    base.startsWith(".env") ||
    base === ".gitignore" ||
    base === ".dockerignore" ||
    base.startsWith("vite.config") ||
    base.startsWith("next.config")
  ) {
    return 100
  }

  // High priority: Application and server entry points
  if (
    base === "server.js" ||
    base === "app.js" ||
    base === "index.js" ||
    base === "main.js" ||
    base === "server.ts" ||
    base === "app.ts" ||
    base === "index.ts" ||
    base === "main.ts" ||
    base === "App.tsx" ||
    base === "App.jsx"
  ) {
    return 80
  }

  // Medium priority: Route, controller, middleware, model, and source files
  if (
    path.includes("/routes/") ||
    path.includes("/controllers/") ||
    path.includes("/middleware/") ||
    path.includes("/models/") ||
    path.includes("/config/") ||
    path.includes("/src/")
  ) {
    return 60
  }

  return 40
}

/**
 * Discovers all multi-service applications in the repository tree.
 * Returns array of { rootDir, name, role, packageJsonPath, dockerfilePath }
 */
export function discoverServices(tree = [], filesMap = new Map()) {
  const serviceMap = new Map()

  for (const entry of tree) {
    if (!entry || !entry.path) continue
    const p = entry.path

    if (
      SKIP_DIR_PREFIXES.some(
        (prefix) => p.startsWith(prefix) || p.includes(`/${prefix}`),
      )
    ) {
      continue
    }

    if (p === "package.json" || p.endsWith("/package.json")) {
      const rootDir =
        p === "package.json" ? "" : p.slice(0, -"/package.json".length)
      if (!serviceMap.has(rootDir)) {
        serviceMap.set(rootDir, {
          rootDir,
          name: rootDir ? rootDir.split("/").pop() : "root",
          packageJsonPath: p,
          dockerfilePath: null,
          role: "backend",
        })
      } else {
        serviceMap.get(rootDir).packageJsonPath = p
      }
    } else if (
      p === "Dockerfile" ||
      p.toLowerCase().endsWith("/dockerfile") ||
      p.endsWith("/Dockerfile")
    ) {
      const rootDir =
        p.toLowerCase() === "dockerfile" ? "" : p.slice(0, p.lastIndexOf("/"))
      if (!serviceMap.has(rootDir)) {
        serviceMap.set(rootDir, {
          rootDir,
          name: rootDir ? rootDir.split("/").pop() : "container",
          packageJsonPath: null,
          dockerfilePath: p,
          role: "container",
        })
      } else {
        serviceMap.get(rootDir).dockerfilePath = p
      }
    }
  }

  const services = Array.from(serviceMap.values())

  for (const s of services) {
    let pkg = null
    if (s.packageJsonPath) {
      const fileRec =
        filesMap instanceof Map
          ? filesMap.get(s.packageJsonPath)
          : filesMap?.[s.packageJsonPath]
      if (fileRec?.content) {
        try {
          pkg = JSON.parse(fileRec.content)
        } catch {
          // ignore invalid json
        }
      }
    }

    if (pkg && pkg.name) {
      s.name = pkg.name
    }

    s.role = classifyServiceRole(s.rootDir, pkg, tree)
  }

  return services
}

function classifyServiceRole(rootDir, pkg, tree) {
  const deps = {
    ...(pkg?.dependencies || {}),
    ...(pkg?.devDependencies || {}),
  }

  // 1. Next.js / Nuxt fullstack
  if (
    deps.next ||
    deps.nuxt ||
    hasFileInDir(tree, rootDir, [
      "next.config.js",
      "next.config.mjs",
      "next.config.ts",
    ])
  ) {
    return "fullstack"
  }

  // 2. Frontend signals
  if (
    deps.react ||
    deps["react-dom"] ||
    deps.vue ||
    deps.svelte ||
    deps.vite ||
    deps["@vitejs/plugin-react"] ||
    deps["solid-js"] ||
    deps.astro ||
    hasFileInDir(tree, rootDir, [
      "vite.config.js",
      "vite.config.ts",
      "index.html",
      "src/App.tsx",
      "src/App.jsx",
      "src/App.vue",
    ])
  ) {
    if (
      deps.express ||
      deps.fastify ||
      deps.koa ||
      deps["@nestjs/core"] ||
      hasFileInDir(tree, rootDir, ["server.js", "server.ts"])
    ) {
      return "fullstack"
    }
    return "frontend"
  }

  // 3. Backend signals
  if (
    deps.express ||
    deps.fastify ||
    deps.koa ||
    deps["@nestjs/core"] ||
    deps.hapi ||
    deps.mongoose ||
    deps.pg ||
    deps.sequelize ||
    deps.prisma ||
    deps["@prisma/client"] ||
    hasFileInDir(tree, rootDir, [
      "server.js",
      "server.ts",
      "app.js",
      "app.ts",
      "routes",
      "controllers",
    ])
  ) {
    return "backend"
  }

  // 4. Directory name conventions
  const dirLower = (rootDir || "").toLowerCase()
  if (
    dirLower.includes("frontend") ||
    dirLower.includes("client") ||
    dirLower.includes("ui") ||
    dirLower.includes("web")
  ) {
    return "frontend"
  }
  if (
    dirLower.includes("backend") ||
    dirLower.includes("server") ||
    dirLower.includes("api")
  ) {
    return "backend"
  }

  // 5. Container only
  if (!pkg && hasFileInDir(tree, rootDir, ["Dockerfile", "dockerfile"])) {
    return "container"
  }

  return "backend"
}

function hasFileInDir(tree, rootDir, candidates) {
  const prefix = rootDir ? `${rootDir}/` : ""
  return tree.some((e) => {
    if (!e || !e.path) return false
    return candidates.some((cand) => {
      const target = `${prefix}${cand}`
      return e.path === target || e.path.startsWith(`${target}/`)
    })
  })
}

function isCodeOrConfigFile(path) {
  return (
    path.endsWith(".json") ||
    path.endsWith(".yaml") ||
    path.endsWith(".yml") ||
    path.endsWith(".toml") ||
    path.endsWith(".js") ||
    path.endsWith(".jsx") ||
    path.endsWith(".mjs") ||
    path.endsWith(".cjs") ||
    path.endsWith(".ts") ||
    path.endsWith(".tsx") ||
    path.endsWith(".env") ||
    path.includes(".env.") ||
    path.endsWith(".env.example") ||
    path.endsWith(".gitignore") ||
    path.endsWith(".dockerignore") ||
    path.toLowerCase().endsWith("dockerfile") ||
    path.endsWith("Procfile") ||
    path.endsWith(".prisma")
  )
}

function detectTargetPlatform(tree, services = []) {
  const paths = new Set(tree.map((e) => e.path))
  if (paths.has("render.yaml") || paths.has("render.yml")) return "render"
  if (paths.has("vercel.json")) return "vercel"
  if (paths.has("Dockerfile") || paths.has("dockerfile")) return "docker"
  if (paths.has("railway.json") || paths.has("railway.toml")) return "railway"
  if (paths.has("Procfile")) return "render"

  // If all services are frontend, default to vercel
  if (services.length > 0 && services.every((s) => s.role === "frontend")) {
    return "vercel"
  }

  if (
    paths.has("vite.config.ts") ||
    paths.has("vite.config.js") ||
    paths.has("index.html")
  ) {
    const hasBackend = services.some(
      (s) => s.role === "backend" || s.role === "fullstack",
    )
    if (!hasBackend) return "vercel"
  }
  return "render"
}

function detectAppShape(tree, services = []) {
  if (services.length > 1) {
    return "monorepo"
  }

  if (services.length === 1) {
    const s = services[0]
    if (s.role === "frontend") return "frontend-spa"
    if (s.role === "fullstack") return "fullstack-next"
    if (s.role === "container") return "containerized"
    return "backend-api"
  }

  const paths = new Set(tree.map((e) => e.path))
  if (
    paths.has("next.config.js") ||
    paths.has("next.config.ts") ||
    paths.has("next.config.mjs")
  ) {
    return "fullstack-next"
  }
  if (paths.has("Dockerfile") || paths.has("dockerfile")) {
    return "containerized"
  }
  if (paths.has("pnpm-workspace.yaml") || paths.has("lerna.json")) {
    return "monorepo"
  }
  if (
    paths.has("vite.config.js") ||
    paths.has("vite.config.ts") ||
    paths.has("index.html")
  ) {
    return "frontend-spa"
  }
  return "backend-api"
}

function detectPackageManager(tree) {
  const paths = new Set(tree.map((e) => e.path))
  if (paths.has("pnpm-lock.yaml")) return "pnpm"
  if (paths.has("yarn.lock")) return "yarn"
  if (paths.has("bun.lockb") || paths.has("bun.lock")) return "bun"
  return "npm"
}

function detectWorkspaces(tree) {
  const workspaces = []
  const paths = tree.map((e) => e.path)
  for (const p of paths) {
    if (p.endsWith("/package.json") && p !== "package.json") {
      const rootDir = p.replace(/\/package\.json$/, "")
      if (!SKIP_DIR_PREFIXES.some((prefix) => rootDir.startsWith(prefix))) {
        workspaces.push(rootDir)
      }
    }
  }
  return workspaces
}

function parseGitHubInput(input) {
  if (typeof input === "string") {
    const match = input
      .trim()
      .match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/tree\/([^/]+))?$/i)
    if (match) {
      return { owner: match[1], repo: match[2], branch: match[3] || "main" }
    }
  }
  if (input && typeof input === "object" && input.owner && input.repo) {
    return input
  }
  return null
}

async function fetchWithRetry(url, options = {}, retries = 3) {
  let attempt = 0
  let delay = 300

  while (attempt <= retries) {
    attempt += 1
    try {
      const res = await fetch(url, options)
      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        if (attempt <= retries) {
          const retryAfter = res.headers.get("retry-after")
          const waitMs = retryAfter ? Number(retryAfter) * 1000 : delay
          await new Promise((r) => setTimeout(r, waitMs))
          delay *= 2
          continue
        }
      }
      return res
    } catch (err) {
      if (attempt > retries) throw err
      await new Promise((r) => setTimeout(r, delay))
      delay *= 2
    }
  }
}
