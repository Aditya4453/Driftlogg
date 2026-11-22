import { after, afterEach, before, describe, it } from "node:test"
import assert from "node:assert/strict"
import request from "supertest"
import { createApp } from "../src/app.js"
import { DeploymentScan } from "../src/models/DeploymentScan.js"
import {
  clearCollections,
  connectTestDb,
  disconnectTestDb,
} from "./helpers/testDb.js"

const tokenCookie = (res) =>
  (res.headers["set-cookie"] || []).find((c) => c.startsWith("token="))

describe("Deployment Pipeline Routes & Background Runner", () => {
  const app = createApp()

  before(connectTestDb)
  afterEach(clearCollections)
  after(disconnectTestDb)

  const alice = {
    name: "Alice Deployer",
    email: "alice@deploy.test",
    password: "Password123!",
  }

  const bob = {
    name: "Bob Observer",
    email: "bob@deploy.test",
    password: "Password123!",
  }

  it("enforces authentication on all deployment routes", async () => {
    const fakeId = "65e23910f1a2b3c4d5e6f7a8"
    await request(app)
      .post(`/api/projects/${fakeId}/deployment-scan`)
      .expect(401)
    await request(app).get(`/api/deployment-scans/${fakeId}`).expect(401)
    await request(app)
      .get(`/api/projects/${fakeId}/deployment-report`)
      .expect(401)
  })

  it("triggers background deployment scan, streams logs, and completes assessment", async () => {
    // 1. Register Alice
    const regRes = await request(app)
      .post("/api/auth/register")
      .send(alice)
      .expect(201)
    const cookie = tokenCookie(regRes)

    // 2. Create a Project for Alice with uploaded manifest
    const projRes = await request(app)
      .post("/api/projects")
      .set("Cookie", cookie)
      .send({
        name: "Cloud Express API",
        sourceType: "package_json",
        packageJson: {
          name: "cloud-express-api",
          version: "1.0.0",
          engines: { node: ">=20.0.0" },
          scripts: {
            start: "node server.js",
          },
        },
      })
      .expect(201)

    const projectId = projRes.body._id

    // 3. Trigger Deployment Scan
    const scanRes = await request(app)
      .post(`/api/projects/${projectId}/deployment-scan`)
      .set("Cookie", cookie)
      .send({
        target: "render",
        files: {
          "package.json": JSON.stringify({
            name: "cloud-express-api",
            version: "1.0.0",
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
      })
      .expect(201)

    assert.equal(scanRes.body.status, "queued")
    assert.equal(scanRes.body.projectId, projectId)
    const scanId = scanRes.body._id

    // 4. Poll until background execution completes
    let completedScan = null
    for (let i = 0; i < 40; i += 1) {
      await new Promise((r) => setTimeout(r, 100))
      const pollRes = await request(app)
        .get(`/api/deployment-scans/${scanId}`)
        .set("Cookie", cookie)
        .expect(200)

      if (
        pollRes.body.status === "completed" ||
        pollRes.body.status === "failed"
      ) {
        completedScan = pollRes.body
        break
      }
    }

    assert.ok(completedScan, "Deployment scan should complete within timeout")
    assert.equal(completedScan.status, "completed")
    assert.equal(completedScan.verdict, "ready")
    assert.equal(completedScan.score, 100)
    assert.equal(completedScan.coverage, 100)
    assert.ok(Array.isArray(completedScan.logs))
    assert.ok(completedScan.logs.length > 0, "Scan must record streaming logs")

    // 5. Fetch latest completed deployment report
    const reportRes = await request(app)
      .get(`/api/projects/${projectId}/deployment-report`)
      .set("Cookie", cookie)
      .expect(200)

    assert.ok(reportRes.body)
    assert.equal(reportRes.body._id, scanId)
    assert.equal(reportRes.body.verdict, "ready")
  })

  it("prevents unauthorized users from accessing or triggering scans on other users' projects", async () => {
    // 1. Register Alice and create project
    const aliceReg = await request(app)
      .post("/api/auth/register")
      .send(alice)
      .expect(201)
    const aliceCookie = tokenCookie(aliceReg)

    const projRes = await request(app)
      .post("/api/projects")
      .set("Cookie", aliceCookie)
      .send({
        name: "Alice Private App",
        sourceType: "package_json",
        packageJson: { name: "private-app" },
      })
      .expect(201)

    const projectId = projRes.body._id

    // 2. Register Bob
    const bobReg = await request(app)
      .post("/api/auth/register")
      .send(bob)
      .expect(201)
    const bobCookie = tokenCookie(bobReg)

    // 3. Bob attempts to trigger scan on Alice's project -> 403 Forbidden
    await request(app)
      .post(`/api/projects/${projectId}/deployment-scan`)
      .set("Cookie", bobCookie)
      .send({})
      .expect(403)

    // 4. Bob attempts to fetch latest report on Alice's project -> 403 Forbidden
    await request(app)
      .get(`/api/projects/${projectId}/deployment-report`)
      .set("Cookie", bobCookie)
      .expect(403)
  })
})
