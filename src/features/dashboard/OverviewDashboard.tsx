import { Icon } from "../../components/common"
import type { Project } from "../../types"

interface OverviewDashboardProps {
  projects: Project[]
  search: string
  onSearchChange: (value: string) => void
  onOpenProject: (projectId?: string) => void
  onNewScan: () => void
}

export function OverviewDashboard({
  projects,
  search,
  onSearchChange,
  onOpenProject,
  onNewScan,
}: OverviewDashboardProps) {
  const visibleProjects = projects.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.detail && p.detail.toLowerCase().includes(search.toLowerCase())) ||
      (p.description &&
        p.description.toLowerCase().includes(search.toLowerCase())),
  )

  const hasProjects = projects.length > 0
  const totalDeps = projects.reduce((sum, p) => sum + (p.deps ?? 0), 0)
  const totalHigh = projects.reduce((sum, p) => sum + (p.high ?? 0), 0)

  // Dynamic readiness calculation
  const readinessScore = hasProjects
    ? Math.max(10, Math.min(100, 100 - totalHigh * 6))
    : null

  const isBlocked = totalHigh > 0

  return (
    <>
      <section className="page-heading command-heading">
        <div>
          <p className="eyebrow">Preflight / Production workspace</p>
          <h1>
            Know what will break <em>before</em> it ships.
          </h1>
          <p>
            DriftLogg turns dependency noise into one clear deployment decision.
          </p>
        </div>
        <button className="primary-button desktop-action" onClick={onNewScan}>
          <Icon name="plus" />
          New scan
        </button>
      </section>

      <section className="control-grid">
        <article className="readiness-panel">
          <div className="panel-topline">
            <div>
              <span className="panel-index">01</span>
              <p className="eyebrow">Deployment readiness</p>
            </div>
            <span className="live-chip">
              <i />
              Live workspace
            </span>
          </div>
          <div className="readiness-core">
            <div className="readiness-score">
              <strong>{readinessScore !== null ? readinessScore : "—"}</strong>
              <span>/ 100</span>
            </div>
            <div className="readiness-copy">
              <span className={`verdict ${!hasProjects ? "ready" : isBlocked ? "review" : "ready"}`}>
                {!hasProjects
                  ? "Ready to scan"
                  : isBlocked
                    ? "Review before deploy"
                    : "Clear to deploy"}
              </span>
              <h2>
                {!hasProjects
                  ? "No dependencies analyzed yet."
                  : isBlocked
                    ? `${totalHigh} ${totalHigh === 1 ? "dependency is" : "dependencies are"} blocking a clean release.`
                    : "All observed codebases are currently clear to ship."}
              </h2>
              <p>
                {!hasProjects
                  ? "Connect a repository or manifest to establish baseline dependency intelligence."
                  : isBlocked
                    ? "High-risk signals detected. Resolve package deprecations or CVE advisories before deployment."
                    : "Zero critical dependency advisories found across your monitored codebases."}
              </p>
            </div>
          </div>
          <div className="readiness-scale">
            <div className="scale-labels">
              <span>Blocked</span>
              <span>Review</span>
              <span>Ready</span>
            </div>
            <div className="scale-track">
              <i
                className="scale-marker"
                style={{
                  left:
                    readinessScore !== null
                      ? `${readinessScore}%`
                      : "50%",
                }}
              />
            </div>
            <p>
              <Icon name="activity" size={14} />
              {!hasProjects
                ? "Awaiting your first repository scan"
                : isBlocked
                  ? `${totalHigh} high-risk items require engineer review`
                  : "All dependencies meet deployment readiness criteria"}
            </p>
          </div>
        </article>

        <article className="telemetry-panel">
          <div className="panel-topline">
            <div>
              <span className="panel-index">02</span>
              <p className="eyebrow">Workspace telemetry</p>
            </div>
          </div>
          <div className="telemetry-row">
            <span>Projects watched</span>
            <strong>{String(projects.length).padStart(2, "0")}</strong>
            <small>
              <i className="teal-dot" />
              {hasProjects ? "All connected" : "None connected"}
            </small>
          </div>
          <div className="telemetry-row">
            <span>Packages observed</span>
            <strong>{totalDeps}</strong>
            <small>
              <Icon name="activity" size={12} />
              {hasProjects ? `${totalDeps} total dependencies` : "No packages"}
            </small>
          </div>
          <div className={`telemetry-row ${totalHigh > 0 ? "danger" : ""}`}>
            <span>Critical signals</span>
            <strong>{String(totalHigh).padStart(2, "0")}</strong>
            <small>{totalHigh > 0 ? `${totalHigh} need action now` : "Zero critical blockers"}</small>
          </div>
        </article>
      </section>

      <section className="section-heading lane-heading">
        <div>
          <span className="panel-index">03</span>
          <div>
            <p className="eyebrow">Risk lanes</p>
            <h2>Where should you look first?</h2>
          </div>
        </div>
        {hasProjects && (
          <div className="project-tools">
            <label className="search-field">
              <Icon name="search" size={16} />
              <input
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search projects..."
              />
            </label>
            <button className="filter-button">
              Last scanned <span>⌄</span>
            </button>
          </div>
        )}
      </section>

      {!hasProjects ? (
        <div
          className="empty-state"
          style={{
            padding: "48px 24px",
            textAlign: "center",
            border: "1px dashed #202a3a",
            borderRadius: "10px",
            background: "rgba(10, 15, 24, 0.4)",
            marginBottom: "32px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "center", marginBottom: "14px", color: "#6b81ff" }}>
            <Icon name="box" size={36} />
          </div>
          <h3 style={{ fontSize: "17px", color: "#f2f5f9", fontWeight: "600" }}>
            No projects monitored yet
          </h3>
          <p
            style={{
              color: "#768398",
              fontSize: "13px",
              maxWidth: "420px",
              margin: "8px auto 20px",
              lineHeight: "1.5",
            }}
          >
            Run your first scan to analyze dependency risks, flag abandoned packages, and establish release readiness.
          </p>
          <button className="primary-button" onClick={onNewScan}>
            <Icon name="plus" />
            Run your first scan
          </button>
        </div>
      ) : (
        <section className="project-list">
          {visibleProjects.map((project, index) => {
            const high = project.high ?? 0
            const medium = project.medium ?? 0
            const low = project.low ?? 0
            const total = high + medium + low || 1
            const isGitHub =
              project.sourceType === "github_repo" ||
              project.source === "GitHub"

            return (
              <button
                className="project-card"
                key={project._id || project.name}
                onClick={() => onOpenProject(project._id)}
              >
                <span className="lane-number">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="project-main">
                  <div className="project-icon">
                    <Icon name={isGitHub ? "github" : "file"} />
                  </div>
                  <div>
                    <h3>{project.name}</h3>
                    <p>
                      {project.detail ||
                        project.description ||
                        project.repositoryUrl ||
                        "Configured repository"}
                    </p>
                  </div>
                </div>
                <div className="source-cell">
                  <span className="source-label">
                    <Icon name={isGitHub ? "github" : "file"} size={13} />
                    {isGitHub ? "GitHub" : "package.json"}
                  </span>
                  <small>Source</small>
                </div>
                <div className="deps-cell">
                  <strong>{project.deps ?? 0}</strong>
                  <small>Dependencies</small>
                </div>
                <div className="health-cell">
                  <div className="health-label">
                    <span>Dependency composition</span>
                    <strong className={high ? "danger-text" : ""}>
                      {high ? `${high} high risk` : "Healthy"}
                    </strong>
                  </div>
                  <div className="health-bar">
                    <i
                      className="low"
                      style={{ width: `${(low / total) * 100}%` }}
                    />
                    <i
                      className="medium"
                      style={{
                        width: `${(medium / total) * 100}%`,
                      }}
                    />
                    <i
                      className="high"
                      style={{ width: `${(high / total) * 100}%` }}
                    />
                  </div>
                </div>
                <div className="scan-cell">
                  <strong>{project.scanned || "Recently"}</strong>
                  <small>Last scan</small>
                </div>
                <span className={`deploy-verdict ${high ? "review" : "ready"}`}>
                  {high ? "Review" : "Ready"}
                </span>
                <Icon name="chevron" size={16} />
              </button>
            )
          })}
          {!visibleProjects.length && (
            <div className="empty-state">
              <Icon name="search" size={24} />
              <h3>No projects found</h3>
              <p>Try a different project name or source.</p>
            </div>
          )}
        </section>
      )}

      <button className="floating-action" onClick={onNewScan}>
        <Icon name="plus" />
        New scan
      </button>
    </>
  )
}
