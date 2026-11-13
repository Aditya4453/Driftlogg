import mongoose from "mongoose"
import { RISK_LEVELS } from "./shared.js"

const { Schema } = mongoose

// One report per dependency per scan. Reports are historical records: they are
// created once when a scan completes and are never edited afterwards.
const riskReportSchema = new Schema(
  {
    // --- Handover contract fields ---
    scan: { type: Schema.Types.ObjectId, ref: "Scan", required: true, index: true, immutable: true },
    dependency: { type: Schema.Types.ObjectId, ref: "Dependency", required: true, index: true, immutable: true },
    packageName: { type: String, required: true, immutable: true },
    version: { type: String, required: true, immutable: true },
    riskLevel: { type: String, enum: RISK_LEVELS, required: true, immutable: true },
    riskScore: { type: Number, min: 0, max: 100, required: true, immutable: true },
    reasons: { type: [String], immutable: true },
    signals: {
      lastCommit: { type: String, immutable: true },
      openIssues: { type: Number, immutable: true },
      lastRelease: { type: String, immutable: true },
      weeklyDownloads: { type: Number, immutable: true },
      deprecated: { type: Boolean, default: false, immutable: true },
    },
    suggestion: { type: String, default: "", immutable: true },
    // --- Extra optional fields for fast history queries ---
    project: { type: Schema.Types.ObjectId, ref: "Project", immutable: true },
    workspace: { type: Schema.Types.ObjectId, ref: "Workspace", immutable: true },
  },
  { timestamps: true, toJSON: { versionKey: false } },
)

riskReportSchema.index({ scan: 1, dependency: 1 }, { unique: true })
// Reports of one scan ordered by severity.
riskReportSchema.index({ scan: 1, riskScore: -1 })
// Risk history of a single package across all scans of a project.
riskReportSchema.index({ project: 1, packageName: 1, createdAt: -1 })
// Global "high risk" counts for admin statistics.
riskReportSchema.index({ workspace: 1, riskLevel: 1 })

// Block updates through query helpers too (updateOne, findOneAndUpdate, ...).
function rejectUpdate() {
  throw new Error("Risk reports are historical records and cannot be modified")
}
riskReportSchema.pre(["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "findOneAndReplace"], rejectUpdate)

export const RiskReport = mongoose.models.RiskReport || mongoose.model("RiskReport", riskReportSchema)
export default RiskReport
