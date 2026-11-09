export type RiskLevel = "low" | "medium" | "high" | "Low" | "Medium" | "High"

export interface RiskSignals {
  lastCommit?: string
  openIssues?: number
  lastRelease?: string
  weeklyDownloads?: number
  deprecated?: boolean
}

export interface RiskReport {
  _id: string
  scan: string
  dependency: string
  packageName: string
  version: string
  riskLevel: "low" | "medium" | "high"
  riskScore: number
  reasons: string[]
  signals: {
    lastCommit?: string
    openIssues?: number
    lastRelease?: string
    weeklyDownloads?: number
    deprecated?: boolean
  }
  suggestion: string
  createdAt: string
}

