import { useState, useRef, useEffect } from "react"
import { Icon } from "../../components/common"
import type { Scan } from "../../types"

export interface ScanPageProps {
  mode: "github" | "upload"
  setMode: (mode: "github" | "upload") => void
  running: boolean
  stage?: number
  activeScan?: Scan | null
  onAnalyze: (payload: {
    sourceType: "package_json" | "github_repo"
    repositoryUrl?: string
    packageJson?: Record<string, unknown>
    packageLockJson?: Record<string, unknown>
  }) => void
  onBack: () => void
}

export function ScanPage({
  mode,
  setMode,
  running,
  stage = 2,
  activeScan,
  onAnalyze,
  onBack,
}: ScanPageProps) {
  const [repoUrl, setRepoUrl] = useState(
    "https://github.com/acme/core-platform",
  )
  const [jsonText, setJsonText] = useState(
    '{\n  "dependencies": {\n    "react": "^19.0.0"\n  }\n}',
  )
  const [isDragging, setIsDragging] = useState(false)
  const [traceCollapsed, setTraceCollapsed] = useState(false)
  const traceEndRef = useRef<HTMLDivElement>(null)
  const [parsedPackageJson, setParsedPackageJson] =
    useState<Record<string, unknown> | null>(null)
  const [parsedPackageLockJson, setParsedPackageLockJson] =
    useState<Record<string, unknown> | null>(null)
  const [uploadedFiles, setUploadedFiles] = useState<{
    pkgName?: string
    lockName?: string
    depCount?: number
  } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!traceCollapsed && activeScan?.logs?.length) {
      traceEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }, [activeScan?.logs?.length, traceCollapsed])

  const handleFiles = (files: FileList | File[]) => {
    const fileArray = Array.from(files)
    fileArray.forEach((file) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        try {
          const content = e.target?.result as string
          const parsed = JSON.parse(content)
          if (/package-lock\.json$/i.test(file.name)) {
            setParsedPackageLockJson(parsed)
            setUploadedFiles((prev) => ({
              ...prev,
              lockName: file.name,
            }))
          } else {
            setParsedPackageJson(parsed)
            setJsonText(content)
            const depCount = Object.keys({
              ...(parsed.dependencies || {}),
              ...(parsed.devDependencies || {}),
            }).length
            setUploadedFiles((prev) => ({
              ...prev,
              pkgName: file.name,
              depCount,
            }))
          }
        } catch (err) {
          console.error("Failed to parse JSON file", err)
        }
      }
      reader.readAsText(file)
    })
  }

  const handleSubmit = () => {
    if (mode === "github") {
      onAnalyze({
        sourceType: "github_repo",
        repositoryUrl: repoUrl.trim(),
      })
    } else {
      let packageJson = parsedPackageJson
      if (!packageJson) {
        try {
          packageJson = JSON.parse(jsonText)
        } catch {
          packageJson = { raw: jsonText }
        }
      }
      onAnalyze({
        sourceType: "package_json",
        packageJson: packageJson || undefined,
        packageLockJson: parsedPackageLockJson || undefined,
      })
    }
  }

  if (running || activeScan?.status === "failed") {
    const isFailed = activeScan?.status === "failed"

    return (
      <section className="scan-processing product-page">
        <div className="processing-visual">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <span
            className="processing-core"
            style={isFailed ? { color: "#ef4444", borderColor: "#ef4444" } : {}}
          >
            <Icon name={isFailed ? "shield" : "activity"} size={28} />
          </span>
        </div>
        <p className="eyebrow">
          {isFailed
            ? "Scan Terminated / Pipeline Failure"
            : "Scan in progress / Polling live status"}
        </p>
        <h1>
          {isFailed ? (
            <>
              Pipeline Execution
              <br />
              Halted with Error.
            </>
          ) : (
            <>
              Reading the signals
              <br />
              behind your packages.
            </>
          )}
        </h1>
        <p className="processing-note">
          {isFailed
            ? "An error occurred during manifest analysis. Detailed execution trace below."
            : "Analysis continues in the background. Polling worker pipeline..."}
        </p>

        {isFailed && activeScan?.errorMessage && (
          <div
            style={{
              width: "100%",
              maxWidth: "720px",
              margin: "20px auto 0",
              padding: "14px 18px",
              borderRadius: "8px",
              border: "1px solid rgba(239, 68, 68, 0.4)",
              background: "rgba(239, 68, 68, 0.12)",
              color: "#fca5a5",
              textAlign: "left",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                fontWeight: "600",
                fontSize: "13px",
                color: "#ef4444",
                marginBottom: "4px",
              }}
            >
              <Icon name="shield" size={15} />
              Pipeline Failure Reason
            </div>
            <p
              style={{
                fontFamily: "var(--font-mono, monospace)",
                fontSize: "12px",
                lineHeight: "1.4",
              }}
            >
              {activeScan.errorMessage}
            </p>
            <button
              type="button"
              className="secondary-button"
              style={{ marginTop: "12px", height: "30px", fontSize: "11px" }}
              onClick={onBack}
            >
              Back to workspace
            </button>
          </div>
        )}

        <div className="processing-steps">
          <div className={stage >= 1 ? "done" : "active"}>
            <span>{stage >= 1 ? <Icon name="check" size={13} /> : <i />}</span>
            <p>
              <strong>Repository connected</strong>
              <small>Manifest discovered on main</small>
            </p>
            <code>0.8s</code>
          </div>
          <div className={stage > 2 ? "done" : stage === 2 ? "active" : ""}>
            <span>
              {stage > 2 ? (
                <Icon name="check" size={13} />
              ) : stage === 2 ? (
                <i />
              ) : (
                "02"
              )}
            </span>
            <p>
              <strong>Fetching npm registry</strong>
              <small>Resolving package records & metadata</small>
            </p>
            <code>{stage > 2 ? "1.2s" : "RUNNING"}</code>
          </div>
          <div className={stage > 3 ? "done" : stage === 3 ? "active" : ""}>
            <span>
              {stage > 3 ? (
                <Icon name="check" size={13} />
              ) : stage === 3 ? (
                <i />
              ) : (
                "03"
              )}
            </span>
            <p>
              <strong>Calculating health metrics</strong>
              <small>Maintenance, activity, and security</small>
            </p>
            <code>
              {stage > 3 ? "0.6s" : stage === 3 ? "RUNNING" : "QUEUED"}
            </code>
          </div>
          <div className={stage >= 4 ? "done" : ""}>
            <span>{stage >= 4 ? <Icon name="check" size={13} /> : "04"}</span>
            <p>
              <strong>Building release verdict</strong>
              <small>Translating evidence into action</small>
            </p>
            <code>{stage >= 4 ? "COMPLETE" : "QUEUED"}</code>
          </div>
        </div>

        {/* Live Pipeline Execution Trace */}
        <div className="pipeline-trace" style={{ margin: "28px auto 0" }}>
          <div className="pipeline-trace-header">
            <div className="pipeline-trace-title">
              <i
                className="online-dot"
                style={{
                  background: isFailed
                    ? "#ef4444"
                    : running
                      ? "#38d99f"
                      : "#6b81ff",
                  boxShadow: isFailed
                    ? "0 0 8px #ef4444"
                    : "0 0 8px rgba(56, 217, 159, 0.6)",
                }}
              />
              Pipeline Execution Trace ({activeScan?.logs?.length || 0})
            </div>
            <button
              type="button"
              onClick={() => setTraceCollapsed((prev) => !prev)}
              style={{
                background: "transparent",
                border: 0,
                color: "var(--muted)",
                fontSize: "10px",
                fontFamily: "DM Mono",
                cursor: "pointer",
              }}
            >
              {traceCollapsed ? "Expand ▲" : "Collapse ▼"}
            </button>
          </div>
          {!traceCollapsed && (
            <div className="pipeline-trace-body">
              {!activeScan?.logs || activeScan.logs.length === 0 ? (
                <div
                  style={{
                    color: "var(--muted)",
                    fontStyle: "italic",
                    padding: "8px 0",
                  }}
                >
                  Connecting to background scan worker… Waiting for pipeline
                  logs…
                </div>
              ) : (
                activeScan.logs.map((log, idx) => {
                  const stageClass = log.stage
                    ? log.stage.toLowerCase()
                    : "runner"
                  return (
                    <div
                      key={`${log.timestamp}-${idx}`}
                      className="trace-log-item"
                    >
                      <span className="trace-timestamp">
                        {log.timestamp
                          ? new Date(log.timestamp).toLocaleTimeString([], {
                              hour12: false,
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit",
                            })
                          : "--:--:--"}
                      </span>
                      <span className={`trace-stage-badge ${stageClass}`}>
                        {log.stage || "runner"}
                      </span>
                      <div className={`trace-log-content ${log.level}`}>
                        <span>{log.message}</span>
                        {log.meta && Object.keys(log.meta).length > 0 && (
                          <details className="trace-meta-details">
                            <summary
                              style={{
                                cursor: "pointer",
                                color: "var(--muted)",
                              }}
                            >
                              metadata ({Object.keys(log.meta).length} fields)
                            </summary>
                            <pre>{JSON.stringify(log.meta, null, 2)}</pre>
                          </details>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
              <div ref={traceEndRef} />
            </div>
          )}
        </div>
      </section>
    )
  }

  return (
    <section className="scan-page product-page">
      <button className="back-link" onClick={onBack}>
        <Icon name="arrow" size={14} />
        Back to workspace
      </button>
      <div className="scan-page-grid">
        <div className="scan-intro">
          <span className="panel-index">NEW / 05</span>
          <p className="eyebrow">Dependency preflight</p>
          <h1>
            Choose what
            <br />
            to inspect.
          </h1>
          <p>
            DriftLogg reads public package metadata and repository signals. Your
            source code is never stored.
          </p>
          <div className="scan-promise">
            <div>
              <Icon name="shield" />
              <span>
                <strong>Private by design</strong>
                <small>We only read dependency manifests</small>
              </span>
            </div>
            <div>
              <Icon name="activity" />
              <span>
                <strong>Results in seconds</strong>
                <small>Non-blocking background analysis</small>
              </span>
            </div>
          </div>
        </div>
        <div className="scan-workbench">
          <div className="scan-methods">
            <button
              className={mode === "github" ? "active" : ""}
              onClick={() => setMode("github")}
            >
              <span>01</span>
              <Icon name="github" />
              <strong>Public GitHub repo</strong>
              <small>Connect with a URL</small>
            </button>
            <button
              className={mode === "upload" ? "active" : ""}
              onClick={() => setMode("upload")}
            >
              <span>02</span>
              <Icon name="file" />
              <strong>Package manifest</strong>
              <small>Upload or paste JSON</small>
            </button>
          </div>
          {mode === "github" ? (
            <div className="scan-input-panel">
              <label>PUBLIC REPOSITORY URL</label>
              <div className="url-input">
                <Icon name="github" />
                <input
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/organization/repository (or /tree/main/subfolder)"
                />
                <span>
                  <Icon name="check" size={13} />
                  Repository found
                </span>
              </div>
              <div className="repo-preview">
                <div className="project-icon">
                  <Icon name="github" />
                </div>
                <div>
                  <strong>
                    {repoUrl.replace("https://github.com/", "") ||
                      "acme/core-platform"}
                  </strong>
                  <p>Public repository · Updated recently</p>
                </div>
                <span>main</span>
              </div>
            </div>
          ) : (
            <div className="scan-input-panel">
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                multiple
                style={{ display: "none" }}
                onChange={(e) => e.target.files && handleFiles(e.target.files)}
              />
              <div
                className={`drop-zone ${isDragging ? "active-drop" : ""}`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault()
                  setIsDragging(true)
                }}
                onDragLeave={(e) => {
                  e.preventDefault()
                  setIsDragging(false)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  setIsDragging(false)
                  if (e.dataTransfer.files) handleFiles(e.dataTransfer.files)
                }}
              >
                <div className="upload-icon">
                  <Icon name="upload" />
                </div>
                {uploadedFiles ? (
                  <div className="drop-zone-loaded">
                    <strong style={{ color: "#f2f5f9" }}>
                      Manifests Loaded
                    </strong>
                    <div
                      style={{
                        display: "flex",
                        gap: "6px",
                        flexWrap: "wrap",
                        justifyContent: "center",
                        marginTop: "4px",
                      }}
                    >
                      {uploadedFiles.pkgName && (
                        <span className="file-badge-pill">
                          <Icon name="check" size={12} />
                          {uploadedFiles.pkgName}{" "}
                          {uploadedFiles.depCount !== undefined
                            ? `(${uploadedFiles.depCount} deps)`
                            : ""}
                        </span>
                      )}
                      {uploadedFiles.lockName && (
                        <span className="file-badge-pill">
                          <Icon name="check" size={12} />
                          {uploadedFiles.lockName}
                        </span>
                      )}
                    </div>
                    <p style={{ marginTop: "6px", fontSize: "11px" }}>
                      Click or drop files to replace
                    </p>
                  </div>
                ) : (
                  <>
                    <strong>Drop package.json & package-lock.json here</strong>
                    <p>
                      or <span>browse your files</span> · Max 5 MB
                    </p>
                  </>
                )}
              </div>
              <div className="paste-divider">
                <span>or paste JSON directly</span>
              </div>
              <textarea
                value={jsonText}
                onChange={(e) => {
                  setJsonText(e.target.value)
                  setParsedPackageJson(null)
                }}
              />
            </div>
          )}
          <div className="scan-submit">
            <p>
              <Icon name="shield" size={14} />
              No source code leaves your repository.
            </p>
            <button className="primary-button" onClick={handleSubmit}>
              Analyze dependencies
              <Icon name="arrow" />
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
