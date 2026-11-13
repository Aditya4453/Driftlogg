// Optional, development only: writes clearly labelled demo data so you can see
// every collection in Compass. Each run adds ONE new scan to the demo project,
// which shows that scans are stored separately.
//   npm run db:demo          -> add demo data / one more demo scan
//   npm run db:demo:remove   -> delete ONLY the demo data created by this script
import mongoose from "mongoose"
import { connectDatabase, connectionHint, disconnectDatabase } from "../src/config/db.js"
import { Dependency, Membership, Project, RiskReport, Scan, User, Workspace } from "../src/models/index.js"
import { addMember, completeScan, createProject, createWorkspace, markScanProcessing, registerUser, startScan } from "../src/services/index.js"

const DEMO_EMAIL = "demo.developer@driftlogg.local"
const DEMO_ADMIN_EMAIL = "demo.teamadmin@driftlogg.local"
const DEMO_TEAM = "DriftLogg Demo Team"
const DEMO_PROJECT = "demo-checkout-service"

const packageJson = {
  name: DEMO_PROJECT,
  dependencies: { express: "^4.18.2", lodash: "4.17.20", request: "2.88.2" },
  devDependencies: { moment: "2.29.1" },
}

// Slightly different results each run, so scan history is visible.
function fakeResults(runNumber) {
  const drift = Math.min(runNumber * 2, 6)
  return [
    { packageName: "request", riskLevel: "high", riskScore: 90 + Math.min(drift, 9), reasons: ["Deprecated package"], signals: { deprecated: true, lastRelease: "2020-02-11" }, suggestion: "Migrate to undici or axios." },
    { packageName: "lodash", riskLevel: "medium", riskScore: 60 + drift, reasons: ["Known vulnerability"], signals: { openIssues: 310 }, suggestion: "Upgrade to lodash >= 4.17.21." },
    { packageName: "moment", riskLevel: "medium", riskScore: 50 + drift, reasons: ["Maintenance mode"], signals: { weeklyDownloads: 23000000 }, suggestion: "Consider date-fns or dayjs." },
    { packageName: "express", riskLevel: "low", riskScore: 15 + drift, reasons: ["Healthy activity"], signals: { deprecated: false }, suggestion: "Package is healthy." },
  ]
}

async function findOrRegister(name, email) {
  return (await User.findOne({ email })) || registerUser({ name, email, password: "demo-password-123" })
}

async function addDemoData() {
  const developer = await findOrRegister("Demo Developer", DEMO_EMAIL)
  const teamAdmin = await findOrRegister("Demo Team Admin", DEMO_ADMIN_EMAIL)

  let team = await Workspace.findOne({ name: DEMO_TEAM, owner: teamAdmin._id })
  if (!team) {
    team = await createWorkspace({ name: DEMO_TEAM, description: "Demo data created by npm run db:demo", ownerId: teamAdmin._id })
    await addMember(teamAdmin, team._id, developer._id, "developer")
  }

  let project = await Project.findOne({ workspace: team._id, name: DEMO_PROJECT })
  if (!project) {
    project = await createProject(developer, { name: DEMO_PROJECT, description: "Demo project", sourceType: "package_json", workspaceId: team._id })
  }

  const scan = await startScan(developer, project._id, { sourceType: "package_json", packageJson })
  await markScanProcessing(scan._id)
  const completed = await completeScan(scan._id, fakeResults(scan.scanNumber))
  const totalScans = await Scan.countDocuments({ project: project._id })

  console.log(`Demo scan #${completed.scanNumber} saved (${completed._id}).`)
  console.log(`Project "${DEMO_PROJECT}" now has ${totalScans} separate scan(s). Run again to add another.`)
}

async function removeDemoData() {
  const users = await User.find({ email: { $in: [DEMO_EMAIL, DEMO_ADMIN_EMAIL] } })
  const userIds = users.map((u) => u._id)
  const workspaces = await Workspace.find({ owner: { $in: userIds } })
  const workspaceIds = workspaces.map((w) => w._id)
  const projectIds = await Project.find({ workspace: { $in: workspaceIds } }).distinct("_id")

  await RiskReport.deleteMany({ project: { $in: projectIds } })
  await Dependency.deleteMany({ project: { $in: projectIds } })
  await Scan.deleteMany({ project: { $in: projectIds } })
  await Project.deleteMany({ _id: { $in: projectIds } })
  await Membership.deleteMany({ $or: [{ workspace: { $in: workspaceIds } }, { user: { $in: userIds } }] })
  await Workspace.deleteMany({ _id: { $in: workspaceIds } })
  await User.deleteMany({ _id: { $in: userIds } })
  console.log("Demo data removed. Other data was not touched.")
}

try {
  const connection = await connectDatabase()
  console.log(`Connected to database "${connection.name}"`)
  if (process.argv.includes("--remove")) await removeDemoData()
  else await addDemoData()
} catch (error) {
  console.error(`Demo script failed: ${error.message}`)
  if (mongoose.connection.readyState !== 1) console.error(`Hint: ${connectionHint(error)}`)
  process.exitCode = 1
} finally {
  if (mongoose.connection.readyState !== 0) await disconnectDatabase()
}
