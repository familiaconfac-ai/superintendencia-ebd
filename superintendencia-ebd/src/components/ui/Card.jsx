import './Card.css'

export default function Card({ children, className = '', onClick, variant = 'default', style }) {
  return (
    <div
      className={`card card--${variant}${onClick ? ' card--clickable' : ''} ${className}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      style={style}
    >
      {children}
    </div>
  )
}

export function CardHeader({ title, subtitle, action }) {
  return (
    <div className="card-header">
      <div>
        <h3 className="card-title">{title}</h3>
        {subtitle && <p className="card-subtitle">{subtitle}</p>}
      </div>
      {action && <div className="card-action">{action}</div>}
    </div>
  )
}

export function SummaryCard({ label, value, icon, color = 'primary', trend, onClick, clickable = false }) {
  return (
    <div
      className={`summary-card summary-card--${color}${clickable || onClick ? ' summary-card--clickable' : ''}`}
      onClick={onClick}
      role={clickable || onClick ? 'button' : undefined}
      tabIndex={clickable || onClick ? 0 : undefined}
      onKeyDown={(event) => {
        if (!(clickable || onClick)) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick?.(event)
        }
      }}
    >
      <div className="summary-card-top">
        <span className="summary-card-icon">{icon}</span>
        {trend !== undefined && (
          <span className={`summary-trend ${trend >= 0 ? 'positive' : 'negative'}`}>
            {trend >= 0 ? '▲' : '▼'} {Math.abs(trend).toFixed(1)}%
          </span>
        )}
      </div>
      <div className="summary-card-value">{value}</div>
      <div className="summary-card-label">{label}</div>
    </div>
  )
}
