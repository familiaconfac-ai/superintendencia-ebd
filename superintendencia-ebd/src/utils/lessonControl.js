function getNextSundayDateKey(baseDate = new Date()) {
  const date = new Date(baseDate)
  date.setHours(0, 0, 0, 0)

  const currentDay = date.getDay()
  let daysUntilSunday = (7 - currentDay) % 7
  if (daysUntilSunday === 0) daysUntilSunday = 7

  date.setDate(date.getDate() + daysUntilSunday)
  return getLocalDateKey(date)
}

export const DEFAULT_LESSON_CONTROL_CONFIG = {
  churchLocation: {
    lat: -20.7425236,
    lng: -48.8978785,
  },
  checkInRadiusMeters: 100,
  lessonDate: import.meta.env.VITE_EBD_LESSON_DATE || getNextSundayDateKey(),
  lessonStartTime: import.meta.env.VITE_EBD_LESSON_START_TIME || '18:30',
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

function normalizeDateKey(value, fallback = DEFAULT_LESSON_CONTROL_CONFIG.lessonDate) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return fallback

  const [, yearText, monthText, dayText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const candidate = new Date(year, month - 1, day)

  if (
    candidate.getFullYear() !== year
    || candidate.getMonth() !== month - 1
    || candidate.getDate() !== day
  ) {
    return fallback
  }

  return `${yearText}-${monthText}-${dayText}`
}

function dateFromDateKey(dateKey) {
  const [yearText, monthText, dayText] = normalizeDateKey(dateKey).split('-')
  return new Date(Number(yearText), Number(monthText) - 1, Number(dayText), 0, 0, 0, 0)
}

function combineDateAndTime(dateKey, timeValue) {
  const [hoursText = '18', minutesText = '30'] = normalizeTimeString(timeValue).split(':')
  const date = dateFromDateKey(dateKey)
  date.setHours(Number(hoursText), Number(minutesText), 0, 0)
  return date
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + (Number(minutes) * 60 * 1000))
}

export function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
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

function buildLessonSessionKey(lessonDate, lessonStartTime, lessonDurationMinutes) {
  const normalizedTime = String(lessonStartTime || '18:30').replace(':', '')
  return `${lessonDate}_${normalizedTime}_${lessonDurationMinutes}`
}

export function getWeekdayLabel(weekday = 0) {
  return ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'][Number(weekday)] || 'Domingo'
}

export function formatTimeLabel(date = new Date()) {
  return date.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatLessonStartTimeLabel(config = DEFAULT_LESSON_CONTROL_CONFIG) {
  const [hours = '18', minutes = '30'] = String(config.lessonStartTime || '18:30').split(':')
  return `${hours}h${minutes}`
}

export function formatDateLabel(date = new Date()) {
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export function buildLessonControlConfig(overrides = {}) {
  const lessonDate = normalizeDateKey(
    overrides.lessonDate ?? DEFAULT_LESSON_CONTROL_CONFIG.lessonDate,
    DEFAULT_LESSON_CONTROL_CONFIG.lessonDate,
  )
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
    clampMinutes(
      overrides.warningLeadMinutes ?? DEFAULT_LESSON_CONTROL_CONFIG.warningLeadMinutes,
      DEFAULT_LESSON_CONTROL_CONFIG.warningLeadMinutes,
    ),
  )
  const checkInLeadMinutes = clampMinutes(
    overrides.checkInLeadMinutes ?? DEFAULT_LESSON_CONTROL_CONFIG.checkInLeadMinutes,
    DEFAULT_LESSON_CONTROL_CONFIG.checkInLeadMinutes,
  )

  const lessonDateObject = dateFromDateKey(lessonDate)
  const lessonWeekday = lessonDateObject.getDay()
  const lessonWeekdayLabel = getWeekdayLabel(lessonWeekday)
  const lessonStartMinutes = parseTimeToMinutes(lessonStartTime)
  const lessonEndTime = formatMinutesAsTime(lessonStartMinutes + lessonDurationMinutes)
  const lessonWarningTime = formatMinutesAsTime((lessonStartMinutes + lessonDurationMinutes) - warningLeadMinutes)
  const checkInStartTime = formatMinutesAsTime(lessonStartMinutes - checkInLeadMinutes)
  const lessonStartDateTime = combineDateAndTime(lessonDate, lessonStartTime)
  const lessonWarningDateTime = addMinutes(lessonStartDateTime, lessonDurationMinutes - warningLeadMinutes)
  const lessonEndDateTime = addMinutes(lessonStartDateTime, lessonDurationMinutes)
  const checkInStartDateTime = addMinutes(lessonStartDateTime, -checkInLeadMinutes)
  const lessonSessionKey = buildLessonSessionKey(lessonDate, lessonStartTime, lessonDurationMinutes)

  return {
    ...DEFAULT_LESSON_CONTROL_CONFIG,
    ...overrides,
    lessonDate,
    lessonSessionKey,
    lessonDateLabel: formatDateLabel(lessonDateObject),
    lessonDateObject,
    lessonWeekday,
    lessonWeekdayLabel,
    lessonStartTime,
    lessonStartTimeLabel: formatLessonStartTimeLabel({ lessonStartTime }),
    lessonDurationMinutes,
    warningLeadMinutes,
    checkInLeadMinutes,
    lessonEndTime,
    lessonWarningTime,
    checkInStartTime,
    lessonStartDateTime,
    lessonWarningDateTime,
    lessonEndDateTime,
    checkInStartDateTime,
  }
}

export const LESSON_CONTROL_CONFIG = buildLessonControlConfig()

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
  const nowMs = date.getTime()
  const lessonDateKey = config.lessonDate
  const currentDateKey = getLocalDateKey(date)
  const startMs = config.lessonStartDateTime.getTime()
  const warningMs = config.lessonWarningDateTime.getTime()
  const endMs = config.lessonEndDateTime.getTime()
  const checkInStartMs = config.checkInStartDateTime.getTime()
  const isLessonDay = currentDateKey === lessonDateKey
  const hasLessonStarted = isLessonDay && nowMs >= startMs
  const isLessonWindow = isLessonDay && nowMs >= startMs && nowMs <= endMs
  const isWithinCheckInWindow = isLessonDay && nowMs >= checkInStartMs && nowMs <= endMs
  const isWarning = isLessonDay && nowMs >= warningMs && nowMs < endMs
  const isExpired = isLessonDay && nowMs >= endMs
  const isPastLesson = nowMs > endMs && !isLessonDay
  const remainingMs = isLessonWindow ? Math.max(0, endMs - nowMs) : 0
  const untilWarningMs = isLessonWindow ? Math.max(0, warningMs - nowMs) : 0

  let statusLabel = `Próxima aula: ${config.lessonWeekdayLabel}, ${config.lessonDateLabel}, às ${config.lessonStartTimeLabel}`
  if (isLessonWindow && !isWarning) statusLabel = 'Aula em andamento'
  if (isWarning) statusLabel = `Faltam ${config.warningLeadMinutes} min para o gongo!`
  if (isExpired) statusLabel = 'Tempo encerrado'
  if (isPastLesson) statusLabel = `Aula encerrada em ${config.lessonWeekdayLabel}, ${config.lessonDateLabel}. Edite o horário da aula.`

  return {
    ...config,
    nowIso: date.toISOString(),
    dateKey: lessonDateKey,
    lessonDateKey,
    currentDateKey,
    isLessonDay,
    isSunday: isLessonDay,
    hasLessonStarted,
    isLessonWindow,
    isWithinCheckInWindow,
    isWarning,
    isExpired,
    isPastLesson,
    shouldShowFinalizePrompt: isExpired,
    remainingMs,
    untilWarningMs,
    countdownLabel: formatCountdown(remainingMs),
    warningCountdownLabel: formatCountdown(untilWarningMs),
    statusLabel,
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
