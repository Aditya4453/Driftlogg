import apiClient from "./apiClient"
import type { Scan, RiskReport } from "../types"

const fallbackReports: RiskReport[] = [
  {
    _id: "rep_001",
    scan: "scan_001",
    dependency: "dep_001",
    packageName: "request",
    version: "2.88.2",
    riskLevel: "high",
    riskScore: 94,
    reasons: ["Inactive 4+ years", "Deprecated package"],
    signals: {
      lastRelease: "2020-02-11T00:00:00Z",
      openIssues: 124,
      weeklyDownloads: 16400000,
      deprecated: true,
      lastCommit: "2020-02-11",
    },
    suggestion:
      "Migrate to undici or axios for native Node.js HTTP maintenance.",
    createdAt: "2025-02-15T12:00:00Z",
  },
  {
    _id: "rep_002",
    scan: "scan_001",
    dependency: "dep_002",
    packageName: "node-sass",
    version: "4.14.1",
    riskLevel: "high",
    riskScore: 86,
    reasons: ["Unmaintained", "3 security issues"],
    signals: {
      lastRelease: "2020-04-30T00:00:00Z",
      openIssues: 38,
      weeklyDownloads: 2100000,
      deprecated: true,
      lastCommit: "2020-05-01",
    },
    suggestion:
      "Migrate to dart-sass (sass) to avoid binary compilation vulnerabilities.",
    createdAt: "2025-02-15T12:00:00Z",
  },
  {
    _id: "rep_003",
    scan: "scan_001",
    dependency: "dep_003",
    packageName: "event-stream",
    version: "3.3.6",
    riskLevel: "high",
    riskScore: 81,
    reasons: ["Suspicious ownership", "Inactive 5+ years"],
    signals: {
      lastRelease: "2018-09-10T00:00:00Z",
      openIssues: 19,
      weeklyDownloads: 850000,
      deprecated: false,
      lastCommit: "2018-09-15",
    },
    suggestion:
      "Replace with standard stream pipelines or high-reputation packages.",
    createdAt: "2025-02-15T12:00:00Z",
  },
  {
    _id: "rep_004",
    scan: "scan_001",
    dependency: "dep_004",
    packageName: "lodash",
    version: "4.17.20",
    riskLevel: "medium",
    riskScore: 64,
    reasons: ["Known vulnerability"],
    signals: {
      lastRelease: "2020-08-13T00:00:00Z",
      openIssues: 310,
      weeklyDownloads: 48000000,
      deprecated: false,
      lastCommit: "2021-02-10",
    },
    suggestion:
      "Upgrade to lodash >= 4.17.21 or replace with native ES6 functions.",
    createdAt: "2025-02-15T12:00:00Z",
  },
  {
    _id: "rep_005",
    scan: "scan_001",
    dependency: "dep_005",
    packageName: "moment",
    version: "2.29.1",
    riskLevel: "medium",
    riskScore: 52,
    reasons: ["Maintenance mode"],
    signals: {
      lastRelease: "2020-10-06T00:00:00Z",
      openIssues: 260,
      weeklyDownloads: 23000000,
      deprecated: false,
      lastCommit: "2022-04-12",
    },
    suggestion: "Consider lighter alternatives like date-fns, luxon, or dayjs.",
    createdAt: "2025-02-15T12:00:00Z",
  },
  {
    _id: "rep_006",
    scan: "scan_001",
    dependency: "dep_006",
    packageName: "express",
    version: "4.18.2",
    riskLevel: "low",
    riskScore: 18,
    reasons: ["Healthy activity"],
    signals: {
      lastRelease: "2023-01-10T00:00:00Z",
      openIssues: 45,
      weeklyDownloads: 32000000,
      deprecated: false,
      lastCommit: "2024-03-01",
    },
    suggestion: "Package is healthy and actively supported.",
    createdAt: "2025-02-15T12:00:00Z",
  },
]

export const scanService = {
  async startAnalysis(
    projectId: string,
    payload: {
      sourceType: "package_json" | "github_repo"
      repositoryUrl?: string
      packageJson?: Record<string, unknown>
    },
  ): Promise<Scan> {
    try {
      const response = await apiClient.post<Scan>(
        `/projects/${projectId}/scans`,
        payload,
      )
      return response.data
    } catch {
      return {
        _id: `scan_${Date.now()}`,
        project: projectId,
        status: "processing",
        startedAt: new Date().toISOString(),
      }
    }
  },

  async getScanById(scanId: string): Promise<Scan> {
    try {
      const response = await apiClient.get<Scan>(`/scans/${scanId}`)
      return response.data
    } catch {
      return {
        _id: scanId,
        project: "proj_001",
        status: "completed",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      }
    }
  },

  async getProjectScans(projectId: string): Promise<Scan[]> {
    try {
      const response = await apiClient.get<Scan[]>(
        `/projects/${projectId}/scans`,
      )
      return response.data
    } catch {
      return [
        {
          _id: "scan_001",
          project: projectId,
          status: "completed",
          startedAt: "2025-02-15T11:58:00Z",
          completedAt: "2025-02-15T12:00:00Z",
        },
      ]
    }
  },

  async getProjectReport(projectId: string): Promise<RiskReport[]> {
    try {
      const response = await apiClient.get<RiskReport[]>(
        `/projects/${projectId}/report`,
      )
      return response.data
    } catch {
      return fallbackReports
    }
  },
}

export default scanService
