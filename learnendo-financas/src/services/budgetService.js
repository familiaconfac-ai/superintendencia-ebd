/**
 * budgetService.js
 * CRUD real no Firestore para orçamentos por categoria.
 * Path: users/{uid}/budgets/{budgetId}
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

function budgetCol(uid) {
  return collection(db, 'users', uid, 'budgets')
}

export async function fetchBudgets(uid, year, month) {
  const monthStr = `${year}-${String(month).padStart(2, '0')}`
  console.log(`[BudgetService] 📥 Fetching users/${uid}/budgets where competencyMonth == ${monthStr}`)
  try {
    const q    = query(budgetCol(uid), where('competencyMonth', '==', monthStr))
    const snap = await getDocs(q)
    const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    console.log(`[BudgetService] ✅ Fetched ${docs.length} budgets`)
    return docs
  } catch (err) {
    console.error('[BudgetService] ❌ Fetch failed:', err.code, err.message)
    throw err
  }
}

export async function addBudget(uid, data) {
  console.log(`[BudgetService] ➕ Writing to users/${uid}/budgets`)
  try {
    const ref = await addDoc(budgetCol(uid), {
      categoryName:    data.categoryName,
      categoryId:      data.categoryId    || null,
      type:            data.type          || 'expense',
      plannedAmount:   Number(data.plannedAmount),
      competencyMonth: data.competencyMonth,
      createdAt:       serverTimestamp(),
      updatedAt:       serverTimestamp(),
    })
    console.log('[BudgetService] ✅ Write succeeded — Firestore id:', ref.id)
    return ref.id
  } catch (err) {
    console.error('[BudgetService] ❌ Write failed:', err.code, err.message)
    throw err
  }
}

export async function updateBudget(uid, budgetId, data) {
  console.log(`[BudgetService] ✏️ Updating users/${uid}/budgets/${budgetId}`)
  try {
    const payload = { ...data, updatedAt: serverTimestamp() }
    if (payload.plannedAmount !== undefined) payload.plannedAmount = Number(payload.plannedAmount)
    await updateDoc(doc(db, 'users', uid, 'budgets', budgetId), payload)
    console.log('[BudgetService] ✅ Update succeeded')
  } catch (err) {
    console.error('[BudgetService] ❌ Update failed:', err.code, err.message)
    throw err
  }
}

export async function deleteBudget(uid, budgetId) {
  console.log(`[BudgetService] 🗑️ Deleting users/${uid}/budgets/${budgetId}`)
  try {
    await deleteDoc(doc(db, 'users', uid, 'budgets', budgetId))
    console.log('[BudgetService] ✅ Delete succeeded')
  } catch (err) {
    console.error('[BudgetService] ❌ Delete failed:', err.code, err.message)
    throw err
  }
}

