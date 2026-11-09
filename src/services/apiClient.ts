import axios, { AxiosError } from "axios"

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api"

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
  withCredentials: true,
  timeout: 10000,
})

apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ message?: string; error?: string }>) => {
    let message = "An unexpected error occurred"
    if (error.response?.data?.message) {
      message = error.response.data.message
    } else if (error.response?.data?.error) {
      message = error.response.data.error
    } else if (error.message) {
      message = error.message
    }
    const normalizedError = new Error(message)
      ; (normalizedError as any).status = error.response?.status
      ; (normalizedError as any).code = error.code
    return Promise.reject(normalizedError)
  },
)

export default apiClient
