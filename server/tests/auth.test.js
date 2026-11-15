import { after, afterEach, before, describe, it } from "node:test"
import assert from "node:assert/strict"
import express from "express"
import cookieParser from "cookie-parser"
import jwt from "jsonwebtoken"
import request from "supertest"
import { createApp } from "../src/app.js"
import { User } from "../src/models/index.js"
import { requireAdmin, requireAuth } from "../src/middleware/auth.js"
import { getJwtSecret } from "../src/config/env.js"
import { sendTokenCookie } from "../src/utils/token.js"
import { clearCollections, connectTestDb, disconnectTestDb } from "./helpers/testDb.js"

const alex = { name: "Alex Mercer", email: "alex@example.com", password: "Password123" }
const tokenCookie = (res) => (res.headers["set-cookie"] || []).find((c) => c.startsWith("token="))

describe("authentication API (/api/auth)", () => {
  const app = createApp()

  before(connectTestDb)
  afterEach(clearCollections)
  after(disconnectTestDb)

  describe("POST /register", () => {
    it("creates the user, hashes the password and sets an httpOnly cookie", async () => {
      const res = await request(app).post("/api/auth/register").send(alex).expect(201)
      assert.equal(res.body.name, "Alex Mercer")
      assert.equal(res.body.email, "alex@example.com")
      assert.equal(res.body.role, "user")
      assert.ok(res.body._id && res.body.createdAt)
      assert.equal(res.body.password, undefined)

      const cookie = tokenCookie(res)
      assert.ok(cookie, "token cookie set")
      assert.match(cookie, /HttpOnly/i)
      assert.match(cookie, /SameSite=Lax/i)
      assert.doesNotMatch(cookie, /Secure/i) // not secure on localhost

      const stored = await User.findOne({ email: "alex@example.com" })
      assert.notEqual(stored.password, "Password123")
      assert.match(stored.password, /^\$2[aby]\$10\$/)
    })

    it("returns 400 for missing fields and duplicate emails", async () => {
      await request(app).post("/api/auth/register").send({ email: "a@b.com", password: "x" }).expect(400)
      await request(app).post("/api/auth/register").send(alex).expect(201)
      const dup = await request(app).post("/api/auth/register").send({ ...alex, email: "ALEX@example.com" }).expect(400)
      assert.match(dup.body.message, /already exists/)
    })

    it("returns 400 for an invalid email", async () => {
      await request(app).post("/api/auth/register").send({ ...alex, email: "nope" }).expect(400)
    })
  })

  describe("POST /login", () => {
    it("returns the user and sets the cookie for correct credentials", async () => {
      await request(app).post("/api/auth/register").send(alex)
      const res = await request(app).post("/api/auth/login").send({ email: alex.email, password: alex.password }).expect(200)
      assert.equal(res.body.email, alex.email)
      assert.equal(res.body.password, undefined)
      assert.match(tokenCookie(res), /HttpOnly/i)
    })

    it("returns 401 for a wrong password or unknown email", async () => {
      await request(app).post("/api/auth/register").send(alex)
      const wrong = await request(app).post("/api/auth/login").send({ email: alex.email, password: "nope" }).expect(401)
      assert.equal(wrong.body.message, "Invalid email or password")
      await request(app).post("/api/auth/login").send({ email: "ghost@example.com", password: "x" }).expect(401)
      await request(app).post("/api/auth/login").send({}).expect(401)
    })
  })

  describe("GET /me and POST /logout", () => {
    it("returns the logged-in user from the cookie (browser refresh)", async () => {
      const agent = request.agent(app)
      await agent.post("/api/auth/register").send(alex).expect(201)
      const res = await agent.get("/api/auth/me").expect(200)
      assert.equal(res.body.email, alex.email)
      assert.equal(res.body.password, undefined)
    })

    it("returns 401 without a token, with a bad token, or for a deleted user", async () => {
      const none = await request(app).get("/api/auth/me").expect(401)
      assert.equal(none.body.message, "Authentication required. No token found.")

      const bad = await request(app).get("/api/auth/me").set("Cookie", "token=not-a-jwt").expect(401)
      assert.equal(bad.body.message, "Invalid or expired token.")

      const forged = jwt.sign({ id: "65e23910f1a2b3c4d5e6f7a8", role: "admin" }, "wrong-secret")
      await request(app).get("/api/auth/me").set("Cookie", `token=${forged}`).expect(401)

      const agent = request.agent(app)
      await agent.post("/api/auth/register").send(alex)
      await User.deleteOne({ email: alex.email })
      const gone = await agent.get("/api/auth/me").expect(401)
      assert.equal(gone.body.message, "User belonging to this token no longer exists.")
    })

    it("logout clears the cookie so /me fails afterwards", async () => {
      const agent = request.agent(app)
      await agent.post("/api/auth/register").send(alex)
      const res = await agent.post("/api/auth/logout").expect(200)
      assert.deepEqual(res.body, { message: "Logged out successfully" })
      assert.match(tokenCookie(res), /Expires=Thu, 01 Jan 1970/)
      await agent.get("/api/auth/me").expect(401)
    })

    it("JWT contains { id, role } and expires in 7 days", async () => {
      const res = await request(app).post("/api/auth/register").send(alex)
      const token = tokenCookie(res).split(";")[0].slice("token=".length)
      const payload = jwt.verify(token, getJwtSecret())
      assert.equal(payload.id, res.body._id)
      assert.equal(payload.role, "user")
      assert.equal(payload.exp - payload.iat, 7 * 24 * 60 * 60)
    })
  })

  describe("CORS", () => {
    it("allows credentials from the frontend origin", async () => {
      const res = await request(app)
        .options("/api/auth/login")
        .set("Origin", "http://localhost:5173")
        .set("Access-Control-Request-Method", "POST")
      assert.equal(res.headers["access-control-allow-origin"], "http://localhost:5173")
      assert.equal(res.headers["access-control-allow-credentials"], "true")
    })
  })

  describe("requireAdmin and production cookies", () => {
    const testApp = express()
    testApp.use(cookieParser())
    testApp.get("/admin-only", requireAuth, requireAdmin, (_req, res) => res.json({ ok: true }))

    it("blocks normal users and allows Super Admins", async () => {
      const user = await request(app).post("/api/auth/register").send(alex)
      await request(testApp).get("/admin-only").set("Cookie", tokenCookie(user).split(";")[0]).expect(403)

      await User.updateOne({ email: alex.email }, { role: "admin" })
      const admin = await request(app).post("/api/auth/login").send(alex) // new token carries role admin
      const ok = await request(testApp).get("/admin-only").set("Cookie", tokenCookie(admin).split(";")[0]).expect(200)
      assert.deepEqual(ok.body, { ok: true })
    })

    it("uses Secure + SameSite=None in production and requires JWT_SECRET", () => {
      const saved = { env: process.env.NODE_ENV, secret: process.env.JWT_SECRET }
      try {
        process.env.NODE_ENV = "production"
        delete process.env.JWT_SECRET
        assert.throws(() => getJwtSecret(), /JWT_SECRET must be set/)

        process.env.JWT_SECRET = "a-long-production-secret"
        let options
        sendTokenCookie({ cookie: (_name, _value, opts) => (options = opts) }, { _id: "65e23910f1a2b3c4d5e6f7a8", role: "user" })
        assert.equal(options.secure, true)
        assert.equal(options.sameSite, "none")
        assert.equal(options.httpOnly, true)
        assert.equal(options.maxAge, 7 * 24 * 60 * 60 * 1000)
      } finally {
        if (saved.env === undefined) delete process.env.NODE_ENV
        else process.env.NODE_ENV = saved.env
        if (saved.secret === undefined) delete process.env.JWT_SECRET
        else process.env.JWT_SECRET = saved.secret
      }
    })
  })
})
