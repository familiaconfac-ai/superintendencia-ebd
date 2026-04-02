import { useNavigate } from 'react-router-dom'
import Button from '../../components/ui/Button'
import Card, { CardHeader } from '../../components/ui/Card'
import { useAuth } from '../../context/AuthContext'
import { logoutUser } from '../../firebase/auth'

export default function ProfilePage() {
  const { user, profile, canManageStructure } = useAuth()
  const navigate = useNavigate()

  async function handleLogout() {
    await logoutUser()
    navigate('/login', { replace: true })
  }

  function handleHistoricalAudit() {
    navigate('/caderneta', {
      state: {
        autoSyncHistorical: true,
      },
    })
  }

  return (
    <div className="feature-page">
      <div className="feature-header">
        <h2 className="feature-title">Perfil</h2>
      </div>

      <Card>
        <CardHeader title={profile?.displayName || user?.displayName || 'Usuario'} subtitle={user?.email || 'Sem e-mail'} />
        <p className="feature-subtitle">Use este ambiente para registrar cadernetas e acompanhar a frequencia da EBD.</p>
      </Card>

      {!canManageStructure && (
        <Card>
          <CardHeader
            title="Historico do Professor"
            subtitle="Conferencia retroativa em modo somente leitura"
          />
          <p className="feature-subtitle">
            Revise suas aulas passadas mesmo que hoje voce esteja em outra classe.
          </p>
          <div className="feature-actions">
            <Button variant="secondary" onClick={handleHistoricalAudit}>Verificar Minhas Aulas Passadas</Button>
          </div>
        </Card>
      )}

      <Button variant="danger" onClick={handleLogout}>Sair da conta</Button>
    </div>
  )
}
