import { after, before, describe, it } from "node:test"
import assert from "node:assert/strict"
import request from "supertest"
import mongoose from "mongoose"
import { createApp } from "../src/app.js"
import { errorHandler } from "../src/middleware/database.js"
import { connectTestDb, disconnectTestDb } from "./helpers/testDb.js"

describe("health endpoint and database middleware", () => {
  const app = createApp()
  before(connectTestDb)
  after(disconnectTestDb)

  it("reports a connected database without exposing details", async () => {
    const res = await request(app).get("/api/health").expect(200)
    assert.deepEqual(res.body, { status: "ok", database: "connected" })
    assert.doesNotMatch(JSON.stringify(res.body), /mongodb|127\.0\.0\.1|driftlogg/)
  })

  it("maps database errors to clean HTTP responses", () => {
    const send = (error) => {
      const res = { code: 0, body: null, status(c) { this.code = c; return this }, json(b) { this.body = b; return this } }
      errorHandler(error, {}, res, () => {})
      return res
    }
    const validation = new mongoose.Error.ValidationError()
    validation.addError("email", new mongoose.Error.ValidatorError({ message: "Email is invalid", path: "email" }))
    assert.equal(send(validation).code, 400)
    assert.deepEqual(send(validation).body.errors, ["Email is invalid"])
    assert.equal(send(Object.assign(new Error("E11000 dup"), { code: 11000 })).code, 409)
    const original = console.error
    console.error = () => {}
    const internal = send(new Error("secret internal detail"))
    console.error = original
    assert.equal(internal.code, 500)
    assert.doesNotMatch(JSON.stringify(internal.body), /secret/)
  })

  it("returns 503 when the database is disconnected", async () => {
    await mongoose.disconnect()
    const res = await request(app).get("/api/health").expect(503)
    assert.equal(res.body.database, "disconnected")
    await request(app).get("/api/projects").expect(503)
  })
})
