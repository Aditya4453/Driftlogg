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

  monthlyScansUsed?: number

  monthlyScanLimit?: number

  daysUntilReset?: number

  onToggleMenu: () => void

  onNavigate: (targetPage: Page) => void

  children: React.ReactNode
}

export function AppShell({
  page,

  currentUser,

  menuOpen,

  projectCount = 0,

  isAdmin = true,

  monthlyScansUsed = 0,

  monthlyScanLimit = 25,

  daysUntilReset = 30,

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
        monthlyScansUsed={monthlyScansUsed}
        monthlyScanLimit={monthlyScanLimit}
        daysUntilReset={daysUntilReset}
        onNavigate={onNavigate}
      />

      <main className="main">{children}</main>
    </div>
  )
}
