import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../../components/ui/Button'
import Card, { CardHeader } from '../../components/ui/Card'
import { useAuth } from '../../context/AuthContext'
import { useLessonControl } from '../../context/LessonControlContext'
import { getCommunicationSettings } from '../../services/communicationSettingsService'
import {
  getPushSupportSummary,
  registerDeviceForFuturePush,
  requestNotificationPermission,
} from '../../services/noticeCenterService'
import { listTeachers } from '../../services/teacherService'
import { formatDistance } from '../../utils/lessonControl'
import { buildWhatsAppGroupDestination } from '../../utils/whatsapp'

function sortTeachersByName(list = []) {
  return [...list].sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''))
}

function getCheckInStatusLabel(status) {
  if (status === 'confirmed') return 'Presença Confirmada'
  if (status === 'outside_radius') return 'Check-in bloqueado'
  if (status === 'permission_denied') return 'GPS pendente'
  if (status === 'gps_unavailable') return 'GPS indisponível'
  return 'Aguardando check-in'
}

function getClosingStatusLabel(session, timeline) {
  if (session?.finishStatus === 'finished') return 'Encerramento confirmado'
  if (session?.finishStatus === 'extrapolated' && session?.endedAt) return 'Aula extrapolada com horário registrado'
  if (session?.finishStatus === 'extrapolated') return 'Aula Extrapolada'
  if (session?.endAlertTriggeredAt) return `Alarme final de ${timeline.lessonEndTime} disparado`
  if (session?.warningTriggeredAt) return `Primeiro alerta de ${timeline.lessonWarningTime} disparado`
  return 'Aguardando horário de fechamento'
}

export default function CommunicationPage() {
  const navigate = useNavigate()
  const { user, canManageStructure, isTeacher } = useAuth()
  const {
    timeline,
    session,
    status,
    canControlLesson,
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
  const defaultGroupMessage = `Boa aula! Lembrem-se de concluir a aula até ${timeline.lessonEndTime} e registrar a frequência.`
  const [groupMessage, setGroupMessage] = useState('')
  const [selectedTeacherIds, setSelectedTeacherIds] = useState([])
  const [groupFeedback, setGroupFeedback] = useState('')
  const [notificationSummary, setNotificationSummary] = useState(() => getPushSupportSummary())
  const [notificationStatusMessage, setNotificationStatusMessage] = useState('')
  const [isEnablingNotifications, setIsEnablingNotifications] = useState(false)

  useEffect(() => {
    if (!user?.uid) return

    async function loadData() {
      const [teacherList, communicationSettings] = await Promise.all([
        canManageStructure ? listTeachers(user.uid).catch(() => []) : Promise.resolve([]),
        getCommunicationSettings().catch(() => null),
      ])

      setTeachers(sortTeachersByName(teacherList.filter((teacher) => teacher.active !== false)))
      setSettings(communicationSettings)
      setNotificationSummary(getPushSupportSummary())
    }

    loadData()
  }, [canManageStructure, user?.uid])

  // Logs de depuração exigidos para o Alarme Local
  useEffect(() => {
    console.log('[LESSON CONTROL] notification permission:', notificationSummary.permission)
  }, [notificationSummary.permission])

  useEffect(() => {
    if (timeline) {
      console.log('[LESSON CONTROL] config loaded', {
        warning: timeline.lessonWarningTime,
        end: timeline.lessonEndTime,
        isLessonWindow: timeline.isLessonWindow,
      })
    }
  }, [timeline])

  useEffect(() => {
    if (session?.warningTriggeredAt || session?.endAlertTriggeredAt) {
      console.log('[LESSON CONTROL] alert fired', {
        type: session?.endAlertTriggeredAt ? 'Final' : 'Aviso',
        time: new Date().toLocaleTimeString(),
      })
    }
  }, [session?.warningTriggeredAt, session?.endAlertTriggeredAt])

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

  function handleOpenGroup(message = groupMessage) {
    const normalizedMessage = message.trim()

    if (!normalizedMessage) {
      window.alert('Digite a mensagem antes de abrir o grupo.')
      return
    }

    const destination = buildWhatsAppGroupDestination(settings?.ebdGroupLink || '', normalizedMessage)
    if (!destination.url) {
      window.alert('O link do Grupo da EBD ainda não foi configurado nas configurações do sistema.')
      return
    }

    window.open(destination.url, '_blank', 'noopener,noreferrer')
    setGroupFeedback(
      destination.supportsPrefill
        ? 'Mensagem pronta para o Grupo da EBD.'
        : 'Grupo aberto. Se o link for apenas de convite, cole a mensagem manualmente ao entrar.',
    )
  }

  async function handleEnableNotifications() {
    setIsEnablingNotifications(true)
    setNotificationStatusMessage('')

    try {
      const permission = await requestNotificationPermission()
      const registration = await registerDeviceForFuturePush({
        uid: user?.uid,
        email: user?.email,
        displayName: user?.displayName,
      })

      setNotificationSummary(getPushSupportSummary())

      if (permission === 'denied') {
        setNotificationStatusMessage('Permissão negada. Ative as notificações do navegador para receber os alertas com o app aberto.')
        return
      }

      if (registration?.status === 'push_ready') {
        setNotificationStatusMessage('Dispositivo pronto para push em background.')
        return
      }

      if (registration?.status === 'notification_only') {
        setNotificationStatusMessage('Permissão concedida. O app já mostra notificações com o painel aberto.')
        return
      }

      setNotificationStatusMessage('Permissão registrada, mas ainda falta suporte completo de push neste navegador.')
    } catch (error) {
      console.error('[CommunicationPage] Falha ao ativar notificações:', error)
      setNotificationStatusMessage('Não foi possível ativar as notificações agora.')
    } finally {
      setIsEnablingNotifications(false)
    }
  }

  const timerCardClassName = [
    'lesson-panel-timer-card',
    timeline.isWarning ? 'warning' : '',
    timeline.isExpired ? 'expired' : '',
  ].filter(Boolean).join(' ')

  const idleMessage = `Check-in liberado a partir de ${timeline.checkInStartTime} no dia ${timeline.lessonDateLabel}.`
  const closingPromptText = `O botão de confirmação final aparece automaticamente às ${timeline.lessonEndTime}.`

  return (
    <div className="feature-page">
      <div className="feature-header">
        <div>
          <h2 className="feature-title">Painel de Controle de Aula</h2>
          <p className="feature-subtitle">Pontualidade, encerramento e apoio de comunicação concentrados em uma única tela.</p>
        </div>
      </div>

      <Card className={timerCardClassName}>
        <CardHeader
          title="Cronômetro regressivo da aula"
          subtitle={`Próxima aula: ${timeline.lessonWeekdayLabel}, ${timeline.lessonDateLabel}, às ${timeline.lessonStartTimeLabel}.`}
        />
        <div className="lesson-panel-actions">
          <Button variant="secondary" size="sm" onClick={() => navigate('/configuracoes')}>
            Editar horário da aula
          </Button>
        </div>

        {timeline.isLessonWindow || timeline.isExpired ? (
          <div className={`lesson-panel-timer${timeline.isWarning ? ' warning' : ''}${timeline.isExpired ? ' expired' : ''}`}>
            <span className="lesson-panel-timer-kicker">{timeline.lessonWeekdayLabel} EBD</span>
            <strong className="lesson-panel-timer-value">{timeline.isExpired ? '00:00:00' : timeline.countdownLabel}</strong>
            <div className="lesson-panel-timer-meta">
              <span>Início: {timeline.lessonStartTimeLabel}</span>
              <span>Status: {timeline.statusLabel}</span>
              <span>Término: {timeline.lessonEndTime}</span>
            </div>
          </div>
        ) : (
          <div className="dashboard-timer-idle">
            <strong>{timeline.statusLabel}</strong>
            <span>{idleMessage}</span>
          </div>
        )}

        <div className="lesson-panel-grid">
          <div className="lesson-panel-stat">
            <span>Primeiro alerta</span>
            <strong>{timeline.lessonWarningTime}</strong>
          </div>
          <div className="lesson-panel-stat">
            <span>Segundo alerta</span>
            <strong>{timeline.lessonEndTime}</strong>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Alertas do celular"
          subtitle="Permite tocar, vibrar e receber notificações locais com o app aberto."
        />
        <div className="lesson-panel-grid">
          <div className="lesson-panel-stat">
            <span>Permissão</span>
            <strong>{notificationSummary.permission}</strong>
          </div>
          <div className="lesson-panel-stat">
            <span>Push em background</span>
            <strong>{notificationSummary.savedRegistration?.status || 'Não configurado'}</strong>
          </div>
          <div className="lesson-panel-stat">
            <span>Service Worker</span>
            <strong>{notificationSummary.serviceWorkerSupported ? 'Disponível' : 'Indisponível'}</strong>
          </div>
          <div className="lesson-panel-stat">
            <span>Modo atual</span>
            <strong>Notificação local</strong>
          </div>
        </div>

        <div className="lesson-panel-callout neutral">
          {notificationStatusMessage || 'Ative as notificações neste aparelho para preparar os dois alertas de aula com o app aberto.'}
        </div>

        <Button onClick={handleEnableNotifications} loading={isEnablingNotifications} fullWidth>
          Ativar alertas no celular
        </Button>
      </Card>

      {isTeacher && (
        <Card className="lesson-panel-status-card">
          <CardHeader
            title="Check-in de pontualidade"
            subtitle={`O GPS só confirma presença e pontualidade dentro do raio de ${checkInRadiusMeters} metros da igreja.`}
          />
          <div className="lesson-panel-grid">
            <div className="lesson-panel-stat">
              <span>Status</span>
              <strong>{getCheckInStatusLabel(status)}</strong>
            </div>
            <div className="lesson-panel-stat">
              <span>Referência</span>
              <strong>{churchLocation.lat}, {churchLocation.lng}</strong>
            </div>
            <div className="lesson-panel-stat">
              <span>Raio válido</span>
              <strong>{checkInRadiusMeters} metros</strong>
            </div>
            <div className="lesson-panel-stat">
              <span>Distância apurada</span>
              <strong>{formatDistance(session?.distanceMeters)}</strong>
            </div>
          </div>

          <div className="lesson-panel-callout">
            {checkInMessage || `Ao abrir o app em ${timeline.lessonWeekdayLabel}, ${timeline.lessonDateLabel}, entre ${timeline.checkInStartTime} e ${timeline.lessonEndTime}, o GPS será solicitado para validar a chegada na igreja.`}
          </div>

          <div className="lesson-panel-actions">
            <Button
              onClick={() => requestGpsCheckIn({ automatic: false })}
              loading={isCheckingIn}
              fullWidth
            >
              {session?.presenceConfirmed ? 'Atualizar check-in' : 'Registrar Presença Confirmada'}
            </Button>
          </div>
        </Card>
      )}

      {canControlLesson && (
        <Card className="lesson-panel-status-card">
          <CardHeader
            title="Encerramento da aula"
            subtitle={`Às ${timeline.lessonWarningTime} o aparelho toca e vibra. Às ${timeline.lessonEndTime} o sistema libera a confirmação final e marca extrapolação se houver demora.`}
          />
          <div className="lesson-panel-grid">
            <div className="lesson-panel-stat">
              <span>Status atual</span>
              <strong>{getClosingStatusLabel(session, timeline)}</strong>
            </div>
            <div className="lesson-panel-stat">
              <span>Alerta antes do fim</span>
              <strong>{timeline.warningLeadMinutes} min</strong>
            </div>
            <div className="lesson-panel-stat">
              <span>Horário final</span>
              <strong>{session?.endedAt ? new Date(session.endedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '--:--'}</strong>
            </div>
            <div className="lesson-panel-stat">
              <span>Relatório</span>
              <strong>{session?.finishStatus === 'extrapolated' ? 'Aula Extrapolada' : 'Dentro do prazo'}</strong>
            </div>
          </div>

          {shouldShowFinalizePrompt ? (
            <Button size="lg" onClick={finalizeLessonNow} loading={isFinalizing} fullWidth>
              Finalizar Aula Agora?
            </Button>
          ) : (
            <div className="lesson-panel-callout neutral">
              {closingPromptText}
            </div>
          )}
        </Card>
      )}

      {!canControlLesson && (
        <Card>
          <CardHeader
            title="Painel do professor"
            subtitle="Check-in por GPS e confirmação de término ficam ativos para perfis de professor."
          />
          <p className="feature-subtitle">
            Como seu perfil atual não é de professor, esta tela mostra o cronômetro e a área de apoio da superintendência.
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
              placeholder="Escreva a mensagem que será enviada ao Grupo da EBD."
            />

            <Button
              onClick={() => {
                if (!groupMessage.trim()) {
                  setGroupMessage(defaultGroupMessage)
                  handleOpenGroup(defaultGroupMessage)
                  return
                }
                handleOpenGroup()
              }}
              fullWidth
            >
              Abrir Grupo da EBD
            </Button>

            <span className="notice-helper-text">
              {settings?.ebdGroupLink ? 'Link oficial do grupo configurado e pronto para abrir no WhatsApp.' : 'O link do grupo ainda precisa ser configurado.'}
            </span>

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
