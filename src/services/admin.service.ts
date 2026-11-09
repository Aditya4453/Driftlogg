import apiClient from "./apiClient"
import type { User, Project } from "../types"

export interface SystemStats {
  totalUsers: number
  totalProjects: number
  totalScans: number
  highRiskCount: number
}

const fallbackStats: SystemStats = {
  totalUsers: 28,
  totalProjects: 14,
  totalScans: 142,
  highRiskCount: 5,
}

const fallbackUsers: User[] = [
  {
    _id: "usr_001",
    name: "Devon Rivera",
    email: "devon@acme.dev",
    role: "admin",
    createdAt: "2025-01-01T10:00:00Z",
  },
  {
    _id: "usr_002",
    name: "Sarah Chen",
    email: "sarah@acme.dev",
    role: "user",
    createdAt: "2025-01-15T11:30:00Z",
  },
  {
    _id: "usr_003",
    name: "Alex Martinez",
    email: "alex@acme.dev",
    role: "user",
    createdAt: "2025-02-01T09:15:00Z",
  },
  {
    _id: "usr_004",
    name: "Elena Rostova",
    email: "elena@acme.dev",
    role: "user",
    createdAt: "2025-02-10T14:20:00Z",
  },
]

export const adminService = {
  async getSystemStats(): Promise<SystemStats> {
    try {
      const response = await apiClient.get<SystemStats>("/admin/stats")
      return response.data
    } catch {
      return fallbackStats
    }
  },

  async getAllUsers(): Promise<User[]> {
    try {
      const response = await apiClient.get<User[]>("/admin/users")
      return response.data
    } catch {
      return fallbackUsers
    }
  },

  async getAllProjects(): Promise<Project[]> {
    try {
      const response = await apiClient.get<Project[]>("/admin/projects")
      return response.data
    } catch {
      return [
        {
          _id: "proj_001",
          name: "core-platform",
          description: "Enterprise backend service layer",
          sourceType: "github_repo",
          source: "GitHub",
          repositoryUrl: "https://github.com/acme/core-platform",
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
          description: "Stripe and billing webhook worker",
          sourceType: "github_repo",
          source: "GitHub",
          repositoryUrl: "https://github.com/acme/checkout-service",
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
          description: "Internal dashboard portal",
          sourceType: "package_json",
          source: "package.json",
          status: "completed",
          deps: 214,
          high: 0,
          medium: 6,
          low: 208,
          scanned: "Yesterday",
          createdAt: "2025-01-20T14:15:00Z",
          updatedAt: "2025-02-13T10:00:00Z",
        },
      ]
    }
  },
}

export default adminService

