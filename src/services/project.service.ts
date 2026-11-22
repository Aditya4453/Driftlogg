import apiClient from "./apiClient"
import type { Project } from "../types"

export const projectService = {
  async getProjects(): Promise<Project[]> {
    try {
      const response = await apiClient.get<Project[]>("/projects")
      return response.data || []
    } catch {
      return []
    }
  },

  async getProjectById(id: string): Promise<Project> {
    const response = await apiClient.get<Project>(`/projects/${id}`)
    return response.data
  },

  async createProject(payload: {
    name: string
    description?: string
    sourceType: string
    repositoryUrl?: string
    packageJson?: Record<string, unknown>
    packageLockJson?: Record<string, unknown>
  }): Promise<Project> {
    const response = await apiClient.post<Project>("/projects", payload)
    return response.data
  },

  async deleteProject(id: string): Promise<void> {
    await apiClient.delete(`/projects/${id}`)
  },
}

export default projectService
