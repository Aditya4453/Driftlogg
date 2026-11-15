import { useState } from "react"
import { Icon, RiskBadge, DonutChart } from "../../components/common"
import type { PackageDependency, Project } from "../../types"

interface ProjectDetailViewProps {
  project?: Project | null
  packages: PackageDependency[]
  riskFilter: string
  onRiskFilterChange: (filter: string) => void
  onInspectPackage: (pkg: PackageDependency) => void
  onGoBack: () => void
  onRunScan: () => void
}

export function ProjectDetailView({
  project,
  packages,
  riskFilter,
  onRiskFilterChange,
  onInspectPackage,
  onGoBack,
  onRunScan,
}: ProjectDetailViewProps) {
  const [packageSearch, setPackageSearch] = useState("")

  const totalCount = packages.length
  const highCount = packages.filter((pkg) => pkg.risk === "High").length
  const medCount = packages.filter((pkg) => pkg.risk === "Medium").length
  const lowCount = packages.filter((pkg) => pkg.risk === "Low").length

  const healthScore =
    totalCount > 0
      ? Math.max(10, Math.min(100, Math.round(100 - (highCount * 14 + medCount * 4))))
      : 100

  const projectName =
    project?.name || (totalCount > 0 ? "Observed Project" : "New Project")
  const repoUrl =
    project?.repositoryUrl ||
    project?.description ||
    project?.detail ||
    "Local manifest analysis"
  const isGitHub =
    project?.sourceType === "github_repo" || project?.source === "GitHub"

  const filteredPackages = packages
    .filter((pkg) =>
      riskFilter === "All risks" ? true : pkg.risk === riskFilter,
    )
    .filter((pkg) =>
      pkg.name.toLowerCase().includes(packageSearch.toLowerCase()),
    )

  return (
    <>
      <div className="breadcrumbs">
        <button onClick={onGoBack}>Projects</button>
        <Icon name="chevron" size={13} />
        <span>{projectName}</span>
      </div>
      <section className="project-heading">
        <div className="project-title">
          <div className="project-icon large">
            <Icon name={isGitHub ? "github" : "box"} />
          </div>
          <div>
            <h1>{projectName}</h1>
            <p>
              {repoUrl} {isGitHub && <span>main</span>}
            </p>
          </div>
        </div>
        <div className="project-actions">
          {project?.repositoryUrl && (
            <a
              href={project.repositoryUrl}
              target="_blank"
              rel="noreferrer"
              className="secondary-button"
            >
              <Icon name="github" />
              View repository
            </a>
          )}
          <button className="primary-button" onClick={onRunScan}>
            <Icon name="activity" />
            Run new scan
          </button>
        </div>
      </section>
      <div className="scan-meta">
        <span>
          <i className="online-dot" />
          {project?.updatedAt
            ? `Last scan ${new Date(project.updatedAt).toLocaleTimeString()}`
            : "Active scan session"}
        </span>
        <span>
          {totalCount} {totalCount === 1 ? "dependency" : "dependencies"} analyzed
        </span>
      </div>

      <section className="report-overview">
        <article className="risk-distribution">
          <div>
            <p className="eyebrow">Risk distribution</p>
            <h2>Package health overview</h2>
            <p>
              {totalCount === 0
                ? "No dependencies have been analyzed for this project."
                : highCount > 0
                  ? `Most dependencies are healthy, but ${highCount} ${highCount === 1 ? "package needs" : "packages need"} immediate review.`
                  : "All dependencies meet deployment readiness criteria."}
            </p>
            <div className="legend">
              <span>
                <i className="legend-high" />
                High <b>{highCount}</b>
              </span>
              <span>
                <i className="legend-med" />
                Medium <b>{medCount}</b>
              </span>
              <span>
                <i className="legend-low" />
                Low <b>{lowCount}</b>
              </span>
            </div>
          </div>
          <DonutChart
            total={totalCount}
            high={highCount}
            medium={medCount}
            low={lowCount}
          />
        </article>
        <article className="score-card">
          <span>Project health score</span>
          <strong>
            {totalCount > 0 ? healthScore : "—"}
            {totalCount > 0 && <small>/100</small>}
          </strong>
          <div className="score-track">
            <i
              style={{
                width: `${totalCount > 0 ? healthScore : 0}%`,
              }}
            />
          </div>
          <p>
            <Icon name="arrow" size={14} />
            {highCount === 0 ? "Clear release baseline" : `${highCount} blocker signals`}
          </p>
        </article>
        <article className="attention-card">
          <div className={`metric-icon ${highCount > 0 ? "red" : "lime"}`}>
            <Icon name="shield" />
          </div>
          <div>
            <span>{highCount > 0 ? "Action required" : "Release status"}</span>
            <strong>
              {highCount > 0
                ? `${highCount} high-risk ${highCount === 1 ? "package" : "packages"}`
                : "Clear to deploy"}
            </strong>
            <p>
              {highCount > 0
                ? "Resolve before your next deployment."
                : "No blocking maintainer or security signals detected."}
            </p>
          </div>
        </article>
      </section>

      <section className="dependencies-section">
        <div className="table-title">
          <div>
            <h2>Dependencies</h2>
            <span>
              {totalCount} {totalCount === 1 ? "package" : "packages"}
            </span>
          </div>
          {totalCount > 0 && (
            <div className="project-tools">
              <label className="search-field">
                <Icon name="search" size={16} />
                <input
                  placeholder="Search packages..."
                  value={packageSearch}
                  onChange={(e) => setPackageSearch(e.target.value)}
                />
              </label>
              <select
                value={riskFilter}
                onChange={(e) => onRiskFilterChange(e.target.value)}
              >
                <option>All risks</option>
                <option>High</option>
                <option>Medium</option>
                <option>Low</option>
              </select>
            </div>
          )}
        </div>
        {totalCount === 0 ? (
          <div
            className="empty-state"
            style={{
              padding: "48px 24px",
              textAlign: "center",
              border: "1px dashed #202a3a",
              borderRadius: "10px",
              background: "rgba(10, 15, 24, 0.4)",
              margin: "16px 0",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                marginBottom: "14px",
                color: "#6b81ff",
              }}
            >
              <Icon name="box" size={32} />
            </div>
            <h3
              style={{
                fontSize: "16px",
                color: "#f2f5f9",
                fontWeight: "600",
              }}
            >
              No dependencies analyzed yet
            </h3>
            <p
              style={{
                color: "#768398",
                fontSize: "13px",
                maxWidth: "380px",
                margin: "8px auto 16px",
                lineHeight: "1.5",
              }}
            >
              Run a scan on this project to inspect package vulnerabilities and
              maintainer drift signals.
            </p>
            <button className="primary-button" onClick={onRunScan}>
              <Icon name="activity" />
              Run scan now
            </button>
          </div>
        ) : filteredPackages.length === 0 ? (
          <div
            style={{
              padding: "36px 20px",
              textAlign: "center",
              color: "#768398",
              fontSize: "13px",
            }}
          >
            No dependencies match your search and filter criteria.
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Package</th>
                  <th>Version</th>
                  <th>Risk score</th>
                  <th>Risk</th>
                  <th>Warning reasons</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filteredPackages.map((pkg) => (
                  <tr key={pkg.name}>
                    <td>
                      <span className="package-cube">
                        <Icon name="box" size={15} />
                      </span>
                      <strong>{pkg.name}</strong>
                    </td>
                    <td>
                      <code>{pkg.version}</code>
                    </td>
                    <td>
                      <div className={`score-pill ${pkg.risk.toLowerCase()}`}>
                        <b>{pkg.score}</b>
                        <span>
                          <i style={{ width: `${pkg.score}%` }} />
                        </span>
                      </div>
                    </td>
                    <td>
                      <RiskBadge risk={pkg.risk} />
                    </td>
                    <td>
                      <div className="reason-list">
                        {pkg.reasons.map((reason) => (
                          <span key={reason}>{reason}</span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <button
                        className="inspect-button"
                        onClick={() => onInspectPackage(pkg)}
                      >
                        Inspect
                        <Icon name="chevron" size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
