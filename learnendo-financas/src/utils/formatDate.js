/**
 * Formata uma string ISO ou Date para dd/mm/yyyy.
 * @param {string|Date} value
 * @returns {string}
 */
export function formatDateBR(value) {
  if (!value) return '—'
  const date = typeof value === 'string' ? new Date(value) : value
  return date.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

/**
 * Retorna "Março 2026" a partir de mês (1-12) e ano.
 */
export function formatMonthLabel(month, year) {
  return new Date(year, month - 1, 1).toLocaleString('pt-BR', { month: 'long', year: 'numeric' })
}
