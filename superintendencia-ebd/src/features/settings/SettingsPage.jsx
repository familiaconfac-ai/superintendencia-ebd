import { useEffect, useState } from 'react'
import Button from '../../components/ui/Button'
import Card, { CardHeader } from '../../components/ui/Card'
import { getCommunicationSettings, saveCommunicationSettings } from '../../services/communicationSettingsService'
import { getPushSupportSummary } from '../../services/noticeCenterService'
import { LESSON_CONTROL_CONFIG } from '../../utils/lessonControl'

export default function SettingsPage() {
  const [form, setForm] = useState({
    groupName: 'Grupo da EBD',
    ebdGroupLink: '',
  })
  const [isSaving, setIsSaving] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [pushSummary, setPushSummary] = useState(() => getPushSupportSummary())

  useEffect(() => {
    async function load() {
      const settings = await getCommunicationSettings().catch(() => null)
      setForm({
        groupName: settings?.groupName || 'Grupo da EBD',
        ebdGroupLink: settings?.ebdGroupLink || '',
      })
      setPushSummary(getPushSupportSummary())
    }

    load()
  }, [])

  async function handleSave() {
    setIsSaving(true)
    setFeedback('')

    try {
      const nextSettings = await saveCommunicationSettings({
        groupName: form.groupName.trim() || 'Grupo da EBD',
        ebdGroupLink: form.ebdGroupLink.trim(),
      })

      setForm({
        groupName: nextSettings.groupName || 'Grupo da EBD',
        ebdGroupLink: nextSettings.ebdGroupLink || '',
      })
      setFeedback('Configuracoes salvas com sucesso.')
      setPushSummary(getPushSupportSummary())
    } catch (error) {
      console.error('[SettingsPage] Falha ao salvar configuracoes:', error)
      setFeedback('Nao foi possivel salvar as configuracoes agora.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="feature-page">
      <div className="feature-header">
        <div>
          <h2 className="feature-title">Configuracoes</h2>
          <p className="feature-subtitle">Ajustes institucionais do grupo da EBD e estado tecnico dos alertas.</p>
        </div>
      </div>

      <Card>
        <CardHeader
          title="Grupo oficial da EBD"
          subtitle="Esses dados alimentam o painel de aula para a superintendencia abrir o grupo rapidamente."
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

          <Button onClick={handleSave} loading={isSaving} fullWidth>
            Salvar configuracoes
          </Button>

          {feedback && <span className="notice-helper-text">{feedback}</span>}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Janela oficial da aula"
          subtitle="Referencia adotada no cronometro, no gongo e no relatorio de extrapolacao."
        />
        <div className="lesson-panel-grid">
          <div className="lesson-panel-stat">
            <span>Check-in liberado</span>
            <strong>{LESSON_CONTROL_CONFIG.checkInStartTime}</strong>
          </div>
          <div className="lesson-panel-stat">
            <span>Inicio da aula</span>
            <strong>{LESSON_CONTROL_CONFIG.lessonStartTime}</strong>
          </div>
          <div className="lesson-panel-stat">
            <span>Gongo</span>
            <strong>{LESSON_CONTROL_CONFIG.lessonWarningTime}</strong>
          </div>
          <div className="lesson-panel-stat">
            <span>Encerramento</span>
            <strong>{LESSON_CONTROL_CONFIG.lessonEndTime}</strong>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Estado tecnico dos alertas"
          subtitle="Preparo atual do navegador para notificacoes e push em background."
        />
        <div className="lesson-panel-grid">
          <div className="lesson-panel-stat">
            <span>Permissao</span>
            <strong>{pushSummary.permission}</strong>
          </div>
          <div className="lesson-panel-stat">
            <span>Service Worker</span>
            <strong>{pushSummary.serviceWorkerSupported ? 'Disponivel' : 'Indisponivel'}</strong>
          </div>
          <div className="lesson-panel-stat">
            <span>PushManager</span>
            <strong>{pushSummary.pushManagerSupported ? 'Disponivel' : 'Indisponivel'}</strong>
          </div>
          <div className="lesson-panel-stat">
            <span>Chave Web Push</span>
            <strong>{pushSummary.vapidConfigured ? 'Configurada' : 'Pendente'}</strong>
          </div>
        </div>
      </Card>
    </div>
  )
}
