/**
 * Deployment Error Pipeline - Stage 2: Config & Secrets
 *
 * Statically analyzes environment variables (AST-based), committed credentials,
 * package manifests, build scripts, and platform configuration.
 */

import { createFinding, createUnifiedDiff } from "./findings.js"
import { runPlatformRules } from "./rules/index.js"

const CLIENT_PREFIXES = ["VITE_", "NEXT_PUBLIC_", "REACT_APP_"]

const PLATFORM_INJECTED_ENV_VARS = new Set([
  "PORT",
  "NODE_ENV",
  "CI",
  "TZ",
  "HOST",
  "HOSTNAME",
])

const SECRET_NAME_PATTERNS = [
  /SECRET/i,
  /PASSWORD/i,
  /PRIVATE_KEY/i,
  /TOKEN/i,
  /API_KEY/i,
  /AUTH/i,
  /CREDENTIALS/i,
]

const SECRET_FILE_PATTERNS = [
  /\.pem$/i,
  /^id_rsa/i,
  /^id_ed25519/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
]

/**
 * Stage 2 Entrypoint: Config & Secrets validation.
 */
export async function runConfigStage(snapshot, options = {}) {
  const onTrace = options.onTrace || (() => {})
  const trace = (msg) => onTrace(`[deploy-config] ${msg}`)

  trace("Starting configuration, secrets, and environment analysis...")
  const findings = []

  // 1. Secrets & Credentials in repository tree
  findings.push(...checkTrackedSecrets(snapshot, trace))

  // 2. Env variable parity using AST analysis
  findings.push(...checkEnvParityAST(snapshot, trace))

  // 3. Build scripts, engines, and package manager configuration
  findings.push(...checkBuildConfig(snapshot, trace))

  // 4. Platform-specific config checks (Render, Vercel, Docker)
  findings.push(...runPlatformRules(snapshot))

  trace(`Config stage completed with ${findings.length} findings.`)
  return findings
}

/**
 * Checks for committed .env files, private keys, database passwords in URLs,
 * and secret keys exposed via client-side prefixes.
 */
function checkTrackedSecrets(snapshot, trace) {
  const findings = []
  const gitignoreContent = snapshot.getContent(".gitignore") || ""
  const gitignoreCoversEnv = /\.env(\b|\*|\.)/m.test(gitignoreContent)

  for (const entry of snapshot.tree) {
    const p = entry.path
    const baseName = p.split("/").pop()

    // 1. Tracked .env files (excluding .example, .sample, .template)
    if (
      baseName === ".env" ||
      (baseName.startsWith(".env.") &&
        !baseName.endsWith(".example") &&
        !baseName.endsWith(".sample") &&
        !baseName.endsWith(".template"))
    ) {
      const isBlocker =
        !gitignoreCoversEnv ||
        baseName === ".env" ||
        baseName.includes(".production")
      findings.push(
        createFinding({
          ruleId: "CONFIG_SECRET_ENV_TRACKED",
          stage: "config",
          severity: isBlocker ? "blocker" : "warning",
          confidence: "confirmed",
          file: p,
          line: 1,
          snippet: p,
          platform: "all",
          message: `Tracked environment file "${p}" is committed to repository. Secrets must be supplied via platform environment variables, not committed in git.`,
          fix: {
            description: `Remove ${p} from git and add it to .gitignore`,
            patch: createUnifiedDiff({
              file: ".gitignore",
              originalText: gitignoreContent,
              newText: `${gitignoreContent.trim()}\n.env\n.env.*\n!.env.example\n`,
            }),
          },
        }),
      )
    }

    // 2. Private key / credential files in tree
    if (SECRET_FILE_PATTERNS.some((pattern) => pattern.test(baseName))) {
      findings.push(
        createFinding({
          ruleId: "CONFIG_SECRET_KEYFILE_COMMITTED",
          stage: "config",
          severity: "blocker",
          confidence: "confirmed",
          file: p,
          line: 1,
          snippet: p,
          platform: "all",
          message: `Private key or credential file "${p}" is committed to the repository.`,
          fix: {
            description: `Remove ${p} from repository and rotate the compromised credential`,
            patch: "",
          },
        }),
      )
    }

    // 3. Inspect source file contents for hardcoded credentials & client prefix leakage
    const content = snapshot.getContent(p)
    if (!content) continue

    // Client prefix leakage: VITE_STRIPE_SECRET, NEXT_PUBLIC_DATABASE_PASSWORD
    for (const prefix of CLIENT_PREFIXES) {
      const regex = new RegExp(`\\b(${prefix}[A-Z0-9_]+)\\b`, "g")
      let match
      while ((match = regex.exec(content)) !== null) {
        const varName = match[1]
        if (SECRET_NAME_PATTERNS.some((pat) => pat.test(varName))) {
          findings.push(
            createFinding({
              ruleId: "CONFIG_SECRET_LEAK_CLIENT_PREFIX",
              stage: "config",
              severity: "blocker",
              confidence: "confirmed",
              file: p,
              line: getLineNumber(content, match.index),
              snippet: varName,
              platform: "all",
              message: `Secret-bearing variable "${varName}" uses client prefix "${prefix}". Client-side bundlers embed this secret directly into public browser bundles.`,
              fix: {
                description: `Rename ${varName} to remove the ${prefix} prefix and access it only on the backend`,
                patch: "",
              },
            }),
          )
        }
      }
    }

    // Database connection strings containing passwords
    const dbUriMatch = content.match(
      /(postgres|postgresql|mongodb|mysql):\/\/[a-zA-Z0-9_.-]+:([^@\s'"]+)@[a-zA-Z0-9_.-]+/i,
    )
    if (
      dbUriMatch &&
      !p.includes(".example") &&
      !p.includes(".test.") &&
      !p.includes(".spec.")
    ) {
      const password = dbUriMatch[2]
      if (
        password !== "password" &&
        password !== "root" &&
        !password.startsWith("$")
      ) {
        findings.push(
          createFinding({
            ruleId: "CONFIG_SECRET_HARDCODED_DB_URL",
            stage: "config",
            severity: "blocker",
            confidence: "confirmed",
            file: p,
            line: getLineNumber(content, dbUriMatch.index),
            snippet: dbUriMatch[0].replace(password, "********"),
            platform: "all",
            message: `Hardcoded database URL containing cleartext credentials found in "${p}".`,
            fix: {
              description:
                "Replace hardcoded database URL with process.env.DATABASE_URL",
              patch: "",
            },
          }),
        )
      }
    }
  }

  return findings
}

/**
 * AST-based Environment Variable Parity Check.
 * Traverses code ASTs to identify process.env and import.meta.env accesses,
 * filtering out guarded access and platform-provided vars.
 * Supports root and subfolder per-service .env.example files.
 */
function checkEnvParityAST(snapshot, trace) {
  const findings = []
  const requiredEnvVars = [] // { varName, file, line, snippet }
  const dynamicAccesses = []

  // Discover all .env.example files across root and service folders
  const exampleRecords = []
  const exampleCandidates = [".env.example", ".env.sample", ".env.template"]

  // Root examples
  for (const cand of exampleCandidates) {
    const content = snapshot.getContent(cand)
    if (content) {
      exampleRecords.push({
        path: cand,
        rootDir: "",
        content,
        vars: parseEnvExampleVars(content),
      })
      break
    }
  }

  // Service folder examples
  if (snapshot.services && snapshot.services.length > 0) {
    for (const service of snapshot.services) {
      if (!service.rootDir) continue
      for (const cand of exampleCandidates) {
        const fullCand = `${service.rootDir}/${cand}`
        const content = snapshot.getContent(fullCand)
        if (content) {
          exampleRecords.push({
            path: fullCand,
            rootDir: service.rootDir,
            content,
            vars: parseEnvExampleVars(content),
          })
          break
        }
      }
    }
  }

  for (const entry of snapshot.tree) {
    if (
      !entry.path.endsWith(".js") &&
      !entry.path.endsWith(".ts") &&
      !entry.path.endsWith(".tsx") &&
      !entry.path.endsWith(".jsx")
    ) {
      continue
    }
    const ast = snapshot.getAST(entry.path)
    if (!ast) continue

    const content = snapshot.getContent(entry.path) || ""

    walkAST(ast, (node, parent) => {
      // 1. process.env.VAR or process.env['VAR']
      if (
        node.type === "MemberExpression" &&
        node.object &&
        node.object.type === "MemberExpression" &&
        node.object.object &&
        node.object.object.type === "Identifier" &&
        node.object.object.name === "process" &&
        node.object.property &&
        node.object.property.name === "env"
      ) {
        if (
          !node.computed &&
          node.property &&
          node.property.type === "Identifier"
        ) {
          handleEnvVarRef(
            node.property.name,
            node,
            parent,
            entry.path,
            content,
            requiredEnvVars,
          )
        } else if (
          node.computed &&
          node.property &&
          node.property.type === "StringLiteral"
        ) {
          handleEnvVarRef(
            node.property.value,
            node,
            parent,
            entry.path,
            content,
            requiredEnvVars,
          )
        } else if (
          node.computed &&
          node.property &&
          node.property.type !== "StringLiteral"
        ) {
          dynamicAccesses.push({
            file: entry.path,
            line: node.loc ? node.loc.start.line : 1,
            snippet: content.slice(node.start, node.end),
          })
        }
      }

      // 2. import.meta.env.VAR
      if (
        node.type === "MemberExpression" &&
        node.object &&
        node.object.type === "MemberExpression" &&
        node.object.object &&
        node.object.object.type === "MetaProperty" &&
        node.object.property &&
        node.object.property.name === "env" &&
        node.property
      ) {
        const varName = node.property.name || node.property.value
        if (varName) {
          handleEnvVarRef(
            varName,
            node,
            parent,
            entry.path,
            content,
            requiredEnvVars,
          )
        }
      }

      // 3. const { VAR } = process.env
      if (
        node.type === "VariableDeclarator" &&
        node.id &&
        node.id.type === "ObjectPattern" &&
        node.init &&
        isProcessEnv(node.init)
      ) {
        for (const prop of node.id.properties) {
          if (prop.type === "ObjectProperty" && prop.key && prop.key.name) {
            const hasDefault =
              prop.value && prop.value.type === "AssignmentPattern"
            if (!hasDefault) {
              handleEnvVarRef(
                prop.key.name,
                prop,
                parent,
                entry.path,
                content,
                requiredEnvVars,
              )
            }
          }
        }
      }
    })
  }

  // Report dynamic process.env accesses as advisory
  for (const item of dynamicAccesses) {
    findings.push(
      createFinding({
        ruleId: "CONFIG_ENV_DYNAMIC_ACCESS",
        stage: "config",
        severity: "info",
        confidence: "advisory",
        file: item.file,
        line: item.line,
        snippet: item.snippet,
        platform: "all",
        message:
          "Dynamic environment variable access (process.env[key]) detected. Static parity could not verify this key.",
        fix: null,
      }),
    )
  }

  // Compare required variables against the appropriate .env.example
  if (exampleRecords.length > 0) {
    const reportedKeys = new Set() // avoid duplicate warnings for same (varName, file)

    for (const info of requiredEnvVars) {
      const dedupeKey = `${info.file}:${info.varName}`
      if (reportedKeys.has(dedupeKey)) continue

      // Resolve example record for this file
      const example = resolveExampleForFile(info.file, exampleRecords)
      if (!example) continue

      if (!example.vars.has(info.varName)) {
        reportedKeys.add(dedupeKey)
        findings.push(
          createFinding({
            ruleId: "CONFIG_ENV_UNDOCUMENTED_REQUIRED",
            stage: "config",
            severity: "warning",
            confidence: "likely",
            file: info.file,
            line: info.line,
            snippet: info.snippet,
            platform: "all",
            message: `Environment variable "${info.varName}" is required in code without fallback, but is missing from ${example.path}.`,
            fix: {
              description: `Add ${info.varName}= to ${example.path}`,
              patch: createUnifiedDiff({
                file: example.path,
                originalText: example.content,
                newText: `${example.content.trim()}\n${info.varName}=\n`,
              }),
            },
          }),
        )
      }
    }
  }

  return findings
}

function parseEnvExampleVars(content) {
  const vars = new Set()
  if (!content) return vars
  const lines = content.split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const keyMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=?/)
    if (keyMatch) {
      vars.add(keyMatch[1])
    }
  }
  return vars
}

function resolveExampleForFile(filePath, exampleRecords) {
  // First match service-level example
  for (const ex of exampleRecords) {
    if (ex.rootDir && filePath.startsWith(`${ex.rootDir}/`)) {
      return ex
    }
  }
  // Fallback to root example
  return exampleRecords.find((ex) => ex.rootDir === "") || exampleRecords[0]
}

function handleEnvVarRef(varName, node, parent, file, content, list) {
  if (!varName || typeof varName !== "string") return

  // Ignore platform injected variables
  if (
    PLATFORM_INJECTED_ENV_VARS.has(varName) ||
    varName.startsWith("VERCEL_") ||
    varName.startsWith("RENDER_") ||
    varName.startsWith("AWS_") ||
    varName.startsWith("RAILWAY_")
  ) {
    return
  }

  // Check for fallback: process.env.X || 'default' or process.env.X ?? 'default'
  if (
    parent &&
    parent.type === "LogicalExpression" &&
    (parent.operator === "||" || parent.operator === "??") &&
    parent.left === node
  ) {
    return // Has default fallback
  }

  // Check for ternary guard: process.env.X ? a : b
  if (
    parent &&
    parent.type === "ConditionalExpression" &&
    parent.test === node
  ) {
    return // Guarded check
  }

  // Check for if statement guard: if (process.env.X) ...
  if (parent && parent.type === "IfStatement" && parent.test === node) {
    return // Guarded check
  }

  const snippet = content.slice(
    Math.max(0, node.start - 10),
    Math.min(content.length, node.end + 20),
  )

  list.push({
    varName,
    file,
    line: node.loc ? node.loc.start.line : 1,
    snippet,
  })
}

function isProcessEnv(node) {
  return (
    node.type === "MemberExpression" &&
    node.object &&
    node.object.type === "Identifier" &&
    node.object.name === "process" &&
    node.property &&
    node.property.name === "env"
  )
}

/**
 * Validates engines.node, scripts.start, scripts.build, lockfile parity,
 * and build tools misplaced in devDependencies across all discovered services.
 */
function checkBuildConfig(snapshot, trace) {
  const findings = []

  const services =
    snapshot.services && snapshot.services.length > 0
      ? snapshot.services
      : snapshot.getJSON("package.json")
        ? [
            {
              rootDir: "",
              name: "root",
              packageJsonPath: "package.json",
              role:
                snapshot.appShape === "frontend-spa" ? "frontend" : "backend",
            },
          ]
        : []

  const hasAnyPackageJson =
    snapshot.hasFile("package.json") ||
    snapshot.tree.some((e) => e.path.endsWith("/package.json"))
  const hasAnyDockerfile =
    snapshot.hasFile("Dockerfile") ||
    snapshot.hasFile("dockerfile") ||
    snapshot.tree.some((e) => e.path.toLowerCase().endsWith("/dockerfile"))

  if (services.length === 0 && !hasAnyPackageJson && !hasAnyDockerfile) {
    findings.push(
      createFinding({
        ruleId: "CONFIG_PACKAGE_JSON_MISSING",
        stage: "config",
        severity: "blocker",
        confidence: "confirmed",
        file: "package.json",
        line: 1,
        snippet: "No root package.json found",
        platform: "all",
        message: "Repository root is missing package.json.",
        fix: null,
      }),
    )
    return findings
  }

  // Iterate over all discovered services
  for (const service of services) {
    if (!service.packageJsonPath) continue
    const pkg = snapshot.getJSON(service.packageJsonPath)
    if (!pkg) continue

    // 1. engines.node check
    if (!pkg.engines || !pkg.engines.node) {
      findings.push(
        createFinding({
          ruleId: "CONFIG_ENGINES_NODE_MISSING",
          stage: "config",
          severity: "warning",
          confidence: "confirmed",
          file: service.packageJsonPath,
          line: 1,
          snippet: "engines.node is missing",
          platform: "all",
          message: `package.json in "${service.name}" (${service.packageJsonPath}) does not specify an "engines.node" field. Cloud platforms may fall back to legacy Node versions (e.g. Node 14 or 18).`,
          fix: {
            description: `Add "engines": { "node": ">=20.0.0" } to ${service.packageJsonPath}`,
            patch: createUnifiedDiff({
              file: service.packageJsonPath,
              originalText:
                snapshot.getContent(service.packageJsonPath) || "{}",
              newText: JSON.stringify(
                {
                  ...pkg,
                  engines: { ...(pkg.engines || {}), node: ">=20.0.0" },
                },
                null,
                2,
              ),
            }),
          },
        }),
      )
    }

    // 2. scripts.build check for frontend/fullstack services
    const isFrontendService =
      service.role === "frontend" ||
      service.role === "fullstack" ||
      (services.length === 1 &&
        (snapshot.appShape === "frontend-spa" ||
          snapshot.appShape === "fullstack-next"))

    if (isFrontendService && (!pkg.scripts || !pkg.scripts.build)) {
      findings.push(
        createFinding({
          ruleId: "CONFIG_SCRIPTS_BUILD_MISSING",
          stage: "config",
          severity: "blocker",
          confidence: "confirmed",
          file: service.packageJsonPath,
          line: 1,
          snippet: `No scripts.build in ${service.packageJsonPath}`,
          platform: "all",
          message: `Service "${service.name}" (${service.packageJsonPath}) requires a "scripts.build" command for cloud deployment.`,
          fix: null,
        }),
      )
    }

    // 3. scripts.start check for backend services
    const isBackendService =
      service.role === "backend" ||
      service.role === "fullstack" ||
      (services.length === 1 && snapshot.appShape === "backend-api")

    const isMonorepoRootWrapper =
      service.rootDir === "" &&
      services.length > 1 &&
      services.some(
        (s) =>
          s.rootDir !== "" && (s.role === "backend" || s.role === "fullstack"),
      )

    if (
      isBackendService &&
      !isMonorepoRootWrapper &&
      snapshot.target !== "docker" &&
      !service.dockerfilePath &&
      (!pkg.scripts || !pkg.scripts.start)
    ) {
      findings.push(
        createFinding({
          ruleId: "CONFIG_SCRIPTS_START_MISSING",
          stage: "config",
          severity: "blocker",
          confidence: "confirmed",
          file: service.packageJsonPath,
          line: 1,
          snippet: `No scripts.start in ${service.packageJsonPath}`,
          platform: "all",
          message: `Backend service "${service.name}" (${service.packageJsonPath}) requires a "scripts.start" command for production boot.`,
          fix: null,
        }),
      )
    }

    // 4. Misplaced core runtime packages in devDependencies
    const coreRuntimePkgs = [
      "express",
      "fastify",
      "koa",
      "@nestjs/core",
      "mongoose",
      "pg",
      "prisma",
      "@prisma/client",
      "dotenv",
      "cors",
      "react",
      "react-dom",
      "next",
    ]
    const devDeps = pkg.devDependencies || {}
    const prodDeps = pkg.dependencies || {}
    for (const corePkg of coreRuntimePkgs) {
      if (devDeps[corePkg] && !prodDeps[corePkg]) {
        findings.push(
          createFinding({
            ruleId: "CONFIG_DEV_DEPENDENCY_MISPLACED",
            stage: "config",
            severity: "warning",
            confidence: "confirmed",
            file: service.packageJsonPath,
            line: 1,
            snippet: `"${corePkg}": "${devDeps[corePkg]}" in devDependencies`,
            platform: "all",
            message: `Runtime dependency "${corePkg}" is placed in "devDependencies" in ${service.packageJsonPath}. In cloud production builds with NODE_ENV=production, devDependencies may not be installed.`,
            fix: null,
          }),
        )
      }
    }

    // 5. Build tools hidden in devDependencies when host prunes them
    if (snapshot.target === "render" && pkg.devDependencies) {
      const buildToolNames = [
        "typescript",
        "vite",
        "@tailwindcss/vite",
        "tailwindcss",
        "esbuild",
      ]
      const misplaced = buildToolNames.filter(
        (tool) =>
          pkg.devDependencies[tool] &&
          (!pkg.dependencies || !pkg.dependencies[tool]),
      )

      if (misplaced.length > 0 && pkg.scripts && pkg.scripts.build) {
        findings.push(
          createFinding({
            ruleId: "CONFIG_BUILD_TOOLS_IN_DEV_DEPS",
            stage: "config",
            severity: "warning",
            confidence: "likely",
            file: service.packageJsonPath,
            line: 1,
            snippet: misplaced.join(", "),
            platform: "render",
            message: `Build tools (${misplaced.join(", ")}) are in devDependencies. Render/Heroku prune devDependencies when NODE_ENV=production, causing build commands to fail.`,
            fix: {
              description: `Move ${misplaced.join(", ")} to dependencies or set SKIP_INSTALL_ONLY_PROD_DEPS=true`,
              patch: "",
            },
          }),
        )
      }
    }
  }

  // 6. Lockfile parity check
  const hasNpmLock = snapshot.hasFile("package-lock.json")
  const hasPnpmLock = snapshot.hasFile("pnpm-lock.yaml")
  const hasYarnLock = snapshot.hasFile("yarn.lock")

  if (snapshot.packageManager === "pnpm" && !hasPnpmLock) {
    findings.push(
      createFinding({
        ruleId: "CONFIG_LOCKFILE_MISMATCH",
        stage: "config",
        severity: "warning",
        confidence: "confirmed",
        file: "package.json",
        line: 1,
        snippet: "pnpm package manager specified without pnpm-lock.yaml",
        platform: "all",
        message:
          "Project is configured for pnpm, but pnpm-lock.yaml is missing from the tree.",
        fix: null,
      }),
    )
  }

  return findings
}

function getLineNumber(content, index) {
  if (!content || index <= 0) return 1
  return content.slice(0, index).split(/\r?\n/).length
}

function walkAST(node, visitor, parent = null) {
  if (!node || typeof node !== "object") return
  visitor(node, parent)

  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "start" || key === "end" || key === "comments")
      continue
    const child = node[key]
    if (Array.isArray(child)) {
      for (const item of child) {
        walkAST(item, visitor, node)
      }
    } else if (child && typeof child === "object") {
      walkAST(child, visitor, node)
    }
  }
}
