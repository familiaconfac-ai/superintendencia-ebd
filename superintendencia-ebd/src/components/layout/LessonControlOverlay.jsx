import Button from '../ui/Button'
import { useLessonControl } from '../../context/LessonControlContext'

export default function LessonControlOverlay() {
  const {
    session,
    isFinalizing,
    finalizeLessonNow,
    shouldShowFinalizePrompt,
  } = useLessonControl()

  if (!shouldShowFinalizePrompt) return null

  return (
    <div className="lesson-finish-overlay" role="dialog" aria-live="assertive" aria-modal="false">
      <div className="lesson-finish-card">
        <span className="lesson-finish-kicker">19:20 alcancado</span>
        <h3>Finalizar Aula Agora?</h3>
        <p>
          {session?.finishStatus === 'extrapolated'
            ? 'A aula ja foi registrada como extrapolada. Confirme agora para gravar o horario real de encerramento.'
            : 'Confirme o encerramento agora para registrar o horario da aula.'}
        </p>
        <Button size="lg" onClick={finalizeLessonNow} loading={isFinalizing} fullWidth>
          Sim, finalizar agora
        </Button>
      </div>
    </div>
  )
}
