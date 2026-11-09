import { useState } from "react"
import { Icon, RiskBadge, DonutChart } from "../../components/common"
import type { PackageDependency } from "../../types"

interface ProjectDetailViewProps {
  packages: PackageDependency[]
  riskFilter: string
  onRiskFilterChange: (filter: string) => void
  onInspectPackage: (pkg: PackageDependency) => void
  onGoBack: () => void
  onRunScan: () => void
}

export function ProjectDetailView({
  packages,
  riskFilter,
  onRiskFilterChange,
  onInspectPackage,
  onGoBack,
  onRunScan,
}: ProjectDetailViewProps) {
  const [packageSearch, setPackageSearch] = useState("")

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
        <span>core-platform</span>
      </div>
      <section className="project-heading">
        <div className="project-title">
          <div className="project-icon large">
            <Icon name="github" />
          </div>
          <div>
            <h1>core-platform</h1>
            <p>
              github.com/acme/core-platform <span>main</span>
            </p>
          </div>
        </div>
        <div className="project-actions">
          <button className="secondary-button">
            <Icon name="github" />
            View repository
          </button>
          <button className="primary-button" onClick={onRunScan}>
            <Icon name="activity" />
            Run new scan
          </button>
        </div>
      </section>
      <div className="scan-meta">
        <span>
          <i className="online-dot" />
          Last scan completed 8 minutes ago
        </span>
        <span>148 dependencies analyzed in 12.4s</span>
      </div>

      <section className="report-overview">
        <article className="risk-distribution">
          <div>
            <p className="eyebrow">Risk distribution</p>
            <h2>Package health overview</h2>
            <p>
              Most dependencies are healthy, but <strong>4 packages</strong>{" "}
              need immediate review.
            </p>
            <div className="legend">
              <span>
                <i className="legend-high" />
                High <b>4</b>
              </span>
              <span>
                <i className="legend-med" />
                Medium <b>13</b>
              </span>
              <span>
                <i className="legend-low" />
                Low <b>131</b>
              </span>
            </div>
          </div>
          <DonutChart total={148} high={4} medium={13} low={131} />
        </article>
        <article className="score-card">
          <span>Project health score</span>
          <strong>
            82<small>/100</small>
          </strong>
          <div className="score-track">
            <i />
          </div>
          <p>
            <Icon name="arrow" size={14} />2 points since last scan
          </p>
        </article>
        <article className="attention-card">
          <div className="metric-icon red">
            <Icon name="shield" />
          </div>
          <div>
            <span>Action required</span>
            <strong>4 high-risk packages</strong>
            <p>Resolve before your next deployment.</p>
          </div>
        </article>
      </section>

      <section className="dependencies-section">
        <div className="table-title">
          <div>
            <h2>Dependencies</h2>
            <span>148 packages</span>
          </div>
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
        </div>
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
      </section>
    </>
  )
}
