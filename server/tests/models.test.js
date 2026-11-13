import { after, afterEach, before, describe, it } from "node:test"
import assert from "node:assert/strict"
import mongoose from "mongoose"
import { Dependency, Membership, Project, RiskReport, Scan, User, Workspace } from "../src/models/index.js"
import { clearCollections, connectTestDb, disconnectTestDb } from "./helpers/testDb.js"

const id = () => new mongoose.Types.ObjectId()

describe("models", () => {
  before(connectTestDb)
  afterEach(clearCollections)
  after(disconnectTestDb)

  describe("User", () => {
    it("validates required fields and email, stores email lowercase", async () => {
      await assert.rejects(User.create({ name: "Bad", email: "not-an-email", password: "x" }), mongoose.Error.ValidationError)
      await assert.rejects(User.create({ name: "No Password", email: "np@example.com" }), /Password is required/)
      const user = await User.create({ name: "Ana", email: "  Ana@Example.COM ", password: "hash" })
      assert.equal(user.email, "ana@example.com")
      assert.equal(user.role, "user")
    })

    it("enforces unique emails", async () => {
      await User.create({ name: "Ana", email: "ana@example.com", password: "hash" })
      await assert.rejects(User.create({ name: "Ana 2", email: "ANA@example.com", password: "hash" }), (e) => e.code === 11000)
    })

    it("stores a bcrypt hash (10 rounds) and never exposes it in JSON", async () => {
      const user = new User({ name: "Ana", email: "ana@example.com" })
      await user.setPassword("Password123")
      await user.save()
      assert.notEqual(user.password, "Password123")
      assert.match(user.password, /^\$2[aby]\$10\$/)
      assert.equal(user.toJSON().password, undefined)
      assert.equal((await User.findById(user._id).select("-password")).password, undefined)
      const stored = await User.findById(user._id)
      assert.equal(await stored.comparePassword("Password123"), true)
      assert.equal(await stored.comparePassword("wrong password"), false)
      await assert.rejects(user.setPassword(""), /Password is required/)
    })

    it("only allows known roles", async () => {
      await assert.rejects(User.create({ name: "X", email: "x@example.com", password: "h", role: "root" }), mongoose.Error.ValidationError)
    })
  })

  describe("Workspace and Membership", () => {
    it("requires a valid unique slug", async () => {
      const owner = id()
      await assert.rejects(Workspace.create({ name: "Team", slug: "Bad Slug!", owner }), mongoose.Error.ValidationError)
      await Workspace.create({ name: "Team", slug: "team", owner })
      await assert.rejects(Workspace.create({ name: "Team", slug: "team", owner }), (e) => e.code === 11000)
    })

    it("allows only one membership per user per workspace", async () => {
      const workspace = id()
      const user = id()
      await Membership.create({ workspace, user, role: "developer" })
      await assert.rejects(Membership.create({ workspace, user, role: "team_admin" }), (e) => e.code === 11000)
      await assert.rejects(Membership.create({ workspace: id(), user, role: "owner" }), mongoose.Error.ValidationError)
    })
  })

  describe("Project", () => {
    it("accepts the handover contract (user, name, sourceType) with its defaults", async () => {
      await assert.rejects(Project.create({ name: "api", sourceType: "github_repo" }), mongoose.Error.ValidationError) // user required
      await assert.rejects(Project.create({ user: id(), name: "api", sourceType: "svn" }), mongoose.Error.ValidationError)
      const plain = await Project.create({ user: id(), name: "api", sourceType: "package_json" })
      assert.equal(plain.description, "")
      assert.equal(plain.repositoryUrl, "")
      assert.equal(plain.status, "pending")
      const gh = await Project.create({ user: id(), name: "api", sourceType: "github_repo", repositoryUrl: "https://github.com/acme/api" })
      const json = gh.toJSON()
      assert.equal(json.source, "GitHub")
      assert.equal(json.detail, "acme/api")
      assert.equal(json.deps, 0)
    })

    it("keeps names unique (case-insensitive) inside one workspace only", async () => {
      const workspace = id()
      await Project.create({ workspace, user: id(), name: "Checkout", sourceType: "package_json" })
      await assert.rejects(Project.create({ workspace, user: id(), name: "checkout", sourceType: "package_json" }), (e) => e.code === 11000)
      await Project.create({ workspace: id(), user: id(), name: "checkout", sourceType: "package_json" })
    })
  })

  describe("Scan, Dependency, RiskReport", () => {
    it("rejects invalid statuses and duplicate scan numbers", async () => {
      const project = id()
      const minimal = await Scan.create({ project }) // handover contract: only project is required
      assert.equal(minimal.status, "queued")
      assert.ok(minimal.startedAt)
      const base = { project, workspace: id(), triggeredBy: id(), sourceType: "package_json" }
      await assert.rejects(Scan.create({ ...base, scanNumber: 1, status: "done" }), mongoose.Error.ValidationError)
      await Scan.create({ ...base, scanNumber: 1 })
      await assert.rejects(Scan.create({ ...base, scanNumber: 1 }), (e) => e.code === 11000)
    })

    it("keeps one dependency row per package per scan", async () => {
      const plain = await Dependency.create({ project: id(), name: "react", version: "^19.0.0" }) // handover contract
      assert.deepEqual(plain.rawData, {})
      const scan = id()
      await Dependency.create({ project: id(), scan, name: "lodash", version: "4.17.21" })
      await assert.rejects(Dependency.create({ project: id(), scan, name: "lodash", version: "4.17.20" }), (e) => e.code === 11000)
    })

    it("validates risk level and score range", async () => {
      const base = { scan: id(), dependency: id(), packageName: "x", version: "1.0.0" }
      await assert.rejects(RiskReport.create({ ...base, riskLevel: "critical", riskScore: 50 }), mongoose.Error.ValidationError)
      await assert.rejects(RiskReport.create({ ...base, riskLevel: "high", riskScore: 120 }), mongoose.Error.ValidationError)
    })

    it("treats risk reports as immutable history", async () => {
      const report = await RiskReport.create({
        scan: id(), dependency: id(),
        packageName: "request", version: "2.88.2", riskLevel: "high", riskScore: 94,
        signals: { lastCommit: "2020-02-11", lastRelease: "2020-02-11T00:00:00Z" },
      })
      assert.equal(report.signals.lastCommit, "2020-02-11") // stored as string
      assert.equal(report.signals.deprecated, false)
      assert.equal(report.suggestion, "")
      await assert.rejects(RiskReport.updateOne({ _id: report._id }, { riskScore: 1 }), /cannot be modified/)
      await assert.rejects(RiskReport.findOneAndUpdate({ _id: report._id }, { riskLevel: "low" }), /cannot be modified/)
      report.riskScore = 1 // immutable field: ignored on save
      await report.save()
      assert.equal((await RiskReport.findById(report._id)).riskScore, 94)
    })
  })
})
