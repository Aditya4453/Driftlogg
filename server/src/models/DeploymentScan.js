import mongoose from "mongoose"

const { Schema } = mongoose

export const DEPLOYMENT_STATUSES = [
  "queued",
  "processing",
  "completed",
  "failed",
]
export const DEPLOYMENT_VERDICTS = ["ready", "needs-fixes", "will-fail"]

const deploymentLogSchema = new Schema(
  {
    timestamp: { type: Date, default: Date.now },
    stage: { type: String, required: true },
    level: { type: String, enum: ["info", "warn", "error"], default: "info" },
    message: { type: String, required: true },
    meta: { type: Schema.Types.Mixed },
  },
  { _id: false },
)

const deploymentScanSchema = new Schema(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: "Project",
      required: true,
      index: true,
    },
    triggeredBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: DEPLOYMENT_STATUSES,
      default: "queued",
      index: true,
    },
    target: {
      type: String,
      default: "auto",
    },
    commitSha: {
      type: String,
      default: "",
    },
    appShape: {
      type: String,
      default: "",
    },
    packageManager: {
      type: String,
      default: "npm",
    },
    score: {
      type: Number,
      min: 0,
      max: 100,
      default: null,
    },
    verdict: {
      type: String,
      enum: DEPLOYMENT_VERDICTS,
      default: null,
    },
    coverage: {
      type: Number,
      min: 0,
      max: 100,
      default: 100,
    },
    findings: {
      type: [Schema.Types.Mixed],
      default: [],
    },
    fixPlan: {
      type: Schema.Types.Mixed,
      default: null,
    },
    logs: {
      type: [deploymentLogSchema],
      default: [],
    },
    errorMessage: {
      type: String,
      default: null,
    },
    startedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
)

export const DeploymentScan =
  mongoose.models.DeploymentScan ||
  mongoose.model("DeploymentScan", deploymentScanSchema)

export default DeploymentScan
