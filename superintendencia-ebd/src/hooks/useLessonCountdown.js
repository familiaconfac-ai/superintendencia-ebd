import { useEffect, useState } from 'react'
import { getLessonTimelineSnapshot } from '../utils/lessonControl'

export default function useLessonCountdown(configOverrides = {}) {
  const [snapshot, setSnapshot] = useState(() => getLessonTimelineSnapshot(new Date(), configOverrides))

  useEffect(() => {
    const updateClock = () => setSnapshot(getLessonTimelineSnapshot(new Date(), configOverrides))
    updateClock()

    const timer = window.setInterval(() => {
      updateClock()
    }, 1000)

    return () => window.clearInterval(timer)
  }, [configOverrides])

  return {
    ...snapshot,
    minutesRemaining: Math.ceil(snapshot.remainingMs / 60000),
  }
}
