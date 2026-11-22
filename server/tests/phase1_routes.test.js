import { after, afterEach, before, describe, it } from "node:test"
import assert from "node:assert/strict"
import request from "supertest"
import { createApp } from "../src/app.js"
import { User } from "../src/models/index.js"
import { validateGitHubRepoUrl } from "../src/middleware/security.js"
import { registerUser } from "../src/services/user.service.js"
import {
  clearCollections,
  connectTestDb,
  disconnectTestDb,
} from "./helpers/testDb.js"

const tokenCookie = (res) =>
  (res.headers["set-cookie"] || []).find((c) => c.startsWith("token="))

describe("Phase 1: Projects, Scans, Admin Routes & Hardening", () => {
  const app = createApp()

  before(connectTestDb)
  afterEach(clearCollections)
  after(disconnectTestDb)

  describe("Security helpers & validators", () => {
    it("validateGitHubRepoUrl validates canonical GitHub repository URLs strictly", () => {
      // Valid URLs
      assert.ok(validateGitHubRepoUrl("https://github.com/facebook/react"))
      assert.ok(validateGitHubRepoUrl("https://github.com/facebook/react.git"))
      assert.ok(validateGitHubRepoUrl("https://github.com/facebook/react/"))
      assert.ok(
        validateGitHubRepoUrl("https://github.com/org-name/repo_name.v2"),
      )

      // Invalid / SSRF attack URLs
      assert.equal(
        validateGitHubRepoUrl("http://github.com/facebook/react"),
        false,
      ) // no http
      assert.equal(
        validateGitHubRepoUrl("https://gitlab.com/facebook/react"),
        false,
      ) // not github
      assert.equal(
        validateGitHubRepoUrl("https://github.com.evil.com/facebook/react"),
        false,
      )
      assert.equal(validateGitHubRepoUrl("https://github.com/facebook"), false) // missing repo
      assert.equal(
        validateGitHubRepoUrl("https://github.com/facebook/react/issues"),
        false,
      ) // subpath
      assert.equal(validateGitHubRepoUrl("javascript:alert(1)"), false)
      assert.equal(validateGitHubRepoUrl(""), false)
      assert.equal(validateGitHubRepoUrl(null), false)
    })
  })

  describe("Projects API (/api/projects)", () => {
    it("requires authentication for all endpoints", async () => {
      await request(app).get("/api/projects").expect(401)
      await request(app)
        .post("/api/projects")
        .send({ name: "Demo" })
        .expect(401)
      await request(app)
        .get("/api/projects/507f1f77bcf86cd799439011")
        .expect(401)
      await request(app)
        .delete("/api/projects/507f1f77bcf86cd799439011")
        .expect(401)
    })

    it("creates, retrieves, lists and deletes projects for authenticated user", async () => {
      // Register developer user
      const devRes = await request(app)
        .post("/api/auth/register")
        .send({
          name: "Dev User",
          email: "dev@example.com",
          password: "Password123",
        })
        .expect(201)
      const cookie = tokenCookie(devRes)

      // 1. Validation: missing name -> 400
      await request(app)
        .post("/api/projects")
        .set("Cookie", cookie)
        .send({ sourceType: "upload" })
        .expect(400)

      // 2. Validation: invalid sourceType -> 400
      await request(app)
        .post("/api/projects")
        .set("Cookie", cookie)
        .send({ name: "P1", sourceType: "svn" })
        .expect(400)

      // 3. Validation: github source with missing / invalid URL -> 400
      await request(app)
        .post("/api/projects")
        .set("Cookie", cookie)
        .send({
          name: "P1",
          sourceType: "github",
          repositoryUrl: "http://malicious.com",
        })
        .expect(400)

      // 4. Create valid GitHub project
      const createdGh = await request(app)
        .post("/api/projects")
        .set("Cookie", cookie)
        .send({
          name: "DriftLogg Web",
          sourceType: "github",
          repositoryUrl: "https://github.com/driftlogg/web",
          description: "Main frontend",
        })
        .expect(201)

      assert.equal(createdGh.body.name, "DriftLogg Web")
      assert.equal(createdGh.body.sourceType, "github_repo")
      assert.equal(
        createdGh.body.repositoryUrl,
        "https://github.com/driftlogg/web",
      )
      const projectId = createdGh.body._id

      // 5. Create valid Upload project
      await request(app)
        .post("/api/projects")
        .set("Cookie", cookie)
        .send({ name: "Backend API", sourceType: "upload" })
        .expect(201)

      // 6. List projects
      const listRes = await request(app)
        .get("/api/projects")
        .set("Cookie", cookie)
        .expect(200)
      assert.equal(Array.isArray(listRes.body), true)
      assert.equal(listRes.body.length, 2)

      // 7. Get single project
      const singleRes = await request(app)
        .get(`/api/projects/${projectId}`)
        .set("Cookie", cookie)
        .expect(200)
      assert.equal(singleRes.body._id, projectId)
      assert.equal(singleRes.body.name, "DriftLogg Web")

      // 8. Reject invalid ObjectId -> 400
      await request(app)
        .get("/api/projects/invalid-id")
        .set("Cookie", cookie)
        .expect(400)

      // 9. Delete project
      await request(app)
        .delete(`/api/projects/${projectId}`)
        .set("Cookie", cookie)
        .expect(200)

      // 10. Verify project no longer found
      await request(app)
        .get(`/api/projects/${projectId}`)
        .set("Cookie", cookie)
        .expect(404)
    })
  })

  describe("Scans API (/api/projects/:projectId/analyze, scans, report)", () => {
    it("handles scan creation, polling, history and report retrieval", async () => {
      const devRes = await request(app)
        .post("/api/auth/register")
        .send({
          name: "Scanner User",
          email: "scanner@example.com",
          password: "Password123",
        })
        .expect(201)
      const cookie = tokenCookie(devRes)

      // Create a project first
      const proj = await request(app)
        .post("/api/projects")
        .set("Cookie", cookie)
        .send({ name: "Scan Target", sourceType: "upload" })
        .expect(201)
      const projectId = proj.body._id

      // 1. Validation: oversized package.json (> 200 KB) -> 400
      const largePackage = {
        name: "oversized",
        dependencies: {},
      }
      for (let i = 0; i < 7000; i += 1) {
        largePackage.dependencies[`pkg-oversized-${i}`] = "^1.0.0"
      }
      await request(app)
        .post(`/api/projects/${projectId}/analyze`)
        .set("Cookie", cookie)
        .send({ packageJson: largePackage })
        .expect(400)

      // 2. Start valid scan via /analyze
      const scanRes = await request(app)
        .post(`/api/projects/${projectId}/analyze`)
        .set("Cookie", cookie)
        .send({
          packageJson: {
            dependencies: {
              lodash: "^4.17.21",
              express: "^5.0.0",
            },
          },
        })
        .expect(201)

      assert.equal(scanRes.body.project, projectId)
      assert.equal(scanRes.body.status, "queued")
      assert.equal(scanRes.body.scanNumber, 1)
      const scanId = scanRes.body._id

      // 3. Test alias /projects/:projectId/scans also triggers scan
      const aliasScanRes = await request(app)
        .post(`/api/projects/${projectId}/scans`)
        .set("Cookie", cookie)
        .send({
          packageJson: {
            dependencies: {
              axios: "^1.6.0",
            },
          },
        })
        .expect(201)
      assert.equal(aliasScanRes.body.scanNumber, 2)

      // 4. Polling endpoint GET /api/scans/:scanId
      const pollRes = await request(app)
        .get(`/api/scans/${scanId}`)
        .set("Cookie", cookie)
        .expect(200)
      assert.equal(pollRes.body._id, scanId)
      assert.equal(pollRes.body.project, projectId)

      // 5. Scan history GET /api/projects/:projectId/scans
      const scansList = await request(app)
        .get(`/api/projects/${projectId}/scans`)
        .set("Cookie", cookie)
        .expect(200)
      assert.equal(scansList.body.length, 2)
      assert.equal(scansList.body[0].scanNumber, 2) // newest first

      // 6. Latest report GET /api/projects/:projectId/report (empty array when not completed)
      const reportRes = await request(app)
        .get(`/api/projects/${projectId}/report`)
        .set("Cookie", cookie)
        .expect(200)
      assert.deepEqual(reportRes.body, [])
    })
  })

  describe("Admin API (/api/admin/stats, users, projects)", () => {
    it("blocks non-admins and allows admin to query stats, users, and all projects", async () => {
      // 1. Regular user
      const userRes = await request(app)
        .post("/api/auth/register")
        .send({
          name: "Normal Dev",
          email: "norm@example.com",
          password: "Password123",
        })
        .expect(201)
      const userCookie = tokenCookie(userRes)

      await request(app)
        .get("/api/admin/stats")
        .set("Cookie", userCookie)
        .expect(403)
      await request(app)
        .get("/api/admin/users")
        .set("Cookie", userCookie)
        .expect(403)
      await request(app)
        .get("/api/admin/projects")
        .set("Cookie", userCookie)
        .expect(403)

      // 2. Admin user (promote role to 'admin')
      const admin = await registerUser({
        name: "Super Administrator",
        email: "superadmin@example.com",
        password: "AdminPassword123",
      })
      await User.updateOne({ _id: admin._id }, { $set: { role: "admin" } })

      const adminLogin = await request(app)
        .post("/api/auth/login")
        .send({ email: "superadmin@example.com", password: "AdminPassword123" })
        .expect(200)
      const adminCookie = tokenCookie(adminLogin)

      // GET /api/admin/stats
      const statsRes = await request(app)
        .get("/api/admin/stats")
        .set("Cookie", adminCookie)
        .expect(200)
      assert.equal(typeof statsRes.body.totalUsers, "number")
      assert.equal(typeof statsRes.body.totalProjects, "number")
      assert.equal(typeof statsRes.body.totalScans, "number")
      assert.equal(typeof statsRes.body.highRiskCount, "number")
      assert.ok(statsRes.body.totalUsers >= 2)

      // GET /api/admin/users
      const usersRes = await request(app)
        .get("/api/admin/users")
        .set("Cookie", adminCookie)
        .expect(200)
      assert.equal(Array.isArray(usersRes.body), true)
      assert.ok(usersRes.body.length >= 2)
      for (const u of usersRes.body) {
        assert.equal(u.password, undefined) // no passwords leaked
      }

      // GET /api/admin/projects
      const projRes = await request(app)
        .get("/api/admin/projects")
        .set("Cookie", adminCookie)
        .expect(200)
      assert.equal(Array.isArray(projRes.body), true)
    })
  })
})
