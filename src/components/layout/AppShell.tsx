import React from "react"
import { Topbar } from "./Topbar"
import { Sidebar } from "./Sidebar"
import type { Page, User } from "../../types"

interface AppShellProps {
  page: Page
  currentUser?: User | null
  menuOpen: boolean
  projectCount?: number
  isAdmin?: boolean
  onToggleMenu: () => void
  onNavigate: (targetPage: Page) => void
  children: React.ReactNode
}

export function AppShell({
  page,
  currentUser,
  menuOpen,
  projectCount = 4,
  isAdmin = true,
  onToggleMenu,
  onNavigate,
  children,
}: AppShellProps) {
  return (
    <div className="app-shell">
      <Topbar
        currentUser={currentUser}
        menuOpen={menuOpen}
        onToggleMenu={onToggleMenu}
        onGoDashboard={() => onNavigate("dashboard")}
        onOpenSettings={() => onNavigate("settings")}
        onOpenProfile={() => onNavigate("profile")}
      />

      <Sidebar
        page={page}
        menuOpen={menuOpen}
        projectCount={projectCount}
        isAdmin={isAdmin}
        onNavigate={onNavigate}
      />

      <main className="main">{children}</main>
    </div>
  )
}
