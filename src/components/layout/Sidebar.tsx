import { Icon } from "../common"
import type { Page } from "../../types"

interface SidebarProps {
  page: Page
  menuOpen: boolean
  projectCount?: number
  isAdmin?: boolean
  onNavigate: (targetPage: Page) => void
}

export function Sidebar({
  page,
  menuOpen,
  projectCount = 4,
  isAdmin = true,
  onNavigate,
}: SidebarProps) {
  return (
    <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
      <nav>
        <button
          className={page === "dashboard" ? "active" : ""}
          onClick={() => onNavigate("dashboard")}
        >
          <Icon name="grid" />
          Overview
        </button>
        <button
          className={page === "projects" || page === "project" ? "active" : ""}
          onClick={() => onNavigate("projects")}
        >
          <Icon name="box" />
          Projects<span className="nav-count">{projectCount}</span>
        </button>
        <button
          className={page === "activity" ? "active" : ""}
          onClick={() => onNavigate("activity")}
        >
          <Icon name="activity" />
          Activity
        </button>
        {isAdmin && (
          <button
            className={page === "admin" ? "active" : ""}
            onClick={() => onNavigate("admin")}
          >
            <Icon name="shield" />
            Admin Console
          </button>
        )}
      </nav>
      <div className="sidebar-bottom">
        <div className="usage">
          <div>
            <span>Monthly scans</span>
            <strong>12 / 25</strong>
          </div>
          <div className="usage-track">
            <i />
          </div>
          <small>Resets in 18 days</small>
        </div>
        <button
          className={page === "settings" ? "active" : ""}
          onClick={() => onNavigate("settings")}
        >
          <Icon name="settings" />
          Settings
        </button>
        <button
          className={page === "docs" ? "active" : ""}
          onClick={() => onNavigate("docs")}
        >
          <Icon name="code" />
          Documentation
          <Icon name="arrow" size={14} />
        </button>
      </div>
    </aside>
  )
}
