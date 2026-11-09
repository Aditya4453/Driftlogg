import { useEffect, useRef, useState } from "react"
import type { Page, Project, RiskReport, User } from "./types"
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

export default function App() {
  const [page, setPage] = useState<Page>("home")
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [reports, setReports] = useState<RiskReport[]>([])
  const [currentProjectId] = useState<string>("proj_001")

  const [showScan, setShowScan] = useState(false)
  const [inputMode, setInputMode] = useState<"github" | "upload">("github")
  const [search, setSearch] = useState("")
  const [riskFilter, setRiskFilter] = useState("All risks")
  const [inspected, setInspected] = useState<RiskReport | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [scanRunning, setScanRunning] = useState(false)
  const [scanStage, setScanStage] = useState(1)

  const pollingTimerRef = useRef<number | null>(null)

  // Fetch initial domain data via contract services
  useEffect(() => {
    let mounted = true
    const initData = async () => {
      const [user, projs, initialReports] = await Promise.all([
        authService.getMe(),
        projectService.getProjects(),
        scanService.getProjectReport(currentProjectId),
      ])
      if (mounted) {
        setCurrentUser(user)
        setProjects(projs)
        setReports(initialReports)
      }
    }
    initData()
    return () => {
      mounted = false
      if (pollingTimerRef.current) {
        window.clearInterval(pollingTimerRef.current)
      }
    }
  }, [currentProjectId])

  const goDashboard = () => {
    setPage("dashboard")
    setMenuOpen(false)
  }

  const openProject = () => {
    setPage("project")
    setMenuOpen(false)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  // Contract-driven polling scan flow
  const handleStartScan = async (payload: {
    sourceType: "package_json" | "github_repo"
    repositoryUrl?: string
    packageJson?: Record<string, unknown>
  }) => {
    setScanRunning(true)
    setScanStage(1)

    // 1. Invoke scan service contract
    const scan = await scanService.startAnalysis(currentProjectId, payload)

    // 2. Poll scan status and advance orbital visual stages
    let currentStep = 1
    if (pollingTimerRef.current) {
      window.clearInterval(pollingTimerRef.current)
    }

    pollingTimerRef.current = window.setInterval(
      async () => {
        currentStep += 1
        setScanStage(currentStep)

        // Query status from contract service
        const latestScan = await scanService.getScanById(scan._id)

        if (currentStep >= 4 || latestScan.status === "completed") {
          if (pollingTimerRef.current) {
            window.clearInterval(pollingTimerRef.current)
            pollingTimerRef.current = null
          }

          // Fetch fresh risk reports from backend contract
          const updatedReports =
            await scanService.getProjectReport(currentProjectId)
          setReports(updatedReports)

          // Refresh project list
          const updatedProjects = await projectService.getProjects()
          setProjects(updatedProjects)

          setScanRunning(false)
          setShowScan(false)
          openProject()
        } else if (latestScan.status === "failed") {
          if (pollingTimerRef.current) {
            window.clearInterval(pollingTimerRef.current)
            pollingTimerRef.current = null
          }
          setScanRunning(false)
          alert(
            latestScan.errorMessage || "Scan analysis encountered an error.",
          )
        }
      },
      600,
    )
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
        onComplete={async () => {
          const user = await authService.getMe()
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
      menuOpen={menuOpen}
      projectCount={projects.length}
      isAdmin={isAdmin}
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
          onAnalyze={handleStartScan}
          onBack={goDashboard}
        />
      ) : page === "activity" ? (
        <ActivityPage onOpen={openProject} />
      ) : page === "settings" ? (
        <SettingsPage />
      ) : page === "docs" ? (
        <DocumentationPage onScan={() => setPage("scan")} />
      ) : page === "profile" ? (
        <ProfilePage />
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
            reasons: r.reasons,
            signals: {
              daysSinceRelease: r.signals?.lastRelease ? "1,842" : "1,842",
              openIssueRatio: r.signals?.openIssues
                ? `${r.signals.openIssues} open`
                : "78%",
              maintenanceVelocity: "12/100",
              weeklyDownloads:
                typeof r.signals?.weeklyDownloads === "number"
                  ? `${(r.signals.weeklyDownloads / 1000000).toFixed(1)}M`
                  : "16.4M",
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
                scan: "scan_001",
                dependency: `dep_${pkg.name}`,
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
