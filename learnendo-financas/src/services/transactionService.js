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
    const ref = await addDoc(txCol(uid), {
      type:            data.type,
      description:     data.description,
      amount:          Number(data.amount),
      date:            data.date,
      competencyMonth: data.date.slice(0, 7),   // ex: "2026-03"
      categoryId:      isInternalTransfer ? null : (data.categoryId || null),
      accountId:       data.accountId   || null,
      toAccountId:     isInternalTransfer ? (data.toAccountId || null) : null,
      notes:           data.notes       || '',
      origin:          data.origin      || 'manual',
      status:          data.status      || 'confirmed',
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
    if (payload.amount !== undefined) payload.amount = Number(payload.amount)
    if (payload.date)                 payload.competencyMonth = payload.date.slice(0, 7)
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
        // Normaliza Timestamps do Firestore para strings ISO
        createdAt: raw.createdAt?.toDate?.().toISOString() ?? raw.createdAt ?? null,
        updatedAt: raw.updatedAt?.toDate?.().toISOString() ?? raw.updatedAt ?? null,
      }
    })
    console.log(`[TransactionService] ✅ Fetched ${docs.length} transactions from Firestore`)
    return docs
  } catch (err) {
    console.error('[TransactionService] ❌ Fetch failed:', err.code, err.message)
    throw err
  }
}
