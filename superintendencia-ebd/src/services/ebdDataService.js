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

function normalizeDoc(record, id) {
  return {
    ...record,
    id,
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

export async function listEbdDocuments(uid, bucket) {
  if (!uid) return []

  if (!isOnline()) {
    return sortByUpdatedAtDesc(readLocal(uid, bucket))
  }

  const snap = await getDocs(collection(db, getBucketPath(uid, bucket)))
  const mapped = snap.docs.map((item) => normalizeDoc(item.data(), item.id))
  return sortByUpdatedAtDesc(mapped)
}

export async function saveEbdDocument(uid, bucket, payload, id = null) {
  if (!uid) throw new Error('Usuário não autenticado')

  console.log('🔐 [ebdDataService] saveEbdDocument iniciado')
  console.log('🔐 [ebdDataService] UID do usuário:', uid)
  console.log('🔐 [ebdDataService] Bucket:', bucket)
  console.log('🔐 [ebdDataService] Collection path:', getBucketPath(uid, bucket))
  console.log('🔐 [ebdDataService] Operação:', id ? 'UPDATE' : 'INSERT')

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
    console.log('🔐 [ebdDataService] Atualizando documento ID:', id)
    try {
      await updateDoc(doc(db, getBucketPath(uid, bucket), id), {
        ...payload,
        updatedAt: serverTimestamp(),
      })
      console.log('✅ [ebdDataService] Documento atualizado com sucesso')
      return id
    } catch (error) {
      console.error('❌ [ebdDataService] ERRO ao atualizar:', error.code, error.message)
      throw error
    }
  }

  console.log('🔐 [ebdDataService] Criando novo documento')
  const ref = doc(collection(db, getBucketPath(uid, bucket)))
  console.log('🔐 [ebdDataService] Doc ref ID:', ref.id)
  
  try {
    await setDoc(ref, {
      ...payload,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    console.log('✅ [ebdDataService] Documento criado com sucesso. ID:', ref.id)
    return ref.id
  } catch (error) {
    console.error('❌ [ebdDataService] ERRO ao criar documento:', error.code, error.message)
    console.error('❌ [ebdDataService] Detalhes completos do erro:', error)
    throw error
  }
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
