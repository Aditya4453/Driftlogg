import { Icon } from "../../components/common"
import { PublicHeader, PublicFooter } from "../../components/layout"

interface HomePageProps {
  onLogin: () => void
  onSignup: () => void
}

export function HomePage({ onLogin, onSignup }: HomePageProps) {
  return (
    <div className="public-shell">
      <PublicHeader onLogin={onLogin} onSignup={onSignup} />
      <main>
        <section className="home-hero">
          <div className="hero-copy">
            <div className="home-kicker">
              <span>Dependency preflight for modern teams</span>
              <i />
            </div>
            <h1>
              Ship code.
              <br />
              Not <em>dependency risk.</em>
            </h1>
            <p>
              DriftLogg identifies abandoned, vulnerable, and high-risk
              open-source packages before they become deployment failures.
            </p>
            <div className="hero-actions">
              <button className="hero-primary" onClick={onSignup}>
                Scan your first project
                <Icon name="arrow" />
              </button>
              <button className="hero-secondary" onClick={onLogin}>
                <span className="play-mark">
                  <Icon name="activity" size={14} />
                </span>
                Explore the workspace
              </button>
            </div>
            <div className="hero-trust">
              <span>
                <Icon name="check" size={13} />
                No credit card
              </span>
              <span>
                <Icon name="check" size={13} />
                Public repos free
              </span>
              <span>
                <Icon name="shield" size={13} />
                Source never stored
              </span>
            </div>
          </div>
          <div className="hero-console">
            <div className="console-top">
              <span>
                <i />
                <i />
                <i />
              </span>
              <code>driftlogg / preflight</code>
              <b>LIVE</b>
            </div>
            <div className="console-body">
              <div className="console-command">
                <span>$</span>
                <code>drift scan acme/core-platform</code>
              </div>
              <div className="console-progress">
                <span>Analyzing 148 dependencies</span>
                <strong>100%</strong>
                <div>
                  <i />
                </div>
              </div>
              <div className="console-verdict">
                <div className="verdict-score">
                  <strong>82</strong>
                  <span>/100</span>
                </div>
                <div>
                  <small>DEPLOYMENT VERDICT</small>
                  <h3>Review before deploy</h3>
                  <p>4 packages need your attention</p>
                </div>
              </div>
              <div className="console-packages">
                <div>
                  <span className="package-cube">
                    <Icon name="box" size={14} />
                  </span>
                  <code>request@2.88.2</code>
                  <b>94</b>
                  <em>HIGH</em>
                </div>
                <div>
                  <span className="package-cube">
                    <Icon name="box" size={14} />
                  </span>
                  <code>node-sass@4.14.1</code>
                  <b>86</b>
                  <em>HIGH</em>
                </div>
                <div>
                  <span className="package-cube">
                    <Icon name="box" size={14} />
                  </span>
                  <code>lodash@4.17.20</code>
                  <b>64</b>
                  <em className="medium">REVIEW</em>
                </div>
              </div>
            </div>
            <div className="console-glow" />
          </div>
        </section>
        <section className="home-proof">
          <p>
            Built for the moment between <span>“tests passed”</span> and{" "}
            <span>“deploy now.”</span>
          </p>
          <div>
            <code>GITHUB</code>
            <code>npm</code>
            <code>package.json</code>
            <code>CI / CD</code>
            <code>NODE.JS</code>
          </div>
        </section>
        <section className="home-problem" id="why">
          <div className="home-section-title">
            <span>01 / THE BLIND SPOT</span>
            <h2>
              Your code can be healthy.
              <br />
              <em>Your dependencies may not be.</em>
            </h2>
          </div>
          <div className="problem-grid">
            <article>
              <span>1,842</span>
              <small>days since release</small>
              <div className="signal-line coral-line" />
              <h3>Abandonment hides in plain sight</h3>
              <p>
                A package can keep working long after its maintainers have left.
                DriftLogg spots the silence.
              </p>
            </article>
            <article>
              <span>78%</span>
              <small>open issue ratio</small>
              <div className="signal-line violet-line" />
              <h3>Popularity is not health</h3>
              <p>
                Download counts do not reveal maintenance velocity, issue
                response, or ownership risk.
              </p>
            </article>
            <article>
              <span>
                12<em>/100</em>
              </span>
              <small>maintenance velocity</small>
              <div className="signal-line lime-line" />
              <h3>Evidence, not guesswork</h3>
              <p>
                Every verdict is backed by release, security, ownership, and
                community signals.
              </p>
            </article>
          </div>
        </section>
        <section className="home-workflow" id="workflow">
          <div className="home-section-title">
            <span>02 / PREFLIGHT</span>
            <h2>
              From repository to
              <br />
              <em>release verdict.</em>
            </h2>
          </div>
          <div className="workflow-track">
            <article>
              <span>01</span>
              <div className="workflow-icon">
                <Icon name="github" />
              </div>
              <h3>Connect</h3>
              <p>Paste a public repository URL or upload package.json.</p>
            </article>
            <article>
              <span>02</span>
              <div className="workflow-icon violet">
                <Icon name="activity" />
              </div>
              <h3>Analyze</h3>
              <p>We evaluate package activity, security, and maintainership.</p>
            </article>
            <article>
              <span>03</span>
              <div className="workflow-icon coral">
                <Icon name="shield" />
              </div>
              <h3>Act</h3>
              <p>Get a clear ship, review, or migrate recommendation.</p>
            </article>
          </div>
        </section>
        <section className="home-cta" id="signals">
          <div>
            <p className="eyebrow">Your next deploy starts here</p>
            <h2>
              Know the risk.
              <br />
              <em>Keep the momentum.</em>
            </h2>
          </div>
          <div>
            <p>
              Scan your first public project in under a minute. No configuration
              required.
            </p>
            <button onClick={onSignup}>
              Start scanning free
              <Icon name="arrow" />
            </button>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  )
}
