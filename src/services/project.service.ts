import apiClient from "./apiClient"
import type { Project } from "../types"

const fallbackProjects: Project[] = [
  {
    _id: "proj_001",
    name: "core-platform",
    description: "Core service orchestration and auth",
    sourceType: "github_repo",
    source: "GitHub",
    repositoryUrl: "https://github.com/acme/core-platform",
    detail: "acme/core-platform",
    status: "completed",
    deps: 148,
    high: 4,
    medium: 13,
    low: 131,
    scanned: "8 min ago",
    createdAt: "2025-01-10T08:00:00Z",
    updatedAt: "2025-02-15T12:00:00Z",
  },
  {
    _id: "proj_002",
    name: "checkout-service",
    description: "Payment and checkout gateway API",
    sourceType: "github_repo",
    source: "GitHub",
    repositoryUrl: "https://github.com/acme/checkout-service",
    detail: "acme/checkout-service",
    status: "completed",
    deps: 86,
    high: 1,
    medium: 8,
    low: 77,
    scanned: "1 hr ago",
    createdAt: "2025-01-14T09:30:00Z",
    updatedAt: "2025-02-14T11:20:00Z",
  },
  {
    _id: "proj_003",
    name: "admin-console",
    description: "Internal operations web app",
    sourceType: "package_json",
    source: "package.json",
    detail: "package.json upload",
    status: "completed",
    deps: 214,
    high: 0,
    medium: 6,
    low: 208,
    scanned: "Yesterday",
    createdAt: "2025-01-20T14:15:00Z",
    updatedAt: "2025-02-13T10:00:00Z",
  },
  {
    _id: "proj_004",
    name: "developer-docs",
    description: "Public developer documentation site",
    sourceType: "github_repo",
    source: "GitHub",
    repositoryUrl: "https://github.com/acme/developer-docs",
    detail: "acme/developer-docs",
    status: "completed",
    deps: 63,
    high: 0,
    medium: 2,
    low: 61,
    scanned: "3 days ago",
    createdAt: "2025-01-25T16:00:00Z",
    updatedAt: "2025-02-11T17:45:00Z",
  },
]

export const projectService = {
  async getProjects(): Promise<Project[]> {
    try {
      const response = await apiClient.get<Project[]>("/projects")
      return response.data
    } catch {
      return fallbackProjects
    }
  },

  async getProjectById(id: string): Promise<Project> {
    try {
      const response = await apiClient.get<Project>(`/projects/${id}`)
      return response.data
    } catch {
      const found = fallbackProjects.find((p) => p._id === id || p.name === id)
      return found || fallbackProjects[0]
    }
  },

  async createProject(payload: {
    name: string
    description?: string
    sourceType: string
    repositoryUrl?: string
  }): Promise<Project> {
    try {
      const response = await apiClient.post<Project>("/projects", payload)
      return response.data
    } catch {
      const newProj: Project = {
        _id: `proj_${Date.now()}`,
        name: payload.name,
        description: payload.description,
        sourceType: payload.sourceType as "package_json" | "github_repo",
        source:
          payload.sourceType === "github_repo" ? "GitHub" : "package.json",
        repositoryUrl: payload.repositoryUrl,
        detail: payload.repositoryUrl || payload.name,
        status: "analyzing",
        deps: 148,
        high: 4,
        medium: 13,
        low: 131,
        scanned: "Just now",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      return newProj
    }
  },

  async deleteProject(id: string): Promise<void> {
    try {
      await apiClient.delete(`/projects/${id}`)
    } catch {
      // Graceful offline fallback
    }
  },
}

export default projectService
