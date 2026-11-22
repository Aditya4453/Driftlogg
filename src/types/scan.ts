export type ScanStatus = "queued" | "processing" | "completed" | "failed"

export interface ScanLog {
  timestamp: string

  stage: string

  level: "info" | "warn" | "error"

  message: string

  meta?: Record<string, unknown>
}

export interface Scan {
  _id: string

  project: string

  status: ScanStatus

  startedAt: string

  completedAt?: string

  errorMessage?: string

  verdict?: "ready" | "review" | "blocked"

  overallScore?: number

  ruleVersion?: string

  sourcesUnavailable?: string[]

  logs?: ScanLog[]
}

export interface Dependency {
  _id: string

  project: string

  name: string

  version: string

  rawData?: Record<string, unknown>
}
