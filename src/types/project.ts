export type ProjectSource = "GitHub" | "package.json" | "package_json" | "github_repo"
export type ProjectStatus = "pending" | "analyzing" | "completed" | "failed"

export interface Project {
  _id: string
  name: string
  description?: string
  sourceType: "package_json" | "github_repo"
  repositoryUrl?: string
  status: ProjectStatus
  createdAt: string
  updatedAt: string

  // UI Presentation / Aggregation helpers
  source?: "GitHub" | "package.json"
  detail?: string
  deps?: number
  high?: number
  medium?: number
  low?: number
  scanned?: string
}
