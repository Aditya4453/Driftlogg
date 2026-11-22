/**
 * Deployment Error Pipeline - RepoSnapshot (Immutable Context)
 *
 * Single immutable repository representation shared across all pipeline stages.
 * Exact case-preserved tree, shared AST and JSON caches, never re-fetches.
 */

import { parse } from "@babel/parser"

export class RepoSnapshot {
  /**
   * @param {object} params
   * @param {object} params.source - { type: 'github'|'local'|'files', ... }
   * @param {string} params.ref - 40-character hex commit SHA
   * @param {Array<{ path: string, mode?: string, type?: string, sha?: string, size?: number }>} params.tree
   * @param {Map<string, { content: string|null, status: 'ok'|'skipped'|'failed', reason?: string }>} params.files
   * @param {string} [params.target='render'] - 'render'|'vercel'|'docker'|'railway'|'node'
   * @param {string} [params.appShape='backend-api'] - 'frontend-spa'|'backend-api'|'monorepo'|'containerized'|'fullstack-next'
   * @param {string} [params.packageManager='npm'] - 'npm'|'pnpm'|'yarn'|'bun'
   * @param {string[]} [params.workspaces=[]] - Workspace directory paths
   * @param {Array<{ rootDir: string, name: string, role: string, packageJsonPath?: string, dockerfilePath?: string }>} [params.services=[]] - Multi-service inventory
   * @param {object} [params.completeness] - Completeness and coverage metadata
   */
  constructor({
    source,
    ref,
    tree = [],
    files = new Map(),
    target = "render",
    appShape = "backend-api",
    packageManager = "npm",
    workspaces = [],
    services = [],
    completeness = {},
  }) {
    this.source = Object.freeze({ ...source })
    this.ref = String(ref || "").trim()

    // Exact case-preserved tree list and map
    this.tree = Object.freeze([...tree])
    this._treeMap = new Map()
    this._lowerTreeMap = new Map() // for detecting case mismatches without changing paths

    for (const entry of tree) {
      if (entry && entry.path) {
        this._treeMap.set(entry.path, entry)
        const lower = entry.path.toLowerCase()
        if (!this._lowerTreeMap.has(lower)) {
          this._lowerTreeMap.set(lower, [])
        }
        this._lowerTreeMap.get(lower).push(entry.path)
      }
    }

    // Exact case-preserved files map
    this.files =
      files instanceof Map ? files : new Map(Object.entries(files || {}))

    this.target = target
    this.appShape = appShape
    this.packageManager = packageManager
    this.workspaces = Object.freeze([...workspaces])
    this.services = Object.freeze(services.map((s) => Object.freeze({ ...s })))

    const skippedCount = completeness.skippedCount ?? 0
    const failedCount = completeness.failedCount ?? 0
    const truncated = Boolean(completeness.truncated)
    const warnings = [...(completeness.warnings || [])]

    // Compute coverage: 100 base minus penalties for truncation or failed files
    let coverage = 100
    if (truncated) coverage -= 20
    if (failedCount > 0) coverage -= Math.min(30, failedCount * 5)
    coverage = Math.max(10, Math.min(100, completeness.coverage ?? coverage))

    this.completeness = Object.freeze({
      truncated,
      skippedCount,
      failedCount,
      warnings: Object.freeze(warnings),
      coverage,
    })

    // Shared parse caches (internal instances reused by read-only methods)
    this._astCache = new Map()
    this._jsonCache = new Map()

    // Freeze top-level snapshot properties
    Object.freeze(this)
  }

  /**
   * Checks if an exact path exists in the tree.
   */
  hasFile(path) {
    if (!path) return false
    const clean = path.replace(/^\.\//, "").replace(/^\/+/, "")
    return this._treeMap.has(clean)
  }

  /**
   * Retrieves a discovered service by name or directory path.
   */
  getService(nameOrDir) {
    if (nameOrDir === undefined || nameOrDir === null) return null
    const clean = String(nameOrDir).replace(/^\.\//, "").replace(/\/+$/, "")
    return (
      this.services.find(
        (s) =>
          s.name === clean ||
          s.rootDir === clean ||
          (clean === "" && s.rootDir === ""),
      ) || null
    )
  }

  /**
   * Returns all backend / fullstack services in the repository.
   */
  getBackendServices() {
    return this.services.filter(
      (s) => s.role === "backend" || s.role === "fullstack",
    )
  }

  /**
   * Returns all frontend / fullstack services in the repository.
   */
  getFrontendServices() {
    return this.services.filter(
      (s) => s.role === "frontend" || s.role === "fullstack",
    )
  }

  /**
   * Retrieves tree entry for exact path.
   */
  getTreeEntry(path) {
    if (!path) return null
    const clean = path.replace(/^\.\//, "").replace(/^\/+/, "")
    return this._treeMap.get(clean) || null
  }

  /**
   * Checks if a file exists with different casing (e.g. "button.js" vs "Button.js").
   * Returns the exact path in the tree if a case collision/mismatch is found, or null if matched or missing.
   */
  findCaseMismatch(path) {
    if (!path) return null
    const clean = path.replace(/^\.\//, "").replace(/^\/+/, "")
    if (this._treeMap.has(clean)) {
      return null // Exact match, no mismatch
    }
    const lower = clean.toLowerCase()
    const existing = this._lowerTreeMap.get(lower)
    if (existing && existing.length > 0) {
      return existing[0] // Returns the exact case-preserved path present in tree
    }
    return null
  }

  /**
   * Retrieves file record { content, status, reason } by exact path.
   */
  getFile(path) {
    if (!path) return null
    const clean = path.replace(/^\.\//, "").replace(/^\/+/, "")
    return this.files.get(clean) || null
  }

  /**
   * Retrieves file text content or null.
   */
  getContent(path) {
    const file = this.getFile(path)
    return file && file.status === "ok" ? file.content : null
  }

  /**
   * Finds tree entries matching a predicate or regex.
   */
  findFiles(matcher) {
    if (typeof matcher === "function") {
      return this.tree.filter(matcher)
    }
    if (matcher instanceof RegExp) {
      return this.tree.filter((e) => matcher.test(e.path))
    }
    if (typeof matcher === "string") {
      return this.tree.filter((e) => e.path.includes(matcher))
    }
    return []
  }

  /**
   * Retrieves or parses AST using Babel, sharing AST cache across stages.
   */
  getAST(path) {
    if (!path) return null
    const clean = path.replace(/^\.\//, "").replace(/^\/+/, "")

    if (this._astCache.has(clean)) {
      return this._astCache.get(clean)
    }

    const content = this.getContent(clean)
    if (!content) return null

    try {
      const ast = parse(content, {
        sourceType: "unambiguous",
        plugins: [
          "jsx",
          "typescript",
          "classProperties",
          "asyncGenerators",
          "dynamicImport",
          "objectRestSpread",
          "optionalCatchBinding",
          "optionalChaining",
          "nullishCoalescingOperator",
          "topLevelAwait",
        ],
        errorRecovery: true,
      })
      this._astCache.set(clean, ast)
      return ast
    } catch {
      this._astCache.set(clean, null)
      return null
    }
  }

  /**
   * Retrieves or parses JSON content using shared JSON cache.
   */
  getJSON(path) {
    if (!path) return null
    const clean = path.replace(/^\.\//, "").replace(/^\/+/, "")

    if (this._jsonCache.has(clean)) {
      return this._jsonCache.get(clean)
    }

    const content = this.getContent(clean)
    if (!content) return null

    try {
      const parsed = JSON.parse(content)
      this._jsonCache.set(clean, parsed)
      return parsed
    } catch {
      this._jsonCache.set(clean, null)
      return null
    }
  }
}
