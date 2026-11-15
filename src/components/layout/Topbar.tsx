import { Icon, Logo } from "../common"
import type { User } from "../../types"

interface TopbarProps {
  currentUser?: User | null
  menuOpen: boolean
  onToggleMenu: () => void
  onGoDashboard: () => void
  onOpenSettings: () => void
  onOpenProfile: () => void
}

export function Topbar({
  currentUser,
  menuOpen,
  onToggleMenu,
  onGoDashboard,
  onOpenSettings,
  onOpenProfile,
}: TopbarProps) {
  const userInitials = currentUser?.name
    ? currentUser.name
        .split(" ")
        .filter(Boolean)
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : currentUser?.email
      ? currentUser.email.slice(0, 2).toUpperCase()
      : "DV"

  return (
    <header className="topbar">
      <button
        className="mobile-menu"
        onClick={onToggleMenu}
        aria-label="Toggle menu"
      >
        <Icon name="menu" />
      </button>
      <button className="logo-button" onClick={onGoDashboard}>
        <Logo />
      </button>
      <div className="topbar-actions">
        <span className="status-chip">
          <span />
          All systems operational
        </span>
        <button
          className="icon-button"
          aria-label="Settings"
          onClick={onOpenSettings}
        >
          <Icon name="settings" />
        </button>
        <button
          className="avatar"
          onClick={onOpenProfile}
          aria-label="Open profile"
          title={
            currentUser
              ? `${currentUser.name} (${currentUser.email})`
              : "Open profile"
          }
        >
          {userInitials}
        </button>
      </div>
    </header>
  )
}
