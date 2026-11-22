import { afterEach, beforeEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { ingestManifest } from "../src/services/analyzer/ingest.stage.js"
import { validateGitHubRepoUrl } from "../src/middleware/security.js"
import {
  _resetCisaCacheForTesting,
  analyzeSecurity,
} from "../src/services/analyzer/security.stage.js"

describe("Phase 2: Analyzer Ingest & Security Stages", () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    _resetCisaCacheForTesting()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe("Stage 1: ingestManifest", () => {
    it("handles upload with lockfile v2/v3, resolving exact direct & transitive versions", async () => {
      const packageJson = {
        name: "test-app",
        engines: { node: ">=18.0.0" },
        dependencies: {
          lodash: "^4.17.0",
        },
        devDependencies: {
          typescript: "^5.0.0",
        },
      }

      const packageLockJson = {
        name: "test-app",
        lockfileVersion: 3,
        packages: {
          "": { name: "test-app" },
          "node_modules/lodash": { version: "4.17.21" },
          "node_modules/typescript": { version: "5.7.2" },
          "node_modules/ms": { version: "2.1.3" }, // transitive
          "node_modules/@types/node": { version: "20.11.0" }, // transitive scoped
        },
      }

      const result = await ingestManifest({
        sourceType: "upload",
        packageJson,
        packageLockJson,
      })

      assert.equal(result.projectName, "test-app")
      assert.equal(result.hasLockfile, true)
      assert.equal(result.enginesNode, ">=18.0.0")

      // Direct dependencies
      const lodash = result.dependencies.find((d) => d.name === "lodash")
      assert.ok(lodash)
      assert.equal(lodash.declaredVersion, "^4.17.0")
      assert.equal(lodash.resolvedVersion, "4.17.21")
      assert.equal(lodash.section, "dependencies")
      assert.equal(lodash.isDirect, true)
      assert.equal(lodash.isUnpinned, false)

      const ts = result.dependencies.find((d) => d.name === "typescript")
      assert.ok(ts)
      assert.equal(ts.declaredVersion, "^5.0.0")
      assert.equal(ts.resolvedVersion, "5.7.2")
      assert.equal(ts.section, "devDependencies")
      assert.equal(ts.isDirect, true)
      assert.equal(ts.isUnpinned, false)

      // Transitive dependencies
      const ms = result.dependencies.find((d) => d.name === "ms")
      assert.ok(ms)
      assert.equal(ms.resolvedVersion, "2.1.3")
      assert.equal(ms.isDirect, false)

      const typesNode = result.dependencies.find(
        (d) => d.name === "@types/node",
      )
      assert.ok(typesNode)
      assert.equal(typesNode.resolvedVersion, "20.11.0")
      assert.equal(typesNode.isDirect, false)
    })

    it("handles upload without lockfile: cleans with semver.coerce and detects unpinned wildcards", async () => {
      const packageJson = JSON.stringify({
        name: "unpinned-app",
        dependencies: {
          express: "~4.18.2",
          axios: "latest",
          rimraf: "*",
          dotenv: "16.4.5",
        },
      })

      const result = await ingestManifest({
        sourceType: "upload",
        packageJson,
      })

      assert.equal(result.projectName, "unpinned-app")
      assert.equal(result.hasLockfile, false)

      const express = result.dependencies.find((d) => d.name === "express")
      assert.ok(express)
      assert.equal(express.declaredVersion, "~4.18.2")
      assert.equal(express.resolvedVersion, "4.18.2")
      assert.equal(express.isUnpinned, false)

      const axios = result.dependencies.find((d) => d.name === "axios")
      assert.ok(axios)
      assert.equal(axios.declaredVersion, "latest")
      assert.equal(axios.isUnpinned, true)

      const rimraf = result.dependencies.find((d) => d.name === "rimraf")
      assert.ok(rimraf)
      assert.equal(rimraf.declaredVersion, "*")
      assert.equal(rimraf.isUnpinned, true)

      const dotenv = result.dependencies.find((d) => d.name === "dotenv")
      assert.ok(dotenv)
      assert.equal(dotenv.declaredVersion, "16.4.5")
      assert.equal(dotenv.resolvedVersion, "16.4.5")
      assert.equal(dotenv.isUnpinned, false)
    })

    it("rejects invalid GitHub repository URLs", async () => {
      await assert.rejects(
        () =>
          ingestManifest({
            sourceType: "github",
            repositoryUrl: "http://github.com/owner/repo", // http rejected
          }),
        /Invalid GitHub repository URL/,
      )

      await assert.rejects(
        () =>
          ingestManifest({
            sourceType: "github",
            repositoryUrl: "https://gitlab.com/owner/repo", // non-github rejected
          }),
        /Invalid GitHub repository URL/,
      )
    })

    it("validates and parses universal GitHub URLs across root, subfolders and direct blob links", () => {
      // 1. Root repository links
      const rootRes = validateGitHubRepoUrl("https://github.com/owner/repo")
      assert.deepEqual(rootRes, {
        owner: "owner",
        repo: "repo",
        branch: null,
        subpath: "",
      })
      assert.ok(validateGitHubRepoUrl("https://github.com/owner/repo.git"))
      assert.ok(validateGitHubRepoUrl("https://github.com/owner/repo/"))

      // 2. Subdirectory link (/tree/<branch>/<subpath>)
      const treeRes = validateGitHubRepoUrl(
        "https://github.com/owner/repo/tree/main/my-app",
      )
      assert.deepEqual(treeRes, {
        owner: "owner",
        repo: "repo",
        branch: "main",
        subpath: "my-app",
      })

      // 3. Direct manifest link (/blob/<branch>/<subpath>/package.json)
      const blobRes = validateGitHubRepoUrl(
        "https://github.com/owner/repo/blob/main/backend/package.json",
      )
      assert.deepEqual(blobRes, {
        owner: "owner",
        repo: "repo",
        branch: "main",
        subpath: "backend",
      })

      // Root direct blob link
      const rootBlobRes = validateGitHubRepoUrl(
        "https://github.com/owner/repo/blob/main/package.json",
      )
      assert.deepEqual(rootBlobRes, {
        owner: "owner",
        repo: "repo",
        branch: "main",
        subpath: "",
      })

      // 4. SSRF and traversal rejection
      assert.equal(validateGitHubRepoUrl("http://github.com/owner/repo"), false) // non-https
      assert.equal(
        validateGitHubRepoUrl("https://gitlab.com/owner/repo"),
        false,
      ) // non-github
      assert.equal(
        validateGitHubRepoUrl("https://github.com.evil.com/owner/repo"),
        false,
      ) // domain spoof
      assert.equal(
        validateGitHubRepoUrl(
          "https://github.com/owner/repo/tree/main/../evil",
        ),
        false,
      ) // path traversal
      assert.equal(
        validateGitHubRepoUrl(
          "https://github.com/owner/repo/blob/main/../../etc/passwd",
        ),
        false,
      ) // path traversal
      assert.equal(
        validateGitHubRepoUrl("https://github.com/owner/repo?ref=main"),
        false,
      ) // query string
      assert.equal(
        validateGitHubRepoUrl("https://github.com/owner/repo#readme"),
        false,
      ) // hash fragment
      assert.equal(
        validateGitHubRepoUrl("https://github.com/owner/repo/issues"),
        false,
      ) // non-tree/blob
      assert.equal(
        validateGitHubRepoUrl("https://github.com/owner/repo/pull/1"),
        false,
      )
    })

    it("ingests manifest from GitHub subfolder link (/tree/v2/my-app)", async () => {
      globalThis.fetch = async (url) => {
        const u = String(url)
        if (u.includes("/contents/my-app/package.json?ref=v2")) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                name: "subfolder-app",
                dependencies: { axios: "^1.6.0" },
              }),
          }
        }
        if (u.includes("/contents/my-app/package-lock.json?ref=v2")) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                name: "subfolder-app",
                lockfileVersion: 3,
                packages: {
                  "": { name: "subfolder-app" },
                  "node_modules/axios": { version: "1.6.2" },
                },
              }),
          }
        }
        return { ok: false, status: 404, statusText: "Not Found" }
      }

      const result = await ingestManifest({
        sourceType: "github",
        repositoryUrl: "https://github.com/owner/repo/tree/v2/my-app",
      })

      assert.equal(result.projectName, "subfolder-app")
      assert.equal(result.hasLockfile, true)
      const axiosDep = result.dependencies.find((d) => d.name === "axios")
      assert.ok(axiosDep)
      assert.equal(axiosDep.resolvedVersion, "1.6.2")
    })

    it("ingests manifest from direct file link (/blob/main/backend/package.json)", async () => {
      globalThis.fetch = async (url) => {
        const u = String(url)
        if (u.includes("/contents/backend/package.json?ref=main")) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                name: "backend-service",
                dependencies: { express: "^5.0.0" },
              }),
          }
        }
        return { ok: false, status: 404, statusText: "Not Found" }
      }

      const result = await ingestManifest({
        sourceType: "github",
        repositoryUrl:
          "https://github.com/owner/repo/blob/main/backend/package.json",
      })

      assert.equal(result.projectName, "backend-service")
      const expressDep = result.dependencies.find((d) => d.name === "express")
      assert.ok(expressDep)
      assert.equal(expressDep.declaredVersion, "^5.0.0")
    })

    it("auto-discovers and merges monorepo manifests when root package.json returns 404", async () => {
      globalThis.fetch = async (url) => {
        const u = String(url)

        // Root package.json is missing -> 404
        if (u.includes("/contents/package.json")) {
          return { ok: false, status: 404, statusText: "Not Found" }
        }

        // Git Trees API returning multiple manifests (ignoring node_modules)
        if (u.includes("/git/trees/HEAD?recursive=1")) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                tree: [
                  { path: "frontend/package.json", type: "blob" },
                  { path: "backend/package.json", type: "blob" },
                  { path: "node_modules/fake/package.json", type: "blob" },
                  { path: "README.md", type: "blob" },
                ],
              }),
          }
        }

        // Frontend workspace
        if (u.includes("/contents/frontend/package.json")) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                name: "frontend",
                dependencies: { react: "^19.0.0" },
                devDependencies: { typescript: "^5.7.0" },
              }),
          }
        }
        if (u.includes("/contents/frontend/package-lock.json")) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                lockfileVersion: 3,
                packages: {
                  "": {},
                  "node_modules/react": { version: "19.0.0" },
                  "node_modules/typescript": { version: "5.7.3" },
                },
              }),
          }
        }

        // Backend workspace
        if (u.includes("/contents/backend/package.json")) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                name: "backend",
                dependencies: { express: "^5.0.0" },
                devDependencies: { typescript: "^5.7.0" },
              }),
          }
        }

        return { ok: false, status: 404, statusText: "Not Found" }
      }

      const result = await ingestManifest({
        sourceType: "github",
        repositoryUrl: "https://github.com/acme/fullstack-monorepo",
      })

      assert.ok(result.projectName.includes("fullstack-monorepo"))
      assert.ok(result.projectName.includes("frontend"))
      assert.ok(result.projectName.includes("backend"))
      assert.equal(result.hasLockfile, true)

      // Verified unified dependencies
      const reactDep = result.dependencies.find((d) => d.name === "react")
      assert.ok(reactDep)
      assert.equal(reactDep.resolvedVersion, "19.0.0")
      assert.equal(reactDep.workspace, "frontend")

      const expressDep = result.dependencies.find((d) => d.name === "express")
      assert.ok(expressDep)
      assert.equal(expressDep.resolvedVersion, "5.0.0")
      assert.equal(expressDep.workspace, "backend")

      const tsDep = result.dependencies.find((d) => d.name === "typescript")
      assert.ok(tsDep)
      assert.ok(tsDep.workspace.includes("frontend"))
      assert.ok(tsDep.workspace.includes("backend"))
    })

    it("throws clear 400 error when zero package.json files exist anywhere in repository", async () => {
      globalThis.fetch = async (url) => {
        const u = String(url)
        if (u.includes("/contents/package.json")) {
          return { ok: false, status: 404, statusText: "Not Found" }
        }
        if (u.includes("/git/trees/HEAD?recursive=1")) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                tree: [
                  { path: "README.md", type: "blob" },
                  { path: "docs/architecture.md", type: "blob" },
                ],
              }),
          }
        }
        return { ok: false, status: 404, statusText: "Not Found" }
      }

      await assert.rejects(
        () =>
          ingestManifest({
            sourceType: "github",
            repositoryUrl: "https://github.com/acme/empty-docs-repo",
          }),
        /No package\.json found in this repository/,
      )
    })

    it("fetches package.json and package-lock.json from GitHub API", async () => {
      globalThis.fetch = async (url) => {
        if (url.includes("/package.json")) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                name: "gh-project",
                dependencies: { chalk: "^5.0.0" },
              }),
          }
        }
        if (url.includes("/package-lock.json")) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                name: "gh-project",
                lockfileVersion: 3,
                packages: {
                  "": { name: "gh-project" },
                  "node_modules/chalk": { version: "5.3.0" },
                },
              }),
          }
        }
        return { ok: false, status: 404, statusText: "Not Found" }
      }

      const result = await ingestManifest({
        sourceType: "github",
        repositoryUrl: "https://github.com/facebook/react",
      })

      assert.equal(result.projectName, "gh-project")
      assert.equal(result.hasLockfile, true)
      const chalk = result.dependencies.find((d) => d.name === "chalk")
      assert.ok(chalk)
      assert.equal(chalk.resolvedVersion, "5.3.0")
    })
  })

  describe("Stage 2: analyzeSecurity", () => {
    it("performs batch OSV query, detects MAL-* malware, matches CISA KEV and FIRST EPSS", async () => {
      const dependencies = [
        { name: "lodash", resolvedVersion: "4.17.15" },
        { name: "fake-malware", resolvedVersion: "1.0.0" },
        { name: "clean-pkg", resolvedVersion: "2.0.0" },
      ]

      globalThis.fetch = async (url, options) => {
        const urlStr = String(url)

        // 1. Batch OSV
        if (urlStr.includes("api.osv.dev/v1/querybatch")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              results: [
                { vulns: [{ id: "GHSA-jf85-cpcp-j695" }] }, // lodash vuln
                { vulns: [{ id: "MAL-2024-0001" }] }, // malware
                { vulns: [] }, // clean
              ],
            }),
          }
        }

        // 2. OSV Details
        if (urlStr.includes("api.osv.dev/v1/vulns/GHSA-jf85-cpcp-j695")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "GHSA-jf85-cpcp-j695",
              summary: "Prototype Pollution in lodash",
              aliases: ["CVE-2020-8203"],
              severity: [
                {
                  type: "CVSS_V3",
                  score: "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:H/A:H",
                },
              ],
              affected: [
                {
                  ranges: [{ events: [{ fixed: "4.17.19" }] }],
                },
              ],
            }),
          }
        }

        if (urlStr.includes("api.osv.dev/v1/vulns/MAL-2024-0001")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "MAL-2024-0001",
              summary: "Malicious dependency package",
              aliases: [],
            }),
          }
        }

        // 3. CISA KEV
        if (urlStr.includes("known_exploited_vulnerabilities.json")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              vulnerabilities: [{ cveID: "CVE-2020-8203" }],
            }),
          }
        }

        // 4. FIRST EPSS
        if (urlStr.includes("api.first.org/data/v1/epss")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              status: "OK",
              data: [
                { cve: "CVE-2020-8203", epss: "0.8924", percentile: "0.98" },
              ],
            }),
          }
        }

        return { ok: false, status: 404 }
      }

      const { vulnMap, sourcesUnavailable } =
        await analyzeSecurity(dependencies)

      assert.deepEqual(sourcesUnavailable, [])
      assert.equal(vulnMap.has("lodash"), true)
      assert.equal(vulnMap.has("fake-malware"), true)
      assert.equal(vulnMap.has("clean-pkg"), false)

      const lodashSec = vulnMap.get("lodash")
      assert.equal(lodashSec.isMalware, false)
      assert.equal(lodashSec.vulns.length, 1)

      const v = lodashSec.vulns[0]
      assert.equal(v.id, "GHSA-jf85-cpcp-j695")
      assert.equal(v.cve, "CVE-2020-8203")
      assert.equal(v.fixedIn, "4.17.19")
      assert.equal(v.kev, true) // Listed in CISA KEV
      assert.equal(v.epss, 0.8924) // FIRST EPSS score attached
      assert.equal(v.isMalware, false)

      const malSec = vulnMap.get("fake-malware")
      assert.equal(malSec.isMalware, true)
      assert.equal(malSec.vulns[0].isMalware, true)
    })

    it("gracefully tracks sourcesUnavailable when upstream APIs fail without throwing", async () => {
      const dependencies = [{ name: "lodash", resolvedVersion: "4.17.15" }]

      // Mock fetch throwing network error for OSV
      globalThis.fetch = async (url) => {
        const urlStr = String(url)
        if (urlStr.includes("api.osv.dev")) {
          throw new Error("Network offline")
        }
        if (urlStr.includes("cisa.gov")) {
          return { ok: false, status: 503 }
        }
        if (urlStr.includes("api.first.org")) {
          throw new Error("EPSS timeout")
        }
        return { ok: false, status: 500 }
      }

      const { vulnMap, sourcesUnavailable } =
        await analyzeSecurity(dependencies)

      // Must not throw, and gracefully log sourcesUnavailable
      assert.ok(sourcesUnavailable.includes("osv"))
      assert.ok(sourcesUnavailable.includes("cisa-kev"))
      assert.equal(vulnMap.size, 0)
    })
  })
})
