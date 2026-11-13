// Test database helper.
// Default: starts a temporary in-memory MongoDB (mongodb-memory-server), so no setup is needed.
// Optional: set TEST_MONGO_URI to use a real server. Its database name must end in "_test",
// because the test database is dropped after each test file.
import mongoose from "mongoose"
import { MongoMemoryServer } from "mongodb-memory-server"
import { getDbNameFromUri, initializeDatabase } from "../../src/config/db.js"

let memoryServer

export async function connectTestDb() {
  let uri = process.env.TEST_MONGO_URI
  let dbName = "driftlogg_test"
  if (uri) {
    dbName = getDbNameFromUri(uri) || dbName
    if (!dbName.endsWith("_test")) throw new Error(`Refusing to run tests on "${dbName}". TEST_MONGO_URI database name must end with "_test".`)
  } else {
    memoryServer = await MongoMemoryServer.create()
    uri = memoryServer.getUri()
  }
  await mongoose.connect(uri, { dbName, autoIndex: false })
  await mongoose.connection.db.dropDatabase() // start clean, before any index is created
  await initializeDatabase() // create collections + indexes
  return mongoose.connection
}

export async function clearCollections() {
  const collections = await mongoose.connection.db.collections()
  await Promise.all(collections.map((c) => c.deleteMany({})))
}

export async function disconnectTestDb() {
  if (mongoose.connection.readyState === 1) {
    if (!mongoose.connection.name.endsWith("_test")) throw new Error("Not a test database")
    await mongoose.connection.db.dropDatabase()
  }
  await mongoose.disconnect()
  if (memoryServer) await memoryServer.stop()
  memoryServer = undefined
}
