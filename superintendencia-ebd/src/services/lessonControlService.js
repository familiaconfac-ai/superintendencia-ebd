import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { IS_MOCK_MODE } from '../firebase/mockMode'

const STORAGE_KEY_PREFIX = 'ebd:lesson-sessions'
const COLLECTION_NAME = 'ebd_lessonSessions'

function getStorageKey(uid) {
  return `${STORAGE_KEY_PREFIX}:${uid}`
}

function getCollectionPath(uid) {
  return `users/${uid}/${COLLECTION_NAME}`
}

function toIso(value) {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value?.toDate === 'function') return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  return null
}

function normalizeLessonSession(record, id, meta = {}) {
  if (!record) return null

  return {
    ...record,
    id: id || record.id || '',
    storageOwnerUid: meta.storageOwnerUid || record.storageOwnerUid || record.ownerUid || record.teacherUid || '',
    createdAt: toIso(record.createdAt) ?? new Date().toISOString(),
    updatedAt: toIso(record.updatedAt) ?? new Date().toISOString(),
  }
}

function readLocalSessions(uid) {
  const raw = localStorage.getItem(getStorageKey(uid))
  if (!raw) return []

  try {
    return JSON.parse(raw)
  } catch {
    return []
  }
}

function writeLocalSessions(uid, sessions) {
  localStorage.setItem(getStorageKey(uid), JSON.stringify(sessions))
}

function sortByUpdatedAtDesc(items = []) {
  return [...items].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
}

function upsertLocalSession(uid, sessionId, payload = {}, { syncPending = false } = {}) {
  const nowIso = new Date().toISOString()
  const sessions = readLocalSessions(uid)
  const current = sessions.find((item) => item.id === sessionId) || null

  const next = normalizeLessonSession({
    ...current,
    ...payload,
    id: sessionId,
    storageOwnerUid: uid,
    createdAt: current?.createdAt || nowIso,
    updatedAt: nowIso,
    syncPending,
  }, sessionId, { storageOwnerUid: uid })

  const nextList = current
    ? sessions.map((item) => (item.id === sessionId ? next : item))
    : [...sessions, next]

  writeLocalSessions(uid, sortByUpdatedAtDesc(nextList))
  return next
}

async function syncLessonSessionToRemote(uid, sessionId, payload = {}) {
  try {
    await setDoc(doc(db, getCollectionPath(uid), sessionId), {
      ...payload,
      syncPending: false,
      updatedAt: serverTimestamp(),
      createdAt: payload.createdAt ? payload.createdAt : serverTimestamp(),
    }, { merge: true })

    const synced = await getLessonSession(uid, sessionId)
    if (synced) {
      upsertLocalSession(uid, sessionId, synced, { syncPending: false })
    }
  } catch (error) {
    console.warn('[lessonControlService] Falha ao sincronizar sessão remotamente:', error)
    upsertLocalSession(uid, sessionId, payload, { syncPending: true })
  }
}

export async function getLessonSession(uid, sessionId) {
  if (!uid || !sessionId) return null

  const localSession = readLocalSessions(uid).find((item) => item.id === sessionId) || null

  if (IS_MOCK_MODE || !db) {
    return localSession
  }

  try {
    const snap = await getDoc(doc(db, getCollectionPath(uid), sessionId))
    if (!snap.exists()) return localSession

    const remoteSession = normalizeLessonSession(snap.data(), snap.id, { storageOwnerUid: uid })
    upsertLocalSession(uid, sessionId, remoteSession, { syncPending: false })
    return remoteSession
  } catch (error) {
    console.warn('[lessonControlService] Falha ao carregar sessão remota, usando cache local:', error)
    return localSession
  }
}

export async function saveLessonSession(uid, sessionId, payload = {}) {
  if (!uid || !sessionId) throw new Error('Sessão de aula inválida.')

  const localSession = upsertLocalSession(uid, sessionId, payload, {
    syncPending: !IS_MOCK_MODE && Boolean(db),
  })

  if (IS_MOCK_MODE || !db) {
    return localSession
  }

  void syncLessonSessionToRemote(uid, sessionId, payload)
  return localSession
}

export async function listLessonSessions(uid, { includeAll = false } = {}) {
  if (!uid) return []

  if (IS_MOCK_MODE || !db) {
    return sortByUpdatedAtDesc(readLocalSessions(uid))
  }

  if (includeAll) {
    try {
      const snap = await getDocs(query(collectionGroup(db, COLLECTION_NAME), orderBy('updatedAt', 'desc')))
      return snap.docs.map((item) => normalizeLessonSession(item.data(), item.id, {
        storageOwnerUid: item.ref.parent?.parent?.id || '',
      }))
    } catch (error) {
      console.warn('[lessonControlService] Falha ao listar sessões globais:', error)
      return sortByUpdatedAtDesc(readLocalSessions(uid))
    }
  }

  try {
    const snap = await getDocs(query(collection(db, getCollectionPath(uid)), orderBy('updatedAt', 'desc')))
    const remoteSessions = snap.docs.map((item) => normalizeLessonSession(item.data(), item.id, { storageOwnerUid: uid }))
    writeLocalSessions(uid, sortByUpdatedAtDesc(remoteSessions))
    return remoteSessions
  } catch (error) {
    console.warn('[lessonControlService] Falha ao listar sessões remotas, usando cache local:', error)
    return sortByUpdatedAtDesc(readLocalSessions(uid))
  }
}
