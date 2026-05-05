import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from './AuthContext'
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

let sharedLessonAudioContext = null
let lessonAudioUnlocked = false

function getSessionStorageKey(type, lessonSessionKey) {
  return `ebd:lesson-control:${type}:${lessonSessionKey}`
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

async function playLessonAlertTone(kind = 'warning') {
  console.log('[LESSON CONTROL] Attempting to play alert tone:', kind)

  try {
    const context = getLessonAudioContext()
    if (!context) {
      console.warn('[LESSON CONTROL] AudioContext not supported on this device/browser.')
      return false
    }

    if (context.state === 'suspended') {
      await context.resume().catch((error) => console.warn('[LESSON CONTROL] AudioContext resume failed:', error))
    }
    if (context.state !== 'running') {
      console.warn('[LESSON CONTROL] AudioContext is not running at alert time.')
      return false
    }

    const warningPattern = [
      { offset: 0, frequency: 880, duration: 0.22 },
      { offset: 0.30, frequency: 1046, duration: 0.22 },
    ]
    const endingPattern = [
      { offset: 0, frequency: 1046, duration: 0.18 },
      { offset: 0.22, frequency: 1318, duration: 0.18 },
      { offset: 0.44, frequency: 1568, duration: 0.28 },
    ]
    const pattern = kind === 'ending' ? endingPattern : warningPattern
    const startAt = context.currentTime

    pattern.forEach(({ offset, frequency, duration }) => {
      const oscillator = context.createOscillator()
      const gain = context.createGain()

      oscillator.type = 'triangle'
      oscillator.frequency.setValueAtTime(frequency, startAt + offset)
      gain.gain.setValueAtTime(0.0001, startAt + offset)
      gain.gain.exponentialRampToValueAtTime(0.28, startAt + offset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + offset + duration)

      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start(startAt + offset)
      oscillator.stop(startAt + offset + duration + 0.02)
    })

    console.log('[LESSON CONTROL] AudioContext tone played.')
    return true
  } catch (error) {
    console.error('[LESSON CONTROL] Error playing alert tone:', error)
    return false
  }
}

async function showLessonNotification(lessonDateKey, kind = 'warning', lessonConfig = DEFAULT_COMMUNICATION_SETTINGS) {
  if (!('Notification' in window)) return false
  if (Notification.permission !== 'granted') return false

  const isEnding = kind === 'ending'
  const options = {
    body: isEnding
      ? '⏰ Tempo encerrado! Finalize a aula agora.'
      : `⚠️ Faltam ${lessonConfig.warningLeadMinutes} minutos! Inicie a conclusão da aula.`,
    tag: `lesson-${kind}-${lessonDateKey}`,
    requireInteraction: true,
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
  const activeRequestRef = useRef(false)
  const alarmLoopTimeoutRef = useRef(null)
  const activeAlarmKindRef = useRef(null)

  useEffect(() => {
    const permission = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
    console.log('[LESSON CONTROL] notification permission:', permission)
  }, [])

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
          'Tempo esgotado ao carregar a sessÃ£o da aula.',
        )
        if (!isMounted) return
        setSession(currentSession)
        setLastDistanceMeters(currentSession?.distanceMeters ?? null)
        setCheckInMessage(
          currentSession?.checkInStatus === 'outside_radius'
            ? HOME_WARNING_MESSAGE
            : currentSession?.checkInStatus === 'confirmed'
              ? `Presença confirmada às ${formatTimeLabel(new Date(currentSession.checkInAt))}.`
              : '',
        )
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
  }, [canControlLesson, timeline.lessonSessionKey, user?.uid])

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
      'Tempo esgotado ao salvar a sessÃ£o da aula.',
    )
    setSession(savedSession)
    setLastDistanceMeters(savedSession?.distanceMeters ?? nextSession.distanceMeters ?? null)
    return savedSession
  }, [canControlLesson, lessonConfig, session, teacherIdentity, timeline.lessonDateKey, timeline.lessonSessionKey, user?.uid])

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
    await closeLessonNotifications()
  }, [timeline.lessonSessionKey])

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

    const playLoop = async () => {
      if (activeAlarmKindRef.current !== kind) return

      const tonePlayed = await playLessonAlertTone(kind).catch(() => false)
      if (navigator.vibrate) {
        navigator.vibrate(kind === 'ending' ? [500, 220, 500, 220, 700] : [350, 180, 350, 180, 500])
      }
      if (!tonePlayed && !navigator.vibrate) {
        window.alert(kind === 'ending' ? 'Tempo encerrado!' : 'Faltam poucos minutos para o fim da aula!')
      }

      alarmLoopTimeoutRef.current = window.setTimeout(
        playLoop,
        kind === 'ending' ? 1800 : 1500,
      )
    }

    playLoop()
  }, [stopActiveAlarm, timeline.lessonSessionKey])

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

      if (isInsideChurchRadius) {
        await persistLessonSession({
          checkInAt: checkedAtIso,
          checkInStatus: 'confirmed',
          presenceConfirmed: true,
          punctualityOk: true,
          distanceMeters,
          geoPoint: coords,
          locationCheckedAt: checkedAtIso,
        })
        setCheckInMessage(`Presença confirmada às ${formatTimeLabel(new Date(checkedAtIso))}.`)
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
  }, [isTeacher, lessonConfig, persistLessonSession, timeline.isWithinCheckInWindow, timeline.lessonSessionKey, user?.uid])

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
    await startActiveAlarm(kind)
  }, [canControlLesson, lessonConfig, persistLessonSession, startActiveAlarm, timeline.lessonSessionKey, user?.uid])

  const finalizeLessonNow = useCallback(async () => {
    if (!canControlLesson || !user?.uid) return null

    setIsFinalizing(true)
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
      setSession((current) => (current ? { ...current, ...finishPatch } : current))
      await stopActiveAlarm()

      const savedSession = await persistLessonSession(finishPatch)

      return savedSession
    } catch (error) {
      console.error('[LESSON CONTROL] Failed to finalize lesson:', error)
      setSession((current) => (
        current
          ? {
              ...current,
              endedAt: session?.endedAt || null,
              finishStatus: session?.finishStatus || current.finishStatus,
              finalizedByTeacherAt: session?.finalizedByTeacherAt || null,
              teacherConfirmedFinish: session?.teacherConfirmedFinish || false,
            }
          : current
      ))
      window.alert('NÃ£o foi possÃ­vel finalizar a aula agora. Verifique a conexÃ£o e tente novamente.')
      return null
    } finally {
      setIsFinalizing(false)
    }
  }, [canControlLesson, persistLessonSession, session, stopActiveAlarm, user?.uid])

  useEffect(() => {
    return () => {
      if (alarmLoopTimeoutRef.current) {
        window.clearTimeout(alarmLoopTimeoutRef.current)
      }
      if (navigator.vibrate) {
        navigator.vibrate(0)
      }
    }
  }, [])

  useEffect(() => {
    if (!canControlLesson || session?.endedAt) {
      if (activeAlarmKindRef.current) {
        stopActiveAlarm({ persistDismissal: false })
      }
      return
    }

    const shouldResumeEndingAlarm = timeline.isExpired && session?.endAlertTriggeredAt
    const shouldResumeWarningAlarm = timeline.isWarning && session?.warningTriggeredAt
    const nextAlarmKind = shouldResumeEndingAlarm ? 'ending' : shouldResumeWarningAlarm ? 'warning' : null

    if (nextAlarmKind && activeAlarmKindRef.current !== nextAlarmKind) {
      startActiveAlarm(nextAlarmKind)
    }
  }, [
    canControlLesson,
    session?.endAlertTriggeredAt,
    session?.endedAt,
    session?.warningTriggeredAt,
    startActiveAlarm,
    stopActiveAlarm,
    timeline.isExpired,
    timeline.isWarning,
  ])

  useEffect(() => {
    if (!isTeacher || !user?.uid || !timeline.isWithinCheckInWindow) return
    if (session?.presenceConfirmed) return

    const requestKey = getSessionStorageKey('gps-requested', timeline.lessonSessionKey)
    if (sessionStorage.getItem(requestKey)) return

    sessionStorage.setItem(requestKey, '1')
    requestGpsCheckIn({ automatic: true })
  }, [isTeacher, requestGpsCheckIn, session?.presenceConfirmed, timeline.isWithinCheckInWindow, timeline.lessonSessionKey, user?.uid])

  useEffect(() => {
    if (!canControlLesson || !user?.uid || !timeline.isLessonDay || !timeline.isWarning) return

    const alertKey = getSessionStorageKey('warning-fired', timeline.lessonSessionKey)
    if (sessionStorage.getItem(alertKey)) return

    sessionStorage.setItem(alertKey, '1')
    triggerLessonAlert('warning')
  }, [canControlLesson, timeline.isLessonDay, timeline.isWarning, timeline.lessonSessionKey, triggerLessonAlert, user?.uid])

  useEffect(() => {
    if (!canControlLesson || !user?.uid || !timeline.isLessonDay || !timeline.isExpired) return

    const alertKey = getSessionStorageKey('ending-fired', timeline.lessonSessionKey)
    if (sessionStorage.getItem(alertKey)) return

    sessionStorage.setItem(alertKey, '1')
    triggerLessonAlert('ending')
  }, [canControlLesson, timeline.isExpired, timeline.isLessonDay, timeline.lessonSessionKey, triggerLessonAlert, user?.uid])

  useEffect(() => {
    if (!canControlLesson || !user?.uid || !timeline.shouldShowFinalizePrompt) return
    if (session?.finishStatus === 'finished' || session?.endedAt) return
    if (session?.finishStatus === 'extrapolated') return

    persistLessonSession({
      finishStatus: 'extrapolated',
      extrapolatedAt: new Date().toISOString(),
      teacherConfirmedFinish: false,
    })
  }, [canControlLesson, persistLessonSession, session?.endedAt, session?.finishStatus, timeline.shouldShowFinalizePrompt, user?.uid])

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
      checkInMessage,
      lastDistanceMeters,
      formattedDistance: formatDistance(lastDistanceMeters),
      shouldShowFinalizePrompt: canControlLesson && timeline.shouldShowFinalizePrompt && !session?.endedAt,
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
    checkInMessage,
    finalizeLessonNow,
    isCheckingIn,
    isFinalizing,
    isLoadingSession,
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
