import { useEffect, useMemo, useState } from 'react'

function parseEndTime(endTime = '19:20') {
  const [hourText = '19', minuteText = '20'] = String(endTime || '19:20').split(':')
  const hours = Number(hourText)
  const minutes = Number(minuteText)

  return {
    hours: Number.isFinite(hours) ? hours : 19,
    minutes: Number.isFinite(minutes) ? minutes : 20,
  }
}

function getRemainingMs(endTime) {
  const now = new Date()
  const target = new Date(now)
  const { hours, minutes } = parseEndTime(endTime)
  target.setHours(hours, minutes, 0, 0)
  return Math.max(0, target.getTime() - now.getTime())
}

function formatRemaining(ms) {
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, '0'))
    .join(':')
}

export default function useLessonCountdown(endTime) {
  const [remainingMs, setRemainingMs] = useState(() => getRemainingMs(endTime))

  useEffect(() => {
    setRemainingMs(getRemainingMs(endTime))

    const timer = window.setInterval(() => {
      setRemainingMs(getRemainingMs(endTime))
    }, 1000)

    return () => window.clearInterval(timer)
  }, [endTime])

  return useMemo(() => {
    const minutesRemaining = Math.ceil(remainingMs / 60000)
    const isWarning = remainingMs > 0 && remainingMs <= 10 * 60 * 1000
    const isExpired = remainingMs === 0

    return {
      remainingMs,
      countdownLabel: formatRemaining(remainingMs),
      minutesRemaining,
      isWarning,
      isExpired,
    }
  }, [remainingMs])
}
