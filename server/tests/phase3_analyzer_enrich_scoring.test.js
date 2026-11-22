import { after, afterEach, before, beforeEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { PackageCache } from "../src/models/PackageCache.js"
import { enrichDependencies } from "../src/services/analyzer/enrich.stage.js"
import {
  RULE_VERSION,
  scoreDependencies,
} from "../src/services/analyzer/scoring.stage.js"
import { runDependencyAnalysis } from "../src/services/analyzer/index.js"
import {
  clearCollections,
  connectTestDb,
  disconnectTestDb,
} from "./helpers/testDb.js"

describe("Phase 3: Analyzer Enrichment, PackageCache & Scoring Engine", () => {
  const originalFetch = globalThis.fetch

  before(connectTestDb)
  afterEach(clearCollections)
  after(disconnectTestDb)

  beforeEach(() => {
    globalThis.fetch = originalFetch
  })

  describe("PackageCache Model", () => {
    it("stores and retrieves cached enrichment records with TTL", async () => {
      const cacheKey = "npm:lodash@4.17.21"
      const data = {
        name: "lodash",
        latestVersion: "4.17.21",
        deprecated: null,
        libyears: 0,
      }

      await PackageCache.create({
        cacheKey,
        data,
        expiresAt: new Date(Date.now() + 60000),
      })

      const found = await PackageCache.findOne({ cacheKey })
      assert.ok(found)
      assert.equal(found.data.name, "lodash")
      assert.equal(found.data.latestVersion, "4.17.21")

      // Duplicate cacheKey rejection
      await assert.rejects(
        () =>
          PackageCache.create({
            cacheKey,
            data,
            expiresAt: new Date(Date.now() + 60000),
          }),
        /duplicate key/i,
      )
    })
  })

  describe("Stage 3: enrichDependencies", () => {
    it("fetches npm registry, deps.dev, and local e18e replacement on cache miss, then writes to cache", async () => {
      const dependencies = [
        {
          name: "moment",
          resolvedVersion: "2.29.4",
          section: "dependencies",
          isDirect: true,
        },
      ]

      globalThis.fetch = async (url) => {
        const urlStr = String(url)

        if (urlStr.includes("registry.npmjs.org/moment")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              "dist-tags": { latest: "2.30.1" },
              time: {
                "2.29.4": "2022-07-06T12:00:00.000Z",
                "2.30.1": "2024-01-01T12:00:00.000Z",
              },
              versions: {
                "2.29.4": {
                  hasInstallScript: false,
                  scripts: {},
                },
              },
            }),
          }
        }

        if (urlStr.includes("api.deps.dev/v3/systems/npm/packages/moment")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              scorecard: { overallScore: 4.5 },
              openIssuesCount: 42,
              archived: false,
            }),
          }
        }

        return { ok: false, status: 404 }
      }

      const { enrichMap, sourcesUnavailable } =
        await enrichDependencies(dependencies)

      assert.deepEqual(sourcesUnavailable, [])
      assert.equal(enrichMap.has("moment"), true)

      const momentData = enrichMap.get("moment")
      assert.equal(momentData.latestVersion, "2.30.1")
      assert.ok(momentData.libyears >= 1.0)
      assert.equal(momentData.scorecard, 4.5)
      assert.equal(momentData.openIssues, 42)

      // Verified e18e replacement attached for moment
      assert.ok(momentData.replacement)
      assert.match(momentData.replacement.name, /day\.js|date-fns/)
      assert.equal(momentData.replacement.source, "e18e")

      // Verified saved to PackageCache
      const cached = await PackageCache.findOne({
        cacheKey: "npm:moment@2.29.4",
      })
      assert.ok(cached)
      assert.equal(cached.data.name, "moment")

      // Cache hit test: verify subsequent enrich call reuses cached data without fetch
      let fetchCalled = false
      globalThis.fetch = async () => {
        fetchCalled = true
        throw new Error("Should not fetch on cache hit")
      }

      const cachedResult = await enrichDependencies(dependencies)
      assert.equal(fetchCalled, false)
      assert.equal(cachedResult.enrichMap.get("moment").latestVersion, "2.30.1")
    })

    it("detects e18e replacement for legacy request package", async () => {
      const dependencies = [
        {
          name: "request",
          resolvedVersion: "2.88.2",
          section: "dependencies",
          isDirect: true,
        },
      ]

      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          "dist-tags": { latest: "2.88.2" },
          versions: { "2.88.2": { deprecated: "request has been deprecated" } },
        }),
      })

      const { enrichMap } = await enrichDependencies(dependencies)
      const reqData = enrichMap.get("request")
      assert.ok(reqData)
      assert.ok(reqData.replacement)
      assert.match(reqData.replacement.name, /fetch|ofetch|ky/)
      assert.equal(reqData.deprecated, "request has been deprecated")
    })

    it("gracefully records sourcesUnavailable when upstream registry fails", async () => {
      const dependencies = [{ name: "some-pkg", resolvedVersion: "1.0.0" }]

      globalThis.fetch = async () => {
        throw new Error("Network timeout")
      }

      const { sourcesUnavailable } = await enrichDependencies(dependencies)
      assert.ok(sourcesUnavailable.includes("npm-registry"))
      assert.ok(sourcesUnavailable.includes("deps.dev"))
    })
  })

  describe("Stage 4: scoreDependencies", () => {
    it("scores malware (MAL-*) at +95 and forces immediate high risk verdict", () => {
      const dependencies = [
        { name: "evil-pkg", resolvedVersion: "1.0.0", isDirect: true },
      ]
      const vulnMap = new Map([
        [
          "evil-pkg",
          { isMalware: true, vulns: [{ id: "MAL-2024-001", isMalware: true }] },
        ],
      ])
      const enrichMap = new Map()

      const { reports, summary } = scoreDependencies(
        dependencies,
        vulnMap,
        enrichMap,
      )
      assert.equal(reports.length, 1)
      assert.equal(reports[0].riskLevel, "high")
      assert.ok(reports[0].riskScore >= 95)
      assert.ok(reports[0].evidence.some((e) => e.rule === "malware-advisory"))
      assert.equal(reports[0].ruleVersion, RULE_VERSION)
      assert.equal(summary.verdict, "blocked")
      assert.equal(summary.highRiskCount, 1)
    })

    it("scores CISA KEV active exploit at +75 and forces immediate high risk override", () => {
      const dependencies = [
        { name: "exploited-pkg", resolvedVersion: "1.2.0", isDirect: true },
      ]
      const vulnMap = new Map([
        [
          "exploited-pkg",
          {
            isMalware: false,
            vulns: [
              {
                id: "GHSA-1234",
                cve: "CVE-2023-9999",
                kev: true,
                fixedIn: "1.2.1",
              },
            ],
          },
        ],
      ])
      const enrichMap = new Map()

      const { reports, summary } = scoreDependencies(
        dependencies,
        vulnMap,
        enrichMap,
      )
      assert.equal(reports[0].riskLevel, "high")
      assert.ok(reports[0].riskScore >= 75)
      assert.ok(
        reports[0].evidence.some((e) => e.rule === "cisa-kev-exploited"),
      )
      assert.match(reports[0].suggestion, /1\.2\.1/)
      assert.equal(summary.verdict, "blocked")
    })

    it("applies 0.75x weight multiplier for transitive dependencies unless active exploit or malware", () => {
      // 1. Transitive with regular deprecation (+45 pts) -> 45 * 0.75 = 34 pts -> low/medium
      const transitiveDep = [
        { name: "sub-dep", resolvedVersion: "1.0.0", isDirect: false },
      ]
      const vulnMap = new Map()
      const enrichMap = new Map([
        ["sub-dep", { deprecated: "Deprecated module" }],
      ])

      const resultTrans = scoreDependencies(transitiveDep, vulnMap, enrichMap)
      assert.equal(resultTrans.reports[0].riskScore, 34) // Math.round(45 * 0.75) = 34
      assert.equal(resultTrans.reports[0].riskLevel, "low")

      // 2. Direct with regular deprecation (+45 pts) -> 45 pts -> medium
      const directDep = [
        { name: "sub-dep", resolvedVersion: "1.0.0", isDirect: true },
      ]
      const resultDirect = scoreDependencies(directDep, vulnMap, enrichMap)
      assert.equal(resultDirect.reports[0].riskScore, 45)
      assert.equal(resultDirect.reports[0].riskLevel, "medium")

      // 3. Transitive with KEV exploit -> multiplier must NOT apply to active exploit
      const transitiveKev = [
        { name: "sub-kev", resolvedVersion: "1.0.0", isDirect: false },
      ]
      const kevVulnMap = new Map([
        ["sub-kev", { vulns: [{ id: "GHSA-kev", kev: true }] }],
      ])
      const resultKev = scoreDependencies(transitiveKev, kevVulnMap, new Map())
      assert.equal(resultKev.reports[0].riskScore, 75) // Not discounted
      assert.equal(resultKev.reports[0].riskLevel, "high")
    })

    it("computes release verdicts: ready (all low), review (medium), blocked (high)", () => {
      const deps = [
        { name: "clean-a", resolvedVersion: "1.0.0", isDirect: true },
        { name: "clean-b", resolvedVersion: "1.0.0", isDirect: true },
      ]
      const readyRes = scoreDependencies(deps, new Map(), new Map())
      assert.equal(readyRes.summary.verdict, "ready")
      assert.equal(readyRes.summary.highRiskCount, 0)
      assert.equal(readyRes.summary.mediumRiskCount, 0)
    })
  })

  describe("End-to-End Orchestrator: runDependencyAnalysis", () => {
    it("executes the full 4-stage pipeline and returns complete reports and summary", async () => {
      const packageJson = {
        name: "full-pipeline-test",
        dependencies: {
          lodash: "4.17.15",
          moment: "2.29.4",
        },
      }

      globalThis.fetch = async (url) => {
        const u = String(url)

        // OSV batch query
        if (u.includes("api.osv.dev/v1/querybatch")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              results: [
                { vulns: [{ id: "GHSA-jf85-cpcp-j695" }] }, // lodash
                { vulns: [] }, // moment
              ],
            }),
          }
        }

        // OSV details
        if (u.includes("api.osv.dev/v1/vulns/GHSA-jf85-cpcp-j695")) {
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
              affected: [{ ranges: [{ events: [{ fixed: "4.17.19" }] }] }],
            }),
          }
        }

        // CISA KEV
        if (u.includes("known_exploited_vulnerabilities.json")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ vulnerabilities: [] }),
          }
        }

        // FIRST EPSS
        if (u.includes("api.first.org/data/v1/epss")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              status: "OK",
              data: [{ cve: "CVE-2020-8203", epss: "0.45" }],
            }),
          }
        }

        // npm registry
        if (u.includes("registry.npmjs.org")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              "dist-tags": { latest: "4.17.21" },
              versions: {},
            }),
          }
        }

        // deps.dev
        if (u.includes("api.deps.dev")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ scorecard: { overallScore: 6.0 } }),
          }
        }

        return { ok: false, status: 404 }
      }

      const result = await runDependencyAnalysis({
        sourceType: "upload",
        packageJson,
      })

      assert.equal(result.projectName, "full-pipeline-test")
      assert.equal(result.dependencies.length, 2)
      assert.equal(result.reports.length, 2)
      assert.ok(result.summary)
      assert.ok(result.summary.verdict)
      assert.equal(result.ruleVersion, RULE_VERSION)

      const lodashReport = result.reports.find(
        (r) => r.packageName === "lodash",
      )
      assert.ok(lodashReport)
      assert.ok(lodashReport.evidence.length > 0)
      assert.ok(lodashReport.suggestion.includes("4.17.19"))

      const momentReport = result.reports.find(
        (r) => r.packageName === "moment",
      )
      assert.ok(momentReport)
      assert.ok(momentReport.replacement)
      assert.equal(momentReport.replacement.source, "e18e")
    })
  })
})
