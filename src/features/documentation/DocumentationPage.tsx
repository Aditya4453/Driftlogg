import { Icon } from "../../components/common"

interface DocumentationPageProps {
  onScan: () => void
}

export function DocumentationPage({ onScan }: DocumentationPageProps) {
  return (
    <section className="product-page docs-page">
      <div className="page-heading command-heading compact">
        <div>
          <p className="eyebrow">Documentation / Quick start</p>
          <h1>
            From repository
            <br />
            to verdict in minutes.
          </h1>
          <p>
            A practical guide to reading DriftLogg scores and making safer
            dependency decisions.
          </p>
        </div>
        <button className="primary-button" onClick={onScan}>
          Run your first scan
          <Icon name="arrow" />
        </button>
      </div>
      <div className="docs-layout">
        <aside>
          <span>ON THIS PAGE</span>
          <a href="#connect">01 · Connect</a>
          <a href="#signals">02 · Read signals</a>
          <a href="#act">03 · Take action</a>
        </aside>
        <div className="docs-content">
          <article id="connect">
            <span>01</span>
            <div>
              <p className="eyebrow">Connect</p>
              <h2>Point DriftLogg at a manifest.</h2>
              <p>
                Use a public GitHub URL or upload a package.json file. The
                scanner only reads dependency metadata and never stores
                application source.
              </p>
              <pre>
                <code>https://github.com/acme/core-platform</code>
                <button onClick={onScan}>
                  Open scanner <Icon name="arrow" size={13} />
                </button>
              </pre>
            </div>
          </article>
          <article id="signals">
            <span>02</span>
            <div>
              <p className="eyebrow">Read signals</p>
              <h2>One score, backed by evidence.</h2>
              <p>
                Risk scores combine release cadence, issue health, security
                advisories, ownership changes, and maintenance velocity.
              </p>
              <div className="docs-scale">
                <span>0 · Healthy</span>
                <span>50 · Review</span>
                <span>100 · Critical</span>
              </div>
            </div>
          </article>
          <article id="act">
            <span>03</span>
            <div>
              <p className="eyebrow">Take action</p>
              <h2>Ship, review, or migrate.</h2>
              <p>
                Every high-risk package includes its warning evidence and a
                maintained alternative where one is available.
              </p>
            </div>
          </article>
        </div>
      </div>
    </section>
  )
}
