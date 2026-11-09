import { Icon } from "../../components/common"
import { initialEvents } from "../../data"
import type { ActivityEvent } from "../../types"

interface ActivityPageProps {
  events?: ActivityEvent[]
  onOpen: () => void
}

export function ActivityPage({
  events = initialEvents,
  onOpen,
}: ActivityPageProps) {
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
            <span>Last 7 days</span>
          </div>
          {events.map((event, index) => (
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
              <span className="event-number">0{index + 1}</span>
              <Icon name="chevron" size={15} />
            </button>
          ))}
        </div>
        <aside className="activity-summary">
          <p className="eyebrow">Signal summary</p>
          <strong>23</strong>
          <span>meaningful changes</span>
          <div>
            <i className="coral" />
            <p>
              <b>5</b> increased risk
            </p>
          </div>
          <div>
            <i className="lime" />
            <p>
              <b>11</b> improved health
            </p>
          </div>
          <div>
            <i className="violet" />
            <p>
              <b>7</b> routine updates
            </p>
          </div>
        </aside>
      </div>
    </section>
  )
}
