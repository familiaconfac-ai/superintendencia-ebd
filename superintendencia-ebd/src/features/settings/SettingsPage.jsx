import { useEffect, useMemo, useState } from 'react'
import Button from '../../components/ui/Button'
import Card, { CardHeader } from '../../components/ui/Card'
import {
  DEFAULT_COMMUNICATION_SETTINGS,
  getCommunicationSettings,
  saveCommunicationSettings,
} from '../../services/communicationSettingsService'
import { getPushSupportSummary } from '../../services/noticeCenterService'
import {
  buildLessonControlConfig,
  formatLessonStartTimeLabel,
  WEEKDAY_OPTIONS,
} from '../../utils/lessonControl'

function buildInitialForm(settings = DEFAULT_COMMUNICATION_SETTINGS) {
  return {
    groupName: settings.groupName || 'Grupo da EBD',
    ebdGroupLink: settings.ebdGroupLink || '',
    lessonWeekday: String(settings.lessonWeekday ?? DEFAULT_COMMUNICATION_SETTINGS.lessonWeekday),
    lessonStartTime: settings.lessonStartTime || DEFAULT_COMMUNICATION_SETTINGS.lessonStartTime,
    lessonDurationMinutes: Number(settings.lessonDurationMinutes ?? DEFAULT_COMMUNICATION_SETTINGS.lessonDurationMinutes),
    warningLeadMinutes: Number(settings.warningLeadMinutes ?? DEFAULT_COMMUNICATION_SETTINGS.warningLeadMinutes),
    checkInLeadMinutes: Number(settings.checkInLeadMinutes ?? DEFAULT_COMMUNICATION_SETTINGS.checkInLeadMinutes),
  }
}

export default function SettingsPage() {
  const [form, setForm] = useState(() => buildInitialForm())
  const [isSaving, setIsSaving] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [pushSummary, setPushSummary] = useState(() => getPushSupportSummary())

  useEffect(() => {
    async function load() {
      const settings = await getCommunicationSettings().catch(() => null)
      setForm(buildInitialForm(settings || DEFAULT_COMMUNICATION_SETTINGS))
      setPushSummary(getPushSupportSummary())
    }

    load()
  }, [])

  const lessonPreview = useMemo(() => buildLessonControlConfig({
    lessonWeekday: Number(form.lessonWeekday),
    lessonStartTime: form.lessonStartTime,
    lessonDurationMinutes: form.lessonDurationMinutes,
    warningLeadMinutes: form.warningLeadMinutes,
    checkInLeadMinutes: form.checkInLeadMinutes,
  }), [form])

  async function handleSave() {
    setIsSaving(true)
    setFeedback('')

    try {
      const nextSettings = await saveCommunicationSettings({
        groupName: form.groupName.trim() || 'Grupo da EBD',
        ebdGroupLink: form.ebdGroupLink.trim(),
        lessonWeekday: Number(form.lessonWeekday),
        lessonStartTime: form.lessonStartTime,
        lessonDurationMinutes: form.lessonDurationMinutes,
        warningLeadMinutes: form.warningLeadMinutes,
        checkInLeadMinutes: form.checkInLeadMinutes,
      })

      setForm(buildInitialForm(nextSettings))
      setFeedback('Configurações salvas com sucesso.')
      setPushSummary(getPushSupportSummary())
    } catch (error) {
      console.error('[SettingsPage] Falha ao salvar configurações:', error)
      setFeedback('Não foi possível salvar as configurações agora.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="feature-page">
      <div className="feature-header">
        <div>
          <h2 className="feature-title">Configurações</h2>
          <p className="feature-subtitle">Ajustes institucionais do grupo da EBD e estado técnico dos alertas.</p>
        </div>
      </div>

      <Card>
        <CardHeader
          title="Grupo oficial da EBD"
          subtitle="Esses dados alimentam o painel de aula para a superintendência abrir o grupo rapidamente."
        />
        <div className="inline-form">
          <label htmlFor="settings-group-name">Nome do grupo</label>
          <input
            id="settings-group-name"
            value={form.groupName}
            onChange={(event) => setForm((current) => ({ ...current, groupName: event.target.value }))}
            placeholder="Grupo da EBD"
          />

          <label htmlFor="settings-group-link">Link do grupo</label>
          <input
            id="settings-group-link"
            value={form.ebdGroupLink}
            onChange={(event) => setForm((current) => ({ ...current, ebdGroupLink: event.target.value }))}
            placeholder="https://chat.whatsapp.com/..."
          />

          <span className="notice-helper-text">
            {form.ebdGroupLink
              ? 'Link oficial carregado. O botão "Abrir Grupo da EBD" usará este endereço.'
              : 'Cole aqui o link oficial do grupo do WhatsApp da EBD.'}
          </span>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Programação oficial da aula"
          subtitle="Defina o dia e a hora da aula. O gongo e o encerramento seguem essa agenda automaticamente."
        />
        <div className="inline-form">
          <label htmlFor="settings-lesson-weekday">Dia da aula</label>
          <select
            id="settings-lesson-weekday"
            value={form.lessonWeekday}
            onChange={(event) => setForm((current) => ({ ...current, lessonWeekday: event.target.value }))}
          >
            {WEEKDAY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <label htmlFor="settings-lesson-start-time">Início da aula</label>
          <input
            id="settings-lesson-start-time"
            type="time"
            value={form.lessonStartTime}
            onChange={(event) => setForm((current) => ({ ...current, lessonStartTime: event.target.value }))}
          />

          <span className="notice-helper-text">
            A duração permanece fixa em 50 minutos. O primeiro alarme toca com 40 minutos de aula e o segundo ao encerrar.
          </span>
        </div>

        <div className="lesson-panel-grid">
          <div className="lesson-panel-stat">
            <span>Check-in liberado</span>
            <strong>{lessonPreview.checkInStartTime}</strong>
          </div>
          <div className="lesson-panel-stat">
            <span>Início da aula</span>
            <strong>{formatLessonStartTimeLabel(lessonPreview)}</strong>
          </div>
          <div className="lesson-panel-stat">
            <span>Alerta de 10 minutos</span>
            <strong>{lessonPreview.lessonWarningTime}</strong>
          </div>
          <div className="lesson-panel-stat">
            <span>Encerramento</span>
            <strong>{lessonPreview.lessonEndTime}</strong>
          </div>
        </div>

        <div className="lesson-panel-callout neutral">
          Aula programada para {lessonPreview.lessonWeekdayLabel}, com check-in a partir de {lessonPreview.checkInStartTime}, alerta final às {lessonPreview.lessonWarningTime} e término às {lessonPreview.lessonEndTime}.
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Estado técnico dos alertas"
          subtitle="Preparo atual do navegador para notificações e push em background."
        />
        <div className="lesson-panel-grid">
          <div className="lesson-panel-stat">
            <span>Permissão</span>
            <strong>{pushSummary.permission}</strong>
          </div>
          <div className="lesson-panel-stat">
            <span>Service Worker</span>
            <strong>{pushSummary.serviceWorkerSupported ? 'Disponível' : 'Indisponível'}</strong>
          </div>
          <div className="lesson-panel-stat">
            <span>PushManager</span>
            <strong>{pushSummary.pushManagerSupported ? 'Disponível' : 'Indisponível'}</strong>
          </div>
          <div className="lesson-panel-stat">
            <span>Chave Web Push</span>
            <strong>{pushSummary.vapidConfigured ? 'Configurada' : 'Pendente'}</strong>
          </div>
        </div>

        {!pushSummary.vapidConfigured && (
          <div className="lesson-panel-callout">
            Falta configurar a chave pública Web Push para concluir o alerta em background com o app fechado.
          </div>
        )}
      </Card>

      <Button onClick={handleSave} loading={isSaving} fullWidth>
        Salvar configurações
      </Button>

      {feedback && <span className="notice-helper-text">{feedback}</span>}
    </div>
  )
}
