import apiClient from "./apiClient"
import type { DeploymentScan } from "../types"

export const deploymentService = {
  /**
   * Starts a new background deployment error pipeline scan for a project.
   */
  async startDeploymentScan(
    projectId: string,
    target?: string,
  ): Promise<DeploymentScan> {
    const payload = target && target !== "auto" ? { target } : {}
    const response = await apiClient.post<DeploymentScan>(
      `/projects/${projectId}/deployment-scan`,
      payload,
    )
    return response.data
  },

  /**
   * Fetches status, live logs, findings, and fix plan for a specific deployment scan.
   */
  async getDeploymentScan(scanId: string): Promise<DeploymentScan> {
    const response = await apiClient.get<DeploymentScan>(
      `/deployment-scans/${scanId}`,
    )
    return response.data
  },

  /**
   * Fetches the latest completed deployment report for a project, or null if none.
   */
  async getLatestDeploymentReport(
    projectId: string,
  ): Promise<DeploymentScan | null> {
    const response = await apiClient.get<DeploymentScan | null>(
      `/projects/${projectId}/deployment-report`,
    )
    return response.data
  },
}

export default deploymentService
