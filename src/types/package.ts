import type { RiskLevel } from "./riskReport"

export interface PackageDependency {
  _id?: string
  name: string
  version: string
  score: number
  risk: RiskLevel
  riskLevel?: RiskLevel
  reasons: string[]
  signals?: {
    daysSinceRelease?: string
    openIssueRatio?: string
    maintenanceVelocity?: string
    weeklyDownloads?: string
    lastCommit?: string
    openIssues?: number
    lastRelease?: string
    deprecated?: boolean
  }
  suggestion?: string
}

export interface HealthSignals {
  daysSinceRelease: string
  openIssueRatio: string
  maintenanceVelocity: string
  weeklyDownloads: string
}
