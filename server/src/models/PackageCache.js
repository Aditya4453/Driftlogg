import mongoose from "mongoose"

const { Schema } = mongoose

const packageCacheSchema = new Schema(
  {
    cacheKey: { type: String, required: true, unique: true, index: true },
    data: { type: Schema.Types.Mixed, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, toJSON: { versionKey: false } },
)

// Automatic TTL expiration in MongoDB
packageCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export const PackageCache =
  mongoose.models.PackageCache ||
  mongoose.model("PackageCache", packageCacheSchema)
export default PackageCache
