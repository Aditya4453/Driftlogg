import { RiskReport, Scan } from "../models/index.js"
import { getProjectForUser } from "./project.service.js"
import { getScanForUser } from "./scan.service.js"

/** Reports of one scan, highest risk first. */
export async function getScanReports(actor, scanId) {
  const scan = await getScanForUser(actor, scanId)
  return RiskReport.find({ scan: scan._id }).sort({ riskScore: -1, packageName: 1 })
}

/** Reports of the project's most recent completed scan (what the dashboard shows). */
export async function getLatestProjectReport(actor, projectId) {
  const project = await getProjectForUser(actor, projectId)
  const latest = await Scan.findOne({ project: project._id, status: "completed" }).sort({ scanNumber: -1 })
  if (!latest) return []
  return RiskReport.find({ scan: latest._id }).sort({ riskScore: -1, packageName: 1 })
}

/** How one package's risk changed over every scan of a project, oldest first. */
export async function getPackageRiskHistory(actor, projectId, packageName) {
  const project = await getProjectForUser(actor, projectId)
  return RiskReport.find({ project: project._id, packageName })
    .sort({ createdAt: 1 })
    .populate("scan", "scanNumber completedAt")
}

/** Risk totals per completed scan, oldest first — for trend charts. */
export async function getProjectRiskTrend(actor, projectId) {
  const project = await getProjectForUser(actor, projectId)
  return Scan.find({ project: project._id, status: "completed" })
    .sort({ scanNumber: 1 })
    .select("scanNumber completedAt summary")
}
