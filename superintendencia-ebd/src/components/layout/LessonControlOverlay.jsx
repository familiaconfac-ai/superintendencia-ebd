import Button from '../ui/Button'
import { useLessonControl } from '../../context/LessonControlContext'

export default function LessonControlOverlay() {
  const {
    timeline,
    session,
    isFinalizing,
    finalizeLessonNow,
    shouldShowFinalizePrompt,
  } = useLessonControl()

  if (!shouldShowFinalizePrompt) return null

  return (
    <div className="lesson-finish-overlay" role="dialog" aria-live="assertive" aria-modal="false">
      <div className="lesson-finish-card">
        <span className="lesson-finish-kicker">{timeline.lessonEndTime} alcançado</span>
        <h3>Finalizar Aula Agora?</h3>
        <p>
          {session?.finishStatus === 'extrapolated'
            ? 'A aula já foi registrada como extrapolada. Confirme agora para gravar o horário real de encerramento.'
            : 'Confirme o encerramento agora para registrar o horário da aula.'}
        </p>
        <Button size="lg" onClick={finalizeLessonNow} loading={isFinalizing} fullWidth>
          Sim, finalizar agora
        </Button>
      </div>
    </div>
  )
}
