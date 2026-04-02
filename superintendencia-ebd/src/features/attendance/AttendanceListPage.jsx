import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import {
  listAttendanceRegisters,
  removeAttendanceRegister,
  syncHistoricalTeacherRegisters,
} from '../../services/attendanceService'
import Button from '../../components/ui/Button'
import Card, { CardHeader } from '../../components/ui/Card'
import {
  canAccessAttendanceRegister,
  getAttendanceRegisterLifecycle,
  isAdmin,
  isAttendanceRegisterReadOnly,
} from '../../utils/accessControl'
import { formatRegisterPeriod } from '../../utils/attendanceUtils'

export default function AttendanceListPage() {
  const { user, profile, canManageStructure } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [registers, setRegisters] = useState([])
  const [loading, setLoading] = useState(true)
  const [syncingHistorical, setSyncingHistorical] = useState(false)
  const [syncFeedback, setSyncFeedback] = useState('')
  const [didAutoSyncHistorical, setDidAutoSyncHistorical] = useState(false)

  async function loadData() {
    setLoading(true)
    try {
      const userIsAdmin = isAdmin(user)
      let allRegisters = await listAttendanceRegisters(user.uid)

      if (!userIsAdmin) {
        const syncResult = await syncHistoricalTeacherRegisters(user.uid, user, profile, {
          registers: allRegisters,
        })

        if (syncResult.linkedCount > 0) {
          allRegisters = await listAttendanceRegisters(user.uid)
        }
      }

      const filtered = userIsAdmin
        ? allRegisters
        : allRegisters.filter((item) => canAccessAttendanceRegister(item, user, profile))

      setRegisters(filtered)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (user?.uid) loadData()
    // eslint-disable-next-line
  }, [user?.uid])

  useEffect(() => {
    if (!user?.uid || canManageStructure || didAutoSyncHistorical || !location.state?.autoSyncHistorical) return

    setDidAutoSyncHistorical(true)
    handleHistoricalSync()
    // eslint-disable-next-line
  }, [user?.uid, canManageStructure, didAutoSyncHistorical, location.state?.autoSyncHistorical])

  const currentRegisters = useMemo(
    () => registers.filter((item) => !getAttendanceRegisterLifecycle(item).isHistorical),
    [registers],
  )

  const historicalRegisters = useMemo(
    () => registers.filter((item) => getAttendanceRegisterLifecycle(item).isHistorical),
    [registers],
  )

  async function handleHistoricalSync() {
    if (!user?.uid || canManageStructure || syncingHistorical) return

    setSyncingHistorical(true)
    setSyncFeedback('')
    try {
      const syncResult = await syncHistoricalTeacherRegisters(user.uid, user, profile)
      await loadData()

      if (syncResult.matchedCount === 0) {
        setSyncFeedback('Nenhuma aula passada vinculada ao seu perfil foi encontrada nesta verificacao.')
        return
      }

      if (syncResult.linkedCount > 0) {
        setSyncFeedback(`${syncResult.linkedCount} caderneta(s) antiga(s) foram vinculadas ao seu perfil.`)
        return
      }

      setSyncFeedback('Suas aulas passadas ja estavam sincronizadas com o seu perfil.')
    } finally {
      setSyncingHistorical(false)
    }
  }

  async function handleDelete(item) {
    if (!canManageStructure) return
    if (!window.confirm('Excluir esta caderneta?')) return

    await removeAttendanceRegister(item.storageOwnerUid || item.ownerUid || item.createdByUid || user.uid, item.id)
    await loadData()
  }

  function handleDuplicate(item) {
    if (!canManageStructure) return
    navigate('/caderneta/criar', {
      state: {
        duplicateRegister: item,
      },
    })
  }

  function handleOpen(item) {
    navigate(`/caderneta/${item.id}`, {
      state: {
        registerOwnerUid: item.storageOwnerUid || item.ownerUid || item.createdByUid || '',
      },
    })
  }

  function renderRegisterRow(item) {
    const lifecycle = getAttendanceRegisterLifecycle(item)
    const readOnly = isAttendanceRegisterReadOnly(item, user)

    return (
      <div className="entity-row" key={item.id}>
        <div>
          <div className="entity-title">{item.className}</div>
          <div className="entity-meta">{formatRegisterPeriod(item)} - {item.teacherName || 'Professor nao informado'}</div>
          <div className="attendance-register-tags">
            {lifecycle.isHistorical && <span className="attendance-register-tag">Historico</span>}
            {readOnly && <span className="attendance-register-tag readonly">Somente leitura</span>}
            <span className="attendance-register-tag lesson">{item.discipline || 'Licao registrada sem tema informado'}</span>
          </div>
        </div>
        <div className="row-actions">
          <Button size="sm" onClick={() => handleOpen(item)}>
            {readOnly ? 'Visualizar' : 'Abrir'}
          </Button>
          {canManageStructure && (
            <>
              <Button size="sm" variant="secondary" onClick={() => handleDuplicate(item)}>Duplicar</Button>
              <Button size="sm" variant="danger" onClick={() => handleDelete(item)}>Excluir</Button>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="feature-page">
      <div className="feature-header">
        <div>
          <h2 className="feature-title">Cadernetas</h2>
          <p className="feature-subtitle">Acompanhe o periodo atual e revise suas aulas passadas com seguranca.</p>
        </div>
        {!canManageStructure && (
          <Button size="sm" variant="secondary" onClick={handleHistoricalSync} disabled={syncingHistorical}>
            {syncingHistorical ? 'Verificando...' : 'Verificar Minhas Aulas Passadas'}
          </Button>
        )}
      </div>

      {syncFeedback && (
        <Card className="attendance-sync-card">
          <p className="feature-subtitle">{syncFeedback}</p>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Cadernetas ativas"
          subtitle={canManageStructure ? 'Lista completa das cadernetas em uso.' : 'Turmas atuais vinculadas ao seu acesso.'}
        />
        <div className="entity-list">
          {loading && <p>Carregando...</p>}
          {!loading && currentRegisters.length === 0 && <p className="feature-subtitle">Nenhuma caderneta ativa encontrada.</p>}
          {currentRegisters.map(renderRegisterRow)}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Historico de Cadernetas"
          subtitle={canManageStructure ? 'Cadernetas encerradas para auditoria.' : 'Aulas passadas em modo somente leitura para conferencia.'}
        />
        <div className="entity-list">
          {loading && <p>Carregando...</p>}
          {!loading && historicalRegisters.length === 0 && <p className="feature-subtitle">Nenhuma caderneta historica encontrada.</p>}
          {historicalRegisters.map(renderRegisterRow)}
        </div>
      </Card>
    </div>
  )
}
