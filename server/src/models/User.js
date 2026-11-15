import mongoose from "mongoose"
import bcrypt from "bcryptjs"

const { Schema } = mongoose

// Global platform roles (handover spec). "user" = Developer, "admin" = Super Admin.
// Team Admin is a per-workspace role stored in Membership.
export const USER_ROLES = ["user", "admin"]
export const BCRYPT_ROUNDS = 10

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const userSchema = new Schema(
  {
    // --- Handover contract fields ---
    name: { type: String, required: [true, "Name is required"], trim: true },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [EMAIL_PATTERN, "Email is invalid"],
    },
    password: { type: String, required: [true, "Password is required"] }, // bcrypt hash only
    role: { type: String, enum: USER_ROLES, default: "user" },
    // --- Extra optional fields ---
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: {
      versionKey: false,
      transform(_doc, ret) {
        delete ret.password // never send the hash to the client
        return ret
      },
    },
  },
)

userSchema.index({ role: 1, createdAt: -1 })

/** Hashes and stores a plain-text password (bcrypt, 10 rounds). */
userSchema.methods.setPassword = async function setPassword(plainPassword) {
  if (typeof plainPassword !== "string" || plainPassword.length === 0) {
    const error = new mongoose.Error.ValidationError()
    error.addError("password", new mongoose.Error.ValidatorError({ message: "Password is required", path: "password" }))
    throw error
  }
  this.password = await bcrypt.hash(plainPassword, BCRYPT_ROUNDS)
}

userSchema.methods.comparePassword = function comparePassword(plainPassword) {
  if (!this.password) return Promise.resolve(false)
  return bcrypt.compare(plainPassword, this.password)
}

export const User = mongoose.models.User || mongoose.model("User", userSchema)
export default User
