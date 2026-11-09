import { useState } from "react"
import { Icon } from "../../components/common"

export interface ScanPageProps {
  mode: "github" | "upload"
  setMode: (mode: "github" | "upload") => void
  running: boolean
  stage?: number
  onAnalyze: (payload: {
    sourceType: "package_json" | "github_repo"
    repositoryUrl?: string
    packageJson?: Record<string, unknown>
  }) => void
  onBack: () => void
}

export function ScanPage({
  mode,
  setMode,
  running,
  stage = 2,
  onAnalyze,
  onBack,
}: ScanPageProps) {
  const [repoUrl, setRepoUrl] = useState(
    "https://github.com/acme/core-platform",
  )
  const [jsonText, setJsonText] = useState(
    '{\n  "dependencies": {\n    "react": "^19.0.0"\n  }\n}',
  )

  const handleSubmit = () => {
    if (mode === "github") {
      onAnalyze({
        sourceType: "github_repo",
        repositoryUrl: repoUrl,
      })
    } else {
      let parsed: Record<string, unknown> | undefined
      try {
        parsed = JSON.parse(jsonText)
      } catch {
        parsed = { raw: jsonText }
      }
      onAnalyze({
        sourceType: "package_json",
        packageJson: parsed,
      })
    }
  }

  if (running) {
    return (
      <section className="scan-processing product-page">
        <div className="processing-visual">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <span className="processing-core">
            <Icon name="activity" size={28} />
          </span>
        </div>
        <p className="eyebrow">Scan in progress / Polling live status</p>
        <h1>
          Reading the signals
          <br />
          behind your packages.
        </h1>
        <p className="processing-note">
          Analysis continues in the background. Polling worker pipeline...
        </p>
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
              <small>Resolving 148 package records</small>
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
                  placeholder="https://github.com/organization/repository"
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
              <div className="drop-zone">
                <div className="upload-icon">
                  <Icon name="upload" />
                </div>
                <strong>Drop package.json here</strong>
                <p>
                  or <span>browse your files</span> · Max 5 MB
                </p>
              </div>
              <div className="paste-divider">
                <span>or paste JSON directly</span>
              </div>
              <textarea
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
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
