import { Icon, Logo } from "../common"

interface TopbarProps {
  menuOpen: boolean
  onToggleMenu: () => void
  onGoDashboard: () => void
  onOpenSettings: () => void
  onOpenProfile: () => void
}

export function Topbar({
  menuOpen,
  onToggleMenu,
  onGoDashboard,
  onOpenSettings,
  onOpenProfile,
}: TopbarProps) {
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
        >
          DV
        </button>
      </div>
    </header>
  )
}
