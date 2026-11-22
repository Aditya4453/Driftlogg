import React, { useState } from "react"

import { Icon, Logo } from "../../components/common"

import { authService } from "../../services"

import type { User } from "../../types"

interface AuthPageProps {
  mode: "login" | "signup"

  onSwitch: () => void

  onComplete: (user: User) => void

  onHome: () => void
}

export function AuthPage({
  mode,

  onSwitch,

  onComplete,

  onHome,
}: AuthPageProps) {
  const signup = mode === "signup"

  const [name, setName] = useState("")

  const [email, setEmail] = useState("")

  const [password, setPassword] = useState("")

  const [showPassword, setShowPassword] = useState(false)

  const [errorMessage, setErrorMessage] = useState("")

  const [loading, setLoading] = useState(false)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    setErrorMessage("")

    setLoading(true)

    try {
      let user: User

      if (signup) {
        user = await authService.register({
          name: name.trim(),

          email: email.trim(),

          password,
        })
      } else {
        user = await authService.login({ email: email.trim(), password })
      }

      onComplete(user)
    } catch (err: any) {
      setErrorMessage(
        err.message || "Authentication failed. Please verify your credentials.",
      )
    } finally {
      setLoading(false)
    }
  }

  const handleSwitchMode = () => {
    setErrorMessage("")

    onSwitch()
  }

  return (
    <div className="auth-shell">
      <div className="auth-brand-panel">
        <button className="logo-button" onClick={onHome}>
          <Logo />
        </button>
        <div className="auth-message">
          <span className="panel-index">PREFLIGHT / 01</span>
          <h2>
            Make every deploy
            <br />
            <em>an informed decision.</em>
          </h2>
          <p>
            See abandonment, security, and maintenance risk before your users
            do.
          </p>
        </div>
        <div className="auth-signal">
          <span>
            <i />
          </span>
          <div>
            <strong>511 packages monitored</strong>
            <small>Workspace signals updated live</small>
          </div>
        </div>
      </div>
      <main className="auth-form-panel">
        <button className="auth-back" onClick={onHome}>
          <Icon name="arrow" size={14} />
          Back to home
        </button>
        <form className="auth-card" onSubmit={handleSubmit}>
          <p className="eyebrow">
            {signup ? "Create workspace" : "Welcome back"}
          </p>
          <h1>{signup ? "Start shipping safer." : "Log in to DriftLogg."}</h1>
          <p>
            {signup
              ? "Create your free workspace. No credit card required."
              : "Continue to your dependency intelligence workspace."}
          </p>

          {errorMessage && (
            <div
              className="auth-error-banner"
              style={{
                display: "flex",

                alignItems: "center",

                gap: "10px",

                padding: "10px 14px",

                marginBottom: "16px",

                borderRadius: "8px",

                backgroundColor: "rgba(239, 82, 94, 0.12)",

                border: "1px solid rgba(239, 82, 94, 0.35)",

                color: "#ff6b76",

                fontSize: "13px",

                lineHeight: "1.4",
              }}
            >
              <Icon name="shield" size={16} />
              <span>{errorMessage}</span>
            </div>
          )}

          <button
            type="button"
            className="github-auth"
            onClick={() => {
              setErrorMessage(
                "GitHub OAuth connects to enterprise SSO. Please sign in with email and password.",
              )
            }}
          >
            <Icon name="github" />
            Continue with GitHub
          </button>
          <div className="auth-divider">
            <span>or continue with email</span>
          </div>

          {signup && (
            <label>
              <span>Full name</span>
              <input
                required
                placeholder="Devon Rivera"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={loading}
              />
            </label>
          )}

          <label>
            <span>Work email</span>
            <input
              type="email"
              required
              placeholder="devon@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
            />
          </label>

          <label className="password-label">
            <span>Password</span>
            <input
              type={showPassword ? "text" : "password"}
              required
              placeholder={
                signup ? "At least 8 characters" : "Enter your password"
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </label>

          {!signup && (
            <div className="auth-options">
              <label>
                <input type="checkbox" />
                Keep me signed in
              </label>
              <button type="button">Forgot password?</button>
            </div>
          )}

          {signup && (
            <label className="terms-check">
              <input type="checkbox" required />
              <span>I agree to the Terms of Service and Privacy Policy.</span>
            </label>
          )}

          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? (
              <span>Connecting to workspace...</span>
            ) : (
              <>
                {signup ? "Create workspace" : "Log in"}
                <Icon name="arrow" size={16} />
              </>
            )}
          </button>

          <p className="auth-switch">
            {signup ? "Already using DriftLogg?" : "New to DriftLogg?"}
            <button type="button" onClick={handleSwitchMode}>
              {signup ? "Log in" : "Create an account"}
            </button>
          </p>
        </form>
      </main>
    </div>
  )
}
