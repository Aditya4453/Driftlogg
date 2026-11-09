export type SettingsSection = "Risk policy" | "Notifications" | "Integrations" | "Workspace"

export interface RiskPolicySettings {
  blockThreshold: number
  inactiveWindowDays: number
  escalateSecurityAdvisories: boolean
  flagArchivedRepositories: boolean
}
