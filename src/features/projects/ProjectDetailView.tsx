import { useEffect, useRef, useState } from "react"
import { Icon, RiskBadge, DonutChart } from "../../components/common"
import type {
  PackageDependency,
  Project,
  DeploymentScan,
  DeploymentFinding,
} from "../../types"
import deploymentService from "../../services/deployment.service"

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
  // Navigation Tabs: 'dependency' vs 'deployment'
  const [activeTab, setActiveTab] = useState<"dependency" | "deployment">(
    "dependency",
  )

  // Dependency Filter States
  const [packageSearch, setPackageSearch] = useState("")
  const [scopeFilter, setScopeFilter] =
    useState<"All" | "Direct" | "Transitive">("All")

  // Deployment Readiness States
  const [deployScan, setDeployScan] = useState<DeploymentScan | null>(null)
  const [deployRunning, setDeployRunning] = useState(false)
  const [deployTarget, setDeployTarget] = useState<string>("auto")
  const [severityFilter, setSeverityFilter] = useState<string>("all")
  const [expandedPatches, setExpandedPatches] =
    useState<Record<string, boolean>>({})
  const [copiedPatchId, setCopiedPatchId] = useState<string | null>(null)
  const [traceOpen, setTraceOpen] = useState(true)

  const deployPollingTimerRef = useRef<number | null>(null)

  // Load latest deployment report whenever project changes
  useEffect(() => {
    let mounted = true
    if (project?._id) {
      deploymentService
        .getLatestDeploymentReport(project._id)
        .then((latest) => {
          if (mounted && latest) {
            setDeployScan(latest)
          }
        })
        .catch(() => {
          // Ignore
        })
    }
    return () => {
      mounted = false
      if (deployPollingTimerRef.current) {
        window.clearInterval(deployPollingTimerRef.current)
      }
    }
  }, [project?._id])

  const handleStartDeploymentScan = async () => {
    if (!project?._id || deployRunning) return
    setDeployRunning(true)
    setTraceOpen(true)

    try {
      const scan = await deploymentService.startDeploymentScan(
        project._id,
        deployTarget,
      )
      setDeployScan(scan)

      if (deployPollingTimerRef.current) {
        window.clearInterval(deployPollingTimerRef.current)
      }

      deployPollingTimerRef.current = window.setInterval(async () => {
        try {
          const latest = await deploymentService.getDeploymentScan(scan._id)
          setDeployScan(latest)

          if (latest.status === "completed" || latest.status === "failed") {
            if (deployPollingTimerRef.current) {
              window.clearInterval(deployPollingTimerRef.current)
              deployPollingTimerRef.current = null
            }
            setDeployRunning(false)
          }
        } catch {
          if (deployPollingTimerRef.current) {
            window.clearInterval(deployPollingTimerRef.current)
            deployPollingTimerRef.current = null
          }
          setDeployRunning(false)
        }
      }, 800)
    } catch {
      setDeployRunning(false)
    }
  }

  const togglePatch = (id: string) => {
    setExpandedPatches((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const copyPatchToClipboard = (id: string, patchText: string) => {
    navigator.clipboard.writeText(patchText)
    setCopiedPatchId(id)
    setTimeout(() => {
      setCopiedPatchId(null)
    }, 2000)
  }

  const totalCount = packages.length
  const highCount = packages.filter((pkg) => pkg.risk === "High").length
  const medCount = packages.filter((pkg) => pkg.risk === "Medium").length
  const lowCount = packages.filter((pkg) => pkg.risk === "Low").length
  const directCount = packages.filter((pkg) => pkg.isDirect !== false).length
  const transitiveCount = packages.filter(
    (pkg) => pkg.isDirect === false,
  ).length

  const healthScore =
    totalCount > 0
      ? Math.max(
          10,
          Math.min(100, Math.round(100 - (highCount * 14 + medCount * 4))),
        )
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

  const normalizedRisk =
    riskFilter === "All risks" || riskFilter === "All"
      ? "all"
      : riskFilter.toLowerCase()

  const filteredPackages = packages.filter((pkg) => {
    if (normalizedRisk !== "all" && pkg.risk.toLowerCase() !== normalizedRisk) {
      return false
    }
    if (scopeFilter === "Direct" && pkg.isDirect === false) {
      return false
    }
    if (scopeFilter === "Transitive" && pkg.isDirect !== false) {
      return false
    }
    if (
      packageSearch &&
      !pkg.name.toLowerCase().includes(packageSearch.toLowerCase())
    ) {
      return false
    }
    return true
  })

  // Filter deployment findings
  const rawFindings = deployScan?.findings || []
  const filteredFindings = rawFindings.filter((f) => {
    if (severityFilter === "all") return true
    return f.severity === severityFilter
  })

  const blockerCount = rawFindings.filter(
    (f) => f.severity === "blocker",
  ).length
  const warningCount = rawFindings.filter(
    (f) => f.severity === "warning",
  ).length
  const infoCount = rawFindings.filter((f) => f.severity === "info").length

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
          {activeTab === "dependency" ? (
            <button className="primary-button" onClick={onRunScan}>
              <Icon name="activity" />
              Run new scan
            </button>
          ) : (
            <button
              className="primary-button"
              onClick={handleStartDeploymentScan}
              disabled={deployRunning}
            >
              <Icon name="shield" />
              {deployRunning ? "Analyzing deploy..." : "Run Deployment Check"}
            </button>
          )}
        </div>
      </section>

      {/* Tab Switcher: Dependency Risk vs Deployment Readiness */}
      <div className="detail-tabs">
        <button
          className={`detail-tab ${activeTab === "dependency" ? "active" : ""}`}
          onClick={() => setActiveTab("dependency")}
        >
          <Icon name="box" size={15} />
          <span>Dependency Risk</span>
          <span className="tab-pill">{totalCount}</span>
        </button>
        <button
          className={`detail-tab ${activeTab === "deployment" ? "active" : ""}`}
          onClick={() => setActiveTab("deployment")}
        >
          <Icon name="shield" size={15} />
          <span>Deployment Readiness</span>
          {deployScan?.verdict && (
            <span className={`tab-verdict-pill ${deployScan.verdict}`}>
              {deployScan.verdict === "ready"
                ? "Ready"
                : deployScan.verdict === "needs-fixes"
                  ? "Needs Fixes"
                  : "Will Fail"}
            </span>
          )}
        </button>
      </div>

      {activeTab === "dependency" ? (
        <>
          <div className="scan-meta">
            <span>
              <i className="online-dot" />
              {project?.updatedAt
                ? `Last scan ${new Date(project.updatedAt).toLocaleTimeString()}`
                : "Active scan session"}
            </span>
            <span>
              {totalCount} {totalCount === 1 ? "dependency" : "dependencies"}{" "}
              analyzed
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
                      ? `Most dependencies are healthy, but ${highCount} ${
                          highCount === 1 ? "package needs" : "packages need"
                        } immediate review.`
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
                {highCount === 0
                  ? "Clear release baseline"
                  : `${highCount} blocker signals`}
              </p>
            </article>
            <article className="attention-card">
              <div className={`metric-icon ${highCount > 0 ? "red" : "lime"}`}>
                <Icon name="shield" />
              </div>
              <div>
                <span>
                  {highCount > 0 ? "Action required" : "Release status"}
                </span>
                <strong>
                  {highCount > 0
                    ? `${highCount} high-risk ${
                        highCount === 1 ? "package" : "packages"
                      }`
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
            <div
              className="table-title"
              style={{ flexWrap: "wrap", gap: "14px" }}
            >
              <div
                style={{ display: "flex", alignItems: "center", gap: "10px" }}
              >
                <h2>Dependencies</h2>
                <span>
                  {totalCount} {totalCount === 1 ? "package" : "packages"}
                </span>
              </div>
              {totalCount > 0 && (
                <div
                  className="project-tools"
                  style={{ flexWrap: "wrap", gap: "10px" }}
                >
                  <div className="filter-pills-bar">
                    <button
                      type="button"
                      className={`filter-pill-button ${
                        normalizedRisk === "all" ? "active" : ""
                      }`}
                      onClick={() => onRiskFilterChange("All risks")}
                    >
                      All ({totalCount})
                    </button>
                    <button
                      type="button"
                      className={`filter-pill-button ${
                        normalizedRisk === "high" ? "active" : ""
                      }`}
                      onClick={() => onRiskFilterChange("High")}
                    >
                      High ({highCount})
                    </button>
                    <button
                      type="button"
                      className={`filter-pill-button ${
                        normalizedRisk === "medium" ? "active" : ""
                      }`}
                      onClick={() => onRiskFilterChange("Medium")}
                    >
                      Med ({medCount})
                    </button>
                    <button
                      type="button"
                      className={`filter-pill-button ${
                        normalizedRisk === "low" ? "active" : ""
                      }`}
                      onClick={() => onRiskFilterChange("Low")}
                    >
                      Low ({lowCount})
                    </button>
                  </div>

                  <div
                    className="filter-pills-bar"
                    style={{
                      borderLeft: "1px solid #202a3a",
                      paddingLeft: "8px",
                      marginLeft: "4px",
                    }}
                  >
                    <button
                      type="button"
                      className={`filter-pill-button ${
                        scopeFilter === "All" ? "active" : ""
                      }`}
                      onClick={() => setScopeFilter("All")}
                    >
                      All scopes
                    </button>
                    <button
                      type="button"
                      className={`filter-pill-button ${
                        scopeFilter === "Direct" ? "active" : ""
                      }`}
                      onClick={() => setScopeFilter("Direct")}
                    >
                      Direct ({directCount})
                    </button>
                    <button
                      type="button"
                      className={`filter-pill-button ${
                        scopeFilter === "Transitive" ? "active" : ""
                      }`}
                      onClick={() => setScopeFilter("Transitive")}
                    >
                      Transitive ({transitiveCount})
                    </button>
                  </div>

                  <label className="search-field">
                    <Icon name="search" size={16} />
                    <input
                      placeholder="Search packages..."
                      value={packageSearch}
                      onChange={(e) => setPackageSearch(e.target.value)}
                    />
                  </label>
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
                  Run a scan on this project to inspect package vulnerabilities
                  and maintainer drift signals.
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
                      <tr key={`${pkg.name}@${pkg.version}`}>
                        <td>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "10px",
                            }}
                          >
                            <span className="package-cube">
                              <Icon name="box" size={15} />
                            </span>
                            <div>
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "8px",
                                }}
                              >
                                <strong>{pkg.name}</strong>
                                <span
                                  className={`dep-badge ${
                                    pkg.isDirect !== false
                                      ? "direct"
                                      : "transitive"
                                  }`}
                                >
                                  {pkg.isDirect !== false
                                    ? "Direct"
                                    : "Transitive"}
                                </span>
                              </div>
                              {pkg.workspace && (
                                <small
                                  style={{
                                    color: "#768398",
                                    fontSize: "10px",
                                    display: "block",
                                  }}
                                >
                                  {pkg.workspace}
                                </small>
                              )}
                            </div>
                          </div>
                        </td>
                        <td>
                          <code>{pkg.version}</code>
                        </td>
                        <td>
                          <div
                            className={`score-pill ${pkg.risk.toLowerCase()}`}
                          >
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
      ) : (
        /* Deployment Readiness View */
        <section className="deployment-readiness-view">
          {/* Action Bar */}
          <div className="deploy-action-bar">
            <div className="deploy-target-select">
              <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                Target Platform:
              </span>
              <select
                value={deployTarget}
                onChange={(e) => setDeployTarget(e.target.value)}
                disabled={deployRunning}
              >
                <option value="auto">Auto (Detect from repository)</option>
                <option value="render">Render (Web Service & Workers)</option>
                <option value="vercel">Vercel (Serverless & Frontend)</option>
                <option value="docker">
                  Docker (Containerized Deployment)
                </option>
              </select>
            </div>
            <button
              className="primary-button"
              onClick={handleStartDeploymentScan}
              disabled={deployRunning}
            >
              <Icon name="shield" />
              {deployRunning ? "Analyzing deploy..." : "Run Deployment Check"}
            </button>
          </div>

          {/* Overview Metric Cards */}
          <div className="deploy-summary-grid">
            <article className="deploy-card">
              <span className="eyebrow">Deployment score</span>
              <div className="deploy-score-value">
                <strong>{deployScan?.score ?? "—"}</strong>
                {deployScan?.score !== null &&
                  deployScan?.score !== undefined && <small>/100</small>}
              </div>
              <div className="score-track" style={{ marginBottom: "12px" }}>
                <i
                  style={{
                    width: `${deployScan?.score ?? 0}%`,
                    background:
                      (deployScan?.score ?? 0) >= 80
                        ? "var(--lime)"
                        : (deployScan?.score ?? 0) >= 41
                          ? "#f59e0b"
                          : "#ef4444",
                  }}
                />
              </div>
              <span style={{ fontSize: "11px", color: "var(--muted)" }}>
                {deployScan?.status === "completed"
                  ? `Evaluated against ${deployScan?.target || "cloud"} rules`
                  : deployRunning
                    ? "Evaluating repository..."
                    : "No check executed yet"}
              </span>
            </article>

            <article className="deploy-card">
              <span className="eyebrow">Release verdict</span>
              <div style={{ margin: "10px 0" }}>
                {deployScan?.verdict ? (
                  <span className={`tab-verdict-pill ${deployScan.verdict}`}>
                    {deployScan.verdict === "ready"
                      ? "Clear to deploy"
                      : deployScan.verdict === "needs-fixes"
                        ? "Review before deploy"
                        : "Will fail deploy"}
                  </span>
                ) : (
                  <span style={{ color: "var(--muted)", fontSize: "14px" }}>
                    {deployRunning ? "Analyzing..." : "Awaiting scan"}
                  </span>
                )}
              </div>
              <p
                style={{
                  fontSize: "12px",
                  color: "var(--text-2)",
                  lineHeight: "1.4",
                  marginTop: "auto",
                }}
              >
                {deployScan?.verdict === "ready"
                  ? "Zero critical deployment blockers found."
                  : deployScan?.verdict === "needs-fixes"
                    ? "Likely configuration traps require engineer review."
                    : deployScan?.verdict === "will-fail"
                      ? `${blockerCount} confirmed blocker traps will break deployment.`
                      : "Run deployment check to predict build & boot outcome."}
              </p>
            </article>

            <article className="deploy-card">
              <span className="eyebrow">Detected stack</span>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                  margin: "8px 0",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "12px",
                  }}
                >
                  <span style={{ color: "var(--muted)" }}>Target</span>
                  <strong style={{ color: "var(--text)" }}>
                    {deployScan?.target || "—"}
                  </strong>
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "12px",
                  }}
                >
                  <span style={{ color: "var(--muted)" }}>Topology</span>
                  <strong style={{ color: "var(--text)" }}>
                    {deployScan?.appShape || "—"}
                  </strong>
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "12px",
                  }}
                >
                  <span style={{ color: "var(--muted)" }}>Package Mgr</span>
                  <strong style={{ color: "var(--text)" }}>
                    {deployScan?.packageManager || "npm"}
                  </strong>
                </div>
              </div>
              {deployScan?.commitSha && (
                <small
                  style={{
                    color: "var(--muted)",
                    fontFamily: "DM Mono",
                    marginTop: "auto",
                  }}
                >
                  SHA: {deployScan.commitSha.slice(0, 8)}
                </small>
              )}
            </article>

            <article className="deploy-card">
              <span className="eyebrow">Static coverage</span>
              <div className="deploy-score-value">
                <strong>{deployScan?.coverage ?? 100}</strong>
                <small>%</small>
              </div>
              <div style={{ display: "flex", gap: "8px", marginTop: "auto" }}>
                <span className="deploy-badge blocker">
                  {blockerCount} Blockers
                </span>
                <span className="deploy-badge warning">
                  {warningCount} Warnings
                </span>
              </div>
            </article>
          </div>

          {/* Findings & Fix Plan */}
          <div className="findings-section">
            <div className="findings-header">
              <div>
                <p className="eyebrow">Predicted issues</p>
                <h2>Deployment Findings & Fix Plan ({rawFindings.length})</h2>
              </div>
              {rawFindings.length > 0 && (
                <div className="filter-pills-bar">
                  <button
                    className={`filter-pill-button ${
                      severityFilter === "all" ? "active" : ""
                    }`}
                    onClick={() => setSeverityFilter("all")}
                  >
                    All ({rawFindings.length})
                  </button>
                  <button
                    className={`filter-pill-button ${
                      severityFilter === "blocker" ? "active" : ""
                    }`}
                    onClick={() => setSeverityFilter("blocker")}
                  >
                    Blockers ({blockerCount})
                  </button>
                  <button
                    className={`filter-pill-button ${
                      severityFilter === "warning" ? "active" : ""
                    }`}
                    onClick={() => setSeverityFilter("warning")}
                  >
                    Warnings ({warningCount})
                  </button>
                  <button
                    className={`filter-pill-button ${
                      severityFilter === "info" ? "active" : ""
                    }`}
                    onClick={() => setSeverityFilter("info")}
                  >
                    Info ({infoCount})
                  </button>
                </div>
              )}
            </div>

            {rawFindings.length === 0 ? (
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
                    color: "var(--lime)",
                  }}
                >
                  <Icon name="check" size={32} />
                </div>
                <h3
                  style={{
                    fontSize: "16px",
                    color: "#f2f5f9",
                    fontWeight: "600",
                  }}
                >
                  {deployScan?.status === "completed"
                    ? "Zero deployment blockers detected"
                    : "No deployment check executed yet"}
                </h3>
                <p
                  style={{
                    color: "#768398",
                    fontSize: "13px",
                    maxWidth: "420px",
                    margin: "8px auto 16px",
                    lineHeight: "1.5",
                  }}
                >
                  {deployScan?.status === "completed"
                    ? "All relative imports, ports, secrets, health checks, and build scripts strictly satisfy cloud deployment criteria."
                    : "Run a deployment check to statically scan your repo for port traps, casing mismatches, and cloud orchestrator pitfalls."}
                </p>
                {!deployRunning && (
                  <button
                    className="primary-button"
                    onClick={handleStartDeploymentScan}
                  >
                    <Icon name="shield" />
                    Run check now
                  </button>
                )}
              </div>
            ) : filteredFindings.length === 0 ? (
              <div
                style={{
                  padding: "32px",
                  textAlign: "center",
                  color: "var(--muted)",
                  fontSize: "13px",
                }}
              >
                No findings match the selected filter.
              </div>
            ) : (
              <div className="findings-list">
                {filteredFindings.map(
                  (finding: DeploymentFinding, idx: number) => {
                    const findingId = `${finding.ruleId}-${finding.file}-${finding.line}-${idx}`
                    const hasPatch = Boolean(finding.fix?.patch)
                    const isPatchOpen = Boolean(expandedPatches[findingId])

                    return (
                      <article
                        key={findingId}
                        className={`finding-card ${finding.severity}`}
                      >
                        <div className="finding-top">
                          <div className="finding-meta">
                            <span
                              className={`deploy-badge ${finding.severity}`}
                            >
                              {finding.severity}
                            </span>
                            <span
                              className={`deploy-badge ${finding.confidence}`}
                            >
                              {finding.confidence}
                            </span>
                            <span className="finding-rule-id">
                              {finding.ruleId}
                            </span>
                            <span
                              style={{
                                fontSize: "10px",
                                padding: "2px 6px",
                                borderRadius: "4px",
                                background: "rgba(255,255,255,0.05)",
                                color: "var(--muted)",
                                textTransform: "uppercase",
                              }}
                            >
                              {finding.platform}
                            </span>
                          </div>
                          <span className="finding-file">
                            {finding.file}
                            {finding.line ? `:${finding.line}` : ""}
                          </span>
                        </div>

                        <div className="finding-message">{finding.message}</div>

                        {finding.snippet && (
                          <div className="finding-snippet">
                            <code>{finding.snippet}</code>
                          </div>
                        )}

                        {finding.fix && (
                          <div className="finding-fix">
                            <div className="finding-fix-header">
                              <span
                                style={{
                                  fontSize: "12px",
                                  fontWeight: "600",
                                  color: "var(--lime)",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "6px",
                                }}
                              >
                                <Icon name="check" size={14} />
                                Recommended Fix: {finding.fix.description}
                              </span>
                              {hasPatch && (
                                <div style={{ display: "flex", gap: "8px" }}>
                                  <button
                                    className="secondary-button"
                                    style={{
                                      padding: "4px 8px",
                                      fontSize: "11px",
                                    }}
                                    onClick={() =>
                                      copyPatchToClipboard(
                                        findingId,
                                        finding.fix!.patch,
                                      )
                                    }
                                  >
                                    {copiedPatchId === findingId
                                      ? "Copied!"
                                      : "Copy Patch"}
                                  </button>
                                  <button
                                    className="secondary-button"
                                    style={{
                                      padding: "4px 8px",
                                      fontSize: "11px",
                                    }}
                                    onClick={() => togglePatch(findingId)}
                                  >
                                    {isPatchOpen ? "Hide Diff" : "View Diff"}
                                  </button>
                                </div>
                              )}
                            </div>

                            {hasPatch && isPatchOpen && (
                              <pre className="diff-patch">
                                {finding.fix.patch
                                  .split("\n")
                                  .map((diffLine, lIdx) => {
                                    let lineClass = ""
                                    if (diffLine.startsWith("+"))
                                      lineClass = "diff-line-add"
                                    else if (diffLine.startsWith("-"))
                                      lineClass = "diff-line-del"
                                    else if (diffLine.startsWith("@"))
                                      lineClass = "diff-line-hdr"
                                    return (
                                      <span key={lIdx} className={lineClass}>
                                        {diffLine}
                                      </span>
                                    )
                                  })}
                              </pre>
                            )}
                          </div>
                        )}
                      </article>
                    )
                  },
                )}
              </div>
            )}
          </div>

          {/* Live Pipeline Execution Trace */}
          {deployScan?.logs && deployScan.logs.length > 0 && (
            <div className="pipeline-trace" style={{ marginTop: "32px" }}>
              <div
                className="pipeline-trace-header"
                onClick={() => setTraceOpen(!traceOpen)}
                style={{ cursor: "pointer" }}
              >
                <div className="pipeline-trace-title">
                  <span className="live-chip" style={{ marginRight: "10px" }}>
                    <i />
                    Live Trace
                  </span>
                  <strong style={{ fontSize: "13px", color: "var(--text)" }}>
                    Pipeline Execution Log ({deployScan.logs.length} events)
                  </strong>
                </div>
                <button
                  type="button"
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--muted)",
                    cursor: "pointer",
                    fontSize: "12px",
                  }}
                >
                  {traceOpen ? "Collapse ▴" : "Expand ▾"}
                </button>
              </div>

              {traceOpen && (
                <div className="pipeline-trace-body">
                  {deployScan.logs.map((log, index) => (
                    <div key={index} className="trace-log-line">
                      <span className="trace-timestamp">
                        {log.timestamp
                          ? new Date(log.timestamp).toLocaleTimeString()
                          : "--:--:--"}
                      </span>
                      <span className={`trace-stage-badge ${log.stage}`}>
                        {log.stage}
                      </span>
                      <span className={`trace-log-content ${log.level}`}>
                        {log.message}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </>
  )
}
