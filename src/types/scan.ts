export type ScanStatus = "queued" | "processing" | "completed" | "failed"

export interface Scan {
  _id: string
  project: string
  status: ScanStatus
  startedAt: string
  completedAt?: string
  errorMessage?: string
}

export interface Dependency {
  _id: string
  project: string
  name: string
  version: string
  rawData?: Record<string, unknown>
}

