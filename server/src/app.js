import express from "express"
import cors from "cors"
import cookieParser from "cookie-parser"
import { env } from "./config/env.js"
import healthRoutes from "./routes/health.routes.js"
import authRoutes from "./routes/auth.routes.js"
import projectRoutes from "./routes/project.routes.js"
import scanRoutes from "./routes/scan.routes.js"
import deploymentRoutes from "./routes/deployment.routes.js"
import adminRoutes from "./routes/admin.routes.js"
import { errorHandler, requireDatabase } from "./middleware/database.js"
import { authLimiter } from "./middleware/security.js"

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

  // 3. Security rate limiters for auth
  app.use("/api/auth/login", authLimiter)
  app.use("/api/auth/register", authLimiter)

  // 4. Base routes
  app.use("/api/health", healthRoutes)
  app.use("/api/auth", authRoutes)

  // 5. Database-dependent feature routes (projects, scans, admin)
  // Protected with requireDatabase so they return a clean 503 if MongoDB is down.
  app.use("/api", requireDatabase)
  app.use("/api/projects", projectRoutes)
  app.use("/api", scanRoutes)
  app.use("/api", deploymentRoutes)
  app.use("/api/admin", adminRoutes)

  app.use("/api", (_req, res) =>
    res.status(404).json({ message: "Route not found" }),
  )
  app.use(errorHandler)
  return app
}
