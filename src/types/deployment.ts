export type DeploymentSeverity = "blocker" | "warning" | "info"
export type DeploymentConfidence = "confirmed" | "likely" | "advisory"
export type DeploymentVerdict = "ready" | "needs-fixes" | "will-fail"
export type DeploymentStatus = "queued" | "processing" | "completed" | "failed"

export interface DeploymentFindingFix {
  description: string
  patch: string
}

export interface DeploymentFinding {
  ruleId: string
  stage: "ingest" | "config" | "code" | "boot" | "scoring"
  severity: DeploymentSeverity
  confidence: DeploymentConfidence
  file: string
  line: number
  snippet: string
  platform: string
  message: string
  fix: DeploymentFindingFix | null
}

export interface DeploymentFixFile {
  file: string
  patches: Array<{
    ruleId: string
    description: string
    patch: string
  }>
}

export interface DeploymentFixPlan {
  summary: string
  files: DeploymentFixFile[]
}

export interface DeploymentLog {
  timestamp: string
  stage: string
  level: "info" | "warn" | "error"
  message: string
  meta?: unknown
}

export interface DeploymentScan {
  _id: string
  projectId: string
  triggeredBy?: string
  status: DeploymentStatus
  target: string
  commitSha?: string
  appShape?: string
  packageManager?: string
  score?: number | null
  verdict?: DeploymentVerdict | null
  coverage?: number
  findings: DeploymentFinding[]
  fixPlan?: DeploymentFixPlan | null
  logs: DeploymentLog[]
  errorMessage?: string | null
  startedAt?: string | null
  completedAt?: string | null
  createdAt: string
  updatedAt: string
}
