// Read-only check: connects with server/.env, then prints document counts per collection.
// Usage (inside the server folder): npm run db:check
import mongoose from "mongoose"
import { connectDatabase, connectionHint, disconnectDatabase } from "../src/config/db.js"
import { models, Scan } from "../src/models/index.js"

try {
  const connection = await connectDatabase()
  await connection.db.admin().ping()
  console.log(`Connected to database "${connection.name}" on ${connection.host}\n`)

  for (const model of models) {
    const count = await model.countDocuments()
    console.log(`${model.collection.collectionName.padEnd(14)} ${count} document(s)`)
  }

  const recentScans = await Scan.find().sort({ createdAt: -1 }).limit(5).populate("project", "name")
  if (recentScans.length) {
    console.log("\nMost recent scans:")
    for (const scan of recentScans) {
      console.log(`  ${scan.project?.name ?? "?"} #${scan.scanNumber}  ${scan.status}  high=${scan.summary.high} medium=${scan.summary.medium} low=${scan.summary.low}  (${scan._id})`)
    }
  }
  console.log("\nDatabase connection OK")
} catch (error) {
  console.error(`Database check failed: ${error.message}`)
  console.error(`Hint: ${connectionHint(error)}`)
  process.exitCode = 1
} finally {
  if (mongoose.connection.readyState !== 0) await disconnectDatabase()
}
