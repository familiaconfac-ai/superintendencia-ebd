import {
  addDoc,
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { IS_MOCK_MODE } from '../firebase/mockMode'

const STORAGE_KEY = 'ebd:latest-notice-broadcast'
const BROADCAST_COLLECTION = 'ebdNoticeBroadcasts'

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

export async function registerDeviceForFuturePush() {
  // Futuro FCM: persistir token do dispositivo aqui.
  return null
}
