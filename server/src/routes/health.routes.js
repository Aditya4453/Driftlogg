import { Router } from "express"
import mongoose from "mongoose"
import { isDatabaseConnected } from "../config/db.js"

const router = Router()

// GET /api/health -> { status, database }. Exposes no hosts, names or credentials.
router.get("/", async (_req, res) => {
  let database = "disconnected"
  if (isDatabaseConnected()) {
    try {
      await mongoose.connection.db.admin().ping()
      database = "connected"
    } catch {
      database = "unreachable"
    }
  }
  const ok = database === "connected"
  res.status(ok ? 200 : 503).json({ status: ok ? "ok" : "degraded", database })
})

export default router
