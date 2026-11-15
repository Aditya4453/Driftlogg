import { useState } from "react"
import { Icon } from "../../components/common"
import type { User } from "../../types"

interface ProfilePageProps {
  currentUser?: User | null
  onLogout?: () => void
}

export function ProfilePage({ currentUser, onLogout }: ProfilePageProps) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(currentUser?.name || "")

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
    : "March 2025"

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
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <button
            className={editing ? "primary-button" : "secondary-button"}
            onClick={() => setEditing(!editing)}
          >
            {editing ? (
              <>
                <Icon name="check" />
                Save profile
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
          <h2>{currentUser?.name || "Devon Rivera"}</h2>
          <p>{currentUser?.email || "devon@acme.dev"}</p>
          <span className="role-badge">{roleDisplay}</span>
          <div className="profile-stats">
            <div>
              <strong>12</strong>
              <span>scans run</span>
            </div>
            <div>
              <strong>7</strong>
              <span>risks resolved</span>
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
                value={editing ? name : currentUser?.name || "Devon Rivera"}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              <span>Role</span>
              <input disabled value={roleDisplay} />
            </label>
            <label>
              <span>Email address</span>
              <input disabled value={currentUser?.email || "devon@acme.dev"} />
            </label>
            <label>
              <span>Timezone</span>
              <select disabled={!editing} defaultValue="utc-8">
                <option value="utc-8">Pacific Time (UTC−8)</option>
                <option value="utc">UTC</option>
                <option value="utc+1">Central European Time</option>
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
              <span className="security-icon lime">
                <Icon name="check" />
              </span>
              <div>
                <strong>Two-factor authentication</strong>
                <p>Your account has an extra layer of security</p>
              </div>
              <button>Manage 2FA</button>
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
