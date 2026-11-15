import { Icon } from "../../components/common"
import type { ActivityEvent } from "../../types"

interface ActivityPageProps {
  events?: ActivityEvent[]
  onOpen: () => void
  onScan?: () => void
}

export function ActivityPage({
  events = [],
  onOpen,
  onScan,
}: ActivityPageProps) {
  const increasedRisk = events.filter((e) => e.tone === "coral").length
  const improvedHealth = events.filter((e) => e.tone === "lime").length
  const routineUpdates = events.filter((e) => e.tone === "violet").length
  const totalEvents = events.length

  return (
    <section className="product-page activity-page">
      <div className="page-heading command-heading compact">
        <div>
          <p className="eyebrow">Workspace log / Live</p>
          <h1>
            What changed,
            <br />
            <em>and why it matters.</em>
          </h1>
          <p>
            A chronological record of scans, score changes, and emerging package
            risk.
          </p>
        </div>
      </div>
      <div className="activity-layout">
        <div className="activity-stream">
          <div className="stream-header">
            <span>Event stream</span>
            <span>Live timeline</span>
          </div>
          {events.length === 0 ? (
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
                <Icon name="activity" size={32} />
              </div>
              <h3
                style={{
                  fontSize: "16px",
                  color: "#f2f5f9",
                  fontWeight: "600",
                }}
              >
                No activity recorded yet
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
                Scans, maintainer telemetry, and score updates will be tracked
                here once you run your first scan.
              </p>
              {onScan && (
                <button className="primary-button" onClick={onScan}>
                  <Icon name="plus" />
                  Run your first scan
                </button>
              )}
            </div>
          ) : (
            events.map((event, index) => (
              <button
                onClick={onOpen}
                className="activity-event"
                key={event.title}
              >
                <span className="event-time">{event.time}</span>
                <i className={event.tone} />
                <div>
                  <strong>{event.title}</strong>
                  <p>{event.detail}</p>
                </div>
                <span className="event-number">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <Icon name="chevron" size={15} />
              </button>
            ))
          )}
        </div>
        <aside className="activity-summary">
          <p className="eyebrow">Signal summary</p>
          <strong>{totalEvents}</strong>
          <span>meaningful changes</span>
          <div>
            <i className="coral" />
            <p>
              <b>{increasedRisk}</b> increased risk
            </p>
          </div>
          <div>
            <i className="lime" />
            <p>
              <b>{improvedHealth}</b> improved health
            </p>
          </div>
          <div>
            <i className="violet" />
            <p>
              <b>{routineUpdates}</b> routine updates
            </p>
          </div>
        </aside>
      </div>
    </section>
  )
}
