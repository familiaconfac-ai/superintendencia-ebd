export const LESSON_CONTROL_CONFIG = {
  churchLocation: {
    lat: -20.7425236,
    lng: -48.8978785,
  },
  checkInRadiusMeters: 100,
  checkInStartTime: '18:00',
  lessonStartTime: '18:30',
  lessonWarningTime: '19:10',
  lessonEndTime: '19:20',
}

function parseTimeToMinutes(value = '19:20') {
  const [hourText = '19', minuteText = '20'] = String(value || '19:20').split(':')
  const hours = Number(hourText)
  const minutes = Number(minuteText)

  return (
    (Number.isFinite(hours) ? hours : 19) * 60
    + (Number.isFinite(minutes) ? minutes : 20)
  )
}

export function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function formatTimeLabel(date = new Date()) {
  return date.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatLessonStartTimeLabel() {
  const [hours = '18', minutes = '30'] = String(LESSON_CONTROL_CONFIG.lessonStartTime || '18:30').split(':')
  return `${hours}h${minutes}`
}

function formatDateLabel(date = new Date()) {
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export function getNextSundayDate(baseDate = new Date()) {
  const date = new Date(baseDate)
  date.setHours(0, 0, 0, 0)
  const currentDay = date.getDay()
  const daysUntilSunday = currentDay === 0 ? 7 : 7 - currentDay
  date.setDate(date.getDate() + daysUntilSunday)
  return date
}

export function formatCountdown(ms = 0) {
  const safeMs = Math.max(0, Number(ms) || 0)
  const totalSeconds = Math.floor(safeMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, '0'))
    .join(':')
}

export function getLessonTimelineSnapshot(date = new Date(), endTime = LESSON_CONTROL_CONFIG.lessonEndTime) {
  const minutesNow = date.getHours() * 60 + date.getMinutes()
  const secondsNow = date.getSeconds()
  const millisNow = date.getMilliseconds()
  const currentMsOfDay = (((minutesNow * 60) + secondsNow) * 1000) + millisNow
  const checkInStartMinutes = parseTimeToMinutes(LESSON_CONTROL_CONFIG.checkInStartTime)
  const lessonStartMinutes = parseTimeToMinutes(LESSON_CONTROL_CONFIG.lessonStartTime)
  const warningMinutes = parseTimeToMinutes(LESSON_CONTROL_CONFIG.lessonWarningTime)
  const endMinutes = parseTimeToMinutes(endTime)
  const checkInStartMs = checkInStartMinutes * 60 * 1000
  const lessonStartMs = lessonStartMinutes * 60 * 1000
  const warningMs = warningMinutes * 60 * 1000
  const endMs = endMinutes * 60 * 1000
  const isSunday = date.getDay() === 0
  const hasLessonStarted = isSunday && currentMsOfDay >= lessonStartMs
  const isLessonWindow = isSunday && currentMsOfDay >= lessonStartMs && currentMsOfDay <= endMs
  const remainingMs = isLessonWindow ? Math.max(0, endMs - currentMsOfDay) : 0
  const untilWarningMs = isLessonWindow ? Math.max(0, warningMs - currentMsOfDay) : 0
  const isWithinCheckInWindow = isSunday && currentMsOfDay >= checkInStartMs && currentMsOfDay <= endMs
  const isWarning = isSunday && currentMsOfDay >= warningMs && currentMsOfDay < endMs
  const isExpired = isSunday && currentMsOfDay >= endMs
  const isBeforeLessonStart = isSunday && currentMsOfDay < lessonStartMs
  const nextSundayDate = isBeforeLessonStart ? new Date(date) : getNextSundayDate(date)
  const nextSundayDateLabel = formatDateLabel(nextSundayDate)
  const lessonStartTimeLabel = formatLessonStartTimeLabel()

  let statusLabel = `Próxima aula: Domingo, ${nextSundayDateLabel}, às ${lessonStartTimeLabel}`
  if (isBeforeLessonStart) statusLabel = `Próxima aula: Domingo, ${nextSundayDateLabel}, às ${lessonStartTimeLabel}`
  if (isLessonWindow && !isWarning) statusLabel = 'Aula em andamento'
  if (isWarning) statusLabel = 'Faltam 10 min para o Gongo!'
  if (isExpired) statusLabel = 'Aula encerrada'

  return {
    nowIso: date.toISOString(),
    dateKey: getLocalDateKey(date),
    isSunday,
    hasLessonStarted,
    isLessonWindow,
    isBeforeLessonStart,
    isWithinCheckInWindow,
    isWarning,
    isExpired,
    shouldShowFinalizePrompt: isExpired,
    currentMsOfDay,
    remainingMs,
    untilWarningMs,
    countdownLabel: formatCountdown(remainingMs),
    warningCountdownLabel: formatCountdown(untilWarningMs),
    statusLabel,
    nextSundayDateLabel,
    checkInStartTime: LESSON_CONTROL_CONFIG.checkInStartTime,
    lessonStartTime: LESSON_CONTROL_CONFIG.lessonStartTime,
    lessonStartTimeLabel,
    warningTime: LESSON_CONTROL_CONFIG.lessonWarningTime,
    endTime,
  }
}

export function calculateDistanceMeters(from, to) {
  if (!from || !to) return Number.POSITIVE_INFINITY

  const earthRadius = 6371000
  const toRadians = (value) => (value * Math.PI) / 180
  const deltaLat = toRadians((to.lat || 0) - (from.lat || 0))
  const deltaLng = toRadians((to.lng || 0) - (from.lng || 0))
  const fromLat = toRadians(from.lat || 0)
  const toLat = toRadians(to.lat || 0)

  const a = (
    Math.sin(deltaLat / 2) ** 2
    + Math.cos(fromLat) * Math.cos(toLat) * Math.sin(deltaLng / 2) ** 2
  )

  return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function formatDistance(distanceMeters) {
  if (!Number.isFinite(distanceMeters)) return '--'
  if (distanceMeters < 1000) return `${Math.round(distanceMeters)} m`
  return `${(distanceMeters / 1000).toFixed(1)} km`
}
