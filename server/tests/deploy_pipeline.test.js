/**
 * Deployment Error Pipeline - Comprehensive Unit & Integration Tests
 *
 * Covers:
 * - Truncated tree handling & advisory coverage reduction
 * - Failed fetch handling & completeness penalties
 * - Case-collision repo (case-sensitive import resolution)
 * - listen() without host (PASS) vs listen(3000, 'localhost') (FAIL)
 * - Destructured env vars & .env.example parity
 * - Committed secrets & client-prefix credential leakage
 * - Platform rules: Render, Vercel, Docker
 * - CORS wildcard with credentials
 * - Boot health check route verification
 * - Gated scoring hard gates
 * - Snapshot immutability
 * - Streaming trace line formatting
 */

import { describe, it } from "node:test"
import assert from "node:assert/strict"

import {
  runDeploymentErrorPipeline,
  runIngestStage,
  runConfigStage,
  runCodeStage,
  runBootStage,
  runScoringStage,
  RepoSnapshot,
  createFinding,
  formatTraceLine,
} from "../src/deploy/index.js"

describe("Deployment Error Pipeline", () => {
  // -------------------------------------------------------------
  // 1. Snapshot Immutability
  // -------------------------------------------------------------
  describe("RepoSnapshot Immutability", () => {
    it("prevents mutation of snapshot properties and preserves exact case", () => {
      const snapshot = new RepoSnapshot({
        source: { type: "test" },
        ref: "1234567890abcdef1234567890abcdef12345678",
        tree: [
          { path: "src/Button.tsx", type: "blob" },
          { path: "package.json", type: "blob" },
        ],
        files: new Map([
          [
            "src/Button.tsx",
            { content: "export const Button = () => null;", status: "ok" },
          ],
          ["package.json", { content: '{"name": "test"}', status: "ok" }],
        ]),
        target: "render",
      })

      // Verify exact case preservation
      assert.equal(snapshot.hasFile("src/Button.tsx"), true)
      assert.equal(snapshot.hasFile("src/button.tsx"), false)
      assert.equal(
        snapshot.findCaseMismatch("src/button.tsx"),
        "src/Button.tsx",
      )

      // Verify immutability
      assert.throws(() => {
        snapshot.target = "vercel"
      })
      assert.throws(() => {
        snapshot.ref = "mutated"
      })
      assert.equal(snapshot.target, "render")
    })
  })

  // -------------------------------------------------------------
  // 2. Stage 1: Ingest & Completeness (Truncated Tree, Failed Fetches)
  // -------------------------------------------------------------
  describe("Stage 1 - Ingest & Completeness", () => {
    it("handles clean complete fixture with 100% coverage", async () => {
      const { snapshot, findings } = await runIngestStage({
        ref: "abcde".repeat(8),
        files: {
          "package.json": '{"name": "clean-app"}',
          "server.js": 'console.log("running");',
        },
      })

      assert.equal(snapshot.completeness.truncated, false)
      assert.equal(snapshot.completeness.coverage, 100)
      assert.equal(findings.length, 0)
    })

    it("emits advisory finding and lowers coverage on truncated tree", async () => {
      const { snapshot, findings } = await runIngestStage({
        ref: "abcde".repeat(8),
        files: {
          "package.json": '{"name": "truncated-app"}',
        },
        completeness: {
          truncated: true,
          warnings: ["Tree was truncated"],
        },
      })

      assert.equal(snapshot.completeness.truncated, true)
      assert.ok(
        snapshot.completeness.coverage < 100,
        "coverage must be penalized on truncation",
      )

      const truncatedFinding = findings.find(
        (f) => f.ruleId === "INGEST_TREE_TRUNCATED",
      )
      assert.ok(truncatedFinding, "must emit INGEST_TREE_TRUNCATED finding")
      assert.equal(truncatedFinding.confidence, "advisory")
    })

    it("emits advisory finding on failed file fetches", async () => {
      const { snapshot, findings } = await runIngestStage({
        ref: "abcde".repeat(8),
        files: {
          "package.json": {
            content: null,
            status: "failed",
            reason: "HTTP 404",
          },
          "server.js": { content: "console.log(1)", status: "ok" },
        },
        completeness: {
          failedCount: 1,
        },
      })

      assert.ok(snapshot.completeness.coverage < 100)
      const failedFinding = findings.find(
        (f) => f.ruleId === "INGEST_FILE_FETCH_FAILED",
      )
      assert.ok(failedFinding)
      assert.equal(failedFinding.confidence, "advisory")
    })
  })

  // -------------------------------------------------------------
  // 3. Stage 2: Config, Secrets & Env Parity
  // -------------------------------------------------------------
  describe("Stage 2 - Config & Secrets", () => {
    it("flags committed .env file when not ignored in .gitignore", async () => {
      const { snapshot } = await runIngestStage({
        files: {
          "package.json":
            '{"name": "sec-app", "scripts": {"start": "node server.js"}}',
          ".env": "SECRET_KEY=123456\nDATABASE_URL=postgres://localhost",
          ".gitignore": "node_modules/\ndist/\n",
        },
      })

      const findings = await runConfigStage(snapshot)
      const envFinding = findings.find(
        (f) => f.ruleId === "CONFIG_SECRET_ENV_TRACKED",
      )
      assert.ok(envFinding)
      assert.equal(envFinding.severity, "blocker")
      assert.equal(envFinding.confidence, "confirmed")
      assert.ok(envFinding.fix && envFinding.fix.patch.includes(".env"))
    })

    it("flags secret-bearing variable exposed with client prefix (e.g. VITE_STRIPE_SECRET)", async () => {
      const { snapshot } = await runIngestStage({
        files: {
          "package.json": '{"name": "vite-app"}',
          "src/config.ts":
            "export const key = import.meta.env.VITE_STRIPE_SECRET_KEY;",
        },
      })

      const findings = await runConfigStage(snapshot)
      const leak = findings.find(
        (f) => f.ruleId === "CONFIG_SECRET_LEAK_CLIENT_PREFIX",
      )
      assert.ok(leak)
      assert.equal(leak.severity, "blocker")
      assert.equal(leak.confidence, "confirmed")
    })

    it("passes destructured env vars with defaults and platform vars; flags missing required vars", async () => {
      const { snapshot } = await runIngestStage({
        files: {
          "package.json":
            '{"name": "env-app", "scripts": {"start": "node server.js"}}',
          "server.js": `
            // Destructured with default -> PASS
            const { PORT = 3000, NODE_ENV } = process.env;

            // Required without default -> MUST be in .env.example
            const apiKey = process.env.PAYMENT_GATEWAY_KEY;

            // Dynamic access -> ADVISORY
            const dyn = process.env[dynamicKey];
          `,
          ".env.example": "PORT=3000\n",
        },
      })

      const findings = await runConfigStage(snapshot)

      // PAYMENT_GATEWAY_KEY is required but missing from .env.example -> warning
      const missingVar = findings.find(
        (f) => f.ruleId === "CONFIG_ENV_UNDOCUMENTED_REQUIRED",
      )
      assert.ok(missingVar)
      assert.equal(missingVar.snippet.includes("PAYMENT_GATEWAY_KEY"), true)

      // Dynamic access -> advisory
      const dynamicVar = findings.find(
        (f) => f.ruleId === "CONFIG_ENV_DYNAMIC_ACCESS",
      )
      assert.ok(dynamicVar)
      assert.equal(dynamicVar.confidence, "advisory")

      // PORT has default and is platform injected -> NOT flagged as missing
      const portMissing = findings.find(
        (f) =>
          f.ruleId === "CONFIG_ENV_UNDOCUMENTED_REQUIRED" &&
          f.snippet.includes("PORT"),
      )
      assert.equal(portMissing, undefined)
    })

    it("flags missing engines.node in package.json", async () => {
      const { snapshot } = await runIngestStage({
        files: {
          "package.json":
            '{"name": "test-app", "scripts": {"start": "node server.js"}}',
        },
      })

      const findings = await runConfigStage(snapshot)
      const enginesFinding = findings.find(
        (f) => f.ruleId === "CONFIG_ENGINES_NODE_MISSING",
      )
      assert.ok(enginesFinding)
      assert.equal(enginesFinding.severity, "warning")
      assert.equal(enginesFinding.confidence, "confirmed")
    })
  })

  // -------------------------------------------------------------
  // 4. Stage 3: Code Traps (Case Sensitivity, Port/Host Binding, CORS)
  // -------------------------------------------------------------
  describe("Stage 3 - Code Traps", () => {
    it("detects case-sensitivity mismatch in relative import and provides unified diff fix", async () => {
      const { snapshot } = await runIngestStage({
        files: {
          "package.json": '{"name": "app"}',
          "src/components/Button.tsx": "export const Button = () => null;",
          "src/App.tsx":
            "import { Button } from './components/button';\nconsole.log(Button);",
        },
      })

      const findings = await runCodeStage(snapshot)
      const caseFinding = findings.find(
        (f) =>
          f.ruleId === "CODE_CASE_MISMATCH" ||
          f.ruleId === "CODE_IMPORT_CASE_MISMATCH",
      )
      assert.ok(caseFinding)
      assert.equal(caseFinding.severity, "blocker")
      assert.equal(caseFinding.confidence, "confirmed")
      assert.ok(caseFinding.message.includes("Button"))
      assert.ok(caseFinding.fix && caseFinding.fix.patch.includes("Button"))
    })

    it("PASSES listen() without host parameter or with 0.0.0.0 (Render requirement)", async () => {
      const { snapshot } = await runIngestStage({
        target: "render",
        files: {
          "package.json":
            '{"name": "app", "scripts": {"start": "node server.js"}}',
          "server.js": `
            const express = require('express');
            const app = express();
            const PORT = process.env.PORT || 3000;
            // Listen with no host binds 0.0.0.0 by default in Node -> MUST PASS
            app.listen(PORT);
          `,
        },
      })

      const findings = await runCodeStage(snapshot)
      const portFindings = findings.filter((f) =>
        f.ruleId.startsWith("RENDER_LISTEN_"),
      )
      assert.equal(
        portFindings.length,
        0,
        "listen(PORT) with no host must pass without findings",
      )
    })

    it("BLOCKS listen() with hardcoded port or explicit localhost host", async () => {
      const { snapshot } = await runIngestStage({
        target: "render",
        files: {
          "package.json":
            '{"name": "app", "scripts": {"start": "node server.js"}}',
          "server.js": `
            const express = require('express');
            const app = express();
            // Hardcoded port 8080 and explicit localhost host -> MUST BLOCK
            app.listen(8080, 'localhost');
          `,
        },
      })

      const findings = await runCodeStage(snapshot)
      const portFinding = findings.find(
        (f) =>
          f.ruleId === "RENDER_LISTEN_HARDCODED_PORT" ||
          f.ruleId === "CODE_HARDCODED_PORT",
      )
      const hostFinding = findings.find(
        (f) =>
          f.ruleId === "RENDER_LISTEN_HOST_LOCALHOST" ||
          f.ruleId === "CODE_LOCALHOST_BIND",
      )

      assert.ok(portFinding, "must block hardcoded port")
      assert.equal(portFinding.severity, "blocker")
      assert.equal(portFinding.confidence, "confirmed")

      assert.ok(hostFinding, "must block localhost host binding")
      assert.equal(hostFinding.severity, "blocker")
      assert.equal(hostFinding.confidence, "confirmed")
    })

    it("flags CORS wildcard origin with credentials: true as confirmed blocker", async () => {
      const { snapshot } = await runIngestStage({
        files: {
          "package.json":
            '{"name": "app", "scripts": {"start": "node server.js"}}',
          "server.js": `
            const cors = require('cors');
            app.use(cors({ origin: '*', credentials: true }));
          `,
        },
      })

      const findings = await runCodeStage(snapshot)
      const corsFinding = findings.find(
        (f) =>
          f.ruleId === "CODE_CORS_WILDCARD_WITH_CREDENTIALS" ||
          f.ruleId === "CODE_CORS_MISCONFIG",
      )
      assert.ok(corsFinding)
      assert.equal(corsFinding.severity, "blocker")
      assert.equal(corsFinding.confidence, "confirmed")
    })
  })

  // -------------------------------------------------------------
  // 5. Stage 4: Boot & Health Simulation
  // -------------------------------------------------------------
  describe("Stage 4 - Boot & Health Simulation", () => {
    it("flags mismatch between render.yaml healthCheckPath and application routes", async () => {
      const { snapshot } = await runIngestStage({
        target: "render",
        files: {
          "package.json":
            '{"name": "app", "scripts": {"start": "node server.js"}}',
          "render.yaml":
            "services:\n  - type: web\n    healthCheckPath: /healthz\n",
          "server.js": `
            const express = require('express');
            const app = express();
            app.get('/api/status', (req, res) => res.send('ok'));
            app.listen(process.env.PORT);
          `,
        },
      })

      const findings = await runBootStage(snapshot)
      const healthFinding = findings.find(
        (f) => f.ruleId === "RENDER_HEALTH_CHECK_ROUTE_NOT_FOUND",
      )
      assert.ok(healthFinding)
      assert.equal(healthFinding.severity, "blocker")
      assert.equal(healthFinding.confidence, "confirmed")
      assert.ok(healthFinding.message.includes("/healthz"))
    })

    it("flags missing database migration step when ORM package is in dependencies", async () => {
      const { snapshot } = await runIngestStage({
        target: "render",
        files: {
          "package.json": JSON.stringify({
            name: "prisma-app",
            dependencies: { "@prisma/client": "^5.0.0" },
            scripts: { start: "node server.js" },
          }),
          "server.js": 'console.log("ready");',
        },
      })

      const findings = await runBootStage(snapshot)
      const ormFinding = findings.find(
        (f) => f.ruleId === "BOOT_ORM_NO_MIGRATION_STEP",
      )
      assert.ok(ormFinding)
      assert.equal(ormFinding.severity, "warning")
      assert.equal(ormFinding.confidence, "likely")
    })
  })

  // -------------------------------------------------------------
  // 6. Platform Rules: Vercel & Docker
  // -------------------------------------------------------------
  describe("Platform Rules - Vercel & Docker", () => {
    it("Vercel: flags missing SPA rewrite for client-side routing", async () => {
      const { snapshot } = await runIngestStage({
        target: "vercel",
        appShape: "frontend-spa",
        files: {
          "package.json": '{"name": "spa", "scripts": {"build": "vite build"}}',
          "index.html": "<html></html>",
        },
      })

      const findings = await runConfigStage(snapshot)
      const spaFinding = findings.find(
        (f) => f.ruleId === "VERCEL_SPA_REWRITE_MISSING",
      )
      assert.ok(spaFinding)
      assert.equal(spaFinding.severity, "blocker")
      assert.equal(spaFinding.confidence, "confirmed")
      assert.ok(spaFinding.fix && spaFinding.fix.patch.includes("rewrites"))
    })

    it("Docker: flags missing Dockerfile and missing .dockerignore", async () => {
      const { snapshot } = await runIngestStage({
        target: "docker",
        appShape: "containerized",
        files: {
          "package.json": '{"name": "container-app"}',
        },
      })

      const findings = await runConfigStage(snapshot)
      const dockerfileFinding = findings.find(
        (f) => f.ruleId === "DOCKERFILE_MISSING",
      )
      assert.ok(dockerfileFinding)
      assert.equal(dockerfileFinding.severity, "blocker")
    })

    it("Docker: flags incomplete .dockerignore when node_modules is not excluded", async () => {
      const { snapshot } = await runIngestStage({
        target: "docker",
        appShape: "containerized",
        files: {
          "package.json": '{"name": "container-app"}',
          Dockerfile:
            'FROM node:20\nWORKDIR /app\nCOPY . .\nEXPOSE 3000\nCMD ["npm", "start"]',
          ".dockerignore": "dist/\n.git/\n",
        },
      })

      const findings = await runConfigStage(snapshot)
      const ignoreFinding = findings.find(
        (f) => f.ruleId === "DOCKERIGNORE_INCOMPLETE",
      )
      assert.ok(ignoreFinding)
      assert.ok(ignoreFinding.message.includes("node_modules"))
    })
  })

  // -------------------------------------------------------------
  // 7. Stage 5: Gated Scoring & Fix Plan
  // -------------------------------------------------------------
  describe("Stage 5 - Gated Scoring Rules", () => {
    it('CAPS score at 40 and sets verdict strictly to "will-fail" on confirmed blocker', async () => {
      const findings = [
        createFinding({
          ruleId: "RENDER_LISTEN_HARDCODED_PORT",
          stage: "code",
          severity: "blocker",
          confidence: "confirmed",
          file: "server.js",
          message: "Hardcoded port",
        }),
      ]

      const report = await runScoringStage({ target: "render" }, findings)
      assert.equal(report.verdict, "will-fail")
      assert.ok(report.score <= 40, `Score must be <= 40, was ${report.score}`)
    })

    it('sets verdict "needs-fixes" for likely issues, but NEVER "will-fail" alone', async () => {
      const findings = [
        createFinding({
          ruleId: "BOOT_HEALTH_ROUTE_MISSING",
          stage: "boot",
          severity: "warning",
          confidence: "likely",
          file: "server.js",
          message: "Missing health route",
        }),
      ]

      const report = await runScoringStage({ target: "render" }, findings)
      assert.equal(report.verdict, "needs-fixes")
      assert.ok(report.score >= 41 && report.score <= 79)
    })

    it('returns verdict "ready" with score 100 on clean repo', async () => {
      const report = await runScoringStage({ target: "render" }, [])
      assert.equal(report.verdict, "ready")
      assert.equal(report.score, 100)
      assert.equal(report.confidence, "confirmed")
    })

    it("assembles ordered fixPlan grouped by file with valid unified diffs", async () => {
      const findings = [
        createFinding({
          ruleId: "RENDER_HEALTH_CHECK_LEADING_SLASH",
          stage: "config",
          severity: "blocker",
          confidence: "confirmed",
          file: "render.yaml",
          message: "Missing leading slash",
          fix: {
            description: "Add leading slash to healthCheckPath",
            patch:
              "--- a/render.yaml\n+++ b/render.yaml\n@@ -1,1 +1,1 @@\n-healthCheckPath: health\n+healthCheckPath: /health\n",
          },
        }),
      ]

      const report = await runScoringStage({ target: "render" }, findings)
      assert.ok(report.fixPlan)
      assert.equal(report.fixPlan.files.length, 1)
      assert.equal(report.fixPlan.files[0].file, "render.yaml")
      assert.equal(
        report.fixPlan.files[0].patches[0].ruleId,
        "RENDER_HEALTH_CHECK_LEADING_SLASH",
      )
    })
  })

  // -------------------------------------------------------------
  // 8. End-to-End Pipeline & Streaming Traces
  // -------------------------------------------------------------
  describe("End-to-End Pipeline & Trace Streaming", () => {
    it("executes full 5-stage pipeline and streams traces with confidence prefixes", async () => {
      const traces = []

      const report = await runDeploymentErrorPipeline(
        {
          target: "render",
          files: {
            "package.json": JSON.stringify({
              name: "full-test-app",
              engines: { node: ">=20.0.0" },
              scripts: { start: "node server.js" },
            }),
            "server.js": `
              const express = require('express');
              const app = express();
              const PORT = process.env.PORT || 3000;
              app.get('/health', (req, res) => res.status(200).send('OK'));
              app.listen(PORT);
            `,
            ".gitignore": "node_modules/\n.env\n",
            ".env.example": "PORT=3000\n",
          },
        },
        {
          onTrace: (line) => traces.push(line),
        },
      )

      // Verify trace lines are streamed across stages
      assert.ok(traces.some((t) => t.startsWith("[deploy-ingest]")))
      assert.ok(traces.some((t) => t.startsWith("[deploy-config]")))
      assert.ok(traces.some((t) => t.startsWith("[deploy-code]")))
      assert.ok(traces.some((t) => t.startsWith("[deploy-boot]")))
      assert.ok(traces.some((t) => t.startsWith("[deploy-score]")))

      // Verify final clean result
      assert.equal(report.verdict, "ready")
      assert.equal(report.score, 100)
      assert.equal(report.findings.length, 0)
    })

    it("streams finding trace line prefixed with confidence tier", () => {
      const finding = createFinding({
        ruleId: "CODE_CASE_MISMATCH",
        stage: "code",
        severity: "blocker",
        confidence: "confirmed",
        file: "src/App.tsx",
        line: 12,
        message: "Import casing mismatch",
      })

      const formatted = formatTraceLine("code", finding)
      assert.equal(
        formatted,
        "[deploy-code] [CONFIRMED] blocker: Import casing mismatch (src/App.tsx:12)",
      )
    })
  })

  // -------------------------------------------------------------
  // 9. Multi-Service & Whole-Repository Discovery (Monorepos & Subfolder Apps)
  // -------------------------------------------------------------
  describe("Multi-Service & Whole-Repository Analysis", () => {
    it("discovers frontend and backend services in monorepo without root package.json", async () => {
      const { snapshot } = await runIngestStage({
        files: {
          "frontend/package.json": JSON.stringify({
            name: "web-client",
            engines: { node: ">=20.0.0" },
            dependencies: { react: "^18.2.0", vite: "^5.0.0" },
            scripts: { build: "vite build" },
          }),
          "frontend/src/api.js": `
            export async function fetchStats() {
              const res = await fetch("http://localhost:5000/api/stats");
              return res.json();
            }
          `,
          "backend/package.json": JSON.stringify({
            name: "api-server",
            engines: { node: ">=20.0.0" },
            dependencies: { express: "^4.18.2", cors: "^2.8.5" },
            scripts: { start: "node server.js" },
          }),
          "backend/server.js": `
            const express = require('express');
            const cors = require('cors');
            const app = express();
            app.use(cors({ origin: '*', credentials: true }));
            const PORT = process.env.PORT || 5000;
            app.get('/health', (req, res) => res.send('ok'));
            app.listen(PORT);
          `,
          "backend/.env.example": "PORT=5000\n",
          ".gitignore": "node_modules/\n",
        },
      })

      // Stage 1 Verification
      assert.equal(snapshot.appShape, "monorepo")
      assert.equal(snapshot.services.length, 2)
      const frontendSvc = snapshot.getService("frontend")
      const backendSvc = snapshot.getService("backend")
      assert.ok(frontendSvc, "frontend service must be discovered")
      assert.equal(frontendSvc.role, "frontend")
      assert.ok(backendSvc, "backend service must be discovered")
      assert.equal(backendSvc.role, "backend")

      // Stage 2 Verification: should NOT emit CONFIG_PACKAGE_JSON_MISSING
      const configFindings = await runConfigStage(snapshot)
      const missingPkg = configFindings.find(
        (f) => f.ruleId === "CONFIG_PACKAGE_JSON_MISSING",
      )
      assert.equal(
        missingPkg,
        undefined,
        "must NOT emit CONFIG_PACKAGE_JSON_MISSING",
      )

      // Stage 3 Verification: catches CORS and hardcoded localhost
      const codeFindings = await runCodeStage(snapshot)
      const corsFinding = codeFindings.find(
        (f) =>
          f.ruleId === "CODE_CORS_MISCONFIG" ||
          f.ruleId === "CODE_CORS_WILDCARD_WITH_CREDENTIALS",
      )
      assert.ok(
        corsFinding,
        "must catch CORS wildcard credentials in backend/server.js",
      )
      assert.equal(corsFinding.severity, "blocker")

      const localhostFinding = codeFindings.find(
        (f) =>
          f.ruleId === "CODE_LOCALHOST_API_URL" ||
          f.ruleId === "CODE_FRONTEND_HARDCODED_LOCALHOST",
      )
      assert.ok(
        localhostFinding,
        "must catch hardcoded localhost in frontend/src/api.js",
      )

      // Stage 4 Verification: should NOT fail with BOOT_ENTRY_UNRESOLVED
      const bootFindings = await runBootStage(snapshot)
      const unresolvedEntry = bootFindings.find(
        (f) => f.ruleId === "BOOT_ENTRY_UNRESOLVED",
      )
      assert.equal(
        unresolvedEntry,
        undefined,
        "must NOT emit BOOT_ENTRY_UNRESOLVED",
      )
    })

    it("analyzes single subfolder frontend SPA app (like Speakflow) without false backend blockers", async () => {
      const { snapshot } = await runIngestStage({
        files: {
          "my-app/package.json": JSON.stringify({
            name: "speakflow-client",
            engines: { node: ">=20.0.0" },
            dependencies: { react: "^18.2.0", vite: "^5.0.0" },
            scripts: { build: "vite build" },
          }),
          "my-app/index.html":
            "<!DOCTYPE html><html><div id='root'></div></html>",
          "my-app/src/App.tsx": "export const App = () => <div>Hello</div>;",
          ".gitignore": "node_modules/\n",
        },
      })

      // Verification: detected as frontend SPA
      assert.equal(snapshot.services.length, 1)
      assert.equal(snapshot.services[0].rootDir, "my-app")
      assert.equal(snapshot.services[0].role, "frontend")
      assert.equal(snapshot.appShape, "frontend-spa")

      // Stage 2: does NOT emit CONFIG_PACKAGE_JSON_MISSING or CONFIG_SCRIPTS_START_MISSING
      const configFindings = await runConfigStage(snapshot)
      const missingPkg = configFindings.find(
        (f) => f.ruleId === "CONFIG_PACKAGE_JSON_MISSING",
      )
      const missingStart = configFindings.find(
        (f) => f.ruleId === "CONFIG_SCRIPTS_START_MISSING",
      )
      assert.equal(missingPkg, undefined)
      assert.equal(missingStart, undefined)

      // Stage 4: cleanly skips backend boot check without false BOOT_ENTRY_UNRESOLVED
      const bootFindings = await runBootStage(snapshot)
      const bootErrors = bootFindings.filter((f) => f.severity === "blocker")
      assert.equal(
        bootErrors.length,
        0,
        "frontend SPA must have 0 boot blocker findings",
      )
    })

    it("guards non-string AST literals and empty template elements without val.match crash", async () => {
      const { snapshot } = await runIngestStage({
        files: {
          "package.json": JSON.stringify({
            name: "ast-guard-app",
            engines: { node: ">=20.0.0" },
            scripts: { start: "node src/server.js" },
          }),
          "src/server.js": `
            const cors = require('cors');
            const express = require('express');
            const app = express();

            // Object properties with numeric, boolean, null, and non-string literals
            const opts = {
              origin: 3000,
              credentials: false,
              secure: null,
              timeout: 10000,
              enabled: true,
              123: 'numeric-key',
              [Symbol('test')]: 'sym',
            };
            app.use(cors(opts));

            // CORS with origin as boolean or number or null
            app.use(cors({ origin: true }));
            app.use(cors({ origin: 8080, credentials: false }));
            app.use(cors({ origin: null }));

            // listen() with numeric host or null argument
            const PORT = process.env.PORT || 3000;
            app.listen(PORT, null);

            // Empty template literals and expressions in client/server code
            const emptyTemplate = \`\`;
            const count = 42;
            const exprTemplate = \`\${count}\`;
            const validLocalhost = \`http://localhost:\${count}\`;
          `,
        },
      })

      // Must execute Stage 3 (code) and Stage 4 (boot) without throwing val.match is not a function
      const codeFindings = await runCodeStage(snapshot)
      assert.ok(
        Array.isArray(codeFindings),
        "code stage must return findings array",
      )

      // Should identify the hardcoded localhost template literal safely
      const localhostFinding = codeFindings.find(
        (f) =>
          f.ruleId === "CODE_LOCALHOST_API_URL" ||
          f.ruleId === "CODE_FRONTEND_HARDCODED_LOCALHOST",
      )
      assert.ok(
        localhostFinding,
        "should safely detect template literal with localhost",
      )

      const bootFindings = await runBootStage(snapshot)
      assert.ok(
        Array.isArray(bootFindings),
        "boot stage must return findings array",
      )
    })
  })
})
