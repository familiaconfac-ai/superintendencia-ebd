import { NavLink } from 'react-router-dom'
import './BottomNav.css'

const NAV_ITEMS = [
  { to: '/dashboard',   label: 'Início',   icon: '🏠' },
  { to: '/lancamentos', label: 'Lançar',   icon: '➕' },
  { to: '/importacao',  label: 'Importar', icon: '📥' },
  { to: '/familia',     label: 'Família',  icon: '👨‍👩‍👧‍👦' },
  { to: '/perfil',      label: 'Perfil',   icon: '👤' },
]

async function shareApp() {
  const data = {
    title: 'Learnendo Finanças',
    text:  'Gerencie as finanças da sua família com o Learnendo Finanças!',
    url:   window.location.origin,
  }
  if (navigator.share) {
    try { await navigator.share(data) } catch (_) { /* user cancelled */ }
  } else {
    try {
      await navigator.clipboard.writeText(window.location.origin)
      // Simple visual feedback via the button — nothing else needed
    } catch (_) {}
  }
}

export default function BottomNav() {
  const items = NAV_ITEMS

  return (
    <nav className="bottom-nav">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `bottom-nav-item${isActive ? ' active' : ''}`
          }
        >
          <span className="bottom-nav-icon">{item.icon}</span>
          <span className="bottom-nav-label">{item.label}</span>
        </NavLink>
      ))}
      <button className="bottom-nav-item bottom-nav-share" onClick={shareApp} title="Compartilhar app">
        <span className="bottom-nav-icon">📤</span>
        <span className="bottom-nav-label">Indicar</span>
      </button>
    </nav>
  )
}

