import { useEffect, useState } from "react"

import { Icon } from "../../components/common"

import authService from "../../services/auth.service"

import type { User, UserSummary } from "../../types"

interface ProfilePageProps {
  currentUser?: User | null
  userSummary?: UserSummary | null
  onLogout?: () => void
  onProfileUpdated?: (user: User) => void
}

export function ProfilePage({
  currentUser,
  userSummary,
  onLogout,
  onProfileUpdated,
}: ProfilePageProps) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState(currentUser?.name || "")
  const [timezone, setTimezone] = useState(currentUser?.timezone || "UTC")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (currentUser?.name) setName(currentUser.name)
    if (currentUser?.timezone) setTimezone(currentUser.timezone)
  }, [currentUser])

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
      : "U"

  const roleDisplay =
    currentUser?.role === "admin"
      ? "Workspace admin"
      : currentUser?.role
        ? `Workspace ${currentUser.role}`
        : "Workspace member"

  const memberSince = currentUser?.createdAt
    ? new Date(currentUser.createdAt).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      })
    : userSummary?.memberSince
      ? new Date(userSummary.memberSince).toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
        })
      : "Recently"

  const totalScans = userSummary?.totalScansRun ?? 0
  const risksResolved = userSummary?.risksResolved ?? 0
  const is2FA = Boolean(currentUser?.twoFactorEnabled)

  const handleSave = async () => {
    if (editing) {
      setSaving(true)
      setError(null)
      try {
        const updated = await authService.updateProfile({ name, timezone })
        setEditing(false)
        if (onProfileUpdated) onProfileUpdated(updated)
      } catch (err: unknown) {
        const message =
          err && typeof err === "object" && "response" in err
            ? (err as { response?: { data?: { message?: string } } }).response
                ?.data?.message || "Failed to update profile"
            : "Failed to update profile"
        setError(message)
      } finally {
        setSaving(false)
      }
    } else {
      setEditing(true)
    }
  }

  return (
    <section className="product-page profile-page">
      <div className="page-heading command-heading compact">
        <div>
          <p className="eyebrow">Account / Personal profile</p>
          <h1>
            Your place in
            <br />
            <em>the workspace.</em>
          </h1>
          <p>
            Manage your identity, security, and contribution to safer releases.
          </p>
          {error && (
            <p style={{ color: "#ef525e", fontSize: "13px", marginTop: "6px" }}>
              {error}
            </p>
          )}
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <button
            className={editing ? "primary-button" : "secondary-button"}
            onClick={handleSave}
            disabled={saving}
          >
            {editing ? (
              <>
                <Icon name="check" />
                {saving ? "Saving..." : "Save profile"}
              </>
            ) : (
              "Edit profile"
            )}
          </button>
          {onLogout && (
            <button
              className="secondary-button"
              onClick={onLogout}
              style={{
                color: "#ef525e",
                borderColor: "rgba(239, 82, 94, 0.4)",
              }}
            >
              Log out
            </button>
          )}
        </div>
      </div>
      <div className="profile-layout">
        <aside className="profile-card">
          <div className="profile-avatar">
            {userInitials}
            <span />
          </div>
          <h2>{currentUser?.name || "Account Member"}</h2>
          <p>{currentUser?.email || "—"}</p>
          <span className="role-badge">{roleDisplay}</span>
          <div className="profile-stats">
            <div>
              <strong>{totalScans}</strong>
              <span>{totalScans === 1 ? "scan run" : "scans run"}</span>
            </div>
            <div>
              <strong>{risksResolved}</strong>
              <span>
                {risksResolved === 1 ? "risk resolved" : "risks resolved"}
              </span>
            </div>
          </div>
          <small>Member since {memberSince}</small>
        </aside>
        <div className="profile-details">
          <div className="profile-section-head">
            <div>
              <p className="eyebrow">01 / Identity</p>
              <h2>Profile details</h2>
            </div>
            <span>{editing ? "Editing" : "Verified"}</span>
          </div>
          <div className="profile-fields">
            <label>
              <span>Full name</span>
              <input
                disabled={!editing}
                value={editing ? name : currentUser?.name || ""}
                placeholder="Your full name"
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              <span>Role</span>
              <input disabled value={roleDisplay} />
            </label>
            <label>
              <span>Email address</span>
              <input disabled value={currentUser?.email || "—"} />
            </label>
            <label>
              <span>Timezone</span>
              <select
                disabled={!editing}
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              >
                <option value="UTC">UTC (Coordinated Universal Time)</option>
                <option value="America/New_York">
                  Eastern Time (US & Canada)
                </option>
                <option value="America/Chicago">
                  Central Time (US & Canada)
                </option>
                <option value="America/Denver">
                  Mountain Time (US & Canada)
                </option>
                <option value="America/Los_Angeles">
                  Pacific Time (US & Canada)
                </option>
                <option value="Europe/London">London (GMT / BST)</option>
                <option value="Europe/Paris">Paris, Berlin (CET / CEST)</option>
                <option value="Asia/Kolkata">India Standard Time (IST)</option>
                <option value="Asia/Tokyo">Japan Standard Time (JST)</option>
                <option value="Australia/Sydney">Sydney (AEST / AEDT)</option>
              </select>
            </label>
          </div>
          <div className="profile-section-head security-head">
            <div>
              <p className="eyebrow">02 / Security</p>
              <h2>Account security</h2>
            </div>
          </div>
          <div className="profile-security">
            <div>
              <span className="security-icon">
                <Icon name="shield" />
              </span>
              <div>
                <strong>Password</strong>
                <p>Protected by cryptographic hashing</p>
              </div>
              <button>Change password</button>
            </div>
            <div>
              <span className={`security-icon ${is2FA ? "lime" : ""}`}>
                <Icon name={is2FA ? "check" : "shield"} />
              </span>
              <div>
                <strong>Two-factor authentication</strong>
                <p>
                  {is2FA
                    ? "Your account has an extra layer of security"
                    : "Not enabled — protect your account with 2FA"}
                </p>
              </div>
              <button>{is2FA ? "Manage 2FA" : "Enable 2FA"}</button>
            </div>
            {onLogout && (
              <div
                style={{
                  marginTop: "16px",
                  paddingTop: "16px",
                  borderTop: "1px solid #202a3a",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <strong>Session & Authentication</strong>
                  <p
                    style={{
                      margin: "2px 0 0",
                      fontSize: "12px",
                      color: "#768398",
                    }}
                  >
                    Sign out of your active workspace session.
                  </p>
                </div>
                <button
                  className="secondary-button"
                  onClick={onLogout}
                  style={{
                    color: "#ef525e",
                    borderColor: "rgba(239, 82, 94, 0.4)",
                  }}
                >
                  Log out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
