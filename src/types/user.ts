export interface User {
  _id: string
  name: string
  email: string
  role: "user" | "admin"
  createdAt: string
  timezone?: string
  twoFactorEnabled?: boolean
}

export interface UserSummary {
  totalProjects: number
  totalScansRun: number
  monthlyScansUsed: number
  monthlyScanLimit: number
  daysUntilReset: number
  risksResolved: number
  memberSince: string
  user: User
}
