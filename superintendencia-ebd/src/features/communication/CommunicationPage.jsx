import { useEffect, useMemo, useState } from 'react'
import Button from '../../components/ui/Button'
import Card, { CardHeader } from '../../components/ui/Card'
import { useAuth } from '../../context/AuthContext'
import { getCommunicationSettings } from '../../services/communicationSettingsService'
import { publishLessonClosingWarning } from '../../services/noticeCenterService'
import { listTeachers } from '../../services/teacherService'
import useLessonCountdown from '../../hooks/useLessonCountdown'
import { buildWhatsAppGroupDestination, buildWhatsAppTeacherUrl, normalizeWhatsAppNumber } from '../../utils/whatsapp'

const DEFAULT_MESSAGE = 'Bom domingo! Que Deus abencoe o ensino de cada classe.'

const QUICK_TEMPLATES = [
  {
    id: 'meeting',
    label: '📢 Reuniao',
    message: 'Atencao professores, teremos uma breve reuniao apos a aula no local de costume.',
  },
  {
    id: 'attendance',
    label: '📝 Chamada',
    message: 'Lembrete: nao esquecam de lancar a frequencia e os visitantes no app ate o final da aula.',
  },
  {
    id: 'prayer',
    label: '🙏 Oracao',
    message: 'Professores, iniciamos o periodo de intercessao pelas classes. Bom estudo a todos.',
  },
  {
    id: 'closing',
    label: '⏳ Faltam 10 min',
    message: '⚠️ Faltam 10 minutos para o encerramento da aula. Organize sua conclusao.',
  },
  {
    id: 'visitors',
    label: '👥 Visitantes',
    message: 'Lembrete: registrem os visitantes da classe no app.',
  },
  {
    id: 'opening',
    label: '📚 Inicio da aula',
    message: 'Bom domingo! Que Deus abencoe o ensino de cada classe.',
  },
]

function sortTeachersByName(list = []) {
  return [...list].sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''))
}

export default function CommunicationPage() {
  const { user, canManageStructure } = useAuth()
  const [teachers, setTeachers] = useState([])
  const [settings, setSettings] = useState(null)
  const [message, setMessage] = useState(DEFAULT_MESSAGE)
  const [recipientMode, setRecipientMode] = useState('group')
  const [selectedTeacherIds, setSelectedTeacherIds] = useState([])
  const [generatedLinks, setGeneratedLinks] = useState([])
  const [groupFeedback, setGroupFeedback] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [isTriggeringAlert, setIsTriggeringAlert] = useState(false)

  useEffect(() => {
    if (!user?.uid || !canManageStructure) return

    async function loadData() {
      const [teacherList, systemSettings] = await Promise.all([
        listTeachers(user.uid).catch(() => []),
        getCommunicationSettings().catch(() => null),
      ])

      setTeachers(sortTeachersByName(teacherList.filter((teacher) => teacher.active !== false)))
      setSettings(systemSettings)
    }

    loadData()
  }, [canManageStructure, user?.uid])

  const messageLength = message.length
  const countdown = useLessonCountdown(settings?.lessonEndTime || '19:20')

  const teachersWithWhatsapp = useMemo(
    () => teachers.filter((teacher) => normalizeWhatsAppNumber(teacher.phone)),
    [teachers],
  )

  const selectedTeachers = useMemo(
    () => teachers.filter((teacher) => selectedTeacherIds.includes(teacher.id)),
    [selectedTeacherIds, teachers],
  )

  function applyTemplate(templateMessage) {
    setMessage(templateMessage)
    setGeneratedLinks([])
    setGroupFeedback('')
    setStatusMessage('')
  }

  function toggleTeacherSelection(teacherId) {
    setSelectedTeacherIds((current) => (
      current.includes(teacherId)
        ? current.filter((id) => id !== teacherId)
        : [...current, teacherId]
    ))
    setGeneratedLinks([])
    setStatusMessage('')
  }

  function handleGenerateTeacherLinks() {
    if (!message.trim()) {
      window.alert('Digite o aviso antes de gerar os links.')
      return
    }

    if (selectedTeacherIds.length === 0) {
      window.alert('Selecione pelo menos um professor.')
      return
    }

    const links = selectedTeachers
      .filter((teacher) => normalizeWhatsAppNumber(teacher.phone))
      .map((teacher) => ({
        id: teacher.id,
        name: teacher.fullName,
        phone: teacher.phone || '',
        url: buildWhatsAppTeacherUrl(teacher.phone, message.trim()),
      }))

    setGeneratedLinks(links)
    setStatusMessage(
      links.length > 0
        ? 'Links individuais prontos para envio.'
        : 'Nenhum dos professores selecionados possui WhatsApp cadastrado.',
    )
  }

  function handleOpenTeacherLink(url) {
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  function handlePostToGroup() {
    if (!message.trim()) {
      window.alert('Digite o aviso antes de abrir o grupo.')
      return
    }

    const destination = buildWhatsAppGroupDestination(settings?.ebdGroupLink || '', message.trim())
    if (!destination.url) {
      window.alert('O link do Grupo da EBD ainda nao foi configurado nas configuracoes do sistema.')
      return
    }

    setGroupFeedback(
      destination.supportsPrefill
        ? 'Mensagem pronta para o grupo.'
        : 'O grupo foi aberto. Se o link for apenas de convite, cole o texto manualmente ao entrar.',
    )

    window.open(destination.url, '_blank', 'noopener,noreferrer')
  }

  async function handleTriggerClosingAlert() {
    if (!user?.uid) return

    setIsTriggeringAlert(true)
    setStatusMessage('')

    try {
      await publishLessonClosingWarning(user.uid, 'manual')
      setStatusMessage('Aviso visual de 10 minutos publicado para quem estiver com o app aberto.')
    } catch (error) {
      console.error('[CommunicationPage] Falha ao publicar aviso:', error)
      window.alert('Nao foi possivel publicar o aviso visual agora.')
    } finally {
      setIsTriggeringAlert(false)
    }
  }

  if (!canManageStructure) {
    return (
      <div className="feature-page">
        <div className="feature-header">
          <div>
            <h2 className="feature-title">Central de Avisos</h2>
            <p className="feature-subtitle">Area reservada para a superintendencia preparar avisos rapidos.</p>
          </div>
        </div>

        <Card>
          <CardHeader title="Avisos da superintendencia" subtitle="Os alertas publicados aparecem na caderneta quando o app estiver aberto." />
          <p className="feature-subtitle">
            Seu perfil pode receber os avisos visuais de aula, mas nao pode publicar novos comunicados por aqui.
          </p>
        </Card>
      </div>
    )
  }

  return (
    <div className="feature-page">
      <div className="feature-header">
        <div>
          <h2 className="feature-title">Central de Avisos</h2>
          <p className="feature-subtitle">Lembretes rapidos da superintendencia com foco em celular, grupo e professores.</p>
        </div>
      </div>

      <Card className="notice-timer-card">
        <CardHeader
          title="Encerramento da aula"
          subtitle="Base pronta para alertas manuais e automacao futura."
        />
        <div className={`notice-timer-panel${countdown.isWarning ? ' warning' : ''}`}>
          <div>
            <span className="notice-timer-label">Horario final</span>
            <strong className="notice-timer-value">{settings?.lessonEndTime || '19:20'}</strong>
          </div>
          <div>
            <span className="notice-timer-label">Contagem regressiva</span>
            <strong className="notice-timer-value">{countdown.countdownLabel}</strong>
          </div>
          <div>
            <span className="notice-timer-label">Status</span>
            <strong className="notice-timer-value">
              {countdown.isExpired ? 'Aula encerrada' : countdown.isWarning ? 'Ultimos 10 minutos' : 'Aula em andamento'}
            </strong>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Mensagem principal" subtitle="Toque em um template para preencher e editar antes de enviar." />
        <div className="inline-form">
          <label htmlFor="notice-message">Aviso</label>
          <textarea
            id="notice-message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Ex: Professores, ao final da aula registrem a frequencia e os visitantes no app."
          />
          <div className="notice-meta-row">
            <span className="notice-counter">{messageLength} caracteres</span>
            {statusMessage && <span className="notice-inline-feedback">{statusMessage}</span>}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Templates rapidos" subtitle="Preenche o texto e deixa livre para voce ajustar." />
        <div className="notice-template-grid">
          {QUICK_TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              className="notice-template-button"
              onClick={() => applyTemplate(template.message)}
            >
              {template.label}
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="Destinatarios" subtitle="Escolha entre o grupo geral da EBD ou professores especificos." />
        <div className="notice-recipient-grid">
          <button
            type="button"
            className={`notice-recipient-option${recipientMode === 'group' ? ' active' : ''}`}
            onClick={() => setRecipientMode('group')}
          >
            <strong>Enviar para grupo da EBD</strong>
            <span>Abre o grupo configurado com a mensagem pronta quando o link permitir.</span>
          </button>
          <button
            type="button"
            className={`notice-recipient-option${recipientMode === 'teachers' ? ' active' : ''}`}
            onClick={() => setRecipientMode('teachers')}
          >
            <strong>Enviar para professores selecionados</strong>
            <span>Gera links individuais de WhatsApp com texto preenchido.</span>
          </button>
        </div>
      </Card>

      {recipientMode === 'group' && (
        <Card className="notice-highlight-card">
          <CardHeader title="Grupo da EBD" subtitle="Use o link salvo nas configuracoes do sistema para o envio rapido." />
          <div className="notice-group-box">
            <div className="notice-group-meta">
              <strong>{settings?.groupName || 'Grupo da EBD'}</strong>
              <span>{settings?.ebdGroupLink ? 'Link configurado' : 'Link ainda nao configurado'}</span>
            </div>
            <Button className="notice-cta" onClick={handlePostToGroup} fullWidth>
              Postar no Grupo da EBD
            </Button>
            {groupFeedback && <p className="notice-helper-text">{groupFeedback}</p>}
          </div>
        </Card>
      )}

      {recipientMode === 'teachers' && (
        <Card>
          <CardHeader
            title="Professores cadastrados"
            subtitle={`${teachers.length} professor(es) encontrados${teachersWithWhatsapp.length !== teachers.length ? ` • ${teachersWithWhatsapp.length} com WhatsApp` : ''}`}
          />
          <div className="selection-list notice-selection-list">
            {teachers.length === 0 && (
              <div className="notice-empty-state">Nenhum professor ativo cadastrado.</div>
            )}
            {teachers.map((teacher) => {
              const hasWhatsapp = !!normalizeWhatsAppNumber(teacher.phone)
              const checked = selectedTeacherIds.includes(teacher.id)

              return (
                <label key={teacher.id} className={`selection-item notice-selection-item${checked ? ' selected' : ''}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleTeacherSelection(teacher.id)}
                  />
                  <span>
                    <strong>{teacher.fullName}</strong>
                    <small>{teacher.phone || 'WhatsApp nao informado'}</small>
                  </span>
                  <em className={`notice-phone-badge${hasWhatsapp ? ' ok' : ''}`}>
                    {hasWhatsapp ? 'WhatsApp' : 'Sem numero'}
                  </em>
                </label>
              )
            })}
          </div>

          <div className="notice-action-stack">
            <Button onClick={handleGenerateTeacherLinks} fullWidth>
              Enviar individual
            </Button>
            {generatedLinks.length > 0 && (
              <div className="notice-link-list">
                {generatedLinks.map((link) => (
                  <div className="notice-link-item" key={link.id}>
                    <div>
                      <strong>{link.name}</strong>
                      <span>{link.phone}</span>
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => handleOpenTeacherLink(link.url)}>
                      Abrir WhatsApp
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Aviso visual de 10 minutos" subtitle="Estrutura pronta para disparo manual agora e push no futuro." />
        <div className="notice-alert-card">
          <p className="notice-alert-preview">
            ⚠️ Faltam 10 minutos para o encerramento! Organize sua conclusao.
          </p>
          <Button onClick={handleTriggerClosingAlert} loading={isTriggeringAlert} fullWidth>
            Acionar alerta no app
          </Button>
          <p className="notice-helper-text">
            Professores com a caderneta aberta recebem o banner visual. O servico ja ficou separado para evolucao com FCM depois.
          </p>
        </div>
      </Card>
    </div>
  )
}
