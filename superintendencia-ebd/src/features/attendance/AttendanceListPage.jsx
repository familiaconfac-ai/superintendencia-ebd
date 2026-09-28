import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import {
  isAttendancePermissionError,
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
  const [loadError, setLoadError] = useState(null)
  const [syncingHistorical, setSyncingHistorical] = useState(false)
  const [syncFeedback, setSyncFeedback] = useState('')
  const [didAutoSyncHistorical, setDidAutoSyncHistorical] = useState(false)

  const loadData = useCallback(async () => {
    if (!user?.uid) {
      setRegisters([])
      setSyncFeedback('')
      setLoadError({ type: 'permission', message: 'Usuario nao autenticado.' })
      setLoading(false)
      return false
    }
    setLoading(true)
    setLoadError(null)
    setSyncFeedback('')

    try {
      const allRegisters = await listAttendanceRegisters(user.uid, user, profile)
      const visibleRegisters = isAdmin(user, profile)
        ? allRegisters
        : allRegisters.filter((item) => canAccessAttendanceRegister(item, user, profile))
      setRegisters(visibleRegisters)
      return true
    } catch (error) {
      console.error('[AttendanceListPage] Erro ao carregar cadernetas:', error)
      setRegisters([])
      setSyncFeedback('')
      setLoadError({
        type: isAttendancePermissionError(error) ? 'permission' : 'error',
        message: error?.message || 'Nao foi possivel carregar as cadernetas.',
      })
      return false
    } finally {
      setLoading(false)
    }
  }, [profile, user])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    if (
      !user?.uid
      || canManageStructure
      || loading
      || loadError
      || didAutoSyncHistorical
      || !location.state?.autoSyncHistorical
    ) return
    setDidAutoSyncHistorical(true)
    handleHistoricalSync()
    // O auto-sync e intencionalmente acionado apenas pelo estado da navegacao.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    user?.uid,
    canManageStructure,
    loading,
    loadError,
    didAutoSyncHistorical,
    location.state?.autoSyncHistorical,
  ])

  const currentRegisters = useMemo(
    () => registers.filter((item) => !getAttendanceRegisterLifecycle(item).isHistorical),
    [registers],
  )

  const historicalRegisters = useMemo(
    () => registers.filter((item) => getAttendanceRegisterLifecycle(item).isHistorical),
    [registers],
  )

  async function handleHistoricalSync() {
    if (!user?.uid || canManageStructure || loading || loadError || syncingHistorical) return
    setSyncingHistorical(true)
    setSyncFeedback('')
    try {
      const syncResult = await syncHistoricalTeacherRegisters(user.uid, user, profile, { registers })
      const reloaded = await loadData()
      if (!reloaded) return
      if (syncResult.matchedCount === 0) {
        setSyncFeedback('Nenhuma aula passada vinculada ao seu UID, ID de professor ou e-mail foi encontrada.')
      } else if (syncResult.linkedCount > 0) {
        setSyncFeedback(`${syncResult.linkedCount} caderneta(s) antiga(s) foram vinculadas ao seu perfil.`)
      } else {
        setSyncFeedback('Suas aulas passadas ja estavam sincronizadas com o seu perfil.')
      }
    } catch (error) {
      console.error('[AttendanceListPage] Erro ao sincronizar historico:', error)
      setSyncFeedback(isAttendancePermissionError(error)
        ? 'Sem permissao para sincronizar cadernetas antigas. Procure a administracao.'
        : 'Nao foi possivel sincronizar as aulas passadas. Tente novamente.')
    } finally {
      setSyncingHistorical(false)
    }
  }

  async function handleDelete(item) {
    if (!canManageStructure || !window.confirm('Excluir esta caderneta?')) return
    await removeAttendanceRegister(item.storageOwnerUid || item.ownerUid || item.createdByUid || user.uid, item.id)
    await loadData()
  }

  function handleOpen(item) {
    navigate(`/caderneta/${item.id}`, {
      state: { registerOwnerUid: item.storageOwnerUid || item.ownerUid || item.createdByUid || '' },
    })
  }

  function renderRegisterRow(item) {
    const lifecycle = getAttendanceRegisterLifecycle(item)
    const readOnly = isAttendanceRegisterReadOnly(item, user, profile)
    return (
      <div className="entity-row" key={`${item.storageOwnerUid || ''}:${item.id}`}>
        <div>
          <div className="entity-title">{item.className || 'Turma sem nome'}</div>
          <div className="entity-meta">{formatRegisterPeriod(item)} - {item.teacherName?.trim() || 'Professor Arquivado / Não Encontrado'}</div>
          <div className="attendance-register-tags">
            {lifecycle.isHistorical && <span className="attendance-register-tag">Historico</span>}
            {readOnly && <span className="attendance-register-tag readonly">Somente leitura</span>}
            <span className="attendance-register-tag lesson">{item.discipline || 'Licao registrada sem tema informado'}</span>
          </div>
        </div>
        <div className="row-actions">
          <Button size="sm" onClick={() => handleOpen(item)}>{readOnly ? 'Visualizar' : 'Abrir'}</Button>
          {canManageStructure && (
            <>
              <Button size="sm" variant="secondary" onClick={() => navigate('/caderneta/criar', { state: { duplicateRegister: item } })}>Duplicar</Button>
              <Button size="sm" variant="danger" onClick={() => handleDelete(item)}>Excluir</Button>
            </>
          )}
        </div>
      </div>
    )
  }

  const emptyMessage = canManageStructure
    ? 'Nenhuma caderneta cadastrada.'
    : 'Voce ainda nao possui turma ou caderneta vinculada. Procure a administracao para conferir seu UID e e-mail.'

  return (
    <div className="feature-page">
      <div className="feature-header">
        <div>
          <h2 className="feature-title">Cadernetas</h2>
          <p className="feature-subtitle">Acompanhe o periodo atual e revise suas aulas passadas com seguranca.</p>
        </div>
        {!canManageStructure && (
          <Button size="sm" variant="secondary" onClick={handleHistoricalSync} disabled={syncingHistorical || loading || Boolean(loadError)}>
            {syncingHistorical ? 'Verificando...' : 'Verificar Minhas Aulas Passadas'}
          </Button>
        )}
      </div>

      {loadError && (
        <Card className="attendance-sync-card">
          <h3>{loadError.type === 'permission' ? 'Sem permissao para acessar a caderneta' : 'Erro ao carregar a caderneta'}</h3>
          <p className="feature-subtitle">
            {loadError.type === 'permission'
              ? 'Seu login esta ativo, mas o Firestore recusou esta consulta. Procure a administracao para revisar o vinculo.'
              : loadError.message}
          </p>
          <Button size="sm" onClick={loadData}>Tentar novamente</Button>
        </Card>
      )}

      {!loadError && syncFeedback && <Card className="attendance-sync-card"><p className="feature-subtitle">{syncFeedback}</p></Card>}

      {!loadError && !loading && registers.length === 0 && (
        <Card className="attendance-sync-card"><p className="feature-subtitle">{emptyMessage}</p></Card>
      )}

      {!loadError && (
        <>
          <Card>
            <CardHeader title="Cadernetas ativas" subtitle={canManageStructure ? 'Lista completa das cadernetas em uso.' : 'Turmas atuais vinculadas ao seu acesso.'} />
            <div className="entity-list">
              {loading && <p>Carregando...</p>}
              {!loading && currentRegisters.length === 0 && registers.length > 0 && <p className="feature-subtitle">Nenhuma caderneta ativa encontrada.</p>}
              {!loading && currentRegisters.map(renderRegisterRow)}
            </div>
          </Card>

          <Card>
            <CardHeader title="Historico de Cadernetas" subtitle={canManageStructure ? 'Cadernetas encerradas para auditoria.' : 'Aulas passadas em modo somente leitura para conferencia.'} />
            <div className="entity-list">
              {loading && <p>Carregando...</p>}
              {!loading && historicalRegisters.length === 0 && registers.length > 0 && <p className="feature-subtitle">Nenhuma caderneta historica encontrada.</p>}
              {!loading && historicalRegisters.map(renderRegisterRow)}
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
