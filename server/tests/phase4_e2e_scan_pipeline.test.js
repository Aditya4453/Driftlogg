import { after, afterEach, before, beforeEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import request from "supertest"
import { createApp } from "../src/app.js"
import {
  Dependency,
  Project,
  RiskReport,
  Scan,
  User,
} from "../src/models/index.js"
import { RULE_VERSION } from "../src/services/analyzer/scoring.stage.js"
import {
  clearCollections,
  connectTestDb,
  disconnectTestDb,
} from "./helpers/testDb.js"

const tokenCookie = (res) =>
  (res.headers["set-cookie"] || []).find((c) => c.startsWith("token="))

async function waitForScanFinished(app, cookie, scanId, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i += 1) {
    const res = await request(app)
      .get(`/api/scans/${scanId}`)
      .set("Cookie", cookie)
    if (res.body.status === "completed" || res.body.status === "failed") {
      return res.body
    }
    await new Promise((resolve) => setTimeout(resolve, 80))
  }
  throw new Error(`Timed out waiting for scan ${scanId} to complete`)
}

describe("Phase 4: End-to-End Scan Pipeline & Background Worker", () => {
  const app = createApp()
  const originalFetch = globalThis.fetch

  before(connectTestDb)
  afterEach(clearCollections)
  after(disconnectTestDb)

  beforeEach(() => {
    globalThis.fetch = originalFetch
  })

  it("executes the full 4-stage pipeline asynchronously, persists dependencies & reports, and sets release verdict", async () => {
    // 1. Setup mocked fetch for external vulnerability & ecosystem registries
    globalThis.fetch = async (url, options = {}) => {
      const u = typeof url === "string" ? url : url.toString()

      // OSV Batch Query
      if (u.includes("api.osv.dev/v1/querybatch")) {
        let bodyObj = {}
        try {
          bodyObj = JSON.parse(options.body)
        } catch {}
        const queries = bodyObj.queries || []
        const results = queries.map((q) => {
          if (q.package?.name === "lodash") {
            return {
              vulns: [
                {
                  id: "GHSA-p6mc-m468-83gw",
                  aliases: ["CVE-2020-8203"],
                  summary: "Prototype Pollution in lodash",
                  database_specific: { severity: "HIGH" },
                  affected: [
                    {
                      package: { name: "lodash", ecosystem: "npm" },
                      ranges: [
                        {
                          type: "SEMVER",
                          events: [{ introduced: "0" }, { fixed: "4.17.19" }],
                        },
                      ],
                    },
                  ],
                },
              ],
            }
          }
          return { vulns: [] }
        })
        return {
          ok: true,
          status: 200,
          json: async () => ({ results }),
        }
      }

      // OSV Vuln Details
      if (u.includes("api.osv.dev/v1/vulns/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: "GHSA-p6mc-m468-83gw",
            summary: "Prototype Pollution in lodash",
            aliases: ["CVE-2020-8203"],
            affected: [
              {
                ranges: [{ events: [{ fixed: "4.17.19" }] }],
              },
            ],
          }),
        }
      }

      // CISA KEV Catalog
      if (
        u.includes("cisa.gov") ||
        u.includes("known_exploited_vulnerabilities.json")
      ) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            vulnerabilities: [
              {
                cveID: "CVE-2020-8203",
                vendorProject: "Lodash",
                product: "Lodash",
                vulnerabilityName: "Lodash Prototype Pollution",
              },
            ],
          }),
        }
      }

      // FIRST EPSS
      if (u.includes("api.first.org/data/v1/epss")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: "OK",
            data: [{ cve: "CVE-2020-8203", epss: "0.785" }],
          }),
        }
      }

      // npm Registry Abbreviated Metadata
      if (u.includes("registry.npmjs.org")) {
        if (u.includes("lodash")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              "dist-tags": { latest: "4.17.21" },
              versions: { "4.17.15": {}, "4.17.21": {} },
              time: {
                "4.17.15": "2019-07-19T00:00:00.000Z",
                "4.17.21": "2021-02-20T00:00:00.000Z",
              },
            }),
          }
        }
        if (u.includes("moment")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              "dist-tags": { latest: "2.30.1" },
              versions: {
                "2.29.4": {
                  deprecated: "Moment is legacy and maintenance-only",
                },
                "2.30.1": {},
              },
              time: {
                "2.29.4": "2022-07-06T00:00:00.000Z",
                "2.30.1": "2023-12-20T00:00:00.000Z",
              },
            }),
          }
        }
        if (u.includes("fast-deep-equal")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              "dist-tags": { latest: "3.1.3" },
              versions: { "3.1.3": {} },
              time: { "3.1.3": "2020-06-25T00:00:00.000Z" },
            }),
          }
        }
      }

      // deps.dev API
      if (u.includes("api.deps.dev")) {
        if (u.includes("fast-deep-equal")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ scorecard: { overallScore: 8.5 } }),
          }
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ scorecard: { overallScore: 6.0 } }),
        }
      }

      return { ok: false, status: 404 }
    }

    // 2. Register & authenticate user
    const regRes = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Release Lead",
        email: "lead@driftlogg.test",
        password: "Password123!",
      })
      .expect(201)
    const cookie = tokenCookie(regRes)

    // 3. Create project (upload sourceType)
    const projRes = await request(app)
      .post("/api/projects")
      .set("Cookie", cookie)
      .send({ name: "Payment Gateway Service", sourceType: "upload" })
      .expect(201)
    const projectId = projRes.body._id

    // 4. Trigger scan with sample package.json (containing KEV vulnerable lodash, legacy moment, healthy fast-deep-equal)
    const samplePackageJson = {
      name: "payment-gateway",
      version: "1.0.0",
      dependencies: {
        lodash: "4.17.15",
        moment: "^2.29.4",
      },
      devDependencies: {
        "fast-deep-equal": "^3.1.3",
      },
    }

    const triggerRes = await request(app)
      .post(`/api/projects/${projectId}/analyze`)
      .set("Cookie", cookie)
      .send({ packageJson: samplePackageJson })
      .expect(201)

    assert.equal(triggerRes.body.status, "queued")
    assert.equal(triggerRes.body.project, projectId)
    const scanId = triggerRes.body._id

    // 5. Poll GET /api/scans/:scanId until completed
    const completedScan = await waitForScanFinished(app, cookie, scanId)
    assert.equal(completedScan.status, "completed")
    assert.equal(completedScan.verdict, "blocked") // lodash has CISA KEV active exploit
    assert.ok(typeof completedScan.overallScore === "number")
    assert.ok(completedScan.overallScore < 100)
    assert.equal(completedScan.ruleVersion, RULE_VERSION)

    // Verify structured execution logs are persisted to Scan
    const freshScan = await Scan.findById(scanId)
    assert.ok(Array.isArray(freshScan.logs))
    assert.ok(freshScan.logs.length >= 6)
    const stages = new Set(freshScan.logs.map((l) => l.stage))
    assert.ok(stages.has("runner"))
    assert.ok(stages.has("ingest"))
    assert.ok(stages.has("security"))
    assert.ok(stages.has("enrich"))
    assert.ok(stages.has("scoring"))
    assert.ok(stages.has("persist"))

    // 6. Verify dependencies saved in database
    const savedDeps = await Dependency.find({ scan: scanId }).sort({ name: 1 })
    assert.equal(savedDeps.length, 3)
    assert.equal(savedDeps[0].name, "fast-deep-equal")
    assert.equal(savedDeps[0].dependencyType, "devDependencies")
    assert.equal(savedDeps[1].name, "lodash")
    assert.equal(savedDeps[1].dependencyType, "dependencies")
    assert.equal(savedDeps[2].name, "moment")
    assert.equal(savedDeps[2].dependencyType, "dependencies")

    // 7. Verify GET /api/projects/:projectId/report
    const reportRes = await request(app)
      .get(`/api/projects/${projectId}/report`)
      .set("Cookie", cookie)
      .expect(200)

    const reports = reportRes.body
    assert.equal(reports.length, 3)

    // Verify lodash report (High Risk: CISA KEV active exploit)
    const lodashReport = reports.find((r) => r.packageName === "lodash")
    assert.ok(lodashReport)
    assert.equal(lodashReport.riskLevel, "high")
    assert.ok(lodashReport.riskScore >= 75)
    assert.ok(lodashReport.evidence.length > 0)
    assert.ok(
      lodashReport.evidence.some((e) => e.rule === "cisa-kev-exploited"),
    )
    assert.ok(lodashReport.suggestion.includes("4.17.19"))
    assert.equal(lodashReport.verdict, "blocked")
    assert.equal(lodashReport.ruleVersion, RULE_VERSION)

    // Verify moment report (Medium Risk: Deprecated + e18e replacement available)
    const momentReport = reports.find((r) => r.packageName === "moment")
    assert.ok(momentReport)
    assert.equal(momentReport.riskLevel, "medium")
    assert.ok(momentReport.replacement)
    assert.equal(momentReport.replacement.source, "e18e")
    assert.ok(momentReport.replacement.name)
    assert.equal(momentReport.verdict, "blocked")

    // Verify fast-deep-equal report (Low Risk: devDependency + high scorecard)
    const healthyReport = reports.find(
      (r) => r.packageName === "fast-deep-equal",
    )
    assert.ok(healthyReport)
    assert.equal(healthyReport.riskLevel, "low")
    assert.equal(healthyReport.signals.scorecard, 8.5)

    // 8. Verify project state was updated with latest scan summary
    const updatedProj = await Project.findById(projectId)
    assert.equal(updatedProj.status, "completed")
    assert.equal(String(updatedProj.latestScan), scanId)
    assert.equal(updatedProj.summary.high, 1)
    assert.equal(updatedProj.summary.medium, 1)
    assert.equal(updatedProj.summary.low, 1)
    assert.equal(updatedProj.summary.totalDependencies, 3)
  })

  it("handles the failure path cleanly when package.json is missing or malformed", async () => {
    const regRes = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Tester User",
        email: "tester@driftlogg.test",
        password: "Password123!",
      })
      .expect(201)
    const cookie = tokenCookie(regRes)

    // 1. Create upload project without stored manifest
    const projRes = await request(app)
      .post("/api/projects")
      .set("Cookie", cookie)
      .send({ name: "Broken App", sourceType: "upload" })
      .expect(201)
    const projectId = projRes.body._id

    // 2. Trigger scan with missing packageJson on upload project
    const emptyScanRes = await request(app)
      .post(`/api/projects/${projectId}/analyze`)
      .set("Cookie", cookie)
      .send({})
      .expect(201)

    const failedEmptyScan = await waitForScanFinished(
      app,
      cookie,
      emptyScanRes.body._id,
    )
    assert.equal(failedEmptyScan.status, "failed")
    assert.ok(failedEmptyScan.errorMessage.includes("package.json is required"))

    // 3. Trigger scan with malformed JSON string
    const malformedScanRes = await request(app)
      .post(`/api/projects/${projectId}/analyze`)
      .set("Cookie", cookie)
      .send({ packageJson: "{ not-valid-json: true " })
      .expect(201)

    const failedMalformedScan = await waitForScanFinished(
      app,
      cookie,
      malformedScanRes.body._id,
    )
    assert.equal(failedMalformedScan.status, "failed")
    assert.ok(failedMalformedScan.errorMessage.includes("not valid JSON"))

    // Verify error logs persisted in Scan document
    const failedDoc = await Scan.findById(malformedScanRes.body._id)
    assert.ok(Array.isArray(failedDoc.logs))
    assert.ok(failedDoc.logs.some((l) => l.level === "error"))

    // 4. Verify project status reflects failure
    const brokenProj = await Project.findById(projectId)
    assert.equal(brokenProj.status, "failed")
  })

  it("completes cleanly when using the /projects/:projectId/scans alias and falling back to stored manifest", async () => {
    // Mock fetch for healthy package
    globalThis.fetch = async (url) => {
      const u = typeof url === "string" ? url : url.toString()
      if (u.includes("api.osv.dev"))
        return {
          ok: true,
          status: 200,
          json: async () => ({ results: [{ vulns: [] }] }),
        }
      if (u.includes("cisa.gov"))
        return {
          ok: true,
          status: 200,
          json: async () => ({ vulnerabilities: [] }),
        }
      if (u.includes("api.first.org"))
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: "OK", data: [] }),
        }
      if (u.includes("registry.npmjs.org")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            "dist-tags": { latest: "1.0.0" },
            versions: { "1.0.0": {} },
            time: { "1.0.0": new Date().toISOString() },
          }),
        }
      }
      if (u.includes("api.deps.dev"))
        return {
          ok: true,
          status: 200,
          json: async () => ({ scorecard: { overallScore: 9.0 } }),
        }
      return { ok: false, status: 404 }
    }

    const regRes = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Clean User",
        email: "clean@driftlogg.test",
        password: "Password123!",
      })
      .expect(201)
    const cookie = tokenCookie(regRes)

    // Create project with stored manifest
    const projRes = await request(app)
      .post("/api/projects")
      .set("Cookie", cookie)
      .send({
        name: "Stored Manifest App",
        sourceType: "upload",
        packageJson: {
          dependencies: {
            "clean-dep": "1.0.0",
          },
        },
      })
      .expect(201)
    const projectId = projRes.body._id

    // Trigger scan using alias route without re-sending packageJson
    const scanRes = await request(app)
      .post(`/api/projects/${projectId}/scans`)
      .set("Cookie", cookie)
      .send({})
      .expect(201)

    const scan = await waitForScanFinished(app, cookie, scanRes.body._id)
    assert.equal(scan.status, "completed")
    assert.equal(scan.verdict, "ready")
    assert.equal(scan.overallScore, 100)
    assert.equal(scan.summary.totalDependencies, 1)
  })
})
