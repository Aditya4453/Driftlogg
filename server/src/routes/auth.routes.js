import { Router } from "express"
import { login, logout, me, register } from "../controllers/auth.controller.js"
import { requireAuth } from "../middleware/auth.js"
import { requireDatabase } from "../middleware/database.js"

const router = Router()

router.post("/register", requireDatabase, register)
router.post("/login", requireDatabase, login)
router.post("/logout", logout) // works even if the database is down
router.get("/me", requireDatabase, requireAuth, me)

export default router
