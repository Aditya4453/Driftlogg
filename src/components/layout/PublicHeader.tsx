import { Icon, Logo } from "../common"

interface PublicHeaderProps {
  onLogin: () => void
  onSignup: () => void
}

export function PublicHeader({ onLogin, onSignup }: PublicHeaderProps) {
  return (
    <header className="public-header">
      <a className="logo-button" href="#">
        <Logo />
      </a>
      <nav>
        <a href="#why">Why DriftLogg</a>
        <a href="#workflow">How it works</a>
        <a href="#signals">Signals</a>
      </nav>
      <div>
        <button className="public-login" onClick={onLogin}>
          Log in
        </button>
        <button className="primary-button" onClick={onSignup}>
          Start scanning
          <Icon name="arrow" size={14} />
        </button>
      </div>
    </header>
  )
}
