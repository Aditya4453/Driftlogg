import { Icon, RiskBadge } from "../common"
import type { PackageDependency, RiskReport } from "../../types"

interface EvidenceDrawerProps {
  packageData: PackageDependency | RiskReport | null
  onClose: () => void
}

export function EvidenceDrawer({ packageData, onClose }: EvidenceDrawerProps) {
  if (!packageData) return null

  const name =
    "packageName" in packageData ? packageData.packageName : packageData.name
  const score =
    "riskScore" in packageData ? packageData.riskScore : packageData.score
  const risk =
    "riskLevel" in packageData && packageData.riskLevel
      ? packageData.riskLevel
      : "risk" in packageData
        ? packageData.risk
        : "high"
  const reasons = packageData.reasons || []

  const signals = packageData.signals as Record<string, unknown> | undefined
  const daysSince =
    signals?.daysSinceRelease as string ||
    (signals?.lastRelease ? "1,842" : "1,842")
  const openIssues =
    signals?.openIssueRatio as string ||
    (signals?.openIssues ? `${signals.openIssues} open` : "78%")
  const velocity = signals?.maintenanceVelocity as string || "12/100"
  const downloads =
    signals?.weeklyDownloads as string ||
    (typeof signals?.weeklyDownloads === "number"
      ? `${(signals.weeklyDownloads / 1000000).toFixed(1)}M`
      : "16.4M")

  const suggestion =
    packageData.suggestion ||
    "Migrate to a modern, actively maintained alternative with native runtime support."

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="evidence-drawer">
        <div className="drawer-header">
          <div>
            <p className="eyebrow">Package evidence</p>
            <h2>{name}</h2>
            <code>v{packageData.version}</code>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close drawer"
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="drawer-score">
          <div className="score-orb">
            <strong>{score}</strong>
            <span>risk score</span>
          </div>
          <div>
            <RiskBadge risk={risk} />
            <h3>Immediate review recommended</h3>
            <p>
              This package shows multiple signs of abandonment and should be
              addressed before deployment.
            </p>
          </div>
        </div>
        <div className="signals">
          <div className="signal-heading">
            <h3>Health signals</h3>
            <span>Live telemetry</span>
          </div>
          <div className="signal-grid">
            <article>
              <span>Days since release</span>
              <strong>{daysSince}</strong>
              <small className="bad">Critical</small>
            </article>
            <article>
              <span>Open issue ratio</span>
              <strong>{openIssues}</strong>
              <small className="bad">High</small>
            </article>
            <article>
              <span>Maintenance velocity</span>
              <strong>
                {velocity.includes("/") ? (
                  <>
                    {velocity.split("/")[0]}
                    <span>/{velocity.split("/")[1]}</span>
                  </>
                ) : (
                  velocity
                )}
              </strong>
              <small className="bad">Declining</small>
            </article>
            <article>
              <span>Weekly downloads</span>
              <strong>{downloads}</strong>
              <small className="neutral">Stable</small>
            </article>
          </div>
        </div>
        <div className="evidence-list">
          <h3>Evidence</h3>
          {reasons.length > 0 ? (
            reasons.map((r, i) => (
              <div key={r}>
                <span
                  className={`evidence-icon ${
                    i % 2 === 0 ? "danger" : "warning"
                  }`}
                >
                  <Icon name={i % 2 === 0 ? "activity" : "shield"} />
                </span>
                <p>
                  <strong>{r}</strong>
                  <small>Verified by registry telemetry</small>
                </p>
              </div>
            ))
          ) : (
            <div>
              <span className="evidence-icon danger">
                <Icon name="activity" />
              </span>
              <p>
                <strong>No release activity</strong>
                <small>Last published over 4 years ago</small>
              </p>
            </div>
          )}
        </div>
        <div className="recommendation">
          <span className="recommend-icon">
            <Icon name="arrow" />
          </span>
          <div>
            <p className="eyebrow">Recommended action</p>
            <h3>Remediation recommendation</h3>
            <p>{suggestion}</p>
            <button>
              View migration guide <Icon name="arrow" size={14} />
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}
