import { useEffect, useState } from 'react'
import { getLessonTimelineSnapshot } from '../utils/lessonControl'

export default function useLessonCountdown(endTime) {
  const [snapshot, setSnapshot] = useState(() => getLessonTimelineSnapshot(new Date(), endTime))

  useEffect(() => {
    const updateClock = () => setSnapshot(getLessonTimelineSnapshot(new Date(), endTime))
    updateClock()

    const timer = window.setInterval(() => {
      updateClock()
    }, 1000)

    return () => window.clearInterval(timer)
  }, [endTime])

  return {
    ...snapshot,
    minutesRemaining: Math.ceil(snapshot.remainingMs / 60000),
  }
}
