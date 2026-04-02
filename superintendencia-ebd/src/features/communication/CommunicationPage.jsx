import { useEffect, useMemo, useState } from 'react'
import Button from '../../components/ui/Button'
import Card, { CardHeader } from '../../components/ui/Card'
import { useAuth } from '../../context/AuthContext'
import { useLessonControl } from '../../context/LessonControlContext'
import { getCommunicationSettings } from '../../services/communicationSettingsService'
import { listTeachers } from '../../services/teacherService'
import { formatDistance } from '../../utils/lessonControl'
import { buildWhatsAppGroupDestination } from '../../utils/whatsapp'

const DEFAULT_GROUP_MESSAGE = 'Bom domingo! Lembrem-se de concluir a aula ate 19:20 e registrar a frequencia.'

function sortTeachersByName(list = []) {
  return [...list].sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''))
}

function getCheckInStatusLabel(status) {
  if (status === 'confirmed') return 'Presenca Confirmada'
  if (status === 'outside_radius') return 'Check-in bloqueado'
  if (status === 'permission_denied') return 'GPS pendente'
  if (status === 'gps_unavailable') return 'GPS indisponivel'
  return 'Aguardando check-in'
}

function getClosingStatusLabel(session) {
  if (session?.finishStatus === 'finished') return 'Encerramento confirmado'
  if (session?.finishStatus === 'extrapolated' && session?.endedAt) return 'Aula extrapolada com horario registrado'
  if (session?.finishStatus === 'extrapolated') return 'Aula Extrapolada'
  if (session?.warningTriggeredAt) return 'Alerta de 19:10 disparado'
  return 'Aguardando horario de fechamento'
}

export default function CommunicationPage() {
  const { user, canManageStructure, isTeacher } = useAuth()
  const {
    timeline,
    session,
    status,
    isCheckingIn,
    isFinalizing,
    checkInMessage,
    requestGpsCheckIn,
    finalizeLessonNow,
    shouldShowFinalizePrompt,
    churchLocation,
    checkInRadiusMeters,
  } = useLessonControl()

  const [teachers, setTeachers] = useState([])
  const [settings, setSettings] = useState(null)
  const [groupMessage, setGroupMessage] = useState(DEFAULT_GROUP_MESSAGE)
  const [selectedTeacherIds, setSelectedTeacherIds] = useState([])
  const [groupFeedback, setGroupFeedback] = useState('')

  useEffect(() => {
    if (!user?.uid) return

    async function loadData() {
      const [teacherList, communicationSettings] = await Promise.all([
        canManageStructure ? listTeachers(user.uid).catch(() => []) : Promise.resolve([]),
        getCommunicationSettings().catch(() => null),
      ])

      setTeachers(sortTeachersByName(teacherList.filter((teacher) => teacher.active !== false)))
      setSettings(communicationSettings)
    }

    loadData()
  }, [canManageStructure, user?.uid])

  const selectedTeachers = useMemo(
    () => teachers.filter((teacher) => selectedTeacherIds.includes(teacher.id)),
    [selectedTeacherIds, teachers],
  )

  function toggleTeacher(teacherId) {
    setSelectedTeacherIds((current) => (
      current.includes(teacherId)
        ? current.filter((id) => id !== teacherId)
        : [...current, teacherId]
    ))
  }

  function handleOpenGroup() {
    if (!groupMessage.trim()) {
      window.alert('Digite a mensagem antes de abrir o grupo.')
      return
    }

    const destination = buildWhatsAppGroupDestination(settings?.ebdGroupLink || '', groupMessage.trim())
    if (!destination.url) {
      window.alert('O link do Grupo da EBD ainda nao foi configurado nas configuracoes do sistema.')
      return
    }

    window.open(destination.url, '_blank', 'noopener,noreferrer')
    setGroupFeedback(
      destination.supportsPrefill
        ? 'Mensagem pronta para o Grupo da EBD.'
        : 'Grupo aberto. Se o link for apenas de convite, cole a mensagem manualmente ao entrar.',
    )
  }

  const timerCardClassName = [
    'lesson-panel-timer-card',
    timeline.isWarning ? 'warning' : '',
    timeline.isExpired ? 'expired' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className="feature-page">
      <div className="feature-header">
        <div>
          <h2 className="feature-title">Painel de Controle de Aula</h2>
          <p className="feature-subtitle">Pontualidade, encerramento e apoio de comunicacao concentrados em uma unica tela.</p>
        </div>
      </div>

      <Card className={timerCardClassName}>
        <CardHeader
          title="Cronometro regressivo da aula"
          subtitle="Verde no fluxo normal e vermelho pulsante depois das 19:10."
        />
        <div className={`lesson-panel-timer${timeline.isWarning ? ' warning' : ''}${timeline.isExpired ? ' expired' : ''}`}>
          <span className="lesson-panel-timer-kicker">Domingo EBD</span>
          <strong className="lesson-panel-timer-value">{timeline.countdownLabel}</strong>
          <div className="lesson-panel-timer-meta">
            <span>Status: {timeline.statusLabel}</span>
            <span>Alerta: 19:10</span>
            <span>Encerramento: 19:20</span>
          </div>
        </div>
      </Card>

      {isTeacher && (
        <>
          <Card className="lesson-panel-status-card">
            <CardHeader
              title="Check-in de pontualidade"
              subtitle="O GPS so confirma presenca e pontualidade dentro do raio de 100 metros da igreja."
            />
            <div className="lesson-panel-grid">
              <div className="lesson-panel-stat">
                <span>Status</span>
                <strong>{getCheckInStatusLabel(status)}</strong>
              </div>
              <div className="lesson-panel-stat">
                <span>Referencia</span>
                <strong>{churchLocation.lat}, {churchLocation.lng}</strong>
              </div>
              <div className="lesson-panel-stat">
                <span>Raio valido</span>
                <strong>{checkInRadiusMeters} metros</strong>
              </div>
              <div className="lesson-panel-stat">
                <span>Distancia apurada</span>
                <strong>{formatDistance(session?.distanceMeters)}</strong>
              </div>
            </div>

            <div className="lesson-panel-callout">
              {checkInMessage || 'Ao abrir o app no domingo entre 18:00 e 19:20, o GPS sera solicitado para validar a chegada na igreja.'}
            </div>

            <div className="lesson-panel-actions">
              <Button
                onClick={() => requestGpsCheckIn({ automatic: false })}
                loading={isCheckingIn}
                fullWidth
              >
                {session?.presenceConfirmed ? 'Atualizar check-in' : 'Registrar Presenca Confirmada'}
              </Button>
            </div>
          </Card>

          <Card className="lesson-panel-status-card">
            <CardHeader
              title="Encerramento da aula"
              subtitle="As 19:10 o aparelho toca e vibra. As 19:20 o sistema libera a confirmacao final e marca extrapolacao se houver demora."
            />
            <div className="lesson-panel-grid">
              <div className="lesson-panel-stat">
                <span>Status atual</span>
                <strong>{getClosingStatusLabel(session)}</strong>
              </div>
              <div className="lesson-panel-stat">
                <span>Alerta 19:10</span>
                <strong>{session?.warningTriggeredAt ? 'Disparado' : 'Aguardando'}</strong>
              </div>
              <div className="lesson-panel-stat">
                <span>Horario final</span>
                <strong>{session?.endedAt ? new Date(session.endedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '--:--'}</strong>
              </div>
              <div className="lesson-panel-stat">
                <span>Relatorio</span>
                <strong>{session?.finishStatus === 'extrapolated' ? 'Aula Extrapolada' : 'Dentro do prazo'}</strong>
              </div>
            </div>

            {shouldShowFinalizePrompt ? (
              <Button size="lg" onClick={finalizeLessonNow} loading={isFinalizing} fullWidth>
                Finalizar Aula Agora?
              </Button>
            ) : (
              <div className="lesson-panel-callout neutral">
                O botao de confirmacao final aparece automaticamente as 19:20.
              </div>
            )}
          </Card>
        </>
      )}

      {!isTeacher && (
        <Card>
          <CardHeader
            title="Painel do professor"
            subtitle="Check-in por GPS e confirmacao de termino ficam ativos para perfis de professor."
          />
          <p className="feature-subtitle">
            Como seu perfil atual nao e de professor, esta tela mostra o cronometro e a area de apoio da superintendencia.
          </p>
        </Card>
      )}

      {canManageStructure && (
        <Card>
          <CardHeader
            title="Central de avisos simplificada"
            subtitle="Mantida apenas com a mensagem do grupo e o seletor de professores."
          />

          <div className="inline-form">
            <label htmlFor="lesson-group-message">Mensagem para o Grupo da EBD</label>
            <textarea
              id="lesson-group-message"
              value={groupMessage}
              onChange={(event) => {
                setGroupMessage(event.target.value)
                setGroupFeedback('')
              }}
              placeholder="Escreva a mensagem que sera enviada ao Grupo da EBD."
            />

            <Button onClick={handleOpenGroup} fullWidth>
              Abrir Grupo da EBD
            </Button>

            {groupFeedback && <span className="notice-helper-text">{groupFeedback}</span>}
          </div>

          <div className="lesson-teacher-selector">
            <div className="lesson-teacher-selector-header">
              <strong>Professores selecionados</strong>
              <span>{selectedTeachers.length} selecionado(s)</span>
            </div>

            <div className="selection-list notice-selection-list">
              {teachers.length === 0 && (
                <div className="notice-empty-state">Nenhum professor ativo cadastrado.</div>
              )}

              {teachers.map((teacher) => {
                const checked = selectedTeacherIds.includes(teacher.id)

                return (
                  <label key={teacher.id} className={`selection-item notice-selection-item${checked ? ' selected' : ''}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleTeacher(teacher.id)}
                    />
                    <span>
                      <strong>{teacher.fullName}</strong>
                      <small>{teacher.phone || teacher.email || 'Sem contato informado'}</small>
                    </span>
                  </label>
                )
              })}
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
