import { useEffect, useState } from "react"
import { Icon } from "../../components/common"
import { adminService, type SystemStats } from "../../services"
import type { User, Project } from "../../types"

interface AdminDashboardProps {
  onBackToWorkspace: () => void
}

export function AdminDashboard({ onBackToWorkspace }: AdminDashboardProps) {
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<"users" | "projects">("users")

  const loadAdminData = async () => {
    setLoading(true)
    try {
      const [statsData, usersData, projectsData] = await Promise.all([
        adminService.getSystemStats(),
        adminService.getAllUsers(),
        adminService.getAllProjects(),
      ])
      setStats(statsData)
      setUsers(usersData)
      setProjects(projectsData)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAdminData()
  }, [])

  return (
    <section className="product-page admin-page">
      <div className="page-heading command-heading compact">
        <div>
          <p className="eyebrow">Platform Administration / System Audit</p>
          <h1>
            Global Telemetry
            <br />
            <em>& Access Control.</em>
          </h1>
          <p>
            Monitor cross-organization scan volume, risk signals, and
            provisioned user accounts.
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <button className="secondary-button" onClick={loadAdminData}>
            <Icon name="activity" size={14} />
            Refresh data
          </button>
          <button className="primary-button" onClick={onBackToWorkspace}>
            <Icon name="arrow" size={14} />
            Back to workspace
          </button>
        </div>
      </div>

      {stats && (
        <section className="metrics-grid">
          <div className="metric-card">
            <div className="metric-icon blue">
              <Icon name="box" />
            </div>
            <div>
              <span className="eyebrow" style={{ color: "#768398" }}>
                Total Users
              </span>
              <h2
                style={{ fontSize: "28px", fontWeight: "700", margin: "4px 0" }}
              >
                {stats.totalUsers}
              </h2>
              <small style={{ color: "#38d99f", fontSize: "11px" }}>
                All active accounts
              </small>
            </div>
          </div>

          <div className="metric-card">
            <div className="metric-icon blue">
              <Icon name="github" />
            </div>
            <div>
              <span className="eyebrow" style={{ color: "#768398" }}>
                Monitored Projects
              </span>
              <h2
                style={{ fontSize: "28px", fontWeight: "700", margin: "4px 0" }}
              >
                {stats.totalProjects}
              </h2>
              <small style={{ color: "#6b81ff", fontSize: "11px" }}>
                Across all repositories
              </small>
            </div>
          </div>

          <div className="metric-card">
            <div className="metric-icon blue">
              <Icon name="activity" />
            </div>
            <div>
              <span className="eyebrow" style={{ color: "#768398" }}>
                Total Scans Run
              </span>
              <h2
                style={{ fontSize: "28px", fontWeight: "700", margin: "4px 0" }}
              >
                {stats.totalScans}
              </h2>
              <small style={{ color: "#768398", fontSize: "11px" }}>
                Dependency runs
              </small>
            </div>
          </div>

          <div className="metric-card critical">
            <div
              className="metric-icon red"
              style={{
                background: "#2a1518",
                borderColor: "#7a2b34",
                color: "#ef525e",
              }}
            >
              <Icon name="shield" />
            </div>
            <div>
              <span className="eyebrow" style={{ color: "#ef525e" }}>
                High-Risk Alerts
              </span>
              <h2
                style={{
                  fontSize: "28px",
                  fontWeight: "700",
                  margin: "4px 0",
                  color: "#ef525e",
                }}
              >
                {stats.highRiskCount}
              </h2>
              <small style={{ color: "#ef525e", fontSize: "11px" }}>
                Require security review
              </small>
            </div>
          </div>
        </section>
      )}

      <div
        className="segment-control"
        style={{ maxWidth: "340px", marginBottom: "22px" }}
      >
        <button
          className={activeTab === "users" ? "active" : ""}
          onClick={() => setActiveTab("users")}
        >
          <Icon name="settings" size={15} />
          User directory ({users.length})
        </button>
        <button
          className={activeTab === "projects" ? "active" : ""}
          onClick={() => setActiveTab("projects")}
        >
          <Icon name="box" size={15} />
          Global codebases ({projects.length})
        </button>
      </div>

      {activeTab === "users" ? (
        <section className="dependencies-section">
          <div className="table-title">
            <div>
              <h2>System Users</h2>
              <span>{users.length} accounts provisioned</span>
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>User ID</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Registered</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u._id}>
                    <td>
                      <code>{u._id}</code>
                    </td>
                    <td>
                      <strong>{u.name}</strong>
                    </td>
                    <td>{u.email}</td>
                    <td>
                      <span
                        className="role-badge"
                        style={{
                          background:
                            u.role === "admin" ? "#2d1f4d" : "#172336",
                          color: u.role === "admin" ? "#c084fc" : "#7dd3fc",
                          border: `1px solid ${
                            u.role === "admin" ? "#6b21a8" : "#0284c7"
                          }`,
                          padding: "2px 8px",
                          borderRadius: "4px",
                          fontSize: "11px",
                        }}
                      >
                        {u.role.toUpperCase()}
                      </span>
                    </td>
                    <td>
                      <code>{new Date(u.createdAt).toLocaleDateString()}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="dependencies-section">
          <div className="table-title">
            <div>
              <h2>Global Monitored Codebases</h2>
              <span>{projects.length} connected repositories</span>
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th>Dependencies</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p._id}>
                    <td>
                      <strong>{p.name}</strong>
                      <br />
                      <small style={{ color: "#768398" }}>
                        {p.description || p.detail}
                      </small>
                    </td>
                    <td>
                      <span className="source-label">
                        <Icon
                          name={
                            p.sourceType === "github_repo" ? "github" : "file"
                          }
                          size={13}
                        />
                        {p.sourceType === "github_repo"
                          ? "GitHub"
                          : "package.json"}
                      </span>
                    </td>
                    <td>
                      <span
                        style={{
                          padding: "3px 8px",
                          borderRadius: "4px",
                          fontSize: "11px",
                          fontWeight: "600",
                          background:
                            p.status === "completed"
                              ? "rgba(56, 217, 159, 0.15)"
                              : "rgba(234, 179, 8, 0.15)",
                          color:
                            p.status === "completed" ? "#38d99f" : "#eab308",
                        }}
                      >
                        {p.status.toUpperCase()}
                      </span>
                    </td>
                    <td>
                      <strong>{p.deps || 0}</strong> packages
                    </td>
                    <td>
                      <code>{new Date(p.createdAt).toLocaleDateString()}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </section>
  )
}

export default AdminDashboard
