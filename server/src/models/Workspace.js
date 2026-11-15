import mongoose from "mongoose"

const { Schema } = mongoose

// A workspace is a team. Every user also gets a personal workspace for their own projects.
const workspaceSchema = new Schema(
  {
    name: { type: String, required: [true, "Workspace name is required"], trim: true, minlength: 2, maxlength: 80 },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: [/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug may only contain lowercase letters, numbers and dashes"],
    },
    description: { type: String, trim: true, maxlength: 500 },
    owner: { type: Schema.Types.ObjectId, ref: "User", required: true },
    isPersonal: { type: Boolean, default: false },
  },
  { timestamps: true, toJSON: { versionKey: false } },
)

workspaceSchema.index({ slug: 1 }, { unique: true })
workspaceSchema.index({ owner: 1 })

export const Workspace = mongoose.models.Workspace || mongoose.model("Workspace", workspaceSchema)
