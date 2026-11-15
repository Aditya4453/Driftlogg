# DriftLogg Server: Database & Authentication

This folder contains the DriftLogg backend: the MongoDB database layer and JWT cookie authentication. It follows the **"DriftLogg Backend Handover: Auth & Database Setup"** specification. This document explains **what** was built, **why** each decision was made and **how** the parts work together.

For account setup (MongoDB Atlas, Compass, deployment), see the root [`README.md`](../README.md), sections C–G.

---

## 1. What was built

| Area | What it provides |
|---|---|
| Server | Express on port 5000. CORS with credentials for `http://localhost:5173`, JSON and cookie parsers. |
| Connection | Connects to MongoDB (Atlas or local) using `MONGO_URI` from `server/.env`. |
| Initialization | Creates collections and indexes automatically on startup. Never deletes or resets data. |
| Models | The 5 handover models (User, Project, Dependency, Scan, RiskReport) with the exact contract fields, plus Workspace and Membership for teams. |
| Authentication | `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, using an httpOnly `token` cookie. |
| Auth middleware | `requireAuth` (logged-in user on `req.user`) and `requireAdmin` (Super Admin only). |
| Roles | Developer, Team Admin and Super Admin permission checks. |
| Scan history | Every scan is stored separately and numbered per project. |
| Historical reports | Risk reports are saved once and can never be edited. |
| Services | Functions for every database operation, ready for the remaining API routes. |
| Health check | `GET /api/health`, which reports only connected or disconnected. |
| Scripts | `db:check` (read-only check) and `db:demo` (optional demo data you can remove). |
| Tests | 50 automated tests on a temporary database. |

### Handover "Definition of Done"

| Checklist item | Status | Proof |
|---|---|---|
| Server starts without crashes on port 5000 | Done | `npm run dev` → `DriftLogg API running on http://localhost:5000/api` |
| MongoDB connects without auth or URI errors | Done (local MongoDB). Atlas needs your account | `[db] MongoDB connected: database "driftlogg"` |
| All 5 models with exact schemas and indexes | Done | `src/models/`, `tests/models.test.js` |
| Passwords stored hashed | Done (bcrypt, 10 rounds) | `tests/auth.test.js`: hash starts with `$2b$10$` |
| Register/Login set an httpOnly `token` cookie | Done | `tests/auth.test.js` |
| Refresh / `GET /api/auth/me` returns the user | Done | `tests/auth.test.js` |
| Logout clears the cookie | Done | `tests/auth.test.js` |

---

## 2. Folder structure

```
server/
├── .env.example                Template for .env (placeholders only, safe to commit)
├── package.json                Scripts and dependencies
├── scripts/
│   ├── db-check.js             Connects, prints document counts, changes nothing
│   └── db-demo.js              Adds or removes clearly labelled demo data
├── src/
│   ├── server.js               Entry point: check config, connect DB, start API
│   ├── app.js                  Express app: CORS, parsers, routes, error handler
│   ├── config/
│   │   ├── env.js              Loads server/.env, JWT secret rules
│   │   └── db.js               Connect, create collections/indexes, error hints
│   ├── controllers/
│   │   └── auth.controller.js  register, login, logout, me
│   ├── routes/
│   │   ├── auth.routes.js      /api/auth/*
│   │   └── health.routes.js    /api/health
│   ├── middleware/
│   │   ├── auth.js             requireAuth, requireAdmin
│   │   └── database.js         requireDatabase, validateObjectIds, errorHandler
│   ├── models/                 Mongoose schemas (one file per collection)
│   ├── services/               Database operations and permission checks
│   └── utils/
│       ├── token.js            signToken, verifyToken, sendTokenCookie, clearTokenCookie
│       └── errors.js           AppError, ObjectId check, slug helper
└── tests/                      node:test test files and the test-database helper
```

**Why this structure:** each layer has one job.
- **Routes** map URLs to controllers.
- **Controllers** read the request and send the response.
- **Services** decide what may be read or written.
- **Models** describe and validate the data.

Database logic therefore stays in one place and can be tested without an HTTP server.

---

## 3. Technology choices and why

| Package | Why |
|---|---|
| **express** (v5) | Minimal web server. v5 forwards errors from async handlers to the error handler automatically. |
| **mongoose** (v9) | Schemas, validation, references and middleware on top of MongoDB. |
| **jsonwebtoken** | Signs and verifies the login token (JWT), as in the handover. |
| **cookie-parser** | Makes `req.cookies.token` available. |
| **bcryptjs** | Password hashing in pure JavaScript, with no native build tools needed on Windows. |
| **cors** | Lets the React app on port 5173 call the API on port 5000 with cookies. |
| **dotenv** | Loads `server/.env`. |
| **nodemon** (dev) | Restarts the server on file changes (`npm run dev`). |
| **node:test, supertest, mongodb-memory-server** (dev) | Built-in test runner, HTTP testing and a throwaway MongoDB, so tests never touch real data. |

The code is plain JavaScript (ES modules), so there is no build step: `npm start` runs it directly.

---

## 4. Authentication

### 4.1 Endpoints (base `/api/auth`)

| Method & path | Body | Success | Errors |
|---|---|---|---|
| `POST /register` | `{ name, email, password }` | **201** + user, sets cookie | 400 missing fields / invalid email / email already exists |
| `POST /login` | `{ email, password }` | **200** + user, sets cookie | 401 `"Invalid email or password"` |
| `POST /logout` | — | **200** `{ "message": "Logged out successfully" }`, clears cookie | — |
| `GET /me` | cookie `token` | **200** + user | 401 no token / invalid or expired token / user no longer exists |

The user object returned (the password is always removed):
```json
{ "_id": "65e23910f1...", "name": "Alex Mercer", "email": "alex@example.com", "role": "user", "createdAt": "...", "updatedAt": "..." }
```

### 4.2 How it works

```
Register / Login ──► bcrypt hash / compare ──► jwt.sign({ id, role }, JWT_SECRET, 7d)
                                            └► res.cookie("token", jwt, httpOnly ...)
Every later request ──► browser sends the cookie automatically (withCredentials: true)
GET /me ──► requireAuth: read req.cookies.token → jwt.verify → User.findById(id).select("-password") → req.user
Logout ──► res.clearCookie("token") with the same options
```

**Cookie options** (`src/utils/token.js`, exactly as in the handover):

| | Development (localhost) | Production (`NODE_ENV=production`) |
|---|---|---|
| `httpOnly` | true | true |
| `secure` | false | true (HTTPS only) |
| `sameSite` | `lax` | `none` (frontend and API on different domains) |
| `maxAge` | 7 days | 7 days |

**Why an httpOnly cookie instead of localStorage:** JavaScript on the page cannot read an httpOnly cookie, so a cross-site-scripting bug cannot steal the token. The frontend was already built for this, since `apiClient.ts` uses `withCredentials: true`.

**Why `sameSite` changes in production:** browsers only send cookies across different domains when they are `SameSite=None` *and* `Secure`. On localhost, `Lax` works because both ports count as the same site.

**Why the CORS origin must be exact:** a browser rejects credentialed requests if the server answers with `*`. `CLIENT_URL` must therefore match the frontend's address exactly (no trailing slash). Several origins can be given, comma separated.

### 4.3 The JWT secret

- The secret comes from `JWT_SECRET` in `server/.env`.
- **Development:** if it is empty, the handover's fallback `driftlogg_secret_key_123` is used, so the project works immediately.
- **Production:** the server **refuses to start** without `JWT_SECRET`. This is the one deliberate deviation from the handover. The fallback value is public in the code, and anyone could use it to forge an admin token.

Generate a secret with:
```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### 4.4 Protecting future routes

```js
import { requireAuth, requireAdmin } from "../middleware/auth.js"

router.get("/projects", requireAuth, handler)                     // any logged-in user
router.get("/admin/stats", requireAuth, requireAdmin, handler)    // Super Admin only
```

`requireAdmin` must come after `requireAuth`. A deactivated user (`isActive: false`) is treated like a deleted user and gets 401.

---

## 5. The data model

### 5.1 Handover contract fields and extra fields

Every model contains **exactly** the fields and defaults from the handover, so code written from the handover works unchanged. For example, `Project.create({ user, name, sourceType })` and `Scan.create({ project })` both succeed. The extra fields are **optional** and are filled in by the services for teams, scan history and dashboards.

| Model | Handover fields (exact) | Extra optional fields |
|---|---|---|
| **User** | name, email (unique, lowercase), password (hash), role `user`/`admin`, timestamps | isActive, lastLoginAt |
| **Project** | name, description `""`, user (owner, indexed), sourceType, repositoryUrl `""`, status, timestamps | workspace, latestScan, lastScannedAt, summary, isArchived |
| **Dependency** | project (indexed), name, version, rawData `{}`, timestamps | scan, dependencyType |
| **Scan** | project (indexed), status, startedAt, completedAt, errorMessage, timestamps | workspace, triggeredBy, scanNumber, sourceType, repositoryUrl, durationMs, summary |
| **RiskReport** | scan, dependency (indexed), packageName, version, riskLevel, riskScore 0–100, reasons, signals { lastCommit (string), openIssues, lastRelease (string), weeklyDownloads, deprecated `false` }, suggestion `""`, timestamps | project, workspace |
| **Workspace** (extra model) | — | name, slug, description, owner, isPersonal |
| **Membership** (extra model) | — | workspace, user, role `team_admin`/`developer`, status, addedBy |

### 5.2 Relationships

```
User ─┬─< Membership >── Workspace ──< Project ──< Scan ──< Dependency
      │                                   │          └────< RiskReport >── Dependency
      └── Project.user (owner)            └── latestScan → newest completed Scan
```

### 5.3 Design decisions

**Why add Workspace and Membership?**
The handover covers single users, but DriftLogg has a Team Admin role. A user can belong to many teams with a different role in each, so the role is stored on the membership, not on the user. Every new user also gets a personal workspace, so own projects and team projects use the same code.

**Why store Dependencies per scan?**
`package.json` changes over time. Per-scan rows (`Dependency.scan`) keep exactly what each scan analysed, so re-scanning never overwrites history.

**Why does Project keep a `summary` and `latestScan`?**
Dashboards list many projects with their high/medium/low counts. Reading a stored snapshot is one query. The snapshot is refreshed whenever a scan completes or fails.

**Why are `project` and `workspace` repeated on RiskReport?**
Questions like "this package's history in this project" or "all high risks in this team" can then be answered with one indexed query.

**Why soft-delete members and archive projects?**
Old scans reference those users and projects, so deleting them would break history. Permanent project deletion (`deleteProject`) exists but only runs on an explicit request.

### 5.4 Validation

- Required fields as in the handover.
- Email format check, lowercase, unique.
- Passwords are stored only as bcrypt hashes (10 rounds). The user's JSON never contains the `password` field.
- Allowed values (enums) for every status, role, risk level and source type.
- `riskScore` between 0 and 100.
- Project names are unique per workspace, ignoring upper/lower case. This only applies to projects that have a workspace.

---

## 6. Roles and permissions

| Role | How it is stored | What it allows |
|---|---|---|
| Developer | `User.role = "user"`, `Membership.role = "developer"` | Own projects and reports. Can view projects of their teams. |
| Team Admin | `Membership.role = "team_admin"` | Manage team projects and team members. |
| Super Admin | `User.role = "admin"` | All users, all teams, global statistics. |

`user`/`admin` are the values from the handover and the React app (`currentUser.role === "admin"`).

Checks in `src/services/access.service.js`:

| Check | Allowed when |
|---|---|
| View project | Super Admin, **or** `project.user` (owner), **or** active member of the project's workspace |
| Change/delete project | Super Admin, **or** owner, **or** Team Admin of that workspace |
| Manage members | Super Admin, **or** Team Admin of that workspace |
| Global statistics / all users | Super Admin only (`requireAdmin` at route level) |

Safety rules:
- A workspace always keeps at least one Team Admin.
- The workspace owner cannot be removed.
- New users always start as Developers.

---

## 7. How a scan is stored

```
startScan()            → Scan #N created (status "queued"), project status "analyzing",
                          dependencies saved from package.json (if given)
markScanProcessing()   → status "processing"
saveDependencies()     → (optional) add more packages
completeScan(results)  → one RiskReport per package, scan summary calculated,
                          status "completed", project snapshot updated
   or failScan(msg)    → status "failed", error saved, previous results kept
```

How each part is handled:
- **Scan numbers:** a unique index on `{project, scanNumber}` plus retry handles scans started at the same moment (tested with 4 in parallel).
- **Finished scans are closed:** a completed or failed scan cannot be completed again (409).
- **Partial failure cleanup:** if saving reports fails halfway, only that scan's partial reports are removed and the scan is marked failed.
- **Failed scans don't hide good data:** the project keeps pointing to its last successful scan.
- **Risk level input is flexible:** `"High"` and `"high"` are both accepted and stored as lowercase.

**Reports are protected:** every RiskReport field is `immutable`, and update queries (`updateOne`, `findOneAndUpdate`, …) are blocked by middleware. A risk report records what was true at scan time, so editing it would make the history untrustworthy.

| Function | Returns |
|---|---|
| `listProjectScans` | All scans of a project, newest first |
| `getLatestProjectReport` | Reports of the newest completed scan, highest risk first |
| `getScanReports` | Reports of any one past scan |
| `getPackageRiskHistory` | One package's score across all scans |
| `getProjectRiskTrend` | High/medium/low counts per scan, for charts |

---

## 8. Indexes

| Collection | Index | Used for |
|---|---|---|
| users | `{email}` unique | Login lookup, no duplicate accounts |
| projects | `{user}`; `{user, updatedAt}` | "My projects" |
| projects | `{workspace, name}` unique (case-insensitive, only when workspace is set) | No duplicate names in a team |
| memberships | `{workspace, user}` unique; `{user, status}` | One membership per person per team; "my teams" |
| scans | `{project}`; `{project, scanNumber}` unique; `{project, status, completedAt}` | History and latest scan |
| dependencies | `{project}`; `{scan, name, dependencyType}` unique (only when scan is set) | One row per package per scan |
| riskreports | `{scan}`; `{dependency}`; `{scan, dependency}` unique; `{scan, riskScore}`; `{project, packageName, createdAt}` | Reports per scan, severity order, package history |
| workspaces | `{slug}` unique | Stable team identifier |

---

## 9. Startup and safety

What happens on `npm run dev` / `npm start`:
1. `config/env.js` loads `server/.env`, whichever folder you run the command from.
2. In production, the server stops if `JWT_SECRET` is missing.
3. `MONGO_URI` is checked. If it is missing or still has the `USERNAME:PASSWORD@CLUSTER` placeholders, the server stops with a clear message.
4. Mongoose connects. The database name comes from the URI, or defaults to `driftlogg` (never MongoDB's default `test`).
5. For each model, the collection is created if missing (`Model.init()`) and missing indexes are added (`Model.createIndexes()`).
6. The API starts listening on `PORT` (5000).

**Why `createIndexes` and not `syncIndexes`:** `syncIndexes` deletes indexes that are not in the code. `createIndexes` only adds. If an older index with different options already exists, the server logs a warning and keeps it, instead of crashing or dropping it.

What the startup never does: drop the database, delete records, insert seed data or reset anything.

**Error hints:** common Atlas failures are translated into plain advice, for example:
- `bad auth` → check the username and password, and URL-encode special characters
- `ENOTFOUND` → check the cluster address
- `timed out` → add your IP in Atlas Network Access

**Credentials are never logged.**

---

## 10. Errors and health check

| Error | Response |
|---|---|
| Service `AppError` | Its own status (400/401/403/404/409/503) with `{ message }` |
| Mongoose validation error | 400 `{ message: "Validation failed", errors: [...] }` |
| Invalid ObjectId | 400 |
| Duplicate key | 409 (duplicate email on register returns 400, as in the handover) |
| Invalid JSON body | 400 |
| Anything unexpected | 500 `"Internal server error"`. Details are logged only on the server. |

**Database down:** `/api` routes return **503** instead of hanging. `POST /api/auth/logout` still works.

**Health check:** `GET /api/health` returns `200 {"status":"ok","database":"connected"}`, or `503 {"status":"degraded","database":"disconnected"}`. It never includes a host, database name or connection string.

---

## 11. Adding the remaining API routes

The frontend also calls `/projects`, `/projects/:id/scans`, `/scans/:id`, `/projects/:id/report` and `/admin/*`. These were not part of the handover. The services for them already exist, so each route only needs a few lines:

```js
// src/routes/project.routes.js (example)
import { Router } from "express"
import { requireAuth } from "../middleware/auth.js"
import { validateObjectIds } from "../middleware/database.js"
import { createProject, getProjectForUser, listProjectsForUser } from "../services/index.js"

const router = Router()
router.use(requireAuth)

router.get("/", async (req, res) => res.json(await listProjectsForUser(req.user)))
router.post("/", async (req, res) => res.status(201).json(await createProject(req.user, req.body)))
router.get("/:projectId", validateObjectIds("projectId"), async (req, res) =>
  res.json(await getProjectForUser(req.user, req.params.projectId)),
)
export default router

// src/app.js, below app.use("/api", requireDatabase):
// app.use("/api/projects", projectRoutes)
```

Services take the logged-in user as their first argument and check permissions themselves. Errors they throw reach the error handler automatically.

---

## 12. Scripts

Run these inside `server/`:

| Command | What it does |
|---|---|
| `npm run dev` | Start with nodemon (auto-restart on file changes) |
| `npm start` | Start normally (production) |
| `npm test` | Run all tests on a temporary database |
| `npm run db:check` | Read-only: connection status, document counts, recent scans |
| `npm run db:demo` | Add demo users, team, project and **one new scan** per run |
| `npm run db:demo:remove` | Delete only the demo data (emails ending `@driftlogg.local`) |

### Trying auth by hand (PowerShell, server running)

```powershell
$s = New-Object Microsoft.PowerShell.Commands.WebRequestSession
Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/auth/register -WebSession $s -ContentType "application/json" -Body '{"name":"Alex Mercer","email":"alex@example.com","password":"Password123"}'
Invoke-RestMethod -Uri http://localhost:5000/api/auth/me -WebSession $s
Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/auth/logout -WebSession $s
```

In Postman, send the same requests. The `token` cookie appears under **Cookies** and is marked HttpOnly.

---

## 13. Tests

| File | Tests | Covers |
|---|---|---|
| `auth.test.js` | 12 | Register/login/logout/me, hashing, cookie flags, 400/401 cases, JWT payload and expiry, CORS, requireAdmin, production cookie and secret rules |
| `connection.test.js` | 7 | URI parsing, placeholder detection, error hints, automatic collections and indexes, safe re-initialization |
| `models.test.js` | 12 | Handover contracts and defaults, validation, unique indexes, immutable reports |
| `services.test.js` | 16 | Registration, memberships, all three roles, scan history, reports, failures, parallel scans, archive and delete |
| `health.test.js` | 3 | Health endpoint, error mapping, 503 when the database is down |

Result: **50 passed, 0 failed.** The suite was run on an in-memory MongoDB and on a local MongoDB 8.0 server.

**Test safety:**
- By default the tests start their own temporary MongoDB. The first run downloads it once (about 100 MB).
- If `TEST_MONGO_URI` is set, its database name must end in `_test`, or the tests refuse to run.

---

## 14. Environment variables (`server/.env`)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `MONGO_URI` | yes | — | MongoDB connection string (line 7 of `.env.example`) |
| `JWT_SECRET` | yes in production | dev-only fallback | Signs login tokens |
| `CLIENT_URL` | no | `http://localhost:5173` | Frontend origin(s) for CORS, comma separated (`CLIENT_ORIGIN` also accepted) |
| `PORT` | no | `5000` | API port |
| `NODE_ENV` | no | `development` | Set `production` when deployed (enables Secure/SameSite=None cookies) |
| `MONGO_DB_NAME` | no | from URI, else `driftlogg` | Override the database name |
| `TEST_MONGO_URI` | no | in-memory | Optional real server for tests (name must end in `_test`) |

`server/.env` is ignored by Git. Only `.env.example`, which holds placeholders, is committed.

**Deployment:** set `MONGO_URI`, `JWT_SECRET`, `CLIENT_URL` (your deployed frontend URL) and `NODE_ENV=production` in the hosting dashboard. Both frontend and backend must use **HTTPS** in production, or the browser will drop the cookie.

---

## 15. Current limitations

- **Not built yet:** project, scan and admin API routes. The frontend calls them, but the handover doesn't include them. Their services exist (see section 11).
- **No multi-document transactions.** Related writes run one after another, with cleanup if a step fails. This works on both local standalone MongoDB and Atlas.

- **Root README is out of date.** It was written before the auth module and still mentions `passwordHash` and `CLIENT_ORIGIN`. This file is the current reference for the server.
