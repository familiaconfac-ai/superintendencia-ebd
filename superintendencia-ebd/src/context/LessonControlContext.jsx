import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from './AuthContext'
import lessonAlarmMp3 from '../assets/lesson-alarm.mp3'
import lessonWarningMp3 from '../assets/lesson-warning.mp3'
import lessonEndingMp3 from '../assets/lesson-ending.mp3'
import {
  COMMUNICATION_SETTINGS_EVENT,
  DEFAULT_COMMUNICATION_SETTINGS,
  getCommunicationSettings,
} from '../services/communicationSettingsService'
import { publishLessonClosingWarning } from '../services/noticeCenterService'
import { getLessonSession, saveLessonSession } from '../services/lessonControlService'
import {
  buildLessonControlConfig,
  calculateDistanceMeters,
  formatDistance,
  formatTimeLabel,
  getLessonTimelineSnapshot,
} from '../utils/lessonControl'

const LessonControlContext = createContext(null)

const HOME_WARNING_MESSAGE = 'Check-in indisponível. Você precisa estar na igreja para registrar sua pontualidade.'
const GPS_REQUIRED_MESSAGE = 'Ative o GPS para registrar sua presença na igreja.'
const REQUEST_TIMEOUT_MS = 12000
const ALERT_AUTO_STOP_MS = 3000
const ALERT_TRIGGER_TOLERANCE_MS = 20000
const CUSTOM_ALARM_SOURCES = {
  warning: [lessonWarningMp3, lessonAlarmMp3],
  ending: [lessonEndingMp3, lessonAlarmMp3],
}

let sharedLessonAudioContext = null
let lessonAudioUnlocked = false

function getSessionStorageKey(type, lessonSessionKey) {
  return `ebd:lesson-control:${type}:${lessonSessionKey}`
}

function getMonitoringStorageKey(uid, lessonSessionKey) {
  return `ebd:lesson-monitoring:${uid}:${lessonSessionKey}`
}

function clearLessonRuntimeState(lessonSessionKey, keys = []) {
  keys.forEach((key) => {
    sessionStorage.removeItem(getSessionStorageKey(key, lessonSessionKey))
  })
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId = null

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(message))
    }, timeoutMs)
  })

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) window.clearTimeout(timeoutId)
  })
}

function getLessonAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext
  if (!AudioContextClass) return null

  if (!sharedLessonAudioContext || sharedLessonAudioContext.state === 'closed') {
    sharedLessonAudioContext = new AudioContextClass()
  }

  return sharedLessonAudioContext
}

async function unlockLessonAudio() {
  const context = getLessonAudioContext()
  if (!context) return false

  if (context.state === 'suspended') {
    await context.resume().catch((error) => {
      console.warn('[LESSON CONTROL] Audio unlock failed:', error)
    })
  }

  lessonAudioUnlocked = context.state === 'running'
  return lessonAudioUnlocked
}

function getTeacherIdentity(user, profile) {
  return {
    teacherUid: user?.uid || profile?.uid || '',
    teacherEmail: (profile?.email || user?.email || '').trim().toLowerCase(),
    teacherName: profile?.displayName || user?.displayName || user?.email || 'Professor da EBD',
    teacherProfileId: profile?.id || profile?.uid || '',
  }
}

function buildCheckInFeedbackMessage(currentSession, lessonStartDateTime) {
  if (!currentSession) return ''

  if (currentSession.checkInStatus === 'outside_radius') {
    return HOME_WARNING_MESSAGE
  }

  if (currentSession.checkInStatus === 'confirmed' && currentSession.checkInAt) {
    const checkInDate = new Date(currentSession.checkInAt)
    const scheduledStart = lessonStartDateTime instanceof Date ? lessonStartDateTime : null
    const isLatePresence = currentSession.presenceConfirmed && currentSession.punctualityOk === false
    const formattedTime = formatTimeLabel(checkInDate)

    if (isLatePresence && scheduledStart) {
      return `Presença confirmada às ${formattedTime}. Chegada após ${formatTimeLabel(scheduledStart)}; registrada como presença, não como pontualidade.`
    }

    return `Presença confirmada às ${formattedTime}.`
  }

  return ''
}

function isCheckInPunctual(checkedAtIso, lessonStartDateTime) {
  if (!checkedAtIso || !(lessonStartDateTime instanceof Date)) return false

  const checkedAt = new Date(checkedAtIso)
  if (Number.isNaN(checkedAt.getTime())) return false

  const checkedAtRoundedToMinute = new Date(checkedAt)
  checkedAtRoundedToMinute.setSeconds(0, 0)

  return checkedAtRoundedToMinute.getTime() <= lessonStartDateTime.getTime()
}

function wasMonitoringActiveBefore(alertDateTime, monitoringActivatedAt) {
  if (!(alertDateTime instanceof Date) || !monitoringActivatedAt) return false

  const activatedAt = new Date(monitoringActivatedAt)
  if (Number.isNaN(activatedAt.getTime())) return false

  return activatedAt.getTime() <= alertDateTime.getTime()
}

function shouldTriggerAlertNow(kind, timeline, currentSession) {
  const eventDateTime = kind === 'ending' ? timeline.lessonEndDateTime : timeline.lessonWarningDateTime
  if (!(eventDateTime instanceof Date)) return false
  if (!wasMonitoringActiveBefore(eventDateTime, currentSession?.monitoringActivatedAt)) return false

  const nowMs = Date.now()
  const eventMs = eventDateTime.getTime()

  return nowMs >= eventMs && nowMs <= eventMs + ALERT_TRIGGER_TOLERANCE_MS
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocalização indisponível.'))
      return
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 0,
    })
  })
}

async function showLessonNotification(lessonSessionKey, kind = 'warning', lessonConfig = DEFAULT_COMMUNICATION_SETTINGS) {
  if (!('Notification' in window)) return false
  if (Notification.permission !== 'granted') return false

  const isEnding = kind === 'ending'
  const options = {
    body: isEnding
      ? '⏰ Tempo encerrado! Finalize a aula agora.'
      : `⚠️ Faltam ${lessonConfig.warningLeadMinutes} minutos! Inicie a conclusão da aula.`,
    tag: `lesson-${kind}-${lessonSessionKey}`,
    requireInteraction: true,
    silent: true,
    vibrate: isEnding ? [300, 120, 300, 120, 400] : [250, 120, 250, 120, 350],
    icon: '/icon-192.png',
    badge: '/favicon.png',
    data: {
      url: '/comunicacao',
    },
  }

  try {
    const registration = await navigator.serviceWorker?.getRegistration?.()
    if (registration?.showNotification) {
      await registration.showNotification('Painel de Controle de Aula', options)
      return true
    }

    const notification = new Notification('Painel de Controle de Aula', options)
    window.setTimeout(() => notification.close(), 20000)
    return true
  } catch {
    return false
  }
}

async function closeLessonNotifications() {
  try {
    const registration = await navigator.serviceWorker?.getRegistration?.()
    const notifications = await registration?.getNotifications?.()
    notifications?.forEach((notification) => notification.close())
  } catch (error) {
    console.warn('[LESSON CONTROL] Unable to close lesson notifications:', error)
  }
}

export function LessonControlProvider({ children }) {
  const { user, profile, role } = useAuth()
  const isTeacher = role === 'teacher'
  const canControlLesson = isTeacher || role === 'admin'
  const [lessonConfig, setLessonConfig] = useState(() => buildLessonControlConfig(DEFAULT_COMMUNICATION_SETTINGS))
  const [timeline, setTimeline] = useState(() => getLessonTimelineSnapshot(new Date(), lessonConfig))
  const [session, setSession] = useState(null)
  const [isLoadingSession, setIsLoadingSession] = useState(false)
  const [isCheckingIn, setIsCheckingIn] = useState(false)
  const [isFinalizing, setIsFinalizing] = useState(false)
  const [activeAlarm, setActiveAlarm] = useState(null)
  const [checkInMessage, setCheckInMessage] = useState('')
  const [lastDistanceMeters, setLastDistanceMeters] = useState(null)
  const [isLessonMonitoringActive, setIsLessonMonitoringActive] = useState(false)
  const [isWakeLockActive, setIsWakeLockActive] = useState(false)
  const activeRequestRef = useRef(false)
  const alarmLoopTimeoutRef = useRef(null)
  const activeAlarmKindRef = useRef(null)
  const wakeLockRef = useRef(null)
  const customAlarmSourceRef = useRef(null)
  const customAlarmGainRef = useRef(null)
  const customAlarmBufferCacheRef = useRef(new Map())

  useEffect(() => {
    const permission = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
    console.log('[LESSON CONTROL] notification permission:', permission)
  }, [])

  useEffect(() => {
    if (!user?.uid) {
      setIsLessonMonitoringActive(false)
      return
    }

    const monitoringKey = getMonitoringStorageKey(user.uid, timeline.lessonSessionKey)
    setIsLessonMonitoringActive(Boolean(localStorage.getItem(monitoringKey)))
  }, [timeline.lessonSessionKey, user?.uid])

  useEffect(() => {
    if (!canControlLesson || lessonAudioUnlocked) return undefined

    let removed = false

    const handleUnlock = async () => {
      const unlocked = await unlockLessonAudio()
      if (!unlocked || removed) return

      window.removeEventListener('pointerdown', handleUnlock)
      window.removeEventListener('keydown', handleUnlock)
      window.removeEventListener('touchstart', handleUnlock)
    }

    window.addEventListener('pointerdown', handleUnlock)
    window.addEventListener('keydown', handleUnlock)
    window.addEventListener('touchstart', handleUnlock)

    return () => {
      removed = true
      window.removeEventListener('pointerdown', handleUnlock)
      window.removeEventListener('keydown', handleUnlock)
      window.removeEventListener('touchstart', handleUnlock)
    }
  }, [canControlLesson])

  const stopCustomAlarmAudio = useCallback(() => {
    try {
      customAlarmSourceRef.current?.stop?.()
    } catch (error) {
      console.warn('[LESSON CONTROL] Failed to stop custom alarm source:', error)
    }

    try {
      customAlarmSourceRef.current?.disconnect?.()
      customAlarmGainRef.current?.disconnect?.()
    } catch (error) {
      console.warn('[LESSON CONTROL] Failed to disconnect custom alarm nodes:', error)
    } finally {
      customAlarmSourceRef.current = null
      customAlarmGainRef.current = null
    }
  }, [])

  const loadCustomAlarmBuffer = useCallback(async (src) => {
    const context = getLessonAudioContext()
    if (!context) return null

    if (customAlarmBufferCacheRef.current.has(src)) {
      return customAlarmBufferCacheRef.current.get(src)
    }

    console.log('[LESSON AUDIO] loading', src)
    const response = await fetch(src, { cache: 'no-store' })
    if (!response.ok) {
      throw new Error(`Falha ao carregar MP3 do alarme: ${src}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    const decodedBuffer = await context.decodeAudioData(arrayBuffer.slice(0))
    customAlarmBufferCacheRef.current.set(src, decodedBuffer)
    return decodedBuffer
  }, [])

  const startCustomAlarmAudio = useCallback(async (kind) => {
    const context = getLessonAudioContext()
    if (!context) return false

    if (context.state === 'suspended') {
      await context.resume().catch(() => null)
    }
    if (context.state !== 'running') return false

    stopCustomAlarmAudio()

    const candidates = CUSTOM_ALARM_SOURCES[kind] || CUSTOM_ALARM_SOURCES.ending
    for (const src of candidates) {
      console.log('[LESSON AUDIO] requested', { url: src, type: kind })
      try {
        const audioBuffer = await loadCustomAlarmBuffer(src)
        if (!audioBuffer) continue

        const source = context.createBufferSource()
        const gain = context.createGain()

        source.buffer = audioBuffer
        source.loop = true
        gain.gain.setValueAtTime(1, context.currentTime)
        source.connect(gain)
        gain.connect(context.destination)
        console.log('[LESSON AUDIO] starting', src)
        source.start()

        customAlarmSourceRef.current = source
        customAlarmGainRef.current = gain
        console.log('[LESSON CONTROL] Custom alarm buffer playing:', src)
        return true
      } catch (error) {
        console.error('[LESSON AUDIO] failed', { url: src, error })
        console.warn('[LESSON CONTROL] Custom alarm buffer unavailable:', src, error)
      }
    }

    return false
  }, [loadCustomAlarmBuffer, stopCustomAlarmAudio])

  useEffect(() => {
    let isMounted = true

    async function loadSettings() {
      const settings = await getCommunicationSettings().catch(() => DEFAULT_COMMUNICATION_SETTINGS)
      if (!isMounted) return
      setLessonConfig(buildLessonControlConfig(settings))
      console.log('[LESSON CONTROL] config loaded (from settings)', settings)
    }

    const handleSettingsUpdated = (event) => {
      setLessonConfig(buildLessonControlConfig(event.detail || DEFAULT_COMMUNICATION_SETTINGS))
    }

    loadSettings()
    window.addEventListener(COMMUNICATION_SETTINGS_EVENT, handleSettingsUpdated)
    return () => {
      isMounted = false
      window.removeEventListener(COMMUNICATION_SETTINGS_EVENT, handleSettingsUpdated)
    }
  }, [])

  useEffect(() => {
    const updateClock = () => setTimeline(getLessonTimelineSnapshot(new Date(), lessonConfig))
    updateClock()

    const timer = window.setInterval(updateClock, 1000)
    return () => window.clearInterval(timer)
  }, [lessonConfig])

  const teacherIdentity = useMemo(
    () => getTeacherIdentity(user, profile),
    [profile, user],
  )

  const releaseWakeLock = useCallback(async () => {
    if (!wakeLockRef.current) {
      setIsWakeLockActive(false)
      return
    }

    try {
      await wakeLockRef.current.release()
    } catch (error) {
      console.warn('[LESSON CONTROL] Failed to release wake lock:', error)
    } finally {
      wakeLockRef.current = null
      setIsWakeLockActive(false)
    }
  }, [])

  const requestWakeLock = useCallback(async () => {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') {
      setIsWakeLockActive(false)
      return false
    }

    try {
      const sentinel = await navigator.wakeLock.request('screen')
      wakeLockRef.current = sentinel
      setIsWakeLockActive(true)

      sentinel.addEventListener('release', () => {
        if (wakeLockRef.current === sentinel) {
          wakeLockRef.current = null
          setIsWakeLockActive(false)
        }
      })

      return true
    } catch (error) {
      console.warn('[LESSON CONTROL] Failed to request wake lock:', error)
      setIsWakeLockActive(false)
      return false
    }
  }, [])

  useEffect(() => {
    let isMounted = true

    async function loadSession() {
      if (!user?.uid || !canControlLesson) {
        if (isMounted) {
          setSession(null)
          setLastDistanceMeters(null)
          setCheckInMessage('')
        }
        return
      }

      setIsLoadingSession(true)
      try {
        const currentSession = await withTimeout(
          getLessonSession(user.uid, timeline.lessonSessionKey),
          REQUEST_TIMEOUT_MS,
          'Tempo esgotado ao carregar a sessão da aula.',
        )
        if (!isMounted) return

        setSession(currentSession)
        setLastDistanceMeters(currentSession?.distanceMeters ?? null)
        setCheckInMessage(buildCheckInFeedbackMessage(currentSession, lessonConfig.lessonStartDateTime))
      } catch (error) {
        console.error('[LESSON CONTROL] Failed to load lesson session:', error)
        if (!isMounted) return
        setSession(null)
        setLastDistanceMeters(null)
      } finally {
        if (isMounted) setIsLoadingSession(false)
      }
    }

    loadSession()

    return () => {
      isMounted = false
    }
  }, [canControlLesson, lessonConfig.lessonStartDateTime, timeline.lessonSessionKey, user?.uid])

  const persistLessonSession = useCallback(async (patch = {}) => {
    if (!user?.uid || !canControlLesson) return null

    const baseSession = session || {
      lessonDateKey: timeline.lessonDateKey,
      lessonSessionKey: timeline.lessonSessionKey,
      lessonDateLabel: lessonConfig.lessonDateLabel,
      lessonWeekday: lessonConfig.lessonWeekday,
      lessonWeekdayLabel: lessonConfig.lessonWeekdayLabel,
      lessonStartTime: lessonConfig.lessonStartTime,
      warningTime: lessonConfig.lessonWarningTime,
      lessonEndTime: lessonConfig.lessonEndTime,
      lessonDurationMinutes: lessonConfig.lessonDurationMinutes,
      churchLocation: lessonConfig.churchLocation,
      allowedRadiusMeters: lessonConfig.checkInRadiusMeters,
      ...teacherIdentity,
    }

    const nextSession = {
      ...baseSession,
      ...patch,
      lessonDateKey: timeline.lessonDateKey,
      lessonSessionKey: timeline.lessonSessionKey,
      lessonDateLabel: lessonConfig.lessonDateLabel,
      lessonWeekday: lessonConfig.lessonWeekday,
      lessonWeekdayLabel: lessonConfig.lessonWeekdayLabel,
      lessonStartTime: lessonConfig.lessonStartTime,
      warningTime: lessonConfig.lessonWarningTime,
      lessonEndTime: lessonConfig.lessonEndTime,
      lessonDurationMinutes: lessonConfig.lessonDurationMinutes,
      churchLocation: lessonConfig.churchLocation,
      allowedRadiusMeters: lessonConfig.checkInRadiusMeters,
      ...teacherIdentity,
    }

    const savedSession = await withTimeout(
      saveLessonSession(user.uid, timeline.lessonSessionKey, nextSession),
      REQUEST_TIMEOUT_MS,
      'Tempo esgotado ao salvar a sessão da aula.',
    )

    setSession(savedSession)
    setLastDistanceMeters(savedSession?.distanceMeters ?? nextSession.distanceMeters ?? null)
    return savedSession
  }, [canControlLesson, lessonConfig, session, teacherIdentity, timeline.lessonDateKey, timeline.lessonSessionKey, user?.uid])

  const activateLessonMonitoring = useCallback(async (payload = {}) => {
    if (!user?.uid) return false
    const activatedAtIso = new Date().toISOString()

    if (!timeline.isWarning && !timeline.isExpired) {
      clearLessonRuntimeState(timeline.lessonSessionKey, [
        'gps-requested',
        'gps-warning',
        'home-warning',
        'warning-fired',
        'ending-fired',
        'alarm-dismissed-warning',
        'alarm-dismissed-ending',
      ])
    }

    const monitoringKey = getMonitoringStorageKey(user.uid, timeline.lessonSessionKey)
    localStorage.setItem(monitoringKey, JSON.stringify({
      registerId: payload.registerId || '',
      className: payload.className || '',
      activatedAt: activatedAtIso,
    }))

    if (!session?.monitoringActivatedAt) {
      await persistLessonSession({
        monitoringActivatedAt: activatedAtIso,
        monitoringActivationSource: payload.monitoringActivationSource || 'register_open',
        monitoringRegisterId: payload.registerId || '',
        monitoringClassName: payload.className || '',
      }).catch((error) => {
        console.warn('[LESSON CONTROL] Failed to persist lesson monitoring activation:', error)
      })
    }

    setIsLessonMonitoringActive(true)
    await unlockLessonAudio().catch(() => false)
    await requestWakeLock().catch(() => false)
    return true
  }, [persistLessonSession, requestWakeLock, session?.monitoringActivatedAt, timeline.isExpired, timeline.isWarning, timeline.lessonSessionKey, user?.uid])

  const deactivateLessonMonitoring = useCallback(async () => {
    if (user?.uid) {
      const monitoringKey = getMonitoringStorageKey(user.uid, timeline.lessonSessionKey)
      localStorage.removeItem(monitoringKey)
    }

    setIsLessonMonitoringActive(false)
    await releaseWakeLock()
  }, [releaseWakeLock, timeline.lessonSessionKey, user?.uid])

  useEffect(() => {
    if (!isLessonMonitoringActive) {
      releaseWakeLock()
      return undefined
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        requestWakeLock()
      } else {
        setIsWakeLockActive(false)
      }
    }

    if (document.visibilityState === 'visible') {
      requestWakeLock()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [isLessonMonitoringActive, releaseWakeLock, requestWakeLock])

  const stopActiveAlarm = useCallback(async ({ persistDismissal = true } = {}) => {
    if (alarmLoopTimeoutRef.current) {
      window.clearTimeout(alarmLoopTimeoutRef.current)
      alarmLoopTimeoutRef.current = null
    }

    if (navigator.vibrate) {
      navigator.vibrate(0)
    }

    if (persistDismissal && activeAlarmKindRef.current) {
      const dismissalKey = getSessionStorageKey(`alarm-dismissed-${activeAlarmKindRef.current}`, timeline.lessonSessionKey)
      sessionStorage.setItem(dismissalKey, '1')
    }

    activeAlarmKindRef.current = null
    setActiveAlarm(null)
    stopCustomAlarmAudio()
    await closeLessonNotifications()
  }, [stopCustomAlarmAudio, timeline.lessonSessionKey])

  const startActiveAlarm = useCallback(async (kind) => {
    if (!kind || activeAlarmKindRef.current === kind) return

    await stopActiveAlarm({ persistDismissal: false })

    const dismissalKey = getSessionStorageKey(`alarm-dismissed-${kind}`, timeline.lessonSessionKey)
    if (sessionStorage.getItem(dismissalKey)) return

    activeAlarmKindRef.current = kind
    setActiveAlarm({
      kind,
      startedAt: new Date().toISOString(),
    })

    const customAudioStarted = await startCustomAlarmAudio(kind).catch(() => false)
    if (!customAudioStarted) {
      console.error('[LESSON AUDIO] MP3 alarm did not start', { type: kind })
      window.alert('O MP3 do alarme nao conseguiu iniciar neste aparelho. Verifique o console.')
    }

    if (navigator.vibrate) {
      navigator.vibrate(kind === 'ending' ? [250, 120, 250, 120, 350] : [220, 100, 220, 100, 300])
    }

    if (!customAudioStarted && !navigator.vibrate) {
      window.alert(kind === 'ending' ? 'Tempo encerrado!' : 'Faltam poucos minutos para o fim da aula!')
    }

    alarmLoopTimeoutRef.current = window.setTimeout(() => {
      stopActiveAlarm({ persistDismissal: false })
    }, ALERT_AUTO_STOP_MS)
  }, [startCustomAlarmAudio, stopActiveAlarm, timeline.lessonSessionKey])

  const requestGpsCheckIn = useCallback(async ({ automatic = false } = {}) => {
    if (!isTeacher || !user?.uid) return null
    if (!timeline.isWithinCheckInWindow) {
      setCheckInMessage('Check-in disponível apenas na data e no horário programados para a aula.')
      return null
    }
    if (activeRequestRef.current) return null

    activeRequestRef.current = true
    setIsCheckingIn(true)
    setCheckInMessage('')

    try {
      const position = await getCurrentPosition()
      const coords = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      }
      const distanceMeters = calculateDistanceMeters(coords, lessonConfig.churchLocation)
      const isInsideChurchRadius = distanceMeters <= lessonConfig.checkInRadiusMeters
      const checkedAtIso = new Date().toISOString()
      const punctualityOk = isCheckInPunctual(checkedAtIso, timeline.lessonStartDateTime)

      if (isInsideChurchRadius) {
        const nextSession = await persistLessonSession({
          checkInAt: checkedAtIso,
          checkInStatus: 'confirmed',
          presenceConfirmed: true,
          punctualityOk,
          distanceMeters,
          geoPoint: coords,
          locationCheckedAt: checkedAtIso,
        })
        setCheckInMessage(buildCheckInFeedbackMessage(nextSession, timeline.lessonStartDateTime))
      } else {
        await persistLessonSession({
          checkInAt: checkedAtIso,
          checkInStatus: 'outside_radius',
          presenceConfirmed: false,
          punctualityOk: false,
          distanceMeters,
          geoPoint: coords,
          locationCheckedAt: checkedAtIso,
          homeWarningMessage: HOME_WARNING_MESSAGE,
        })
        setCheckInMessage(HOME_WARNING_MESSAGE)

        const warningKey = getSessionStorageKey('home-warning', timeline.lessonSessionKey)
        if (!automatic || !sessionStorage.getItem(warningKey)) {
          window.alert(HOME_WARNING_MESSAGE)
          sessionStorage.setItem(warningKey, '1')
        }
      }

      return true
    } catch (error) {
      const checkedAtIso = new Date().toISOString()
      await persistLessonSession({
        checkInStatus: error?.code === 1 ? 'permission_denied' : 'gps_unavailable',
        presenceConfirmed: false,
        punctualityOk: false,
        locationCheckedAt: checkedAtIso,
        locationError: error?.message || GPS_REQUIRED_MESSAGE,
      })
      setCheckInMessage(GPS_REQUIRED_MESSAGE)

      const warningKey = getSessionStorageKey('gps-warning', timeline.lessonSessionKey)
      if (!automatic || !sessionStorage.getItem(warningKey)) {
        window.alert(GPS_REQUIRED_MESSAGE)
        sessionStorage.setItem(warningKey, '1')
      }

      return false
    } finally {
      activeRequestRef.current = false
      setIsCheckingIn(false)
    }
  }, [isTeacher, lessonConfig, persistLessonSession, timeline.isWithinCheckInWindow, timeline.lessonSessionKey, timeline.lessonStartDateTime, user?.uid])

  const triggerLessonAlert = useCallback(async (kind) => {
    if (!canControlLesson || !user?.uid) return
    console.log(`[LESSON CONTROL] alert fired: ${kind}`)

    const timestamp = new Date().toISOString()

    if (kind === 'warning') {
      await persistLessonSession({
        warningTriggeredAt: timestamp,
        warningTriggered: true,
      })
      await publishLessonClosingWarning(user.uid, 'automatic').catch(() => null)
    } else {
      await persistLessonSession({
        endAlertTriggeredAt: timestamp,
        endAlertTriggered: true,
      })
    }

    await showLessonNotification(timeline.lessonSessionKey, kind, lessonConfig)
    await unlockLessonAudio().catch(() => false)
    await startActiveAlarm(kind)
  }, [canControlLesson, lessonConfig, persistLessonSession, startActiveAlarm, timeline.lessonSessionKey, user?.uid])

  const finalizeLessonNow = useCallback(async () => {
    if (!canControlLesson || !user?.uid) return null

    setIsFinalizing(true)
    const previousSession = session

    try {
      const finishedAtIso = new Date().toISOString()
      const nextStatus = session?.finishStatus === 'extrapolated' ? 'extrapolated' : 'finished'
      const finishPatch = {
        finishStatus: nextStatus,
        endedAt: finishedAtIso,
        finalizedByTeacherAt: finishedAtIso,
        teacherConfirmedFinish: true,
      }

      console.log('[LESSON CONTROL] finalize requested', finishPatch)
      setSession((current) => ({ ...(current || {}), ...finishPatch }))
      await stopActiveAlarm()

      const savedSession = await persistLessonSession(finishPatch)
      await deactivateLessonMonitoring()
      return savedSession
    } catch (error) {
      console.error('[LESSON CONTROL] Failed to finalize lesson:', error)
      setSession(previousSession || null)
      window.alert('Não foi possível finalizar a aula agora. Verifique a conexão e tente novamente.')
      return null
    } finally {
      setIsFinalizing(false)
    }
  }, [canControlLesson, deactivateLessonMonitoring, persistLessonSession, session, stopActiveAlarm, user?.uid])

  useEffect(() => (
    () => {
      if (alarmLoopTimeoutRef.current) {
        window.clearTimeout(alarmLoopTimeoutRef.current)
      }
      if (navigator.vibrate) {
        navigator.vibrate(0)
      }
      stopCustomAlarmAudio()
    }
  ), [stopCustomAlarmAudio])

  useEffect(() => {
    if (!canControlLesson || session?.endedAt) {
      if (activeAlarmKindRef.current) {
        stopActiveAlarm({ persistDismissal: false })
      }
      return
    }
  }, [
    canControlLesson,
    session?.endedAt,
    stopActiveAlarm,
  ])

  useEffect(() => {
    if (!isLessonMonitoringActive || !isTeacher || !user?.uid || !timeline.isWithinCheckInWindow) return
    if (session?.presenceConfirmed) return

    const requestKey = getSessionStorageKey('gps-requested', timeline.lessonSessionKey)
    if (sessionStorage.getItem(requestKey)) return

    sessionStorage.setItem(requestKey, '1')
    requestGpsCheckIn({ automatic: true })
  }, [isLessonMonitoringActive, isTeacher, requestGpsCheckIn, session?.presenceConfirmed, timeline.isWithinCheckInWindow, timeline.lessonSessionKey, user?.uid])

  useEffect(() => {
    if (!isLessonMonitoringActive || !canControlLesson || !user?.uid || !timeline.isLessonDay || !timeline.isWarning) return
    if (!shouldTriggerAlertNow('warning', timeline, session)) return

    const alertKey = getSessionStorageKey('warning-fired', timeline.lessonSessionKey)
    if (sessionStorage.getItem(alertKey)) return

    sessionStorage.setItem(alertKey, '1')
    triggerLessonAlert('warning')
  }, [canControlLesson, isLessonMonitoringActive, session, timeline, triggerLessonAlert, user?.uid])

  useEffect(() => {
    if (!isLessonMonitoringActive || !canControlLesson || !user?.uid || !timeline.isLessonDay || !timeline.isExpired) return
    if (!shouldTriggerAlertNow('ending', timeline, session)) return

    const alertKey = getSessionStorageKey('ending-fired', timeline.lessonSessionKey)
    if (sessionStorage.getItem(alertKey)) return

    sessionStorage.setItem(alertKey, '1')
    triggerLessonAlert('ending')
  }, [canControlLesson, isLessonMonitoringActive, session, timeline, triggerLessonAlert, user?.uid])

  useEffect(() => {
    if (!isLessonMonitoringActive || !canControlLesson || !user?.uid || !timeline.shouldShowFinalizePrompt) return
    if (session?.finishStatus === 'finished' || session?.endedAt) return
    if (session?.finishStatus === 'extrapolated') return

    persistLessonSession({
      finishStatus: 'extrapolated',
      extrapolatedAt: new Date().toISOString(),
      teacherConfirmedFinish: false,
    })
  }, [canControlLesson, isLessonMonitoringActive, persistLessonSession, session?.endedAt, session?.finishStatus, timeline.shouldShowFinalizePrompt, user?.uid])

  const contextValue = useMemo(() => {
    const status = session?.presenceConfirmed
      ? 'confirmed'
      : session?.checkInStatus === 'outside_radius'
        ? 'outside_radius'
        : session?.checkInStatus || 'pending'

    return {
      timeline,
      lessonConfig,
      session,
      isTeacher,
      canControlLesson,
      isLoadingSession,
      isCheckingIn,
      isFinalizing,
      activeAlarm,
      isLessonMonitoringActive,
      isWakeLockActive,
      checkInMessage,
      lastDistanceMeters,
      formattedDistance: formatDistance(lastDistanceMeters),
      shouldShowFinalizePrompt: canControlLesson && timeline.shouldShowFinalizePrompt && !session?.endedAt,
      activateLessonMonitoring,
      deactivateLessonMonitoring,
      requestGpsCheckIn,
      finalizeLessonNow,
      stopActiveAlarm,
      status,
      churchLocation: lessonConfig.churchLocation,
      checkInRadiusMeters: lessonConfig.checkInRadiusMeters,
      homeWarningMessage: HOME_WARNING_MESSAGE,
    }
  }, [
    activeAlarm,
    activateLessonMonitoring,
    checkInMessage,
    deactivateLessonMonitoring,
    finalizeLessonNow,
    isCheckingIn,
    isFinalizing,
    isLessonMonitoringActive,
    isLoadingSession,
    isWakeLockActive,
    canControlLesson,
    isTeacher,
    lastDistanceMeters,
    lessonConfig,
    requestGpsCheckIn,
    session,
    stopActiveAlarm,
    timeline,
  ])

  return (
    <LessonControlContext.Provider value={contextValue}>
      {children}
    </LessonControlContext.Provider>
  )
}

export function useLessonControl() {
  const context = useContext(LessonControlContext)
  if (!context) throw new Error('useLessonControl deve ser usado dentro de LessonControlProvider.')
  return context
}
