import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { logoutUser } from '../../firebase/auth'
import Card, { CardHeader } from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import './Perfil.css'

export default function Perfil() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)

  async function handleLogout() {
    setLoading(true)
    await logoutUser()
    navigate('/login')
  }

  return (
    <div className="perfil-page">
      {/* Avatar — suporta foto real ou inicial como fallback */}
      <div className="perfil-hero">
        <div className="perfil-avatar">
          {profile?.photoURL || user?.photoURL ? (
            <img
              src={profile?.photoURL ?? user?.photoURL}
              alt={profile?.displayName ?? 'Avatar'}
              className="perfil-avatar-img"
            />
          ) : (
            <span className="perfil-avatar-initial">
              {profile?.displayName?.[0]?.toUpperCase() ?? user?.email?.[0]?.toUpperCase() ?? '?'}
            </span>
          )}
        </div>
        <h2 className="perfil-name">{profile?.displayName ?? '—'}</h2>
        <p className="perfil-email">{user?.email}</p>
      </div>

      {/* Dados */}
      <div className="perfil-content">
        <Card>
          <CardHeader title="Dados da conta" />
          <div className="perfil-row"><span>Nome</span><span>{profile?.displayName ?? '—'}</span></div>
          <div className="perfil-row"><span>E-mail</span><span>{user?.email}</span></div>
          <div className="perfil-row"><span>Perfil</span><span>{profile?.role === 'admin' ? 'Administrador' : 'Usuário'}</span></div>
        </Card>

        <Card>
          <CardHeader title="Preferências" />
          <div className="perfil-row">
            <span>Moeda</span>
            <span>BRL – Real Brasileiro</span>
          </div>
          <div className="perfil-row">
            <span>Notificações</span>
            <span>Em breve</span>
          </div>
        </Card>

        <Button variant="danger" fullWidth loading={loading} onClick={handleLogout}>
          🚪 Sair da conta
        </Button>
      </div>
    </div>
  )
}
