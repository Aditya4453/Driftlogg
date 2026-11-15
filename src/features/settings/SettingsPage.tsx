import { useState } from "react"
import { Icon } from "../../components/common"
import type { SettingsSection } from "../../types"

export function SettingsPage() {
  const [section, setSection] = useState<SettingsSection>("Risk policy")
  const [security, setSecurity] = useState(true)
  const [archive, setArchive] = useState(true)
  const [saved, setSaved] = useState(false)

  const sections: SettingsSection[] = [
    "Risk policy",
    "Notifications",
    "Integrations",
    "Workspace",
  ]

  return (
    <section className="product-page settings-page">
      <div className="page-heading command-heading compact">
        <div>
          <p className="eyebrow">Workspace configuration</p>
          <h1>
            Make DriftLogg
            <br />
            <em>work your way.</em>
          </h1>
          <p>
            Set the thresholds that turn package evidence into release
            decisions.
          </p>
        </div>
      </div>
      <div className="settings-layout">
        <aside className="settings-index">
          {sections.map((item, index) => (
            <button
              key={item}
              className={section === item ? "active" : ""}
              onClick={() => {
                setSection(item)
                setSaved(false)
              }}
            >
              0{index + 1} · {item}
            </button>
          ))}
        </aside>
        <div className="settings-content">
          <div className="setting-heading">
            <div>
              <p className="eyebrow">Configuration / {section}</p>
              <h2>
                {section === "Risk policy" ? "Deployment thresholds" : section}
              </h2>
              <p>
                {section === "Risk policy"
                  ? "Control how DriftLogg classifies dependencies across this workspace."
                  : `Manage workspace ${section.toLowerCase()} and delivery preferences.`}
              </p>
            </div>
            <span>{saved ? "Changes saved" : "Ready"}</span>
          </div>
          {section === "Risk policy" ? (
            <>
              <div className="setting-row">
                <div>
                  <strong>Block deployment at</strong>
                  <p>Packages at or above this score are marked high risk.</p>
                </div>
                <label className="number-field">
                  <input defaultValue="80" />
                  <span>/ 100</span>
                </label>
              </div>
              <div className="setting-row">
                <div>
                  <strong>Inactive package window</strong>
                  <p>
                    Flag packages with no release activity during this period.
                  </p>
                </div>
                <select defaultValue="730">
                  <option value="365">1 year</option>
                  <option value="730">2 years</option>
                  <option value="1095">3 years</option>
                </select>
              </div>
              <div className="setting-row">
                <div>
                  <strong>Security advisories</strong>
                  <p>
                    Always escalate packages with unresolved critical
                    advisories.
                  </p>
                </div>
                <button
                  aria-label="Toggle security advisories"
                  onClick={() => setSecurity(!security)}
                  className={`toggle ${security ? "active" : ""}`}
                >
                  <i />
                </button>
              </div>
              <div className="setting-row">
                <div>
                  <strong>Archive detection</strong>
                  <p>
                    Flag packages whose source repository has been archived.
                  </p>
                </div>
                <button
                  aria-label="Toggle archive detection"
                  onClick={() => setArchive(!archive)}
                  className={`toggle ${archive ? "active" : ""}`}
                >
                  <i />
                </button>
              </div>
            </>
          ) : (
            <div className="setting-placeholder">
              <span>0{sections.indexOf(section) + 1}</span>
              <Icon
                name={
                  section === "Integrations"
                    ? "code"
                    : section === "Notifications"
                      ? "activity"
                      : "settings"
                }
                size={26}
              />
              <h3>{section} controls</h3>
              <p>
                This workspace is using the recommended defaults. Add custom
                rules when your team is ready.
              </p>
              <button className="secondary-button">
                Configure {section.toLowerCase()}
              </button>
            </div>
          )}
          <div className="setting-footer">
            <button
              className="secondary-button"
              onClick={() => {
                setSecurity(true)
                setArchive(true)
              }}
            >
              Restore defaults
            </button>
            <button className="primary-button" onClick={() => setSaved(true)}>
              Save changes
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
