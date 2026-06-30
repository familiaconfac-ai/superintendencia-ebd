import Button from '../ui/Button'
import { useLessonControl } from '../../context/LessonControlContext'

export default function LessonControlOverlay() {
  const {
    activeAlarm,
    timeline,
    session,
    isFinalizing,
    finalizeLessonNow,
    stopActiveAlarm,
    shouldShowFinalizePrompt,
  } = useLessonControl()

  const isEndingAlarm = activeAlarm?.kind === 'ending'
  const isWarningAlarm = activeAlarm?.kind === 'warning'
  const shouldRender = Boolean(activeAlarm) || shouldShowFinalizePrompt

  if (!shouldRender) return null

  return (
    <div className="lesson-finish-overlay" role="dialog" aria-live="assertive" aria-modal="false">
      <div className={`lesson-finish-card${activeAlarm ? ' ringing' : ''}`}>
        <span className="lesson-finish-kicker">
          {isWarningAlarm ? `${timeline.lessonWarningTime} em alerta` : `${timeline.lessonEndTime} alcançado`}
        </span>
        <h3>{isWarningAlarm ? 'Alarme da aula tocando' : 'Finalizar Aula Agora?'}</h3>
        <p>
          {isWarningAlarm
            ? 'O aviso de encerramento toca por alguns segundos e para sozinho. Use este aviso para concluir a aula.'
            : session?.finishStatus === 'extrapolated'
              ? 'A aula já foi registrada como extrapolada. Confirme agora para gravar o horário real de encerramento.'
              : 'Confirme o encerramento agora para registrar o horário da aula.'}
        </p>
        <div className="lesson-finish-actions">
          {activeAlarm && (
            <Button variant="secondary" size="lg" onClick={() => stopActiveAlarm()} fullWidth>
              Desligar alarme
            </Button>
          )}
          {(isEndingAlarm || shouldShowFinalizePrompt) && (
            <Button size="lg" onClick={finalizeLessonNow} loading={isFinalizing} fullWidth>
              Sim, finalizar agora
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
