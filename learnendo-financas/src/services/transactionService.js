/**
 * transactionService.js
 * CRUD real no Firestore para transações do usuário.
 * Path: users/{uid}/transactions/{transactionId}
 */
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDocs,
  query,
  where,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase/config'

function normalizeStatus(status) {
  if (status === 'confirmed') return 'confirmed'
  if (status === 'needs_review') return 'pending'
  if (status === 'pending') return 'pending'
  return 'confirmed'
}

function monthKeyFromDate(date) {
  return String(date || '').slice(0, 7)
}

function normalizeOrigin(origin) {
  if (!origin) return 'manual'
  if (origin === 'recurring_auto') return 'recurring_auto'
  return origin
}

// Referência para a subcoleção de transações do usuário
function txCol(uid) {
  return collection(db, 'users', uid, 'transactions')
}

/** Adiciona uma nova transação no Firestore */
export async function addTransaction(uid, data) {
  const path = `users/${uid}/transactions`
  const isInternalTransfer = data.type === 'transfer_internal'
  console.log('[TransactionService] ➕ Writing to:', path)
  console.log('[TransactionService] Payload:', {
    ...data,
    amount: Number(data.amount),
    isInternalTransfer,
  })
  try {
    const normalizedCategoryName = typeof data.categoryName === 'string' ? data.categoryName.trim() : ''
    const normalizedStatus = normalizeStatus(data.status)
    const ref = await addDoc(txCol(uid), {
      type:            data.type,
      description:     data.description,
      amount:          Number(data.amount),
      date:            data.date,
      competencyMonth: data.date.slice(0, 7),   // ex: "2026-03"
      categoryId:      isInternalTransfer ? null : (data.categoryId || null),
      categoryName:    isInternalTransfer ? null : (normalizedCategoryName || null),
      accountId:       data.accountId   || null,
      toAccountId:     isInternalTransfer ? (data.toAccountId || null) : null,
      notes:           data.notes       || '',
      origin:          normalizeOrigin(data.origin),
      status:          normalizedStatus,
      ...(data.recurringId          ? { recurringId:          data.recurringId } : {}),
      ...(data.recurringType        ? { recurringType:        data.recurringType } : {}),
      ...(data.recurringInstanceMonth ? { recurringInstanceMonth: data.recurringInstanceMonth } : {}),
      ...(Number.isFinite(Number(data.installmentNumber))
        ? { installmentNumber: Number(data.installmentNumber) }
        : {}),
      // Internal transfers don't affect expense totals — they are neutral moves
      balanceImpact:   !isInternalTransfer,
      // Import metadata (only present when origin === 'bank_import')
      ...(data.importBatchId            ? { importBatchId:             data.importBatchId }            : {}),
      ...(data.classificationConfidence ? { classificationConfidence:  data.classificationConfidence } : {}),
      createdAt:       serverTimestamp(),
      updatedAt:       serverTimestamp(),
    })
    if (isInternalTransfer) {
      console.log('[TransactionService] 🔄 Internal transfer saved — balanceImpact: false, toAccountId:', data.toAccountId ?? '(none)')
    }
    console.log('[TransactionService] ✅ Write succeeded — Firestore id:', ref.id)
    return ref.id
  } catch (err) {
    console.error('[TransactionService] ❌ Write failed:', err.code, err.message)
    throw err
  }
}

/** Atualiza campos de uma transação existente */
export async function updateTransaction(uid, txId, data) {
  const path = `users/${uid}/transactions/${txId}`
  console.log('[TransactionService] ✏️ Updating:', path)
  try {
    const payload = { ...data, updatedAt: serverTimestamp() }
    const isInternalTransfer = payload.type === 'transfer_internal'
    if (payload.amount !== undefined) payload.amount = Number(payload.amount)
    if (payload.date)                 payload.competencyMonth = payload.date.slice(0, 7)
    if (payload.categoryName !== undefined) {
      payload.categoryName = typeof payload.categoryName === 'string'
        ? (payload.categoryName.trim() || null)
        : null
    }
    if (payload.status !== undefined) {
      payload.status = normalizeStatus(payload.status)
    }
    if (isInternalTransfer) {
      payload.categoryId = null
      payload.categoryName = null
      payload.balanceImpact = false
    }
    await updateDoc(doc(db, 'users', uid, 'transactions', txId), payload)
    console.log('[TransactionService] ✅ Update succeeded')
  } catch (err) {
    console.error('[TransactionService] ❌ Update failed:', err.code, err.message)
    throw err
  }
}

/** Remove uma transação do Firestore */
export async function deleteTransaction(uid, txId) {
  const path = `users/${uid}/transactions/${txId}`
  console.log('[TransactionService] 🗑️ Deleting:', path)
  try {
    await deleteDoc(doc(db, 'users', uid, 'transactions', txId))
    console.log('[TransactionService] ✅ Delete succeeded')
  } catch (err) {
    console.error('[TransactionService] ❌ Delete failed:', err.code, err.message)
    throw err
  }
}

/**
 * Busca todas as transações de um mês/ano para o usuário.
 * Filtra pelo campo `competencyMonth` (ex: "2026-03").
 * Ordenação feita no cliente para evitar índice composto no Firestore.
 */
export async function fetchTransactions(uid, year, month) {
  return fetchTransactionsWithOptions(uid, year, month)
}

export async function fetchTransactionsWithOptions(uid, year, month, options = {}) {
  const monthStr = `${year}-${String(month).padStart(2, '0')}`
  const path     = `users/${uid}/transactions`
  console.log(`[TransactionService] 📥 Fetching ${path} where competencyMonth == ${monthStr}`)
  try {
    const q    = query(txCol(uid), where('competencyMonth', '==', monthStr))
    const snap = await getDocs(q)
    const docs = snap.docs.map((d) => {
      const raw = d.data()
      return {
        id: d.id,
        ...raw,
        origin: normalizeOrigin(raw.origin),
        status: normalizeStatus(raw.status),
        recurringInstanceMonth: raw.recurringInstanceMonth || monthKeyFromDate(raw.date),
        // Normaliza Timestamps do Firestore para strings ISO
        createdAt: raw.createdAt?.toDate?.().toISOString() ?? raw.createdAt ?? null,
        updatedAt: raw.updatedAt?.toDate?.().toISOString() ?? raw.updatedAt ?? null,
      }
    })
    const includeRecurringAuto = options.includeRecurringAuto !== false
    const filtered = includeRecurringAuto
      ? docs
      : docs.filter((tx) => tx.origin !== 'recurring_auto')
    console.log(`[TransactionService] ✅ Fetched ${filtered.length} transactions from Firestore`)
    return filtered
  } catch (err) {
    console.error('[TransactionService] ❌ Fetch failed:', err.code, err.message)
    throw err
  }
}
