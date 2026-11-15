import type { RiskLevel } from "../../types"

interface RiskBadgeProps {
  risk: RiskLevel | string
}

export function RiskBadge({ risk }: RiskBadgeProps) {
  return (
    <span className={`risk-badge ${risk.toLowerCase()}`}>
      <span />
      {risk}
    </span>
  )
}
