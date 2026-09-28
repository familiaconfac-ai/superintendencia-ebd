import {
  collection,
  doc,
  getDocs,
  collectionGroup,
  query,
  where,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { IS_MOCK_MODE } from '../firebase/mockMode'

const PREFIX = 'ebd-data'

function getStorageKey(uid, bucket) {
  return `${PREFIX}:${uid}:${bucket}`
}

function getBucketPath(uid, bucket) {
  return `users/${uid}/ebd_${bucket}`
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

function normalizeDoc(record, id, meta = {}) {
  return {
    ...record,
    id,
    storageOwnerUid: meta.storageOwnerUid || record.ownerUid || record.createdByUid || '',
    storagePath: meta.storagePath || '',
    createdAt: toIso(record.createdAt) ?? new Date().toISOString(),
    updatedAt: toIso(record.updatedAt) ?? new Date().toISOString(),
  }
}

function readLocal(uid, bucket) {
  const raw = localStorage.getItem(getStorageKey(uid, bucket))
  return raw ? JSON.parse(raw) : []
}

function writeLocal(uid, bucket, data) {
  localStorage.setItem(getStorageKey(uid, bucket), JSON.stringify(data))
}

function sortByUpdatedAtDesc(items) {
  return [...items].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
}

function mapQuerySnapshot(snapshot) {
  return snapshot.docs.map((item) => normalizeDoc(item.data(), item.id, {
    storageOwnerUid: item.ref.parent?.parent?.id || '',
    storagePath: item.ref.path,
  }))
}

function mergeDocumentsByPath(groups) {
  const documents = new Map()
  groups.flat().forEach((item) => {
    const key = item.storagePath || `${item.storageOwnerUid}:${item.id}`
    if (!documents.has(key)) documents.set(key, item)
  })
  return Array.from(documents.values())
}

async function listAttendanceDocuments(uid, access = {}) {
  const registers = collectionGroup(db, 'ebd_attendanceRegisters')
  if (access.isAdmin) return mapQuerySnapshot(await getDocs(registers))

  const email = String(access.email || '').trim().toLowerCase()
  const teacherId = String(access.teacherId || '').trim()
  const constraints = [
    ['ownerUid', uid],
    ['teacherAuthUid', uid],
    ['teacherUid', uid],
    ['teacherUserUid', uid],
    ...(teacherId ? [['teacherId', teacherId], ['defaultTeacherId', teacherId]] : []),
    ...(email ? [['teacherEmail', email], ['defaultTeacherEmail', email]] : []),
  ]
  const snapshots = await Promise.all(
    constraints.map(([field, value]) => getDocs(query(registers, where(field, '==', value)))),
  )
  return mergeDocumentsByPath(snapshots.map(mapQuerySnapshot))
}

export async function listEbdDocuments(uid, bucket, options = {}) {
  // Consulta local (mock)
  if (!uid) return []
  if (!isOnline()) {
    return sortByUpdatedAtDesc(readLocal(uid, bucket))
  }

  // Para attendanceRegisters, buscar TODAS as cadernetas de TODOS os usuários
  if (bucket === 'attendanceRegisters') {
    // Busca em todas as subcoleções users/*/ebd_attendanceRegisters
    return sortByUpdatedAtDesc(await listAttendanceDocuments(uid, options.access))
  }

  // Para outros buckets, mantém comportamento antigo
  const snap = await getDocs(collection(db, getBucketPath(uid, bucket)))
  const mapped = snap.docs.map((item) => normalizeDoc(item.data(), item.id))
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
    writeLocal(uid, bucket, list)
    return targetId
  }

  if (id) {
    await updateDoc(doc(db, getBucketPath(uid, bucket), id), {
      ...payload,
      updatedAt: serverTimestamp(),
    })
    return id
  }

  const ref = doc(collection(db, getBucketPath(uid, bucket)))
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
    writeLocal(uid, bucket, list)
    return
  }

  await deleteDoc(doc(db, getBucketPath(uid, bucket), id))
}
