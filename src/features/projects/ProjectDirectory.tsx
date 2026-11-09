import { Icon } from "../../components/common"
import type { Project } from "../../types"

interface ProjectDirectoryProps {
  projects: Project[]
  onOpen: () => void
  onScan: () => void
}

export function ProjectDirectory({
  projects,
  onOpen,
  onScan,
}: ProjectDirectoryProps) {
  return (
    <section className="product-page">
      <div className="page-heading command-heading compact">
        <div>
          <p className="eyebrow">
            Project index / {String(projects.length).padStart(2, "0")} connected
          </p>
          <h1>
            Every codebase.
            <br />
            <em>One risk language.</em>
          </h1>
          <p>
            Compare deployment readiness across repositories without translating
            raw package data.
          </p>
        </div>
        <button className="primary-button" onClick={onScan}>
          <Icon name="plus" />
          Connect project
        </button>
      </div>
      <div className="directory-map">
        <div className="directory-axis">
          <span>Priority</span>
          <span>Project / source</span>
          <span>Observed</span>
          <span>Release signal</span>
        </div>
        {projects.map((project, index) => {
          const high = project.high ?? 0
          const ready = high === 0
          const isGitHub =
            project.sourceType === "github_repo" || project.source === "GitHub"

          return (
            <button
              className={`directory-row ${ready ? "is-ready" : "needs-review"}`}
              onClick={onOpen}
              key={project._id || project.name}
            >
              <span className="priority-code">
                {high > 0 ? `P${index + 1}` : "CLEAR"}
              </span>
              <div className="directory-name">
                <span className="project-icon">
                  <Icon name={isGitHub ? "github" : "file"} />
                </span>
                <div>
                  <strong>{project.name}</strong>
                  <small>
                    {project.detail ||
                      project.description ||
                      project.repositoryUrl ||
                      "Connected repo"}
                  </small>
                </div>
              </div>
              <div className="directory-observed">
                <strong>{project.deps ?? 0}</strong>
                <small>packages</small>
              </div>
              <div className="directory-signal">
                <div>
                  <i style={{ width: `${Math.max(4, high * 12)}%` }} />
                  <span>{high > 0 ? `${high} blockers` : "Clear to ship"}</span>
                </div>
                <Icon name="arrow" size={16} />
              </div>
            </button>
          )
        })}
      </div>
      <div className="directory-footnotes">
        <article>
          <span>01</span>
          <div>
            <strong>Continuously observed</strong>
            <p>
              Repository health is recalculated when package signals change.
            </p>
          </div>
        </article>
        <article>
          <span>02</span>
          <div>
            <strong>Deployment-focused</strong>
            <p>
              Risk is translated into a clear release decision for your team.
            </p>
          </div>
        </article>
        <article>
          <span>03</span>
          <div>
            <strong>Evidence attached</strong>
            <p>
              Every score links back to maintainership and security evidence.
            </p>
          </div>
        </article>
      </div>
    </section>
  )
}
