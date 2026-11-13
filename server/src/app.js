import express from "express"
import cors from "cors"
import cookieParser from "cookie-parser"
import { env } from "./config/env.js"
import healthRoutes from "./routes/health.routes.js"
import authRoutes from "./routes/auth.routes.js"
import { errorHandler, requireDatabase } from "./middleware/database.js"

export function createApp() {
  const app = express()

  // 1. CORS: must allow credentials and name the frontend origin (cookies will not work otherwise)
  app.use(
    cors({
      origin: env.clientUrl.split(",").map((o) => o.trim()),
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    }),
  )

  // 2. Body and cookie parsers
  app.use(express.json({ limit: "1mb" }))
  app.use(cookieParser())

  // 3. Routes
  app.use("/api/health", healthRoutes)
  app.use("/api/auth", authRoutes)

  // Further feature routes (projects, scans, admin) mount below this guard so they
  // get a clean 503 if MongoDB is down. They call the services in src/services.
  app.use("/api", requireDatabase)

  app.use("/api", (_req, res) => res.status(404).json({ message: "Route not found" }))
  app.use(errorHandler)
  return app
}
