import {
  addDoc,
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { IS_MOCK_MODE } from '../firebase/mockMode'

const STORAGE_KEY = 'ebd:latest-notice-broadcast'
const PUSH_STORAGE_KEY = 'ebd:push-device-registration'
const BROADCAST_COLLECTION = 'ebdNoticeBroadcasts'
const PUSH_DEVICE_COLLECTION = 'ebdPushDevices'

export const LESSON_CLOSING_WARNING = {
  kind: 'lesson-closing-warning',
  title: 'Aviso de 10 minutos',
  message: '⚠️ Faltam 10 minutos para o encerramento! Organize sua conclusão.',
}

function normalizeBroadcast(record, id = '') {
  if (!record) return null

  return {
    id: id || record.id || '',
    kind: record.kind || '',
    title: record.title || '',
    message: record.message || '',
    triggerType: record.triggerType || 'manual',
    createdAtIso: record.createdAtIso || '',
    createdAtMs: Number(record.createdAtMs || 0),
    authorUid: record.authorUid || '',
  }
}

function readLocalBroadcast() {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null

  try {
    return normalizeBroadcast(JSON.parse(raw))
  } catch {
    return null
  }
}

function writeLocalBroadcast(payload) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
}

function readLocalPushRegistration() {
  const raw = localStorage.getItem(PUSH_STORAGE_KEY)
  if (!raw) return null

  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function writeLocalPushRegistration(payload) {
  localStorage.setItem(PUSH_STORAGE_KEY, JSON.stringify(payload))
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)

  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index)
  }

  return outputArray
}

export function getNotificationPermissionState() {
  if (!('Notification' in window)) return 'unsupported'
  return Notification.permission
}

export function getPushSupportSummary() {
  return {
    notificationsSupported: 'Notification' in window,
    serviceWorkerSupported: 'serviceWorker' in navigator,
    pushManagerSupported: 'PushManager' in window,
    vapidConfigured: Boolean(import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY),
    permission: getNotificationPermissionState(),
    savedRegistration: readLocalPushRegistration(),
  }
}

export async function requestNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported'
  return Notification.requestPermission()
}

export async function publishNoticeBroadcast(authorUid, payload = {}) {
  const createdAtMs = Date.now()
  const broadcast = normalizeBroadcast({
    ...payload,
    authorUid: authorUid || '',
    createdAtMs,
    createdAtIso: new Date(createdAtMs).toISOString(),
  })

  if (IS_MOCK_MODE || !db) {
    writeLocalBroadcast(broadcast)
    window.dispatchEvent(new CustomEvent('ebd:notice-broadcast', { detail: broadcast }))
    return broadcast
  }

  const ref = await addDoc(collection(db, BROADCAST_COLLECTION), {
    ...broadcast,
    createdAt: serverTimestamp(),
  })

  return {
    ...broadcast,
    id: ref.id,
  }
}

export function publishLessonClosingWarning(authorUid, triggerType = 'manual') {
  return publishNoticeBroadcast(authorUid, {
    ...LESSON_CLOSING_WARNING,
    triggerType,
  })
}

export function subscribeToLatestNoticeBroadcast(onChange) {
  if (IS_MOCK_MODE || !db) {
    onChange(readLocalBroadcast())

    function handleLocalEvent(event) {
      onChange(normalizeBroadcast(event.detail))
    }

    function handleStorage(event) {
      if (event.key !== STORAGE_KEY) return
      onChange(readLocalBroadcast())
    }

    window.addEventListener('ebd:notice-broadcast', handleLocalEvent)
    window.addEventListener('storage', handleStorage)

    return () => {
      window.removeEventListener('ebd:notice-broadcast', handleLocalEvent)
      window.removeEventListener('storage', handleStorage)
    }
  }

  const latestBroadcastQuery = query(
    collection(db, BROADCAST_COLLECTION),
    orderBy('createdAtMs', 'desc'),
    limit(1),
  )

  return onSnapshot(
    latestBroadcastQuery,
    (snap) => {
      const docSnap = snap.docs[0]
      onChange(docSnap ? normalizeBroadcast(docSnap.data(), docSnap.id) : null)
    },
    (error) => {
      console.warn('[noticeCenterService] Falha ao acompanhar avisos:', error)
      onChange(null)
    },
  )
}

export async function registerDeviceForFuturePush(userContext = {}) {
  const support = getPushSupportSummary()
  const basePayload = {
    uid: userContext?.uid || '',
    email: userContext?.email || '',
    displayName: userContext?.displayName || '',
    permission: support.permission,
    notificationsSupported: support.notificationsSupported,
    serviceWorkerSupported: support.serviceWorkerSupported,
    pushManagerSupported: support.pushManagerSupported,
    vapidConfigured: support.vapidConfigured,
    userAgent: navigator.userAgent,
    updatedAtIso: new Date().toISOString(),
  }

  if (!support.notificationsSupported || !support.serviceWorkerSupported) {
    writeLocalPushRegistration({
      ...basePayload,
      status: 'unsupported',
    })
    return {
      ...basePayload,
      status: 'unsupported',
    }
  }

  if (support.permission !== 'granted') {
    writeLocalPushRegistration({
      ...basePayload,
      status: 'permission_required',
    })
    return {
      ...basePayload,
      status: 'permission_required',
    }
  }

  if (!support.pushManagerSupported || !support.vapidConfigured) {
    const fallbackPayload = {
      ...basePayload,
      status: 'notification_only',
    }

    if (IS_MOCK_MODE || !db || !userContext?.uid) {
      writeLocalPushRegistration(fallbackPayload)
      return fallbackPayload
    }

    await setDoc(doc(db, PUSH_DEVICE_COLLECTION, userContext.uid), {
      ...fallbackPayload,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    }, { merge: true })

    writeLocalPushRegistration(fallbackPayload)
    return fallbackPayload
  }

  const registration = await navigator.serviceWorker.getRegistration()
  if (!registration) {
    const pendingPayload = {
      ...basePayload,
      status: 'service_worker_missing',
    }
    writeLocalPushRegistration(pendingPayload)
    return pendingPayload
  }

  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY),
    })
  }

  const subscriptionJson = subscription.toJSON()
  const pushPayload = {
    ...basePayload,
    status: 'push_ready',
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime || null,
    subscription: subscriptionJson,
  }

  if (IS_MOCK_MODE || !db || !userContext?.uid) {
    writeLocalPushRegistration(pushPayload)
    return pushPayload
  }

  const existingSnap = await getDoc(doc(db, PUSH_DEVICE_COLLECTION, userContext.uid))

  await setDoc(doc(db, PUSH_DEVICE_COLLECTION, userContext.uid), {
    ...pushPayload,
    updatedAt: serverTimestamp(),
    createdAt: existingSnap.exists() ? existingSnap.data()?.createdAt || serverTimestamp() : serverTimestamp(),
  }, { merge: true })

  writeLocalPushRegistration(pushPayload)
  return pushPayload
}
