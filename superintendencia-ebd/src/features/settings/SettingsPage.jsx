import { useEffect, useMemo, useState } from 'react'
import Button from '../../components/ui/Button'
import Card, { CardHeader } from '../../components/ui/Card'
import {
  DEFAULT_COMMUNICATION_SETTINGS,
  getCommunicationSettings,
  saveCommunicationSettings,
} from '../../services/communicationSettingsService'
import { getPushSupportSummary } from '../../services/noticeCenterService'
import { buildLessonControlConfig } from '../../utils/lessonControl'

function buildInitialForm(settings = DEFAULT_COMMUNICATION_SETTINGS) {
  const preview = buildLessonControlConfig(settings)

  return {
    groupName: settings.groupName || 'Grupo da EBD',
    ebdGroupLink: settings.ebdGroupLink || '',
    lessonDate: settings.lessonDate || preview.lessonDate,
    lessonStartTime: settings.lessonStartTime || preview.lessonStartTime,
    lessonDurationMinutes: Number(settings.lessonDurationMinutes ?? preview.lessonDurationMinutes),
    warningLeadMinutes: Number(settings.warningLeadMinutes ?? preview.warningLeadMinutes),
    checkInLeadMinutes: Number(settings.checkInLeadMinutes ?? preview.checkInLeadMinutes),
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
    lessonDate: form.lessonDate,
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
        lessonDate: form.lessonDate,
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
          <p className="feature-subtitle">Ajustes institucionais do grupo da EBD e configuração editável da próxima aula.</p>
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
          title="Próxima aula"
          subtitle="Defina manualmente a data, o horário e os alertas da próxima aula."
        />

        <div className="inline-form">
          <label htmlFor="settings-lesson-date">Data da aula</label>
          <input
            id="settings-lesson-date"
            type="date"
            value={form.lessonDate}
            onChange={(event) => setForm((current) => ({ ...current, lessonDate: event.target.value }))}
          />

          <label htmlFor="settings-lesson-start-time">Horário de início</label>
          <input
            id="settings-lesson-start-time"
            type="time"
            value={form.lessonStartTime}
            onChange={(event) => setForm((current) => ({ ...current, lessonStartTime: event.target.value }))}
          />

          <label htmlFor="settings-lesson-duration">Duração da aula (minutos)</label>
          <input
            id="settings-lesson-duration"
            type="number"
            min="1"
            step="1"
            value={form.lessonDurationMinutes}
            onChange={(event) => setForm((current) => ({
              ...current,
              lessonDurationMinutes: Number(event.target.value) || 50,
            }))}
          />

          <label htmlFor="settings-lesson-warning">Alerta antes do fim (minutos)</label>
          <input
            id="settings-lesson-warning"
            type="number"
            min="0"
            step="1"
            value={form.warningLeadMinutes}
            onChange={(event) => setForm((current) => ({
              ...current,
              warningLeadMinutes: Number(event.target.value) || 0,
            }))}
          />

          <span className="notice-helper-text">
            Teste rápido: configure a aula para hoje, início daqui a 1 minuto, duração 2 e alerta 1.
          </span>
        </div>

        <div className="lesson-panel-grid">
          <div className="lesson-panel-stat">
            <span>Próxima aula</span>
            <strong>{lessonPreview.lessonWeekdayLabel}, {lessonPreview.lessonDateLabel}</strong>
          </div>
          <div className="lesson-panel-stat">
            <span>Início</span>
            <strong>{lessonPreview.lessonStartTimeLabel}</strong>
          </div>
          <div className="lesson-panel-stat">
            <span>Primeiro alerta</span>
            <strong>{lessonPreview.lessonWarningTime}</strong>
          </div>
          <div className="lesson-panel-stat">
            <span>Segundo alerta</span>
            <strong>{lessonPreview.lessonEndTime}</strong>
          </div>
        </div>

        <div className="lesson-panel-callout neutral">
          Próxima aula: {lessonPreview.lessonWeekdayLabel}, {lessonPreview.lessonDateLabel}, às {lessonPreview.lessonStartTimeLabel}.
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Estado técnico dos alertas"
          subtitle="Mantemos apenas a notificação local com o app aberto. Web Push fica para depois."
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
            <span>Modo atual</span>
            <strong>Notificação local</strong>
          </div>
        </div>
      </Card>

      <Button onClick={handleSave} loading={isSaving} fullWidth>
        Salvar configurações da aula
      </Button>

      {feedback && <span className="notice-helper-text">{feedback}</span>}
    </div>
  )
}
