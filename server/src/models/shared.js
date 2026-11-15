import mongoose from "mongoose"

export const RISK_LEVELS = ["low", "medium", "high"]
export const SOURCE_TYPES = ["package_json", "github_repo"]

/** Risk counts stored on Scan (per scan) and Project (latest scan). */
export const riskSummarySchema = new mongoose.Schema(
  {
    totalDependencies: { type: Number, default: 0, min: 0 },
    high: { type: Number, default: 0, min: 0 },
    medium: { type: Number, default: 0, min: 0 },
    low: { type: Number, default: 0, min: 0 },
    averageRiskScore: { type: Number, default: 0, min: 0, max: 100 },
  },
  { _id: false },
)
