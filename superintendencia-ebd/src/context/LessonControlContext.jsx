import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from './AuthContext'
import { publishLessonClosingWarning } from '../services/noticeCenterService'
import { getLessonSession, saveLessonSession } from '../services/lessonControlService'
import {
  LESSON_CONTROL_CONFIG,
  calculateDistanceMeters,
  formatDistance,
  formatTimeLabel,
  getLessonTimelineSnapshot,
} from '../utils/lessonControl'

const LessonControlContext = createContext(null)

const HOME_WARNING_MESSAGE = 'Check-in indisponivel. Voce precisa estar na igreja para registrar sua pontualidade.'
const GPS_REQUIRED_MESSAGE = 'Ative o GPS para registrar sua presenca na igreja.'

function getSessionStorageKey(type, dateKey) {
  return `ebd:lesson-control:${type}:${dateKey}`
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
      reject(new Error('Geolocalizacao indisponivel.'))
      return
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 0,
    })
  })
}

async function playLessonAlertTone() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext
  if (!AudioContextClass) return

  const context = new AudioContextClass()
  if (context.state === 'suspended') {
    await context.resume().catch(() => undefined)
  }

  const startAt = context.currentTime
  ;[0, 0.32].forEach((offset) => {
    const oscillator = context.createOscillator()
    const gain = context.createGain()

    oscillator.type = 'square'
    oscillator.frequency.setValueAtTime(880, startAt + offset)
    gain.gain.setValueAtTime(0.0001, startAt + offset)
    gain.gain.exponentialRampToValueAtTime(0.24, startAt + offset + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + offset + 0.2)

    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start(startAt + offset)
    oscillator.stop(startAt + offset + 0.22)
  })

  window.setTimeout(() => {
    context.close().catch(() => undefined)
  }, 900)
}

async function showLessonNotification(dateKey) {
  if (!('Notification' in window)) return false
  if (Notification.permission !== 'granted') return false

  const body = '\u26a0\ufe0f Faltam 10 minutos! Inicie a conclusao da aula.'
  const options = {
    body,
    tag: `lesson-warning-${dateKey}`,
    requireInteraction: true,
    vibrate: [250, 120, 250, 120, 350],
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
  const [timeline, setTimeline] = useState(() => getLessonTimelineSnapshot())
  const [session, setSession] = useState(null)
  const [isLoadingSession, setIsLoadingSession] = useState(false)
  const [isCheckingIn, setIsCheckingIn] = useState(false)
  const [isFinalizing, setIsFinalizing] = useState(false)
  const [checkInMessage, setCheckInMessage] = useState('')
  const [lastDistanceMeters, setLastDistanceMeters] = useState(null)
  const activeRequestRef = useRef(false)

  useEffect(() => {
    const updateClock = () => setTimeline(getLessonTimelineSnapshot())
    updateClock()

    const timer = window.setInterval(updateClock, 1000)
    return () => window.clearInterval(timer)
  }, [])

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
        const currentSession = await getLessonSession(user.uid, timeline.dateKey)
        if (!isMounted) return
        setSession(currentSession)
        setLastDistanceMeters(currentSession?.distanceMeters ?? null)
        setCheckInMessage(
          currentSession?.checkInStatus === 'outside_radius'
            ? HOME_WARNING_MESSAGE
            : currentSession?.checkInStatus === 'confirmed'
              ? `Presenca confirmada as ${formatTimeLabel(new Date(currentSession.checkInAt))}.`
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
  }, [isTeacher, timeline.dateKey, user?.uid])

  async function persistLessonSession(patch = {}) {
    if (!user?.uid || !isTeacher) return null

    const baseSession = session || {
      lessonDateKey: timeline.dateKey,
      lessonDateLabel: timeline.dateKey,
      warningTime: LESSON_CONTROL_CONFIG.lessonWarningTime,
      lessonEndTime: LESSON_CONTROL_CONFIG.lessonEndTime,
      churchLocation: LESSON_CONTROL_CONFIG.churchLocation,
      allowedRadiusMeters: LESSON_CONTROL_CONFIG.checkInRadiusMeters,
      ...teacherIdentity,
    }

    const nextSession = {
      ...baseSession,
      ...patch,
      lessonDateKey: timeline.dateKey,
      lessonDateLabel: timeline.dateKey,
      warningTime: LESSON_CONTROL_CONFIG.lessonWarningTime,
      lessonEndTime: LESSON_CONTROL_CONFIG.lessonEndTime,
      churchLocation: LESSON_CONTROL_CONFIG.churchLocation,
      allowedRadiusMeters: LESSON_CONTROL_CONFIG.checkInRadiusMeters,
      ...teacherIdentity,
    }

    const savedSession = await saveLessonSession(user.uid, timeline.dateKey, nextSession)
    setSession(savedSession)
    setLastDistanceMeters(savedSession?.distanceMeters ?? nextSession.distanceMeters ?? null)
    return savedSession
  }

  async function requestGpsCheckIn({ automatic = false } = {}) {
    if (!isTeacher || !user?.uid) return null
    if (!timeline.isWithinCheckInWindow) {
      setCheckInMessage('Check-in disponivel apenas aos domingos, entre 18:00 e 19:20.')
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
      const distanceMeters = calculateDistanceMeters(coords, LESSON_CONTROL_CONFIG.churchLocation)
      const isInsideChurchRadius = distanceMeters <= LESSON_CONTROL_CONFIG.checkInRadiusMeters
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
        setCheckInMessage(`Presenca confirmada as ${formatTimeLabel(new Date(checkedAtIso))}.`)
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

        const warningKey = getSessionStorageKey('home-warning', timeline.dateKey)
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

      const warningKey = getSessionStorageKey('gps-warning', timeline.dateKey)
      if (!automatic || !sessionStorage.getItem(warningKey)) {
        window.alert(GPS_REQUIRED_MESSAGE)
        sessionStorage.setItem(warningKey, '1')
      }

      return false
    } finally {
      activeRequestRef.current = false
      setIsCheckingIn(false)
    }
  }

  async function triggerClosingAlert() {
    if (!isTeacher || !user?.uid) return

    await persistLessonSession({
      warningTriggeredAt: new Date().toISOString(),
      warningTriggered: true,
    })

    await publishLessonClosingWarning(user.uid, 'automatic').catch(() => null)
    await playLessonAlertTone().catch(() => null)

    if (navigator.vibrate) {
      navigator.vibrate([250, 120, 250, 120, 350])
    }

    await showLessonNotification(timeline.dateKey)
  }

  async function finalizeLessonNow() {
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
  }

  useEffect(() => {
    if (!isTeacher || !user?.uid || !timeline.isWithinCheckInWindow) return
    if (session?.presenceConfirmed) return

    const requestKey = getSessionStorageKey('gps-requested', timeline.dateKey)
    if (sessionStorage.getItem(requestKey)) return

    sessionStorage.setItem(requestKey, '1')
    requestGpsCheckIn({ automatic: true })
  }, [isTeacher, requestGpsCheckIn, session?.presenceConfirmed, timeline.dateKey, timeline.isWithinCheckInWindow, user?.uid])

  useEffect(() => {
    if (!isTeacher || !user?.uid || !timeline.isSunday || !timeline.isWarning) return

    const alertKey = getSessionStorageKey('warning-fired', timeline.dateKey)
    if (sessionStorage.getItem(alertKey)) return

    sessionStorage.setItem(alertKey, '1')
    triggerClosingAlert()
  }, [isTeacher, timeline.dateKey, timeline.isSunday, timeline.isWarning, user?.uid])

  useEffect(() => {
    if (!isTeacher || !user?.uid || !timeline.shouldShowFinalizePrompt) return
    if (session?.finishStatus === 'finished' || session?.endedAt) return
    if (session?.finishStatus === 'extrapolated') return

    persistLessonSession({
      finishStatus: 'extrapolated',
      extrapolatedAt: new Date().toISOString(),
      teacherConfirmedFinish: false,
    })
  }, [isTeacher, session?.endedAt, session?.finishStatus, timeline.shouldShowFinalizePrompt, user?.uid])

  const contextValue = useMemo(() => {
    const status = session?.presenceConfirmed
      ? 'confirmed'
      : session?.checkInStatus === 'outside_radius'
        ? 'outside_radius'
        : session?.checkInStatus || 'pending'

    return {
      timeline,
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
      churchLocation: LESSON_CONTROL_CONFIG.churchLocation,
      checkInRadiusMeters: LESSON_CONTROL_CONFIG.checkInRadiusMeters,
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
