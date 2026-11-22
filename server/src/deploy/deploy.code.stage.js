/**
 * Deployment Error Pipeline - Stage 3: Code Traps
 *
 * AST-driven analysis of case-sensitive imports, port/host binding,
 * hardcoded localhost URLs, CORS credential traps, proxy cookies,
 * and ephemeral disk writes.
 */

import { createFinding, createUnifiedDiff } from "./findings.js"

const RESOLUTION_EXTENSIONS = [
  "",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".json",
]

/**
 * Stage 3 Entrypoint: Code Traps AST analysis.
 */
export async function runCodeStage(snapshot, options = {}) {
  const onTrace = options.onTrace || (() => {})
  const trace = (msg) => onTrace(`[deploy-code] ${msg}`)

  trace("Starting AST code-level analysis across repository files...")
  const findings = []

  // 1. Case-sensitivity import resolution against case-preserved tree
  findings.push(...checkCaseSensitiveImports(snapshot, trace))

  // 2. Port & Host Binding (Render rules)
  findings.push(...checkPortHostBinding(snapshot, trace))

  // 3. Hardcoded localhost URLs in frontend production code
  findings.push(...checkHardcodedLocalhost(snapshot, trace))

  // 4. CORS credentials with wildcard origin
  findings.push(...checkCorsAndCookies(snapshot, trace))

  // 5. Ephemeral filesystem writes in containerized/serverless apps
  findings.push(...checkEphemeralDiskWrites(snapshot, trace))

  trace(`Code stage completed with ${findings.length} findings.`)
  return findings
}

/**
 * Resolves relative imports against case-preserved tree.
 * Detects case mismatches (e.g. import './button' vs 'Button.tsx') that fail on Linux/Docker/Render.
 */
function checkCaseSensitiveImports(snapshot, trace) {
  const findings = []

  for (const entry of snapshot.tree) {
    if (!isSourceFile(entry.path)) continue
    const ast = snapshot.getAST(entry.path)
    if (!ast) continue

    const content = snapshot.getContent(entry.path) || ""
    const dir = entry.path.includes("/")
      ? entry.path.slice(0, entry.path.lastIndexOf("/"))
      : ""

    walkAST(ast, (node) => {
      let importSource = null
      let line = node.loc ? node.loc.start.line : 1

      // import ... from '...' or import('...')
      if (
        (node.type === "ImportDeclaration" ||
          node.type === "ExportNamedDeclaration" ||
          node.type === "ExportAllDeclaration") &&
        node.source &&
        node.source.type === "StringLiteral" &&
        typeof node.source.value === "string"
      ) {
        importSource = node.source.value
      } else if (
        node.type === "CallExpression" &&
        node.callee &&
        (node.callee.type === "Import" ||
          (node.callee.type === "Identifier" &&
            node.callee.name === "require")) &&
        node.arguments.length > 0 &&
        node.arguments[0].type === "StringLiteral" &&
        typeof node.arguments[0].value === "string"
      ) {
        importSource = node.arguments[0].value
      }

      if (
        !importSource ||
        typeof importSource !== "string" ||
        !importSource.startsWith(".")
      )
        return

      // Resolve relative path against tree
      const resolvedTarget = resolveRelativePath(dir, importSource)
      const caseMismatch = findTreeCaseMismatch(snapshot, resolvedTarget)

      if (caseMismatch && typeof caseMismatch === "string") {
        const expectedBase = caseMismatch.split("/").pop()
        const importedBase = importSource.split("/").pop()
        const correctedImport =
          importSource.slice(0, importSource.lastIndexOf(importedBase)) +
          expectedBase.replace(/\.[^.]+$/, "")

        findings.push(
          createFinding({
            ruleId: "CODE_IMPORT_CASE_MISMATCH",
            aliases: ["CODE_CASE_MISMATCH"],
            stage: "code",
            severity: "blocker",
            confidence: "confirmed",
            file: entry.path,
            line,
            snippet: `import from '${importSource}'`,
            platform: "all",
            message: `Case mismatch in import path: "${importSource}" does not match exact case-preserved file "${caseMismatch}". This will cause ModuleNotFoundError on Linux/Render/Docker.`,
            fix: {
              description: `Correct import path casing to match "${caseMismatch}"`,
              patch: createUnifiedDiff({
                file: entry.path,
                originalLine: line,
                originalText: `'${importSource}'`,
                newText: `'${correctedImport}'`,
              }),
            },
          }),
        )
      }
    })
  }

  return findings
}

function resolveRelativePath(baseDir, relativePath) {
  const parts = (baseDir ? `${baseDir}/${relativePath}` : relativePath).split(
    "/",
  )
  const resolved = []
  for (const part of parts) {
    if (part === "." || part === "") continue
    if (part === "..") {
      resolved.pop()
    } else {
      resolved.push(part)
    }
  }
  return resolved.join("/")
}

function findTreeCaseMismatch(snapshot, basePath) {
  // Test candidate extensions
  for (const ext of RESOLUTION_EXTENSIONS) {
    const candidate = `${basePath}${ext}`
    if (snapshot.hasFile(candidate)) {
      return null // Exact match found
    }
    const mismatch = snapshot.findCaseMismatch(candidate)
    if (mismatch) {
      return mismatch
    }
  }

  // Test index file resolution (e.g. ./components -> components/index.ts)
  for (const ext of [".js", ".jsx", ".ts", ".tsx", ".mjs"]) {
    const indexCandidate = `${basePath}/index${ext}`
    if (snapshot.hasFile(indexCandidate)) {
      return null
    }
    const indexMismatch = snapshot.findCaseMismatch(indexCandidate)
    if (indexMismatch) {
      return indexMismatch
    }
  }

  return null
}

/**
 * Validates app.listen / server.listen calls.
 * - Blocker if listen uses hardcoded port (e.g. 3000) without process.env.PORT.
 * - Blocker if listen specifies explicit 127.0.0.1 or localhost host.
 * - PASS if listen(process.env.PORT) has NO host, because Node binds all interfaces (0.0.0.0) by default.
 */
function checkPortHostBinding(snapshot, trace) {
  const findings = []

  for (const entry of snapshot.tree) {
    if (!isSourceFile(entry.path)) continue
    const ast = snapshot.getAST(entry.path)
    if (!ast) continue

    const content = snapshot.getContent(entry.path) || ""

    walkAST(ast, (node) => {
      if (
        node.type === "CallExpression" &&
        node.callee &&
        node.callee.type === "MemberExpression" &&
        node.callee.property &&
        node.callee.property.name === "listen"
      ) {
        const line = node.loc ? node.loc.start.line : 1
        const callSnippet = content.slice(
          node.start,
          Math.min(content.length, node.end),
        )
        const args = node.arguments || []

        if (args.length === 0) return

        const portArg = args[0]
        const hostArg =
          args.length > 1 && args[1].type === "StringLiteral" ? args[1] : null

        // 1. Check for hardcoded localhost / 127.0.0.1 host binding
        if (
          hostArg &&
          typeof hostArg.value === "string" &&
          (hostArg.value === "127.0.0.1" || hostArg.value === "localhost")
        ) {
          findings.push(
            createFinding({
              ruleId: "CODE_LOCALHOST_BIND",
              aliases: ["RENDER_LISTEN_HOST_LOCALHOST"],
              stage: "code",
              severity: "blocker",
              confidence: "confirmed",
              file: entry.path,
              line,
              snippet: callSnippet,
              platform: "render",
              message: `Server binds to localhost/127.0.0.1 ("${hostArg.value}"). Cloud platforms require binding to 0.0.0.0 (or omitting the host parameter) so the reverse proxy can route incoming requests.`,
              fix: {
                description: 'Remove host argument or change to "0.0.0.0"',
                patch: createUnifiedDiff({
                  file: entry.path,
                  originalLine: line,
                  originalText: callSnippet,
                  newText: callSnippet.replace(
                    new RegExp(`,\\s*['"]${hostArg.value}['"]`),
                    "",
                  ),
                }),
              },
            }),
          )
        }

        // 2. Check for hardcoded port (numeric literal or non-env expression without process.env.PORT)
        const isHardcodedPort = isLiteralNumberOrHardcoded(portArg)
        const usesProcessEnvPort = referencesEnvPort(portArg, content)

        if (isHardcodedPort && !usesProcessEnvPort) {
          const portVal = portArg?.value ?? "hardcoded"
          findings.push(
            createFinding({
              ruleId: "CODE_HARDCODED_PORT",
              aliases: ["RENDER_LISTEN_HARDCODED_PORT"],
              stage: "code",
              severity: "blocker",
              confidence: "confirmed",
              file: entry.path,
              line,
              snippet: callSnippet,
              platform: "render",
              message: `Server listens on hardcoded port ${portVal} without honoring process.env.PORT. Cloud platforms inject dynamic PORT (e.g. 10000) and will fail health checks if the app does not bind to it.`,
              fix: {
                description: "Use process.env.PORT || 3000 in listen()",
                patch: createUnifiedDiff({
                  file: entry.path,
                  originalLine: line,
                  originalText: callSnippet,
                  newText: callSnippet.replace(
                    String(portVal),
                    "process.env.PORT || 3000",
                  ),
                }),
              },
            }),
          )
        }
      }
    })
  }

  return findings
}

function isLiteralNumberOrHardcoded(node) {
  if (!node) return false
  if (node.type === "NumericLiteral") return true
  if (
    node.type === "StringLiteral" &&
    typeof node.value === "string" &&
    /^\d+$/.test(node.value)
  )
    return true
  return false
}

function referencesEnvPort(node, content) {
  if (!node || typeof content !== "string") return false
  const expr = content.slice(node.start, node.end)
  return (
    typeof expr === "string" &&
    (expr.includes("process.env.PORT") || expr.includes("process.env['PORT']"))
  )
}

/**
 * Checks for hardcoded http://localhost URLs in frontend production code.
 */
function checkHardcodedLocalhost(snapshot, trace) {
  const findings = []

  for (const entry of snapshot.tree) {
    if (!isFrontendSourceFile(entry.path, snapshot)) continue
    const ast = snapshot.getAST(entry.path)
    if (!ast) continue

    const content = snapshot.getContent(entry.path) || ""

    walkAST(ast, (node, parent) => {
      let val = null
      if (node.type === "StringLiteral" && typeof node.value === "string") {
        val = node.value
      } else if (node.type === "TemplateElement" && node.value) {
        if (typeof node.value.raw === "string") {
          val = node.value.raw
        } else if (typeof node.value.cooked === "string") {
          val = node.value.cooked
        }
      }

      if (typeof val === "string" && val.length > 0) {
        const match = val.match(/https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i)

        if (match) {
          // Verify it's not guarded by development check or in a test file
          if (!isGuardedByEnvDev(parent, content)) {
            const line = node.loc ? node.loc.start.line : 1
            findings.push(
              createFinding({
                ruleId: "CODE_LOCALHOST_API_URL",
                aliases: ["CODE_FRONTEND_HARDCODED_LOCALHOST"],
                stage: "code",
                severity: "warning",
                confidence: "likely",
                file: entry.path,
                line,
                snippet: match[0],
                platform: "all",
                message: `Hardcoded localhost URL "${match[0]}" found in client-side code. This will fail in production when executed in users' browsers.`,
                fix: {
                  description:
                    "Replace hardcoded localhost with an environment variable or relative path",
                  patch: "",
                },
              }),
            )
          }
        }
      }
    })
  }

  return findings
}

function isGuardedByEnvDev(node, content) {
  if (!node || typeof content !== "string") return false
  const start = typeof node.start === "number" ? node.start : 0
  const end = typeof node.end === "number" ? node.end : start
  // Basic heuristic: check nearby code for NODE_ENV === 'development' or DEV
  const snippet = content.slice(
    Math.max(0, start - 80),
    Math.min(content.length, end + 80),
  )
  return (
    snippet.includes("development") || snippet.includes("import.meta.env.DEV")
  )
}

/**
 * Validates CORS credentials with wildcard origin, hardcoded localhost origins,
 * and secure cookies behind reverse proxies.
 */
function checkCorsAndCookies(snapshot, trace) {
  const findings = []
  let setsTrustProxy = false
  const cookieFindings = []

  for (const entry of snapshot.tree) {
    if (!isSourceFile(entry.path)) continue
    const ast = snapshot.getAST(entry.path)
    if (!ast) continue

    const content = snapshot.getContent(entry.path) || ""

    // Check if app.set('trust proxy', ...) is called anywhere
    if (/app\.set\s*\(\s*['"]trust proxy['"]/m.test(content)) {
      setsTrustProxy = true
    }

    walkAST(ast, (node) => {
      // 1. CORS checks: cors({ origin, credentials })
      if (
        node.type === "CallExpression" &&
        node.callee &&
        (node.callee.name === "cors" ||
          (node.callee.type === "MemberExpression" &&
            node.callee.property &&
            node.callee.property.name === "cors")) &&
        node.arguments.length > 0 &&
        node.arguments[0].type === "ObjectExpression" &&
        Array.isArray(node.arguments[0].properties)
      ) {
        let hasWildcardOrigin = false
        let hasCredentialsTrue = false
        let hasLocalhostOrigin = false
        let localhostSnippet = ""

        for (const prop of node.arguments[0].properties) {
          if (prop && prop.type === "ObjectProperty" && prop.key) {
            const key =
              typeof prop.key.name === "string"
                ? prop.key.name
                : typeof prop.key.value === "string"
                  ? prop.key.value
                  : null
            if (key === "origin" && prop.value) {
              if (
                prop.value.type === "StringLiteral" &&
                typeof prop.value.value === "string" &&
                prop.value.value === "*"
              ) {
                hasWildcardOrigin = true
              } else if (
                prop.value.type === "StringLiteral" &&
                typeof prop.value.value === "string" &&
                (prop.value.value.includes("localhost") ||
                  prop.value.value.includes("127.0.0.1"))
              ) {
                hasLocalhostOrigin = true
                localhostSnippet = prop.value.value
              } else if (
                prop.value.type === "ArrayExpression" &&
                Array.isArray(prop.value.elements)
              ) {
                for (const el of prop.value.elements) {
                  if (
                    el &&
                    el.type === "StringLiteral" &&
                    typeof el.value === "string" &&
                    (el.value.includes("localhost") ||
                      el.value.includes("127.0.0.1"))
                  ) {
                    hasLocalhostOrigin = true
                    localhostSnippet = el.value
                    break
                  }
                }
              }
            }
            if (
              key === "credentials" &&
              prop.value &&
              prop.value.type === "BooleanLiteral" &&
              prop.value.value === true
            ) {
              hasCredentialsTrue = true
            }
          }
        }

        const line = node.loc ? node.loc.start.line : 1
        const corsSnippet = content.slice(node.start, node.end)

        if (hasWildcardOrigin && hasCredentialsTrue) {
          findings.push(
            createFinding({
              ruleId: "CODE_CORS_MISCONFIG",
              aliases: ["CODE_CORS_WILDCARD_WITH_CREDENTIALS"],
              stage: "code",
              severity: "blocker",
              confidence: "confirmed",
              file: entry.path,
              line,
              snippet: 'cors({ origin: "*", credentials: true })',
              platform: "all",
              message:
                'CORS configured with origin: "*" and credentials: true. Browsers strictly reject credentialed requests when origin is wildcard.',
              fix: {
                description:
                  "Set explicit allowed origin or use origin reflection function",
                patch: "",
              },
            }),
          )
        } else if (hasLocalhostOrigin) {
          findings.push(
            createFinding({
              ruleId: "CODE_CORS_MISCONFIG",
              aliases: ["CODE_CORS_LOCALHOST_ORIGIN"],
              stage: "code",
              severity: "warning",
              confidence: "likely",
              file: entry.path,
              line,
              snippet: corsSnippet,
              platform: "all",
              message: `CORS configured with hardcoded origin "${localhostSnippet}" without environment variable fallback for production.`,
              fix: {
                description:
                  "Use process.env.CLIENT_URL or dynamic allowed origins whitelist",
                patch: "",
              },
            }),
          )
        }
      }

      // 2. Cookie secure: true without trust proxy
      if (
        node.type === "ObjectProperty" &&
        node.key &&
        (node.key.name === "secure" || node.key.value === "secure") &&
        node.value &&
        node.value.type === "BooleanLiteral" &&
        node.value.value === true
      ) {
        const line = node.loc ? node.loc.start.line : 1
        cookieFindings.push({
          file: entry.path,
          line,
          snippet: content.slice(
            Math.max(0, node.start - 20),
            Math.min(content.length, node.end + 20),
          ),
        })
      }
    })
  }

  // If secure cookies are configured but app.set('trust proxy', 1) is missing on cloud proxy platform
  if (
    !setsTrustProxy &&
    cookieFindings.length > 0 &&
    (snapshot.target === "render" || snapshot.target === "vercel")
  ) {
    const first = cookieFindings[0]
    findings.push(
      createFinding({
        ruleId: "CODE_COOKIE_TRUST_PROXY",
        aliases: ["CODE_COOKIE_SECURE_WITHOUT_TRUST_PROXY"],
        stage: "code",
        severity: "warning",
        confidence: "likely",
        file: first.file,
        line: first.line,
        snippet: first.snippet,
        platform: "all",
        message:
          'Cookies configured with secure: true without app.set("trust proxy", 1). Behind Render/Vercel reverse proxies, Express will not see HTTPS and cookies will not be set.',
        fix: {
          description:
            'Add app.set("trust proxy", 1) before session or cookie middleware',
          patch: "",
        },
      }),
    )
  }

  return findings
}

/**
 * Flags ephemeral filesystem writes in containerized or serverless apps.
 */
function checkEphemeralDiskWrites(snapshot, trace) {
  const findings = []
  const isEphemeral =
    snapshot.target === "vercel" || snapshot.appShape === "containerized"

  if (!isEphemeral) return findings

  for (const entry of snapshot.tree) {
    if (
      !entry ||
      typeof entry.path !== "string" ||
      !isSourceFile(entry.path) ||
      entry.path.includes(".test.") ||
      entry.path.includes(".spec.")
    )
      continue
    const content = snapshot.getContent(entry.path) || ""
    if (typeof content !== "string") continue

    const writeMatch = content.match(
      /fs\.(writeFileSync|writeFile)\s*\(\s*['"]\.\/([^'"]+)['"]/,
    )
    if (
      writeMatch &&
      typeof writeMatch[2] === "string" &&
      !writeMatch[2].startsWith("tmp/")
    ) {
      findings.push(
        createFinding({
          ruleId: "CODE_EPHEMERAL_DISK_WRITE",
          stage: "code",
          severity: "warning",
          confidence: "likely",
          file: entry.path,
          line: getLineNumber(content, writeMatch.index),
          snippet: writeMatch[0],
          platform: "all",
          message: `Local file write to "${writeMatch[2]}" on an ephemeral filesystem. Data written to container disk will be lost on container restart or dyno cycling.`,
          fix: {
            description:
              "Use persistent object storage (S3/R2) or a mounted persistent disk volume",
            patch: "",
          },
        }),
      )
    }
  }

  return findings
}

function isSourceFile(path) {
  if (typeof path !== "string") return false
  return (
    (path.endsWith(".js") ||
      path.endsWith(".ts") ||
      path.endsWith(".jsx") ||
      path.endsWith(".tsx") ||
      path.endsWith(".mjs")) &&
    !path.includes("node_modules/") &&
    !path.includes(".next/")
  )
}

function isFrontendSourceFile(path, snapshot = null) {
  if (typeof path !== "string" || !isSourceFile(path)) return false
  if (
    path.includes(".test.") ||
    path.includes(".spec.") ||
    path.includes("vite.config")
  ) {
    return false
  }

  if (
    path.startsWith("src/") ||
    path.startsWith("app/") ||
    path.startsWith("client/") ||
    path.startsWith("frontend/") ||
    path.includes("/src/") ||
    path.includes("/client/") ||
    path.includes("/ui/")
  ) {
    return true
  }

  if (snapshot && typeof snapshot.getFrontendServices === "function") {
    const frontendServices = snapshot.getFrontendServices()
    if (
      Array.isArray(frontendServices) &&
      frontendServices.some(
        (s) =>
          s &&
          typeof s.rootDir === "string" &&
          s.rootDir &&
          path.startsWith(`${s.rootDir}/`),
      )
    ) {
      return true
    }
  }

  return false
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
