import { useEffect, useMemo, useState } from 'react'
import Button from '../../components/ui/Button'
import Card, { CardHeader } from '../../components/ui/Card'
import {
  DEFAULT_COMMUNICATION_SETTINGS,
  getCommunicationSettings,
  saveCommunicationSettings,
} from '../../services/communicationSettingsService'
import { buildLessonControlConfig, LESSON_RECURRENCE_OPTIONS } from '../../utils/lessonControl'

function buildInitialForm(settings = DEFAULT_COMMUNICATION_SETTINGS) {
  const preview = buildLessonControlConfig(settings)

  return {
    groupName: settings.groupName || 'Grupo da EBD',
    ebdGroupLink: settings.ebdGroupLink || '',
    lessonDate: settings.lessonDate || preview.lessonDate,
    lessonRecurrence: settings.lessonRecurrence || preview.lessonRecurrence,
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

  useEffect(() => {
    async function load() {
      const settings = await getCommunicationSettings().catch(() => null)
      setForm(buildInitialForm(settings || DEFAULT_COMMUNICATION_SETTINGS))
    }

    load()
  }, [])

  const lessonPreview = useMemo(() => buildLessonControlConfig({
    lessonDate: form.lessonDate,
    lessonRecurrence: form.lessonRecurrence,
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
        lessonRecurrence: form.lessonRecurrence,
        lessonStartTime: form.lessonStartTime,
        lessonDurationMinutes: form.lessonDurationMinutes,
        warningLeadMinutes: form.warningLeadMinutes,
        checkInLeadMinutes: form.checkInLeadMinutes,
      })

      setForm(buildInitialForm(nextSettings))
      setFeedback('Configurações salvas com sucesso.')
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
          subtitle="Defina a data-base, a repetição, o horário e os alertas da aula."
        />

        <div className="inline-form">
          <label htmlFor="settings-lesson-date">Data-base da aula</label>
          <input
            id="settings-lesson-date"
            type="date"
            value={form.lessonDate}
            onChange={(event) => setForm((current) => ({ ...current, lessonDate: event.target.value }))}
          />

          <label htmlFor="settings-lesson-recurrence">Repetição</label>
          <select
            id="settings-lesson-recurrence"
            value={form.lessonRecurrence}
            onChange={(event) => setForm((current) => ({ ...current, lessonRecurrence: event.target.value }))}
          >
            {LESSON_RECURRENCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>

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
            Use a opção Uma vez para um domingo específico ou reunião pontual. Use as demais opções para repetir a partir da data-base.
          </span>
        </div>

        <div className="lesson-panel-grid">
          <div className="lesson-panel-stat">
            <span>Próxima aula</span>
            <strong>{lessonPreview.lessonWeekdayLabel}, {lessonPreview.lessonDateLabel}</strong>
          </div>
          <div className="lesson-panel-stat">
            <span>Repetição</span>
            <strong>{lessonPreview.lessonRecurrenceLabel}</strong>
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
          Próxima aula: {lessonPreview.lessonWeekdayLabel}, {lessonPreview.lessonDateLabel}, às {lessonPreview.lessonStartTimeLabel}. Repetição configurada: {lessonPreview.lessonRecurrenceLabel}.
        </div>
      </Card>

      <Button onClick={handleSave} loading={isSaving} fullWidth>
        Salvar configurações da aula
      </Button>

      {feedback && <span className="notice-helper-text">{feedback}</span>}
    </div>
  )
}
