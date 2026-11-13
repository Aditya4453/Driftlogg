import mongoose from "mongoose"
import { SOURCE_TYPES, riskSummarySchema } from "./shared.js"

const { Schema } = mongoose

export const SCAN_STATUSES = ["queued", "processing", "completed", "failed"]

// Every analysis run is a separate Scan document, so a project keeps its full scan history.
const scanSchema = new Schema(
  {
    // --- Handover contract fields ---
    project: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    status: { type: String, enum: SCAN_STATUSES, default: "queued" },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date },
    errorMessage: { type: String },
    // --- Extra optional fields (filled by scan.service) ---
    workspace: { type: Schema.Types.ObjectId, ref: "Workspace" },
    triggeredBy: { type: Schema.Types.ObjectId, ref: "User" },
    scanNumber: { type: Number, min: 1 }, // 1, 2, 3 ... per project
    sourceType: { type: String, enum: SOURCE_TYPES },
    repositoryUrl: { type: String, default: "" },
    durationMs: { type: Number, min: 0 },
    summary: { type: riskSummarySchema, default: () => ({}) },
  },
  { timestamps: true, toJSON: { versionKey: false } },
)

scanSchema.index({ project: 1, scanNumber: -1 }, { unique: true, partialFilterExpression: { scanNumber: { $exists: true } } })
// Scan history for a project, newest first.
scanSchema.index({ project: 1, createdAt: -1 })
scanSchema.index({ project: 1, status: 1, completedAt: -1 })
scanSchema.index({ workspace: 1, createdAt: -1 })
scanSchema.index({ triggeredBy: 1, createdAt: -1 })

export const Scan = mongoose.models.Scan || mongoose.model("Scan", scanSchema)
export default Scan
