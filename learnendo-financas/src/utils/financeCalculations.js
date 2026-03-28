function toNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function canonicalType(type) {
  return type === 'transfer_internal' ? 'transfer' : type
}

export function calculateMonthlySummary(transactions, debugTag = '') {
  const source = Array.isArray(transactions) ? transactions : []

  const receitas = source
    .filter((t) => t.type === 'income')
    .reduce((sum, t) => sum + toNumber(t.amount), 0)

  const despesas = source
    .filter((t) => t.type === 'expense' && t.balanceImpact !== false)
    .reduce((sum, t) => sum + toNumber(t.amount), 0)

  const investimentos = source
    .filter((t) => t.type === 'investment' && t.balanceImpact !== false)
    .reduce((sum, t) => sum + toNumber(t.amount), 0)

  const transferencias = source
    .filter((t) => canonicalType(t.type) === 'transfer')
    .reduce((sum, t) => sum + toNumber(t.amount), 0)

  const saldo = receitas - despesas - investimentos
  const pendingCount = source.filter(
    (t) => t.status === 'needs_review' || t.status === 'pending',
  ).length

  const recentTransactions = [...source].slice(0, 6)

  if (debugTag) {
    console.log(`[FinanceSummary:${debugTag}]`, {
      count: source.length,
      receitas,
      despesas,
      investimentos,
      transferencias,
      saldo,
      pendingCount,
    })
  }

  return {
    receitas,
    despesas,
    investimentos,
    transferencias,
    saldo,
    pendingCount,
    recentTransactions,
  }
}

export function buildBudgetSpentMap(transactions, debugTag = '') {
  const source = Array.isArray(transactions) ? transactions : []
  const spentByCategoryId = {}
  const spentByCategoryName = {}

  source.forEach((tx) => {
    if (!['income', 'expense', 'investment'].includes(tx.type)) return
    if (tx.balanceImpact === false) return

    const type = tx.type
    const amount = Math.abs(toNumber(tx.amount))
    if (!amount) return

    const byIdKey = `${type}::${tx.categoryId || '__none__'}`
    spentByCategoryId[byIdKey] = (spentByCategoryId[byIdKey] || 0) + amount

    const normalizedCategoryName = normalizeText(tx.categoryName)
    if (normalizedCategoryName) {
      const byNameKey = `${type}::${normalizedCategoryName}`
      spentByCategoryName[byNameKey] = (spentByCategoryName[byNameKey] || 0) + amount
    }
  })

  if (debugTag) {
    console.log(`[BudgetSpentMap:${debugTag}]`, {
      txCount: source.length,
      byIdKeys: Object.keys(spentByCategoryId).length,
      byNameKeys: Object.keys(spentByCategoryName).length,
    })
  }

  return { spentByCategoryId, spentByCategoryName }
}

export function normalizedCategoryName(value) {
  return normalizeText(value)
}