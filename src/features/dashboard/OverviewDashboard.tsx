import { Icon } from "../../components/common"
import type { Project } from "../../types"

interface OverviewDashboardProps {
  projects: Project[]
  search: string
  onSearchChange: (value: string) => void
  onOpenProject: () => void
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
              <strong>82</strong>
              <span>/ 100</span>
            </div>
            <div className="readiness-copy">
              <span className="verdict">Review before deploy</span>
              <h2>4 dependencies are blocking a clean release.</h2>
              <p>
                Three are abandoned and one contains unresolved security
                advisories.
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
              <i className="scale-marker" />
            </div>
            <p>
              <Icon name="activity" size={14} />
              Health improved by 2 points since your last scan
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
              All connected
            </small>
          </div>
          <div className="telemetry-row">
            <span>Packages observed</span>
            <strong>511</strong>
            <small>
              <Icon name="activity" size={12} />
              23 changed this week
            </small>
          </div>
          <div className="telemetry-row danger">
            <span>Critical signals</span>
            <strong>05</strong>
            <small>3 need action now</small>
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
      </section>

      <section className="project-list">
        {visibleProjects.map((project, index) => {
          const high = project.high ?? 0
          const medium = project.medium ?? 0
          const low = project.low ?? 0
          const total = high + medium + low || 1
          const isGitHub =
            project.sourceType === "github_repo" || project.source === "GitHub"

          return (
            <button
              className="project-card"
              key={project._id || project.name}
              onClick={onOpenProject}
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
      <button className="floating-action" onClick={onNewScan}>
        <Icon name="plus" />
        New scan
      </button>
    </>
  )
}
