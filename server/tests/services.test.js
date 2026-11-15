import { after, afterEach, before, beforeEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { Dependency, Membership, Project, RiskReport, Scan, Workspace } from "../src/models/index.js"
import * as db from "../src/services/index.js"
import { clearCollections, connectTestDb, disconnectTestDb } from "./helpers/testDb.js"

const packageJson = {
  dependencies: { request: "2.88.2", express: "^4.18.2" },
  devDependencies: { lodash: "4.17.20" },
}
const results = (requestScore = 94) => [
  { packageName: "request", riskLevel: "High", riskScore: requestScore, reasons: ["Deprecated"], signals: { deprecated: true } },
  { packageName: "express", riskLevel: "low", riskScore: 18, reasons: ["Healthy"] },
  { packageName: "lodash", riskLevel: "medium", riskScore: 64, reasons: ["Known vulnerability"] },
]
const status = (code) => (error) => error.status === code

async function runScan(actor, projectId, score) {
  const scan = await db.startScan(actor, projectId, { packageJson })
  await db.markScanProcessing(scan._id)
  return db.completeScan(scan._id, results(score))
}

describe("database services", () => {
  let dev, otherDev, teamAdmin, superAdmin, team

  before(connectTestDb)
  after(disconnectTestDb)
  afterEach(clearCollections)

  beforeEach(async () => {
    dev = await db.registerUser({ name: "Dev One", email: "dev1@example.com", password: "password-123" })
    otherDev = await db.registerUser({ name: "Dev Two", email: "dev2@example.com", password: "password-123" })
    teamAdmin = await db.registerUser({ name: "Team Lead", email: "lead@example.com", password: "password-123" })
    superAdmin = await db.registerUser({ name: "Root", email: "root@example.com", password: "password-123" })
    superAdmin.role = "admin"
    await superAdmin.save()
    team = await db.createWorkspace({ name: "Platform Team", ownerId: teamAdmin._id })
    await db.addMember(teamAdmin, team._id, dev._id, "developer")
  })

  describe("users and workspaces", () => {
    it("registers a user with a personal workspace where they are team admin", async () => {
      const personal = await db.getPersonalWorkspace(dev._id)
      assert.ok(personal)
      const membership = await Membership.findOne({ workspace: personal._id, user: dev._id })
      assert.equal(membership.role, "team_admin")
      await assert.rejects(db.registerUser({ name: "Dup", email: "DEV1@example.com", password: "password-123" }), status(400))
      await assert.rejects(db.registerUser({ name: "No Pass", email: "np@example.com" }), status(400))
    })

    it("verifies credentials", async () => {
      const user = await db.verifyCredentials("DEV1@example.com", "password-123")
      assert.equal(user.email, "dev1@example.com")
      assert.equal(user.password, undefined)
      assert.ok(user.lastLoginAt)
      assert.equal(await db.verifyCredentials("dev1@example.com", "wrong-password"), null)
    })

    it("lists the user's workspaces with their role", async () => {
      const workspaces = await db.listUserWorkspaces(dev._id)
      assert.equal(workspaces.length, 2)
      assert.equal(workspaces.find((w) => w.slug === team.slug).membershipRole, "developer")
    })

    it("only team admins manage members, and the last team admin cannot be removed", async () => {
      await assert.rejects(db.addMember(dev, team._id, otherDev._id), status(403))
      await db.addMember(teamAdmin, team._id, otherDev._id)
      await db.removeMember(teamAdmin, team._id, otherDev._id)
      assert.equal((await Membership.findOne({ workspace: team._id, user: otherDev._id })).status, "removed")
      await assert.rejects(db.updateMemberRole(teamAdmin, team._id, teamAdmin._id, "developer"), status(409))
      await assert.rejects(db.removeMember(teamAdmin, team._id, teamAdmin._id), status(409))
      // Super admin can manage any team
      await db.addMember(superAdmin, team._id, otherDev._id, "team_admin")
    })
  })

  describe("permissions (Developer / Team Admin / Super Admin)", () => {
    it("developers see their own projects but not other people's", async () => {
      const own = await db.createProject(dev, { name: "my-app", sourceType: "package_json" })
      assert.equal(String(own.user), String(dev._id))
      // A project created directly with the handover fields (no workspace) is still found and protected.
      const direct = await Project.create({ user: dev._id, name: "direct", sourceType: "package_json" })
      assert.equal((await db.listProjectsForUser(dev)).length, 2)
      assert.ok(await db.getProjectForUser(dev, direct._id))
      await assert.rejects(db.getProjectForUser(otherDev, direct._id), status(403))
      await assert.rejects(db.updateProject(teamAdmin, direct._id, { name: "x" }), status(403))
      await assert.rejects(db.getProjectForUser(otherDev, own._id), status(403))
      const list = await db.listProjectsForUser(otherDev)
      assert.equal(list.length, 0)
    })

    it("team members see team projects; only owner or team admin can change them", async () => {
      const teamProject = await db.createProject(teamAdmin, { name: "core", sourceType: "package_json", workspaceId: team._id })
      assert.ok(await db.getProjectForUser(dev, teamProject._id))
      await assert.rejects(db.updateProject(dev, teamProject._id, { name: "hijack" }), status(403))
      await assert.rejects(db.getProjectForUser(otherDev, teamProject._id), status(403))

      const devProject = await db.createProject(dev, { name: "dev-tool", sourceType: "package_json", workspaceId: team._id })
      const renamed = await db.updateProject(teamAdmin, devProject._id, { name: "dev-tool-2" })
      assert.equal(renamed.name, "dev-tool-2")
    })

    it("super admin sees everything and global statistics; others cannot", async () => {
      await db.createProject(dev, { name: "a", sourceType: "package_json" })
      await db.createProject(otherDev, { name: "b", sourceType: "package_json" })
      assert.equal((await db.listProjectsForUser(superAdmin)).length, 2)
      assert.equal((await db.listUsers(superAdmin)).length, 4)
      await assert.rejects(db.getSystemStats(dev), status(403))
      await assert.rejects(db.listUsers(teamAdmin), status(403))
      const stats = await db.getSystemStats(superAdmin)
      assert.deepEqual(
        { users: stats.totalUsers, projects: stats.totalProjects, teams: stats.totalTeams },
        { users: 4, projects: 2, teams: 1 },
      )
    })

    it("rejects duplicate project names in a workspace", async () => {
      await db.createProject(dev, { name: "dup", sourceType: "package_json" })
      await assert.rejects(db.createProject(dev, { name: "DUP", sourceType: "package_json" }), status(409))
    })
  })

  describe("scan history and historical risk reports", () => {
    it("stores each scan separately with its own dependencies and reports", async () => {
      const project = await db.createProject(dev, { name: "history", sourceType: "package_json" })
      const first = await runScan(dev, project._id, 94)
      const second = await runScan(dev, project._id, 40)

      assert.equal(first.scanNumber, 1)
      assert.equal(second.scanNumber, 2)
      assert.notEqual(String(first._id), String(second._id))
      assert.equal(await Scan.countDocuments({ project: project._id }), 2)
      assert.equal(await Dependency.countDocuments({ scan: first._id }), 3)
      assert.equal(await Dependency.countDocuments({ scan: second._id }), 3)
      assert.equal(await RiskReport.countDocuments({ scan: first._id }), 3)
      assert.equal(await RiskReport.countDocuments({ scan: second._id }), 3)

      // Old report is unchanged after the newer scan.
      const oldReport = await RiskReport.findOne({ scan: first._id, packageName: "request" })
      assert.equal(oldReport.riskScore, 94)
      assert.equal(oldReport.riskLevel, "high")

      const history = await db.listProjectScans(dev, project._id)
      assert.deepEqual(history.map((s) => s.scanNumber), [2, 1])
    })

    it("summarises scans and updates the project snapshot", async () => {
      const project = await db.createProject(dev, { name: "summary", sourceType: "package_json" })
      const scan = await runScan(dev, project._id)
      assert.equal(scan.status, "completed")
      assert.ok(scan.completedAt >= scan.startedAt)
      assert.deepEqual({ ...scan.summary.toObject() }, { totalDependencies: 3, high: 1, medium: 1, low: 1, averageRiskScore: 58.7 })

      const refreshed = await Project.findById(project._id)
      assert.equal(refreshed.status, "completed")
      assert.equal(String(refreshed.latestScan), String(scan._id))
      assert.equal(refreshed.toJSON().high, 1)
    })

    it("returns the latest report, per-scan reports, package history and trend", async () => {
      const project = await db.createProject(dev, { name: "reports", sourceType: "package_json" })
      const first = await runScan(dev, project._id, 94)
      const second = await runScan(dev, project._id, 70)

      const latest = await db.getLatestProjectReport(dev, project._id)
      assert.ok(latest.every((r) => String(r.scan) === String(second._id)))
      assert.equal(latest[0].packageName, "request") // highest risk first

      const firstReports = await db.getScanReports(dev, first._id)
      assert.equal(firstReports.find((r) => r.packageName === "request").riskScore, 94)

      const history = await db.getPackageRiskHistory(dev, project._id, "request")
      assert.deepEqual(history.map((r) => r.riskScore), [94, 70])
      assert.deepEqual(history.map((r) => r.scan.scanNumber), [1, 2])

      const trend = await db.getProjectRiskTrend(dev, project._id)
      assert.equal(trend.length, 2)

      await assert.rejects(db.getScanReports(otherDev, first._id), status(403))
    })

    it("a failed scan keeps earlier results and cannot be completed later", async () => {
      const project = await db.createProject(dev, { name: "failing", sourceType: "package_json" })
      const good = await runScan(dev, project._id)
      const bad = await db.startScan(dev, project._id, { packageJson })
      await db.failScan(bad._id, "GitHub rate limit")

      const refreshed = await Project.findById(project._id)
      assert.equal(refreshed.status, "completed")
      assert.equal(String(refreshed.latestScan), String(good._id))
      assert.equal((await Scan.findById(bad._id)).errorMessage, "GitHub rate limit")
      await assert.rejects(db.completeScan(bad._id, results()), status(409))
      await assert.rejects(db.completeScan(good._id, results()), status(409))
    })

    it("validates scan input", async () => {
      const project = await db.createProject(dev, { name: "validate", sourceType: "package_json" })
      await assert.rejects(db.startScan(dev, project._id, { packageJson: { dependencies: ["x"] } }), status(400))
      const scan = await db.startScan(dev, project._id, { packageJson })
      await assert.rejects(db.completeScan(scan._id, [{ packageName: "request", riskLevel: "critical", riskScore: 5 }]), status(400))
      await assert.rejects(db.startScan(dev, "not-an-id"), status(400))
    })

    it("creates missing dependency rows when results include extra packages", async () => {
      const project = await db.createProject(dev, { name: "extra", sourceType: "package_json" })
      const scan = await db.startScan(dev, project._id)
      await db.completeScan(scan._id, [{ packageName: "left-pad", version: "1.3.0", riskLevel: "high", riskScore: 80 }])
      assert.equal(await Dependency.countDocuments({ scan: scan._id, name: "left-pad" }), 1)
    })

    it("handles parallel scans without duplicate scan numbers", async () => {
      const project = await db.createProject(dev, { name: "parallel", sourceType: "package_json" })
      const scans = await Promise.all([1, 2, 3, 4].map(() => db.startScan(dev, project._id)))
      assert.deepEqual(scans.map((s) => s.scanNumber).sort(), [1, 2, 3, 4])
    })
  })

  describe("project removal", () => {
    it("archive keeps history; delete removes only that project's data", async () => {
      const keep = await db.createProject(dev, { name: "keep", sourceType: "package_json" })
      const remove = await db.createProject(dev, { name: "remove", sourceType: "package_json" })
      await runScan(dev, keep._id)
      await runScan(dev, remove._id)

      await db.archiveProject(dev, keep._id)
      assert.equal((await db.listProjectsForUser(dev)).some((p) => p.name === "keep"), false)
      assert.equal(await RiskReport.countDocuments({ project: keep._id }), 3)

      await assert.rejects(db.deleteProject(otherDev, remove._id), status(403))
      await db.deleteProject(dev, remove._id)
      assert.equal(await Project.countDocuments({ _id: remove._id }), 0)
      assert.equal(await Scan.countDocuments({ project: remove._id }), 0)
      assert.equal(await RiskReport.countDocuments({ project: remove._id }), 0)
      assert.equal(await RiskReport.countDocuments({ project: keep._id }), 3)
      assert.ok(await Workspace.exists({ _id: team._id }))
    })
  })
})
