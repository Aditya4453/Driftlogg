import apiClient from "./apiClient"
import type { User } from "../types"

export interface RegisterPayload {
  name: string
  email: string
  password?: string
}

export interface LoginPayload {
  email: string
  password?: string
}

export const authService = {
  async register(data: RegisterPayload): Promise<User> {
    const response = await apiClient.post<User>("/auth/register", data)
    return response.data
  },

  async login(data: LoginPayload): Promise<User> {
    const response = await apiClient.post<User>("/auth/login", data)
    return response.data
  },

  async logout(): Promise<void> {
    try {
      await apiClient.post("/auth/logout")
    } catch {
      // Allow frontend session clearing even if network error occurs
    }
  },

  async getMe(): Promise<User | null> {
    try {
      const response = await apiClient.get<User>("/auth/me")
      return response.data
    } catch {
      return null
    }
  },
}

export default authService
