import { useMemo } from 'react'
import { useTransactions } from './useTransactions'
import { MOCK_BUDGET } from '../utils/mockData'

/**
 * Hook que calcula o resumo financeiro do Dashboard a partir de dados reais do Firestore.
 * Campos que ainda não têm backend (orçamento, reconciliação, cartões) usam mock temporariamente.
 *
 * Tipos de transação e como afetam o saldo:
 *   income            → receita  (+saldo)
 *   expense           → despesa  (-saldo)
 *   investment        → investimento (-saldo)
 *   transfer_internal → transferência entre contas próprias (neutro — não afeta saldo)
 *   transfer          → transferência legada/importada (tratada como despesa se balanceImpact=true)
 */
export function useDashboard(year, month) {
  const { transactions, loading, error, reload } = useTransactions(year, month)

  const summary = useMemo(() => {
    const sum = (type) =>
      transactions
        .filter((t) => t.type === type)
        .reduce((acc, t) => acc + Number(t.amount ?? 0), 0)

    const receitas       = sum('income')
    const despesas       = sum('expense')
    const investimentos  = sum('investment')
    // transfer_internal = neutral (same-owner moves, not counted in saldo)
    const transferencias_internas  = sum('transfer_internal')
    // legacy imported 'transfer' — only counted when balanceImpact flag is true
    const transferencias_legadas   = transactions
      .filter((t) => t.type === 'transfer' && t.balanceImpact)
      .reduce((acc, t) => acc + Number(t.amount ?? 0), 0)

    const saldo = receitas - despesas - investimentos

    console.log('[useDashboard] 📊 Summary:', {
      receitas, despesas, investimentos,
      transferencias_internas, transferencias_legadas, saldo,
    })

    const pendingCount = transactions.filter(
      (t) => t.status === 'needs_review' || t.status === 'pending',
    ).length

    const recentTransactions = [...transactions].slice(0, 6)

    return {
      scope:               'personal',
      ownerName:           '',              // preenchido em Dashboard.jsx via profile
      receitas,
      despesas,
      investimentos,
      transferencias: transferencias_internas,
      saldo,
      orcado:              MOCK_BUDGET.totalBudgeted,  // TODO: mover para Firestore
      pendingCount,
      reconciled:          false,           // TODO: conectar reconciliação
      reconciliationDiff:  0,
      recentTransactions,
    }
  }, [transactions])

  return { summary, transactions, loading, error, reload }
}
