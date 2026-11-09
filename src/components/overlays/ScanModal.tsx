import { useState } from "react"
import { Icon } from "../common"

interface ScanModalProps {
  isOpen: boolean
  inputMode: "github" | "upload"
  scanRunning: boolean
  onClose: () => void
  onSetInputMode: (mode: "github" | "upload") => void
  onRunScan: (payload: {
    sourceType: "package_json" | "github_repo"
    repositoryUrl?: string
    packageJson?: Record<string, unknown>
  }) => void
}

export function ScanModal({
  isOpen,
  inputMode,
  scanRunning,
  onClose,
  onSetInputMode,
  onRunScan,
}: ScanModalProps) {
  const [repoUrl, setRepoUrl] = useState(
    "https://github.com/acme/core-platform",
  )
  const [jsonText, setJsonText] = useState(
    '{\n  "dependencies": {\n    "react": "^19.0.0"\n  }\n}',
  )

  if (!isOpen) return null

  const handleAnalyze = () => {
    if (inputMode === "github") {
      onRunScan({
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
      onRunScan({
        sourceType: "package_json",
        packageJson: parsed,
      })
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={() => !scanRunning && onClose()}
    >
      <div className="scan-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Dependency intelligence</p>
            <h2>Create a new scan</h2>
            <p>Connect a repository or provide a manifest to analyze.</p>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close modal"
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="segment-control">
          <button
            className={inputMode === "github" ? "active" : ""}
            onClick={() => onSetInputMode("github")}
          >
            <Icon name="github" />
            Public GitHub repo
          </button>
          <button
            className={inputMode === "upload" ? "active" : ""}
            onClick={() => onSetInputMode("upload")}
          >
            <Icon name="file" />
            Upload / Paste
          </button>
        </div>
        {inputMode === "github" ? (
          <div className="form-area">
            <label>Repository URL</label>
            <div className="url-input">
              <Icon name="github" />
              <input
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
              />
              <span>
                <Icon name="check" size={13} />
                Found
              </span>
            </div>
            <div className="fetch-result">
              <div className="project-icon">
                <Icon name="github" />
              </div>
              <div>
                <strong>
                  {repoUrl.replace("https://github.com/", "") ||
                    "acme/core-platform"}
                </strong>
                <p>Public repository · TypeScript</p>
              </div>
              <code>main</code>
            </div>
          </div>
        ) : (
          <div className="form-area">
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
              <span>or paste JSON</span>
            </div>
            <textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
            />
          </div>
        )}
        <div className="modal-footer">
          <p>
            <Icon name="shield" size={14} />
            Your source code is never stored.
          </p>
          <button
            className="primary-button analyze-button"
            onClick={handleAnalyze}
            disabled={scanRunning}
          >
            {scanRunning ? (
              <>
                <span className="spinner" />
                Polling worker pipeline…
              </>
            ) : (
              <>
                Analyze dependencies
                <Icon name="arrow" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
