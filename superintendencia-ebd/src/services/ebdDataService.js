import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { IS_MOCK_MODE } from '../firebase/mockMode'

const PREFIX = 'ebd-data'
const SHARED_SCOPE = 'default'

function getLegacyStorageKey(uid, bucket) {
  return `${PREFIX}:${uid}:${bucket}`
}

function getSharedStorageKey(bucket) {
  return `${PREFIX}:shared:${SHARED_SCOPE}:${bucket}`
}

function getLegacyBucketPath(uid, bucket) {
  return `users/${uid}/ebd_${bucket}`
}

function getSharedBucketPath(bucket) {
  return `ebd_shared/${SHARED_SCOPE}/${bucket}`
}

function isOnline() {
  return !IS_MOCK_MODE && !!db
}

function toIso(value) {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value?.toDate === 'function') return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  return null
}

function normalizeDoc(record, id) {
  return {
    ...record,
    id,
    createdAt: toIso(record.createdAt) ?? new Date().toISOString(),
    updatedAt: toIso(record.updatedAt) ?? new Date().toISOString(),
  }
}

function serializeForShared(record) {
  return {
    ...record,
    createdAt: record.createdAt || new Date().toISOString(),
    updatedAt: record.updatedAt || new Date().toISOString(),
  }
}

function readLocal(uid, bucket) {
  const sharedRaw = localStorage.getItem(getSharedStorageKey(bucket))
  if (sharedRaw) return JSON.parse(sharedRaw)

  const legacyRaw = localStorage.getItem(getLegacyStorageKey(uid, bucket))
  if (!legacyRaw) return []

  const parsed = JSON.parse(legacyRaw)
  localStorage.setItem(getSharedStorageKey(bucket), legacyRaw)
  return parsed
}

function writeLocal(bucket, data) {
  localStorage.setItem(getSharedStorageKey(bucket), JSON.stringify(data))
}

function sortByUpdatedAtDesc(items) {
  return [...items].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
}

async function migrateLegacyBucketToShared(uid, bucket) {
  if (!uid || !isOnline()) return []

  const legacySnap = await getDocs(collection(db, getLegacyBucketPath(uid, bucket)))
  if (legacySnap.empty) return []

  const mapped = legacySnap.docs.map((item) => normalizeDoc(item.data(), item.id))
  await Promise.all(
    mapped.map((item) => (
      setDoc(
        doc(db, getSharedBucketPath(bucket), item.id),
        serializeForShared(item),
        { merge: true },
      )
    )),
  )

  writeLocal(bucket, mapped)
  return mapped
}

export async function listEbdDocuments(uid, bucket) {
  if (!uid) return []

  if (!isOnline()) {
    return sortByUpdatedAtDesc(readLocal(uid, bucket))
  }

  const sharedSnap = await getDocs(collection(db, getSharedBucketPath(bucket)))
  let mapped = sharedSnap.docs.map((item) => normalizeDoc(item.data(), item.id))

  if (mapped.length === 0) {
    mapped = await migrateLegacyBucketToShared(uid, bucket)
  }

  writeLocal(bucket, mapped)
  return sortByUpdatedAtDesc(mapped)
}

export async function saveEbdDocument(uid, bucket, payload, id = null) {
  if (!uid) throw new Error('Usuário não autenticado')

  if (!isOnline()) {
    const list = readLocal(uid, bucket)
    const now = new Date().toISOString()
    const targetId = id ?? payload.id ?? (globalThis.crypto?.randomUUID?.() || `${Date.now()}`)
    const base = {
      ...payload,
      id: targetId,
      createdAt: payload.createdAt ?? now,
      updatedAt: now,
    }
    const index = list.findIndex((item) => item.id === targetId)
    if (index >= 0) list[index] = { ...list[index], ...base, id: targetId, updatedAt: now }
    else list.push(base)
    writeLocal(bucket, list)
    return targetId
  }

  if (id) {
    await updateDoc(doc(db, getSharedBucketPath(bucket), id), {
      ...payload,
      updatedAt: serverTimestamp(),
    })
    return id
  }

  const ref = doc(collection(db, getSharedBucketPath(bucket)))
  await setDoc(ref, {
    ...payload,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return ref.id
}

export async function softToggleEbdDocument(uid, bucket, id, active) {
  return saveEbdDocument(uid, bucket, { active }, id)
}

export async function removeEbdDocument(uid, bucket, id) {
  if (!uid || !id) return

  if (!isOnline()) {
    const list = readLocal(uid, bucket).filter((item) => item.id !== id)
    writeLocal(bucket, list)
    return
  }

  await deleteDoc(doc(db, getSharedBucketPath(bucket), id))
}
