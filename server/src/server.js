
import mongoose from "mongoose"
import { env, getJwtSecret } from "./config/env.js"
import { connectDatabase, connectionHint, disconnectDatabase } from "./config/db.js"
import { createApp } from "./app.js"

async function start() {
  try {
    getJwtSecret() // stops here in production if JWT_SECRET is missing
  } catch (error) {
    console.error(`[auth] ${error.message}`)
    process.exit(1)
  }

  try {
    const connection = await connectDatabase()
    console.log(`[db] MongoDB connected: database "${connection.name}" on ${connection.host}`)
    console.log("[db] Collections and indexes are ready")
  } catch (error) {
    console.error(`[db] MongoDB connection failed: ${error.message}`)
    console.error(`[db] Hint: ${connectionHint(error)}`)
    process.exit(1)
  }

  mongoose.connection.on("disconnected", () => console.warn("[db] MongoDB disconnected, retrying..."))
  mongoose.connection.on("reconnected", () => console.log("[db] MongoDB reconnected"))

  const server = createApp().listen(env.port, () => {
    console.log(`[server] DriftLogg API running on http://localhost:${env.port}/api`)
    console.log(`[server] Health check: http://localhost:${env.port}/api/health`)
  })

  const shutdown = async (signal) => {
    console.log(`[server] ${signal} received, shutting down`)
    server.close()
    mongoose.connection.removeAllListeners("disconnected")
    await disconnectDatabase()
    process.exit(0)
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
}

start()
