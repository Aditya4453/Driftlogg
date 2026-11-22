interface DonutChartProps {
  total?: number

  high?: number

  medium?: number

  low?: number
}

export function DonutChart({
  total = 148,

  high = 4,

  medium = 13,

  low = 131,
}: DonutChartProps) {
  // Circumference of r=47 is 2 * PI * 47 = 295.31

  const circumference = 2 * Math.PI * 47

  const sum = high + medium + low || total || 1

  const lowLength = (low / sum) * circumference

  const medLength = (medium / sum) * circumference

  const highLength = (high / sum) * circumference

  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 120 120" className="donut">
        <circle cx="60" cy="60" r="47" className="donut-bg" />
        <circle
          cx="60"
          cy="60"
          r="47"
          className="donut-low"
          strokeDasharray={`${lowLength.toFixed(1)} ${(circumference - lowLength).toFixed(1)}`}
        />
        <circle
          cx="60"
          cy="60"
          r="47"
          className="donut-med"
          strokeDasharray={`${medLength.toFixed(1)} ${(circumference - medLength).toFixed(1)}`}
          strokeDashoffset={(-lowLength).toFixed(1)}
        />
        <circle
          cx="60"
          cy="60"
          r="47"
          className="donut-high"
          strokeDasharray={`${highLength.toFixed(1)} ${(circumference - highLength).toFixed(1)}`}
          strokeDashoffset={(-(lowLength + medLength)).toFixed(1)}
        />
      </svg>
      <div className="donut-center">
        <strong>{total}</strong>
        <span>packages</span>
      </div>
    </div>
  )
}
