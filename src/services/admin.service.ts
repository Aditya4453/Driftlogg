import apiClient from "./apiClient"
import type { User, Project } from "../types"

export interface SystemStats {
  totalUsers: number
  totalProjects: number
  totalScans: number
  highRiskCount: number
}

export const adminService = {
  async getSystemStats(): Promise<SystemStats> {
    try {
      const response = await apiClient.get<SystemStats>("/admin/stats")
      return response.data || {
        totalUsers: 0,
        totalProjects: 0,
        totalScans: 0,
        highRiskCount: 0,
      }
    } catch {
      return {
        totalUsers: 0,
        totalProjects: 0,
        totalScans: 0,
        highRiskCount: 0,
      }
    }
  },

  async getAllUsers(): Promise<User[]> {
    try {
      const response = await apiClient.get<User[]>("/admin/users")
      return response.data || []
    } catch {
      return []
    }
  },

  async getAllProjects(): Promise<Project[]> {
    try {
      const response = await apiClient.get<Project[]>("/admin/projects")
      return response.data || []
    } catch {
      return []
    }
  },
}

export default adminService
