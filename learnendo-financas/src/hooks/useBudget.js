import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { fetchBudgets, addBudget, updateBudget, deleteBudget } from '../services/budgetService'
import { fetchTransactions } from '../services/transactionService'

/**
 * Hook para orçamento mensal do usuário.
 * Carrega itens de orçamento do Firestore e cruza com as transações do mês
 * para calcular o `spent` real de cada categoria.
 */
export function useBudget(year, month) {
  const { user } = useAuth()
  const [budgetItems, setBudgetItems] = useState([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)

  const reload = useCallback(async () => {
    if (!user?.uid) { setBudgetItems([]); setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      // Carrega orçamentos e transações do mês em paralelo
      const [rawBudgets, transactions] = await Promise.all([
        fetchBudgets(user.uid, year, month),
        fetchTransactions(user.uid, year, month),
      ])

      // Sum transactions by type+categoryId to calculate realizado per budget item
      const spentMap = {}
      transactions.forEach((t) => {
        if (!['expense', 'income', 'investment'].includes(t.type)) return
        const key = `${t.type}::${t.categoryId || '__none__'}`
        spentMap[key] = (spentMap[key] || 0) + Math.abs(Number(t.amount || 0))
      })

      const items = rawBudgets.map((b) => ({
        ...b,
        spent: spentMap[`${b.type || 'expense'}::${b.categoryId || '__none__'}`] || 0,
      }))
      setBudgetItems(items)
    } catch (err) {
      console.error('[useBudget] Error:', err.message)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [user?.uid, year, month])

  useEffect(() => { reload() }, [reload])

  async function add(data) {
    if (!user?.uid) throw new Error('Usuário não autenticado')
    const id = await addBudget(user.uid, data)
    await reload()
    return id
  }

  async function update(budgetId, data) {
    if (!user?.uid) throw new Error('Usuário não autenticado')
    await updateBudget(user.uid, budgetId, data)
    await reload()
  }

  async function remove(budgetId) {
    if (!user?.uid) throw new Error('Usuário não autenticado')
    await deleteBudget(user.uid, budgetId)
    await reload()
  }

  const totalBudgeted = budgetItems.reduce((s, b) => s + (b.plannedAmount || 0), 0)
  const totalSpent    = budgetItems.reduce((s, b) => s + (b.spent        || 0), 0)

  return { budgetItems, loading, error, reload, add, update, remove, totalBudgeted, totalSpent }
}
