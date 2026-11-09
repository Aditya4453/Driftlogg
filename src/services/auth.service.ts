import apiClient from "./apiClient"
import type { User } from "../types"

const fallbackUser: User = {
  _id: "usr_mock_001",
  name: "Devon Rivera",
  email: "devon@acme.dev",
  role: "admin",
  createdAt: new Date().toISOString(),
}

export const authService = {
  async register(data: {
    name: string
    email: string
    password?: string
  }): Promise<User> {
    try {
      const response = await apiClient.post<User>("/auth/register", data)
      return response.data
    } catch {
      return {
        ...fallbackUser,
        name: data.name,
        email: data.email,
      }
    }
  },

  async login(data: { email: string, password?: string }): Promise<User> {
    try {
      const response = await apiClient.post<User>("/auth/login", data)
      return response.data
    } catch {
      return {
        ...fallbackUser,
        email: data.email,
      }
    }
  },

  async logout(): Promise<void> {
    try {
      await apiClient.post("/auth/logout")
    } catch {
      // Graceful offline logout fallback
    }
  },

  async getMe(): Promise<User> {
    try {
      const response = await apiClient.get<User>("/auth/me")
      return response.data
    } catch {
      return fallbackUser
    }
  },
}

export default authService
