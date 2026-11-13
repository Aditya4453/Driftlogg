import mongoose from "mongoose"
import { SOURCE_TYPES, riskSummarySchema } from "./shared.js"

const { Schema } = mongoose

export const PROJECT_STATUSES = ["pending", "analyzing", "completed", "failed"]

const projectSchema = new Schema(
  {
    // --- Handover contract fields ---
    name: { type: String, required: [true, "Project name is required"], trim: true },
    description: { type: String, default: "" },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true }, // project owner
    sourceType: { type: String, enum: SOURCE_TYPES, required: true },
    repositoryUrl: { type: String, default: "" },
    status: { type: String, enum: PROJECT_STATUSES, default: "pending" },
    // --- Extra optional fields (teams, scan history, dashboards) ---
    workspace: { type: Schema.Types.ObjectId, ref: "Workspace" },
    latestScan: { type: Schema.Types.ObjectId, ref: "Scan" },
    lastScannedAt: { type: Date },
    summary: { type: riskSummarySchema, default: () => ({}) },
    isArchived: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON: {
      versionKey: false,
      virtuals: true,
      transform(_doc, ret) {
        delete ret.id
        return ret
      },
    },
  },
)

// UI helper fields expected by the React Project type.
projectSchema.virtual("source").get(function source() {
  return this.sourceType === "github_repo" ? "GitHub" : "package.json"
})
projectSchema.virtual("detail").get(function detail() {
  if (this.repositoryUrl) return this.repositoryUrl.replace(/^https:\/\/github\.com\//, "").replace(/\/$/, "")
  return "package.json upload"
})
projectSchema.virtual("deps").get(function deps() {
  return this.summary?.totalDependencies ?? 0
})
projectSchema.virtual("high").get(function high() {
  return this.summary?.high ?? 0
})
projectSchema.virtual("medium").get(function medium() {
  return this.summary?.medium ?? 0
})
projectSchema.virtual("low").get(function low() {
  return this.summary?.low ?? 0
})

// Project names are unique inside a workspace (only applies when a workspace is set).
projectSchema.index(
  { workspace: 1, name: 1 },
  { unique: true, collation: { locale: "en", strength: 2 }, partialFilterExpression: { workspace: { $exists: true } } },
)
projectSchema.index({ workspace: 1, isArchived: 1, updatedAt: -1 })
projectSchema.index({ user: 1, updatedAt: -1 })

export const Project = mongoose.models.Project || mongoose.model("Project", projectSchema)
export default Project
