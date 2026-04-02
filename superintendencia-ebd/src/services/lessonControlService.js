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

export async function getLessonSession(uid, sessionId) {
  if (!uid || !sessionId) return null

  if (IS_MOCK_MODE || !db) {
    return readLocalSessions(uid).find((item) => item.id === sessionId) || null
  }

  const snap = await getDoc(doc(db, getCollectionPath(uid), sessionId))
  return snap.exists()
    ? normalizeLessonSession(snap.data(), snap.id, { storageOwnerUid: uid })
    : null
}

export async function saveLessonSession(uid, sessionId, payload = {}) {
  if (!uid || !sessionId) throw new Error('Sessao de aula invalida.')

  const nowIso = new Date().toISOString()

  if (IS_MOCK_MODE || !db) {
    const sessions = readLocalSessions(uid)
    const current = sessions.find((item) => item.id === sessionId) || null
    const next = {
      ...current,
      ...payload,
      id: sessionId,
      storageOwnerUid: uid,
      createdAt: current?.createdAt || nowIso,
      updatedAt: nowIso,
    }

    const nextList = current
      ? sessions.map((item) => (item.id === sessionId ? next : item))
      : [...sessions, next]

    writeLocalSessions(uid, sortByUpdatedAtDesc(nextList))
    return next
  }

  await setDoc(doc(db, getCollectionPath(uid), sessionId), {
    ...payload,
    updatedAt: serverTimestamp(),
    createdAt: payload.createdAt ? payload.createdAt : serverTimestamp(),
  }, { merge: true })

  return getLessonSession(uid, sessionId)
}

export async function listLessonSessions(uid, { includeAll = false } = {}) {
  if (!uid) return []

  if (IS_MOCK_MODE || !db) {
    return sortByUpdatedAtDesc(readLocalSessions(uid))
  }

  if (includeAll) {
    const snap = await getDocs(query(collectionGroup(db, COLLECTION_NAME), orderBy('updatedAt', 'desc')))
    return snap.docs.map((item) => normalizeLessonSession(item.data(), item.id, {
      storageOwnerUid: item.ref.parent?.parent?.id || '',
    }))
  }

  const snap = await getDocs(query(collection(db, getCollectionPath(uid)), orderBy('updatedAt', 'desc')))
  return snap.docs.map((item) => normalizeLessonSession(item.data(), item.id, { storageOwnerUid: uid }))
}
