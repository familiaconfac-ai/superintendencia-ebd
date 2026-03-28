import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { fetchBudgets, addBudget, updateBudget, deleteBudget } from '../services/budgetService'
import { fetchTransactions } from '../services/transactionService'
import { buildBudgetSpentMap, normalizedCategoryName } from '../utils/financeCalculations'

/**
 * Hook para orçamento mensal do usuário.
 * Carrega itens de orçamento do Firestore e cruza com as transações do mês
 * para calcular o `spent` real de cada categoria.
 */
export function useBudget(year, month) {
  const { user } = useAuth()
  const { activeWorkspaceId, permissions, myRole } = useWorkspace()
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
        fetchBudgets(user.uid, year, month, { workspaceId: activeWorkspaceId }),
        fetchTransactions(user.uid, year, month, {
          workspaceId: activeWorkspaceId,
          viewerRole: myRole,
          viewerUid: user.uid,
        }),
      ])

      const { spentByCategoryId, spentByCategoryName } = buildBudgetSpentMap(transactions, 'useBudget')

      const items = rawBudgets.map((b) => ({
        ...b,
        spent:
          spentByCategoryId[`${b.type || 'expense'}::${b.categoryId || '__none__'}`] ||
          spentByCategoryName[`${b.type || 'expense'}::${normalizedCategoryName(b.categoryName)}`] ||
          0,
      }))

      console.log('[useBudget] Diagnostics:', {
        budgets: rawBudgets.length,
        transactions: transactions.length,
        matchedById: items.filter((i) => i.spent > 0 && i.categoryId).length,
      })
      setBudgetItems(items)
    } catch (err) {
      console.error('[useBudget] Error:', err.message)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [user?.uid, year, month, activeWorkspaceId, myRole])

  useEffect(() => { reload() }, [reload])

  async function add(data) {
    if (!user?.uid) throw new Error('Usuário não autenticado')
    if (!permissions.canEditBudget) throw new Error('Seu papel não permite alterar orçamento neste workspace')
    const id = await addBudget(user.uid, { ...data, workspaceId: activeWorkspaceId }, { workspaceId: activeWorkspaceId })
    await reload()
    return id
  }

  async function update(budgetId, data) {
    if (!user?.uid) throw new Error('Usuário não autenticado')
    if (!permissions.canEditBudget) throw new Error('Seu papel não permite alterar orçamento neste workspace')
    await updateBudget(user.uid, budgetId, { ...data, workspaceId: activeWorkspaceId }, { workspaceId: activeWorkspaceId })
    await reload()
  }

  async function remove(budgetId) {
    if (!user?.uid) throw new Error('Usuário não autenticado')
    if (!permissions.canEditBudget) throw new Error('Seu papel não permite alterar orçamento neste workspace')
    await deleteBudget(user.uid, budgetId, { workspaceId: activeWorkspaceId })
    await reload()
  }

  const totalBudgeted = budgetItems.reduce((s, b) => s + (b.plannedAmount || 0), 0)
  const totalSpent    = budgetItems.reduce((s, b) => s + (b.spent        || 0), 0)

  return { budgetItems, loading, error, reload, add, update, remove, totalBudgeted, totalSpent }
}
