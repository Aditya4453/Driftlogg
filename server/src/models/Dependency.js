import mongoose from "mongoose"

const { Schema } = mongoose

export const DEPENDENCY_TYPES = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]

const dependencySchema = new Schema(
  {
    // --- Handover contract fields ---
    project: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    name: { type: String, required: [true, "Package name is required"] },
    version: { type: String, required: [true, "Version is required"] },
    rawData: { type: Object, default: {} },
    // --- Extra optional fields: links the row to the scan that captured it (scan history) ---
    scan: { type: Schema.Types.ObjectId, ref: "Scan" },
    dependencyType: { type: String, enum: DEPENDENCY_TYPES, default: "dependencies" },
  },
  { timestamps: true, toJSON: { versionKey: false } },
)

// One row per package per scan (only for rows that belong to a scan).
dependencySchema.index(
  { scan: 1, name: 1, dependencyType: 1 },
  { unique: true, partialFilterExpression: { scan: { $exists: true } } },
)
dependencySchema.index({ project: 1, name: 1, createdAt: -1 })

export const Dependency = mongoose.models.Dependency || mongoose.model("Dependency", dependencySchema)
export default Dependency
