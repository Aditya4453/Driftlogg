import mongoose from "mongoose"

const { Schema } = mongoose

// Workspace-level roles: Team Admin manages team projects and members; Developer works on them.
export const MEMBERSHIP_ROLES = ["team_admin", "developer"]
export const MEMBERSHIP_STATUSES = ["active", "removed"]

const membershipSchema = new Schema(
  {
    workspace: { type: Schema.Types.ObjectId, ref: "Workspace", required: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: MEMBERSHIP_ROLES, default: "developer" },
    status: { type: String, enum: MEMBERSHIP_STATUSES, default: "active" },
    addedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, toJSON: { versionKey: false } },
)

// One membership per user per workspace.
membershipSchema.index({ workspace: 1, user: 1 }, { unique: true })
// "Which workspaces does this user belong to?"
membershipSchema.index({ user: 1, status: 1 })
// "Who are the members / admins of this workspace?"
membershipSchema.index({ workspace: 1, status: 1, role: 1 })

export const Membership = mongoose.models.Membership || mongoose.model("Membership", membershipSchema)
