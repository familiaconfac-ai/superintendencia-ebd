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

function getSessionStorageKey(type, lessonDateKey) {
  return `ebd:lesson-control:${type}:${lessonDateKey}`
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
  const AudioContextClass = window.AudioContext || window.webkitAudioContext
  if (!AudioContextClass) return

  const context = new AudioContextClass()
  if (context.state === 'suspended') {
    await context.resume().catch(() => undefined)
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

  window.setTimeout(() => {
    context.close().catch(() => undefined)
  }, kind === 'ending' ? 1400 : 900)
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

export function LessonControlProvider({ children }) {
  const { user, profile, role } = useAuth()
  const isTeacher = role === 'teacher'
  const [lessonConfig, setLessonConfig] = useState(() => buildLessonControlConfig(DEFAULT_COMMUNICATION_SETTINGS))
  const [timeline, setTimeline] = useState(() => getLessonTimelineSnapshot(new Date(), lessonConfig))
  const [session, setSession] = useState(null)
  const [isLoadingSession, setIsLoadingSession] = useState(false)
  const [isCheckingIn, setIsCheckingIn] = useState(false)
  const [isFinalizing, setIsFinalizing] = useState(false)
  const [checkInMessage, setCheckInMessage] = useState('')
  const [lastDistanceMeters, setLastDistanceMeters] = useState(null)
  const activeRequestRef = useRef(false)

  useEffect(() => {
    let isMounted = true

    async function loadSettings() {
      const settings = await getCommunicationSettings().catch(() => DEFAULT_COMMUNICATION_SETTINGS)
      if (!isMounted) return
      setLessonConfig(buildLessonControlConfig(settings))
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
      if (!user?.uid || !isTeacher) {
        if (isMounted) {
          setSession(null)
          setLastDistanceMeters(null)
          setCheckInMessage('')
        }
        return
      }

      setIsLoadingSession(true)
      try {
        const currentSession = await getLessonSession(user.uid, timeline.lessonDateKey)
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
      } finally {
        if (isMounted) setIsLoadingSession(false)
      }
    }

    loadSession()

    return () => {
      isMounted = false
    }
  }, [isTeacher, timeline.lessonDateKey, user?.uid])

  const persistLessonSession = useCallback(async (patch = {}) => {
    if (!user?.uid || !isTeacher) return null

    const baseSession = session || {
      lessonDateKey: timeline.lessonDateKey,
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

    const savedSession = await saveLessonSession(user.uid, timeline.lessonDateKey, nextSession)
    setSession(savedSession)
    setLastDistanceMeters(savedSession?.distanceMeters ?? nextSession.distanceMeters ?? null)
    return savedSession
  }, [isTeacher, lessonConfig, session, teacherIdentity, timeline.lessonDateKey, user?.uid])

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

        const warningKey = getSessionStorageKey('home-warning', timeline.lessonDateKey)
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

      const warningKey = getSessionStorageKey('gps-warning', timeline.lessonDateKey)
      if (!automatic || !sessionStorage.getItem(warningKey)) {
        window.alert(GPS_REQUIRED_MESSAGE)
        sessionStorage.setItem(warningKey, '1')
      }

      return false
    } finally {
      activeRequestRef.current = false
      setIsCheckingIn(false)
    }
  }, [isTeacher, lessonConfig, persistLessonSession, timeline.isWithinCheckInWindow, timeline.lessonDateKey, user?.uid])

  const triggerLessonAlert = useCallback(async (kind) => {
    if (!isTeacher || !user?.uid) return

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

    await playLessonAlertTone(kind).catch(() => null)
    if (navigator.vibrate) {
      navigator.vibrate(kind === 'ending' ? [300, 120, 300, 120, 400] : [250, 120, 250, 120, 350])
    }
    await showLessonNotification(timeline.lessonDateKey, kind, lessonConfig)
  }, [isTeacher, lessonConfig, persistLessonSession, timeline.lessonDateKey, user?.uid])

  const finalizeLessonNow = useCallback(async () => {
    if (!isTeacher || !user?.uid) return null

    setIsFinalizing(true)
    try {
      const finishedAtIso = new Date().toISOString()
      const nextStatus = session?.finishStatus === 'extrapolated' ? 'extrapolated' : 'finished'

      const savedSession = await persistLessonSession({
        finishStatus: nextStatus,
        endedAt: finishedAtIso,
        finalizedByTeacherAt: finishedAtIso,
        teacherConfirmedFinish: true,
      })

      return savedSession
    } finally {
      setIsFinalizing(false)
    }
  }, [isTeacher, persistLessonSession, session?.finishStatus, user?.uid])

  useEffect(() => {
    if (!isTeacher || !user?.uid || !timeline.isWithinCheckInWindow) return
    if (session?.presenceConfirmed) return

    const requestKey = getSessionStorageKey('gps-requested', timeline.lessonDateKey)
    if (sessionStorage.getItem(requestKey)) return

    sessionStorage.setItem(requestKey, '1')
    requestGpsCheckIn({ automatic: true })
  }, [isTeacher, requestGpsCheckIn, session?.presenceConfirmed, timeline.isWithinCheckInWindow, timeline.lessonDateKey, user?.uid])

  useEffect(() => {
    if (!isTeacher || !user?.uid || !timeline.isLessonDay || !timeline.isWarning) return

    const alertKey = getSessionStorageKey('warning-fired', timeline.lessonDateKey)
    if (sessionStorage.getItem(alertKey)) return

    sessionStorage.setItem(alertKey, '1')
    triggerLessonAlert('warning')
  }, [isTeacher, timeline.isLessonDay, timeline.isWarning, timeline.lessonDateKey, triggerLessonAlert, user?.uid])

  useEffect(() => {
    if (!isTeacher || !user?.uid || !timeline.isLessonDay || !timeline.isExpired) return

    const alertKey = getSessionStorageKey('ending-fired', timeline.lessonDateKey)
    if (sessionStorage.getItem(alertKey)) return

    sessionStorage.setItem(alertKey, '1')
    triggerLessonAlert('ending')
  }, [isTeacher, timeline.isExpired, timeline.isLessonDay, timeline.lessonDateKey, triggerLessonAlert, user?.uid])

  useEffect(() => {
    if (!isTeacher || !user?.uid || !timeline.shouldShowFinalizePrompt) return
    if (session?.finishStatus === 'finished' || session?.endedAt) return
    if (session?.finishStatus === 'extrapolated') return

    persistLessonSession({
      finishStatus: 'extrapolated',
      extrapolatedAt: new Date().toISOString(),
      teacherConfirmedFinish: false,
    })
  }, [isTeacher, persistLessonSession, session?.endedAt, session?.finishStatus, timeline.shouldShowFinalizePrompt, user?.uid])

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
      isLoadingSession,
      isCheckingIn,
      isFinalizing,
      checkInMessage,
      lastDistanceMeters,
      formattedDistance: formatDistance(lastDistanceMeters),
      shouldShowFinalizePrompt: isTeacher && timeline.shouldShowFinalizePrompt && !session?.endedAt,
      requestGpsCheckIn,
      finalizeLessonNow,
      status,
      churchLocation: lessonConfig.churchLocation,
      checkInRadiusMeters: lessonConfig.checkInRadiusMeters,
      homeWarningMessage: HOME_WARNING_MESSAGE,
    }
  }, [
    checkInMessage,
    finalizeLessonNow,
    isCheckingIn,
    isFinalizing,
    isLoadingSession,
    isTeacher,
    lastDistanceMeters,
    lessonConfig,
    requestGpsCheckIn,
    session,
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
