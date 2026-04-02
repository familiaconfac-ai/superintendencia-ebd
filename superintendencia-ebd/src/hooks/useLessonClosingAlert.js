import { useEffect, useState } from 'react'
import { LESSON_CLOSING_WARNING, subscribeToLatestNoticeBroadcast } from '../services/noticeCenterService'

const ALERT_TTL_MS = 20 * 60 * 1000
const ALERT_AUTO_HIDE_MS = 12 * 1000

function isFreshLessonAlert(alert) {
  if (!alert) return false
  if (alert.kind !== LESSON_CLOSING_WARNING.kind) return false
  if (!alert.createdAtMs) return false
  return Date.now() - alert.createdAtMs <= ALERT_TTL_MS
}

export default function useLessonClosingAlert(enabled = true) {
  const [latestAlert, setLatestAlert] = useState(null)
  const [visibleAlert, setVisibleAlert] = useState(null)

  useEffect(() => {
    if (!enabled) {
      setLatestAlert(null)
      setVisibleAlert(null)
      return undefined
    }

    return subscribeToLatestNoticeBroadcast((nextAlert) => {
      setLatestAlert(nextAlert)
      if (!isFreshLessonAlert(nextAlert)) return

      setVisibleAlert((current) => (
        current?.id === nextAlert.id
          ? current
          : nextAlert
      ))
    })
  }, [enabled])

  useEffect(() => {
    if (!visibleAlert?.id) return undefined

    const timer = window.setTimeout(() => {
      setVisibleAlert((current) => (current?.id === visibleAlert.id ? null : current))
    }, ALERT_AUTO_HIDE_MS)

    return () => window.clearTimeout(timer)
  }, [visibleAlert?.id])

  return {
    latestAlert,
    visibleAlert,
    dismissAlert: () => setVisibleAlert(null),
  }
}
