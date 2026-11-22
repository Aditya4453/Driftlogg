export type RiskLevel = "low" | "medium" | "high" | "Low" | "Medium" | "High"

export interface RiskSignals {
  lastCommit?: string
  openIssues?: number
  openIssueRatio?: string
  lastRelease?: string
  weeklyDownloads?: number
  deprecated?: boolean
  maintenanceVelocity?: number
  scorecardScore?: number
  maintainerCount?: number
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

  signals: RiskSignals

  suggestion: string

  createdAt: string

  evidence?: Array<Record<string, unknown>>

  replacement?: {
    name: string

    reason?: string

    source?: string
  }

  ruleVersion?: string

  verdict?: "ready" | "review" | "blocked"

  isDirect?: boolean

  dependencyType?: string

  workspace?: string
}
