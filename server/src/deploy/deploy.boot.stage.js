/**
 * Deployment Error Pipeline - Stage 4: Boot & Health Simulation
 *
 * Verifies entry file execution path, health route registration,
 * healthCheckPath alignment with render.yaml, database migration strategy,
 * and managed Postgres SSL/pooling configuration.
 */

import { createFinding, createUnifiedDiff } from "./findings.js"

const ORM_PACKAGES = [
  "@prisma/client",
  "prisma",
  "knex",
  "sequelize",
  "typeorm",
  "drizzle-orm",
]

/**
 * Stage 4 Entrypoint: Boot & Health Simulation.
 */
export async function runBootStage(snapshot, options = {}) {
  const onTrace = options.onTrace || (() => {})
  const trace = (msg) => onTrace(`[deploy-boot] ${msg}`)

  trace("Starting boot simulation, entry trace, and health check validation...")
  const findings = []

  // Check if repository is a pure frontend application (e.g. Speakflow Vite/React SPA)
  const isPureFrontend =
    snapshot.appShape === "frontend-spa" ||
    (snapshot.services &&
      snapshot.services.length > 0 &&
      snapshot.services.every((s) => s.role === "frontend"))

  if (isPureFrontend) {
    trace(
      "Pure frontend application detected. Skipping backend server boot simulation.",
    )
    return findings
  }

  // Identify backend services to validate
  const backendServices =
    snapshot.services && snapshot.services.length > 0
      ? snapshot.services.filter(
          (s) => s.role === "backend" || s.role === "fullstack",
        )
      : [
          {
            rootDir: "",
            name: "root",
            packageJsonPath: snapshot.hasFile("package.json")
              ? "package.json"
              : null,
            dockerfilePath: snapshot.hasFile("Dockerfile")
              ? "Dockerfile"
              : null,
            role: "backend",
          },
        ]

  if (backendServices.length === 0) {
    trace(
      "No backend services detected in repository. Boot stage completed without errors.",
    )
    return findings
  }

  // 1. Resolve and trace entry point for each backend service
  for (const service of backendServices) {
    const entryPath = resolveServiceEntryPath(snapshot, service)
    const displayFile = service.packageJsonPath || "package.json"

    if (!entryPath) {
      if (
        snapshot.appShape === "backend-api" ||
        snapshot.appShape === "monorepo" ||
        service.role === "backend"
      ) {
        findings.push(
          createFinding({
            ruleId: "BOOT_ENTRY_UNRESOLVED",
            stage: "boot",
            severity: "blocker",
            confidence: "likely",
            file: displayFile,
            line: 1,
            snippet: `Unable to resolve application entry file for service "${service.name}"`,
            platform: "all",
            message: `Could not resolve the backend application entry point for service "${service.name}" from ${displayFile} or Dockerfile.`,
            fix: null,
          }),
        )
      }
    } else if (!snapshot.hasFile(entryPath)) {
      findings.push(
        createFinding({
          ruleId: "BOOT_ENTRY_FILE_MISSING",
          stage: "boot",
          severity: "blocker",
          confidence: "confirmed",
          file: entryPath,
          line: 1,
          snippet: `Entry file: ${entryPath}`,
          platform: "all",
          message: `Application entry file "${entryPath}" does not exist in the repository tree. Deployment boot will fail immediately.`,
          fix: null,
        }),
      )
    } else {
      // 2. Health check route registration vs render.yaml healthCheckPath
      findings.push(...checkHealthRouteRegistration(snapshot, entryPath, trace))
    }
  }

  // 3. Database migrations verification
  findings.push(...checkDatabaseMigrations(snapshot, trace))

  // 4. Managed Postgres SSL & Pooling options
  findings.push(...checkPostgresSSL(snapshot, trace))

  trace(`Boot stage completed with ${findings.length} findings.`)
  return findings
}

/**
 * Resolves entry path for a service from its package.json scripts.start, main field,
 * or Dockerfile.
 */
function resolveServiceEntryPath(snapshot, service) {
  const rootDir = service.rootDir || ""
  const prefix = rootDir ? `${rootDir}/` : ""

  if (service.packageJsonPath) {
    const pkg = snapshot.getJSON(service.packageJsonPath)
    if (pkg && pkg.scripts && typeof pkg.scripts.start === "string") {
      const startCmd = pkg.scripts.start
      const match = startCmd.match(
        /(?:node|ts-node|tsx|dist)\s+(?:--[^\s]+\s+)*([^\s]+\.(?:js|ts|mjs|cjs))/,
      )
      if (match && typeof match[1] === "string") {
        const rawTarget = match[1].replace(/^\.\//, "")
        return rawTarget.startsWith(prefix)
          ? rawTarget
          : `${prefix}${rawTarget}`
      }
    }

    if (pkg && typeof pkg.main === "string") {
      const rawTarget = pkg.main.replace(/^\.\//, "")
      return rawTarget.startsWith(prefix) ? rawTarget : `${prefix}${rawTarget}`
    }
  }

  if (typeof service.dockerfilePath === "string" && service.dockerfilePath) {
    return service.dockerfilePath
  }

  // Check common convention paths
  const commonEntries = [
    `${prefix}src/index.js`,
    `${prefix}src/index.ts`,
    `${prefix}src/server.js`,
    `${prefix}src/server.ts`,
    `${prefix}src/main.js`,
    `${prefix}src/main.ts`,
    `${prefix}server.js`,
    `${prefix}index.js`,
    `${prefix}app.js`,
  ]

  for (const candidate of commonEntries) {
    if (snapshot.hasFile(candidate)) {
      return candidate
    }
  }

  return null
}

/**
 * Verifies that the server registers a health check route and matches render.yaml healthCheckPath.
 */
function checkHealthRouteRegistration(snapshot, entryPath, trace) {
  const findings = []
  const renderYamlContent =
    snapshot.getContent("render.yaml") ||
    snapshot.getContent("render.yml") ||
    ""
  const healthMatch =
    typeof renderYamlContent === "string"
      ? renderYamlContent.match(/healthCheckPath:\s*([^\s#]+)/)
      : null
  const requiredHealthPath =
    healthMatch && typeof healthMatch[1] === "string"
      ? healthMatch[1].trim()
      : null

  // Scan all source files to find registered routes (e.g. app.get('/health', ...), router.get('/healthz', ...))
  const registeredRoutes = new Set()

  for (const entry of snapshot.tree) {
    if (!entry || typeof entry.path !== "string") continue
    if (!entry.path.endsWith(".js") && !entry.path.endsWith(".ts")) continue
    const content = snapshot.getContent(entry.path) || ""
    if (typeof content !== "string") continue

    // Regex match for HTTP route registrations: .get('/path', ...), .use('/path', ...)
    const routeRegex = /\.(get|use|all)\s*\(\s*['"](\/[^'"]*)['"]/g
    let match
    while ((match = routeRegex.exec(content)) !== null) {
      if (typeof match[2] === "string") {
        registeredRoutes.add(match[2])
      }
    }
  }

  if (requiredHealthPath) {
    const hasExactRoute = registeredRoutes.has(requiredHealthPath)
    if (!hasExactRoute) {
      findings.push(
        createFinding({
          ruleId: "RENDER_HEALTH_CHECK_ROUTE_NOT_FOUND",
          stage: "boot",
          severity: "blocker",
          confidence: "confirmed",
          file: "render.yaml",
          line: 1,
          snippet: `healthCheckPath: ${requiredHealthPath}`,
          platform: "render",
          message: `render.yaml specifies healthCheckPath "${requiredHealthPath}", but no route handler for "${requiredHealthPath}" is registered in code. Deploy will timeout and fail health checks.`,
          fix: {
            description: `Register route app.get("${requiredHealthPath}", (req, res) => res.status(200).send("OK")) in ${entryPath}`,
            patch: "",
          },
        }),
      )
    }
  } else if (
    snapshot.target === "render" &&
    snapshot.appShape === "backend-api"
  ) {
    const hasCommonHealthRoute =
      registeredRoutes.has("/health") ||
      registeredRoutes.has("/healthz") ||
      registeredRoutes.has("/api/health") ||
      registeredRoutes.has("/")

    if (!hasCommonHealthRoute) {
      findings.push(
        createFinding({
          ruleId: "BOOT_HEALTH_ROUTE_MISSING",
          stage: "boot",
          severity: "warning",
          confidence: "likely",
          file: entryPath,
          line: 1,
          snippet: entryPath,
          platform: "render",
          message:
            "No health check route (e.g. /health or /healthz) found. Define a health endpoint to ensure reliable zero-downtime deploys.",
          fix: null,
        }),
      )
    }
  }

  return findings
}

/**
 * Checks for ORM usage without a corresponding migration step in pre-deploy or start script.
 */
function checkDatabaseMigrations(snapshot, trace) {
  const findings = []

  const manifestPaths =
    snapshot.services && snapshot.services.length > 0
      ? snapshot.services
          .filter((s) => s.packageJsonPath)
          .map((s) => s.packageJsonPath)
      : snapshot.hasFile("package.json")
        ? ["package.json"]
        : []

  for (const manifestPath of manifestPaths) {
    const pkg = snapshot.getJSON(manifestPath)
    if (!pkg) continue

    const allDeps = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
    }
    const detectedOrm = ORM_PACKAGES.find((orm) => allDeps[orm])
    if (!detectedOrm) continue

    // Check render.yaml preDeployCommand or package.json scripts
    const renderYamlContent =
      snapshot.getContent("render.yaml") ||
      snapshot.getContent("render.yml") ||
      ""
    const hasPreDeployCommand =
      typeof renderYamlContent === "string" &&
      /preDeployCommand:\s*[^\r\n]+/i.test(renderYamlContent)

    const startScript =
      pkg.scripts && typeof pkg.scripts.start === "string"
        ? pkg.scripts.start
        : ""
    const hasMigrationInStart =
      typeof startScript === "string" &&
      /(migrate|prisma db push|knex migrate|typeorm migration)/i.test(
        startScript,
      )

    if (!hasPreDeployCommand && !hasMigrationInStart) {
      findings.push(
        createFinding({
          ruleId: "BOOT_ORM_NO_MIGRATION_STEP",
          stage: "boot",
          severity: "warning",
          confidence: "likely",
          file: manifestPath,
          line: 1,
          snippet: `Dependency: ${detectedOrm}`,
          platform: "all",
          message: `Project uses ${detectedOrm}, but no database migration step was found in render.yaml preDeployCommand or start script. Schema changes may not apply during deployment.`,
          fix: {
            description: `Add a preDeployCommand to render.yaml (e.g. "npx ${
              detectedOrm === "@prisma/client" || detectedOrm === "prisma"
                ? "prisma migrate deploy"
                : "knex migrate:latest"
            }")`,
            patch: "",
          },
        }),
      )
    }
  }

  return findings
}

/**
 * Verifies SSL configuration for Postgres databases on cloud platforms.
 */
function checkPostgresSSL(snapshot, trace) {
  const findings = []
  const pkg = snapshot.getJSON("package.json") || {}
  const allDeps = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
  }

  if (allDeps["pg"] || allDeps["pg-pool"]) {
    let hasSSLConfig = false
    let pgConfigFile = null

    for (const entry of snapshot.tree) {
      if (!entry || typeof entry.path !== "string") continue
      if (!entry.path.endsWith(".js") && !entry.path.endsWith(".ts")) continue
      const content = snapshot.getContent(entry.path) || ""
      if (typeof content !== "string") continue

      if (content.includes("new Pool") || content.includes("new Client")) {
        pgConfigFile = entry.path
        if (content.includes("ssl:") || content.includes("sslmode=")) {
          hasSSLConfig = true
          break
        }
      }
    }

    if (pgConfigFile && !hasSSLConfig && snapshot.target === "render") {
      findings.push(
        createFinding({
          ruleId: "BOOT_POSTGRES_SSL_MISSING",
          stage: "boot",
          severity: "warning",
          confidence: "likely",
          file: pgConfigFile,
          line: 1,
          snippet: "Postgres Pool/Client initialization",
          platform: "render",
          message:
            "Postgres client is initialized without explicit SSL configuration. Managed cloud Postgres (such as Render Postgres) requires SSL connections.",
          fix: {
            description:
              "Configure { ssl: { rejectUnauthorized: false } } in Postgres connection options",
            patch: "",
          },
        }),
      )
    }
  }

  return findings
}
