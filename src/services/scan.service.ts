import apiClient from "./apiClient"

import type { Scan, RiskReport } from "../types"

export const scanService = {
  async startAnalysis(
    projectId: string,
    payload: {
      sourceType: "package_json" | "github_repo"
      repositoryUrl?: string
      packageJson?: Record<string, unknown>
      packageLockJson?: Record<string, unknown>
    },
  ): Promise<Scan> {
    const response = await apiClient.post<Scan>(
      `/projects/${projectId}/scans`,

      payload,
    )

    return response.data
  },

  async getScanById(scanId: string): Promise<Scan> {
    const response = await apiClient.get<Scan>(`/scans/${scanId}`)

    return response.data
  },

  async getProjectScans(projectId: string): Promise<Scan[]> {
    try {
      const response = await apiClient.get<Scan[]>(
        `/projects/${projectId}/scans`,
      )

      return response.data || []
    } catch {
      return []
    }
  },

  async getProjectReport(projectId: string): Promise<RiskReport[]> {
    try {
      const response = await apiClient.get<RiskReport[]>(
        `/projects/${projectId}/report`,
      )

      return response.data || []
    } catch {
      return []
    }
  },
}

export default scanService
