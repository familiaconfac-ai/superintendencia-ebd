export const WEEKDAY_OPTIONS = [
  { value: 0, label: 'Domingo' },
  { value: 1, label: 'Segunda-feira' },
  { value: 2, label: 'Terça-feira' },
  { value: 3, label: 'Quarta-feira' },
  { value: 4, label: 'Quinta-feira' },
  { value: 5, label: 'Sexta-feira' },
  { value: 6, label: 'Sábado' },
]

export const DEFAULT_LESSON_CONTROL_CONFIG = {
  churchLocation: {
    lat: -20.7425236,
    lng: -48.8978785,
  },
  checkInRadiusMeters: 100,
  lessonWeekday: 0,
  lessonStartTime: '18:30',
  lessonDurationMinutes: 50,
  warningLeadMinutes: 10,
  checkInLeadMinutes: 30,
}

function clampMinutes(value, fallback) {
  const minutes = Number(value)
  if (!Number.isFinite(minutes)) return fallback
  return Math.max(0, Math.floor(minutes))
}

function normalizeTimeString(value = '18:30', fallback = '18:30') {
  const [hourText, minuteText] = String(value || fallback).split(':')
  const hours = Number(hourText)
  const minutes = Number(minuteText)

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return fallback
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return fallback

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export function parseTimeToMinutes(value = '18:30') {
  const [hourText = '18', minuteText = '30'] = normalizeTimeString(value).split(':')
  return (Number(hourText) * 60) + Number(minuteText)
}

function formatMinutesAsTime(totalMinutes = 0) {
  const safeMinutes = ((Number(totalMinutes) % 1440) + 1440) % 1440
  const hours = Math.floor(safeMinutes / 60)
  const minutes = safeMinutes % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export function getWeekdayLabel(weekday = 0) {
  return WEEKDAY_OPTIONS.find((item) => item.value === Number(weekday))?.label || 'Domingo'
}

export function buildLessonControlConfig(overrides = {}) {
  const lessonWeekday = Number.isInteger(Number(overrides.lessonWeekday))
    ? Math.min(6, Math.max(0, Number(overrides.lessonWeekday)))
    : DEFAULT_LESSON_CONTROL_CONFIG.lessonWeekday
  const lessonStartTime = normalizeTimeString(
    overrides.lessonStartTime || DEFAULT_LESSON_CONTROL_CONFIG.lessonStartTime,
    DEFAULT_LESSON_CONTROL_CONFIG.lessonStartTime,
  )
  const lessonDurationMinutes = clampMinutes(
    overrides.lessonDurationMinutes ?? DEFAULT_LESSON_CONTROL_CONFIG.lessonDurationMinutes,
    DEFAULT_LESSON_CONTROL_CONFIG.lessonDurationMinutes,
  ) || DEFAULT_LESSON_CONTROL_CONFIG.lessonDurationMinutes
  const warningLeadMinutes = Math.min(
    lessonDurationMinutes,
    clampMinutes(overrides.warningLeadMinutes ?? DEFAULT_LESSON_CONTROL_CONFIG.warningLeadMinutes, DEFAULT_LESSON_CONTROL_CONFIG.warningLeadMinutes),
  )
  const checkInLeadMinutes = clampMinutes(
    overrides.checkInLeadMinutes ?? DEFAULT_LESSON_CONTROL_CONFIG.checkInLeadMinutes,
    DEFAULT_LESSON_CONTROL_CONFIG.checkInLeadMinutes,
  )

  const lessonStartMinutes = parseTimeToMinutes(lessonStartTime)
  const lessonEndTime = formatMinutesAsTime(lessonStartMinutes + lessonDurationMinutes)
  const lessonWarningTime = formatMinutesAsTime((lessonStartMinutes + lessonDurationMinutes) - warningLeadMinutes)
  const checkInStartTime = formatMinutesAsTime(lessonStartMinutes - checkInLeadMinutes)

  return {
    ...DEFAULT_LESSON_CONTROL_CONFIG,
    ...overrides,
    lessonWeekday,
    lessonWeekdayLabel: getWeekdayLabel(lessonWeekday),
    lessonStartTime,
    lessonDurationMinutes,
    warningLeadMinutes,
    checkInLeadMinutes,
    lessonEndTime,
    lessonWarningTime,
    checkInStartTime,
  }
}

export const LESSON_CONTROL_CONFIG = buildLessonControlConfig()

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

export function formatLessonStartTimeLabel(config = LESSON_CONTROL_CONFIG) {
  const [hours = '18', minutes = '30'] = String(config.lessonStartTime || '18:30').split(':')
  return `${hours}h${minutes}`
}

function formatDateLabel(date = new Date()) {
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function getNextLessonDate(baseDate = new Date(), config = LESSON_CONTROL_CONFIG) {
  const date = new Date(baseDate)
  date.setHours(0, 0, 0, 0)

  const currentDay = date.getDay()
  let daysUntilLesson = (config.lessonWeekday - currentDay + 7) % 7
  if (daysUntilLesson === 0) daysUntilLesson = 7

  date.setDate(date.getDate() + daysUntilLesson)
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

export function getLessonTimelineSnapshot(date = new Date(), configOverrides = {}) {
  const config = buildLessonControlConfig(configOverrides)
  const minutesNow = date.getHours() * 60 + date.getMinutes()
  const secondsNow = date.getSeconds()
  const millisNow = date.getMilliseconds()
  const currentMsOfDay = (((minutesNow * 60) + secondsNow) * 1000) + millisNow
  const checkInStartMinutes = parseTimeToMinutes(config.checkInStartTime)
  const lessonStartMinutes = parseTimeToMinutes(config.lessonStartTime)
  const warningMinutes = parseTimeToMinutes(config.lessonWarningTime)
  const endMinutes = parseTimeToMinutes(config.lessonEndTime)
  const checkInStartMs = checkInStartMinutes * 60 * 1000
  const lessonStartMs = lessonStartMinutes * 60 * 1000
  const warningMs = warningMinutes * 60 * 1000
  const endMs = endMinutes * 60 * 1000
  const isLessonDay = date.getDay() === config.lessonWeekday
  const hasLessonStarted = isLessonDay && currentMsOfDay >= lessonStartMs
  const isLessonWindow = isLessonDay && currentMsOfDay >= lessonStartMs && currentMsOfDay <= endMs
  const remainingMs = isLessonWindow ? Math.max(0, endMs - currentMsOfDay) : 0
  const untilWarningMs = isLessonWindow ? Math.max(0, warningMs - currentMsOfDay) : 0
  const isWithinCheckInWindow = isLessonDay && currentMsOfDay >= checkInStartMs && currentMsOfDay <= endMs
  const isWarning = isLessonDay && currentMsOfDay >= warningMs && currentMsOfDay < endMs
  const isExpired = isLessonDay && currentMsOfDay >= endMs
  const isBeforeLessonStart = isLessonDay && currentMsOfDay < lessonStartMs
  const nextLessonDate = isBeforeLessonStart ? new Date(date) : getNextLessonDate(date, config)
  const nextLessonDateLabel = formatDateLabel(nextLessonDate)
  const lessonStartTimeLabel = formatLessonStartTimeLabel(config)

  let statusLabel = `Próxima aula: ${config.lessonWeekdayLabel}, ${nextLessonDateLabel}, às ${lessonStartTimeLabel}`
  if (isLessonWindow && !isWarning) statusLabel = 'Aula em andamento'
  if (isWarning) statusLabel = 'Faltam 10 min para o gongo!'
  if (isExpired) statusLabel = 'Tempo encerrado'

  return {
    ...config,
    nowIso: date.toISOString(),
    dateKey: getLocalDateKey(date),
    isLessonDay,
    isSunday: isLessonDay,
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
    nextLessonDateLabel,
    lessonStartTimeLabel,
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
