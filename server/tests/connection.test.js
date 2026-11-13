import { after, before, describe, it } from "node:test"
import assert from "node:assert/strict"
import mongoose from "mongoose"
import { connectDatabase, connectionHint, getDbNameFromUri, initializeDatabase, redactUri } from "../src/config/db.js"
import { models, User } from "../src/models/index.js"
import { connectTestDb, disconnectTestDb } from "./helpers/testDb.js"

describe("connection helpers", () => {
  it("reads the database name from a URI", () => {
    assert.equal(getDbNameFromUri("mongodb+srv://u:p@cluster0.abc.mongodb.net/driftlogg?retryWrites=true&w=majority"), "driftlogg")
    assert.equal(getDbNameFromUri("mongodb://127.0.0.1:27017/driftlogg"), "driftlogg")
    assert.equal(getDbNameFromUri("mongodb+srv://u:p@cluster0.abc.mongodb.net/?retryWrites=true"), "")
  })

  it("redacts credentials for logging", () => {
    assert.equal(redactUri("mongodb+srv://me:s3cret@cluster0.x.mongodb.net/driftlogg"), "mongodb+srv://****:****@cluster0.x.mongodb.net/driftlogg")
  })

  it("rejects a missing or placeholder MONGO_URI before connecting", async () => {
    await assert.rejects(connectDatabase(""), /MONGO_URI is not set/)
    await assert.rejects(
      connectDatabase("mongodb+srv://USERNAME:PASSWORD@CLUSTER.mongodb.net/driftlogg?retryWrites=true&w=majority"),
      /placeholders/,
    )
  })

  it("gives actionable hints for common Atlas errors", () => {
    assert.match(connectionHint(new Error("bad auth : Authentication failed.")), /username or password/)
    assert.match(connectionHint(new Error("querySrv ENOTFOUND _mongodb._tcp.cluster")), /host not found/)
    assert.match(connectionHint(new Error("Could not connect to any servers in your MongoDB Atlas cluster. ... IP that isn't whitelisted")), /Network Access/)
  })
})

describe("database initialization", () => {
  before(connectTestDb)
  after(disconnectTestDb)

  it("creates every collection automatically", async () => {
    const names = (await mongoose.connection.db.listCollections().toArray()).map((c) => c.name)
    for (const model of models) assert.ok(names.includes(model.collection.collectionName), model.modelName)
  })

  it("creates the declared indexes", async () => {
    const scanIndexes = await mongoose.connection.db.collection("scans").indexes()
    assert.ok(scanIndexes.some((i) => i.unique && i.key.project === 1 && i.key.scanNumber === -1))
    const userIndexes = await mongoose.connection.db.collection("users").indexes()
    assert.ok(userIndexes.some((i) => i.unique && i.key.email === 1))
  })

  it("is safe to run again: keeps existing data and indexes", async () => {
    await User.create({ name: "Keep Me", email: "keep@example.com", password: "hash" })
    const before = await mongoose.connection.db.collection("users").indexes()
    await initializeDatabase()
    await initializeDatabase()
    assert.equal(await User.countDocuments({ email: "keep@example.com" }), 1)
    const afterIdx = await mongoose.connection.db.collection("users").indexes()
    assert.equal(afterIdx.length, before.length)
  })
})
