import { useState, useRef } from "react"
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
    packageLockJson?: Record<string, unknown>
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
  const [isDragging, setIsDragging] = useState(false)
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

  if (!isOpen) return null

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

  const handleAnalyze = () => {
    if (inputMode === "github") {
      onRunScan({
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
      onRunScan({
        sourceType: "package_json",
        packageJson: packageJson || undefined,
        packageLockJson: parsedPackageLockJson || undefined,
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
                placeholder="https://github.com/organization/repository (or /tree/main/subfolder)"
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
                  <strong style={{ color: "#f2f5f9" }}>Manifests Loaded</strong>
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
              <span>or paste JSON</span>
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
