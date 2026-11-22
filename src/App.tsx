import { useEffect, useRef, useState } from "react"

import type {
  ActivityEvent,
  Page,
  Project,
  RiskReport,
  Scan,
  User,
  UserSummary,
} from "./types"

import { authService, projectService, scanService } from "./services"

import { AppShell } from "./components/layout"

import { EvidenceDrawer, ScanModal } from "./components/overlays"

import {
  HomePage,
  AuthPage,
  OverviewDashboard,
  ProjectDirectory,
  ProjectDetailView,
  ScanPage,
  ActivityPage,
  SettingsPage,
  ProfilePage,
  DocumentationPage,
  AdminDashboard,
} from "./features"

function normalizeRepoUrl(url: string): string {
  try {
    const parsed = new URL(url.trim())
    return `${parsed.origin}${parsed.pathname
      .replace(/\/+$/, "")
      .replace(/\.git$/, "")
      .toLowerCase()}`
  } catch {
    return url
      .trim()
      .toLowerCase()
      .replace(/\/+$/, "")
      .replace(/\.git$/, "")
  }
}

function extractRepoName(url: string): string {
  try {
    const parsed = new URL(url.trim())
    const parts = parsed.pathname.split("/").filter(Boolean)
    const last = parts.pop()?.replace(/\.git$/, "")
    return last || "Repository Project"
  } catch {
    const parts = url.trim().replace(/\/+$/, "").split("/").filter(Boolean)
    const last = parts.pop()?.replace(/\.git$/, "")
    return last || "Repository Project"
  }
}

export default function App() {
  const [page, setPage] = useState<Page>("home")

  const [currentUser, setCurrentUser] = useState<User | null>(null)

  const [userSummary, setUserSummary] = useState<UserSummary | null>(null)

  const [projects, setProjects] = useState<Project[]>([])

  const [reports, setReports] = useState<RiskReport[]>([])

  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)

  const [showScan, setShowScan] = useState(false)

  const [inputMode, setInputMode] = useState<"github" | "upload">("github")

  const [search, setSearch] = useState("")

  const [riskFilter, setRiskFilter] = useState("All risks")

  const [inspected, setInspected] = useState<RiskReport | null>(null)

  const [menuOpen, setMenuOpen] = useState(false)

  const [scanRunning, setScanRunning] = useState(false)

  const [scanStage, setScanStage] = useState(1)

  const [activeScan, setActiveScan] = useState<Scan | null>(null)

  const pollingTimerRef = useRef<number | null>(null)

  const refreshSummary = async () => {
    try {
      const summary = await authService.getSummary()
      setUserSummary(summary)
    } catch {
      setUserSummary(null)
    }
  }

  // 1. Initial session load via getMe()

  useEffect(() => {
    let mounted = true

    const checkSession = async () => {
      try {
        const user = await authService.getMe()

        if (mounted) {
          setCurrentUser(user)
          if (user) {
            refreshSummary()
          }
        }
      } catch {
        if (mounted) {
          setCurrentUser(null)
          setUserSummary(null)
        }
      }
    }

    checkSession()

    return () => {
      mounted = false
    }
  }, [])

  // 2. Synchronize workspace data strictly with currentUser

  useEffect(() => {
    let mounted = true

    if (!currentUser) {
      setProjects([])

      setActiveProjectId(null)

      setReports([])

      setInspected(null)

      setUserSummary(null)

      return
    }

    refreshSummary()

    const loadUserData = async () => {
      try {
        const userProjects = await projectService.getProjects()

        if (!mounted) return

        setProjects(userProjects)

        if (userProjects.length > 0) {
          const firstProjId = userProjects[0]._id

          setActiveProjectId(firstProjId)

          try {
            const projectReports =
              await scanService.getProjectReport(firstProjId)

            if (mounted) {
              setReports(projectReports)
            }
          } catch {
            if (mounted) {
              setReports([])
            }
          }
        } else {
          setActiveProjectId(null)

          setReports([])
        }
      } catch {
        if (mounted) {
          setProjects([])

          setActiveProjectId(null)

          setReports([])
        }
      }
    }

    loadUserData()

    return () => {
      mounted = false
    }
  }, [currentUser])

  // Cleanup polling timer on unmount

  useEffect(() => {
    return () => {
      if (pollingTimerRef.current) {
        window.clearInterval(pollingTimerRef.current)
      }
    }
  }, [])

  const goDashboard = () => {
    setPage("dashboard")

    setMenuOpen(false)
  }

  const openProject = async (projectId?: string) => {
    const targetId = projectId || activeProjectId || projects[0]?._id

    if (targetId) {
      setActiveProjectId(targetId)

      try {
        const projectReports = await scanService.getProjectReport(targetId)

        setReports(projectReports)
      } catch {
        setReports([])
      }
    }

    setPage("project")

    setMenuOpen(false)

    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const handleLogout = async () => {
    try {
      await authService.logout()
    } catch {
      // ignore
    }

    setCurrentUser(null)
    setUserSummary(null)
    setProjects([])
    setActiveProjectId(null)
    setReports([])
    setInspected(null)
    setPage("home")
    setMenuOpen(false)
  }

  // Contract-driven polling scan flow

  const handleStartScan = async (payload: {
    sourceType: "package_json" | "github_repo"

    repositoryUrl?: string

    packageJson?: Record<string, unknown>

    packageLockJson?: Record<string, unknown>
  }) => {
    setScanRunning(true)

    setScanStage(1)

    let targetProjectId: string | null = null

    try {
      if (payload.sourceType === "github_repo" && payload.repositoryUrl) {
        const targetNorm = normalizeRepoUrl(payload.repositoryUrl)
        const existing = projects.find(
          (p) =>
            p.sourceType === "github_repo" &&
            p.repositoryUrl &&
            normalizeRepoUrl(p.repositoryUrl) === targetNorm,
        )

        if (existing) {
          targetProjectId = existing._id
          setActiveProjectId(existing._id)
        } else {
          const repoName = extractRepoName(payload.repositoryUrl)
          const created = await projectService.createProject({
            name: repoName,
            sourceType: "github_repo",
            repositoryUrl: payload.repositoryUrl,
            description: payload.repositoryUrl,
          })
          targetProjectId = created._id
          setProjects((prev) => [created, ...prev])
          setActiveProjectId(created._id)
        }
      } else if (payload.sourceType === "package_json") {
        if (
          payload.packageJson &&
          Object.keys(payload.packageJson).length > 0
        ) {
          const manifestName =
            typeof payload.packageJson.name === "string" &&
            payload.packageJson.name
              ? payload.packageJson.name
              : "Manifest Project"
          const created = await projectService.createProject({
            name: manifestName,
            sourceType: "package_json",
            description: "Uploaded manifest",
            packageJson: payload.packageJson,
            packageLockJson: payload.packageLockJson,
          })
          targetProjectId = created._id
          setProjects((prev) => [created, ...prev])
          setActiveProjectId(created._id)
        } else if (activeProjectId) {
          targetProjectId = activeProjectId
        } else {
          const created = await projectService.createProject({
            name: "Manifest Project",
            sourceType: "package_json",
            description: "Uploaded manifest",
          })
          targetProjectId = created._id
          setProjects((prev) => [created, ...prev])
          setActiveProjectId(created._id)
        }
      }

      if (!targetProjectId) {
        targetProjectId = activeProjectId || "default"
      }

      // 1. Invoke scan service contract
      const scan = await scanService.startAnalysis(targetProjectId, payload)
      setActiveScan(scan)

      // 2. Poll scan status and advance orbital visual stages
      let currentStep = 1

      if (pollingTimerRef.current) {
        window.clearInterval(pollingTimerRef.current)
      }

      pollingTimerRef.current = window.setInterval(
        async () => {
          if (currentStep < 4) {
            currentStep += 1
            setScanStage(currentStep)
          }

          // Query status from contract service
          const latestScan = await scanService.getScanById(scan._id)
          setActiveScan(latestScan)

          if (latestScan.status === "completed") {
            if (pollingTimerRef.current) {
              window.clearInterval(pollingTimerRef.current)

              pollingTimerRef.current = null
            }

            // Fetch fresh risk reports and user summary from backend contract
            const [updatedReports, updatedProjects] = await Promise.all([
              scanService.getProjectReport(targetProjectId!),

              projectService.getProjects(),
            ])

            setReports(updatedReports)

            setProjects(updatedProjects)

            refreshSummary()

            setScanRunning(false)

            setShowScan(false)

            openProject(targetProjectId!)
          } else if (latestScan.status === "failed") {
            if (pollingTimerRef.current) {
              window.clearInterval(pollingTimerRef.current)

              pollingTimerRef.current = null
            }

            setScanRunning(false)

            setShowScan(false)
          }
        },

        1000,
      )
    } catch (err: unknown) {
      if (pollingTimerRef.current) {
        window.clearInterval(pollingTimerRef.current)

        pollingTimerRef.current = null
      }

      setScanRunning(false)

      const message =
        err instanceof Error ? err.message : "Failed to initiate scan"

      alert(message)
    }
  }

  if (page === "home") {
    return (
      <HomePage
        onLogin={() => setPage("login")}
        onSignup={() => setPage("signup")}
      />
    )
  }

  if (page === "login" || page === "signup") {
    return (
      <AuthPage
        mode={page}
        onHome={() => setPage("home")}
        onComplete={(user: User) => {
          setCurrentUser(user)

          goDashboard()
        }}
        onSwitch={() => setPage(page === "login" ? "signup" : "login")}
      />
    )
  }

  const isAdmin = currentUser?.role === "admin"

  return (
    <AppShell
      page={page}
      currentUser={currentUser}
      menuOpen={menuOpen}
      projectCount={projects.length}
      isAdmin={isAdmin}
      monthlyScansUsed={userSummary?.monthlyScansUsed ?? 0}
      monthlyScanLimit={userSummary?.monthlyScanLimit ?? 25}
      daysUntilReset={userSummary?.daysUntilReset ?? 30}
      onToggleMenu={() => setMenuOpen(!menuOpen)}
      onNavigate={(targetPage) => {
        setPage(targetPage)

        setMenuOpen(false)
      }}
    >
      {page === "admin" ? (
        <AdminDashboard onBackToWorkspace={goDashboard} />
      ) : page === "projects" ? (
        <ProjectDirectory
          projects={projects}
          onOpen={openProject}
          onScan={() => setPage("scan")}
        />
      ) : page === "scan" ? (
        <ScanPage
          mode={inputMode}
          setMode={setInputMode}
          running={scanRunning}
          stage={scanStage}
          activeScan={activeScan}
          onAnalyze={handleStartScan}
          onBack={goDashboard}
        />
      ) : page === "activity" ? (
        <ActivityPage
          events={projects
            .filter((p) => Boolean(p.lastScanned || p.scanned))
            .map((p) => {
              const isHigh = (p.high ?? 0) > 0
              return {
                time: p.lastScanned || p.scanned || "Recent",
                title: "Scan completed",
                detail: `${p.name} · ${
                  isHigh
                    ? `${p.high} high-risk signals`
                    : `${p.deps ?? 0} packages healthy`
                }`,
                tone: isHigh ? "coral" as const : "lime" as const,
              }
            })}
          onOpen={openProject}
          onScan={() => setPage("scan")}
        />
      ) : page === "settings" ? (
        <SettingsPage />
      ) : page === "docs" ? (
        <DocumentationPage onScan={() => setPage("scan")} />
      ) : page === "profile" ? (
        <ProfilePage
          currentUser={currentUser}
          userSummary={userSummary}
          onLogout={handleLogout}
          onProfileUpdated={(updated) => {
            setCurrentUser(updated)
            refreshSummary()
          }}
        />
      ) : page === "dashboard" ? (
        <OverviewDashboard
          projects={projects}
          search={search}
          onSearchChange={setSearch}
          onOpenProject={openProject}
          onNewScan={() => setPage("scan")}
        />
      ) : (
        <ProjectDetailView
          project={
            projects.find((p) => p._id === activeProjectId) ||
            projects[0] ||
            null
          }
          packages={reports.map((r) => ({
            _id: r._id,

            name: r.packageName,

            version: r.version,

            score: r.riskScore,

            risk:
              r.riskLevel === "high"
                ? "High"
                : r.riskLevel === "medium"
                  ? "Medium"
                  : "Low",

            isDirect: r.isDirect !== false,

            dependencyType: r.dependencyType || "dependencies",

            workspace: r.workspace,

            reasons: r.reasons,

            signals: {
              daysSinceRelease: r.signals?.lastRelease
                ? `${Math.max(
                    0,
                    Math.floor(
                      (Date.now() - new Date(r.signals.lastRelease).getTime()) /
                        (1000 * 60 * 60 * 24),
                    ),
                  )}d ago`
                : "N/A",

              openIssueRatio:
                typeof r.signals?.openIssues === "number"
                  ? `${r.signals.openIssues} open`
                  : typeof r.signals?.openIssueRatio === "string"
                    ? r.signals.openIssueRatio
                    : "None",

              maintenanceVelocity:
                typeof r.signals?.maintenanceVelocity === "number"
                  ? `${r.signals.maintenanceVelocity}/100`
                  : typeof r.signals?.scorecardScore === "number"
                    ? `${r.signals.scorecardScore}/10`
                    : "N/A",

              weeklyDownloads:
                typeof r.signals?.weeklyDownloads === "number"
                  ? r.signals.weeklyDownloads >= 1_000_000
                    ? `${(r.signals.weeklyDownloads / 1_000_000).toFixed(1)}M`
                    : r.signals.weeklyDownloads >= 1_000
                      ? `${(r.signals.weeklyDownloads / 1_000).toFixed(0)}k`
                      : String(r.signals.weeklyDownloads)
                  : "0",
            },

            suggestion: r.suggestion,
          }))}
          riskFilter={riskFilter}
          onRiskFilterChange={setRiskFilter}
          onInspectPackage={(pkg) => {
            const matchingReport = reports.find(
              (r) => r.packageName === pkg.name,
            )

            if (matchingReport) {
              setInspected(matchingReport)
            } else {
              setInspected({
                _id: pkg._id || `rep_${pkg.name}`,

                scan: activeScan?._id || "latest",

                dependency: pkg._id || `dep_${pkg.name}`,

                packageName: pkg.name,

                version: pkg.version,

                riskLevel: pkg.risk.toLowerCase() as "high" | "medium" | "low",

                riskScore: pkg.score,

                reasons: pkg.reasons,

                signals: {},

                suggestion: pkg.suggestion || "Review before deploy.",

                createdAt: new Date().toISOString(),
              })
            }
          }}
          onGoBack={goDashboard}
          onRunScan={() => setPage("scan")}
        />
      )}

      <ScanModal
        isOpen={showScan}
        inputMode={inputMode}
        scanRunning={scanRunning}
        onClose={() => setShowScan(false)}
        onSetInputMode={setInputMode}
        onRunScan={handleStartScan}
      />

      <EvidenceDrawer
        packageData={inspected}
        onClose={() => setInspected(null)}
      />
    </AppShell>
  )
}
