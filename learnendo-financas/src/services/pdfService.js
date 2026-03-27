import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatCurrency } from '../utils/formatCurrency'

const MONTH_NAMES = [
  'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro',
]

/**
 * Gera PDF do relatório mensal.
 * @param {Object} params
 * @param {Object} params.summary  - dados de resumo do mês
 * @param {Object} params.budget   - dados de orçamento
 * @param {number} [params.month]  - mês (1–12)
 * @param {number} [params.year]
 * @param {boolean} [params.isAdmin]
 * @param {Array}  [params.users]  - lista de usuários (admin)
 */
export async function generateMonthlyPDF({ summary, budget, month, year, isAdmin = false, users = [] }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const now = new Date()
  const m = month ?? now.getMonth() + 1
  const y = year  ?? now.getFullYear()

  const primaryColor = [26, 86, 219]   // #1a56db
  const successColor = [22, 163, 74]   // green-600
  const dangerColor  = [220, 38, 38]   // red-600

  // ── Cabeçalho ──────────────────────────────────────────────────────────────
  doc.setFillColor(...primaryColor)
  doc.rect(0, 0, 210, 28, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text('Learnendo Finanças', 14, 11)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(
    isAdmin
      ? `Relatório Consolidado – ${MONTH_NAMES[m - 1]} ${y}`
      : `Relatório Mensal – ${MONTH_NAMES[m - 1]} ${y}`,
    14, 19
  )
  doc.text(`Gerado em: ${now.toLocaleDateString('pt-BR')}`, 14, 24)

  let cursor = 36

  if (!isAdmin && summary) {
    // ── Resumo financeiro ────────────────────────────────────────────────────
    doc.setTextColor(0, 0, 0)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text('Resumo do Mês', 14, cursor)
    cursor += 6

    autoTable(doc, {
      startY: cursor,
      head: [['Item', 'Valor']],
      body: [
        ['Receitas',     formatCurrency(summary.receitas)],
        ['Despesas',     formatCurrency(summary.despesas)],
        ['Investimentos',formatCurrency(summary.investimentos)],
        ['Saldo',        formatCurrency(summary.saldo)],
      ],
      headStyles: { fillColor: primaryColor },
      bodyStyles: { fontSize: 10 },
      margin: { left: 14 },
    })
    cursor = doc.lastAutoTable.finalY + 8
  }

  if (!isAdmin && budget) {
    // ── Orçado x Realizado ───────────────────────────────────────────────────
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text('Orçado x Realizado por Categoria', 14, cursor)
    cursor += 6

    autoTable(doc, {
      startY: cursor,
      head: [['Categoria', 'Orçado', 'Realizado', 'Diferença']],
      body: budget.categories.map((c) => [
        c.name,
        formatCurrency(c.budgeted),
        formatCurrency(c.spent),
        formatCurrency(c.budgeted - c.spent),
      ]),
      headStyles: { fillColor: primaryColor },
      bodyStyles: { fontSize: 9 },
      margin: { left: 14 },
    })
    cursor = doc.lastAutoTable.finalY + 8
  }

  if (isAdmin && users.length > 0) {
    // ── Relatório admin consolidado ──────────────────────────────────────────
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text('Usuários – Resumo Mensal', 14, cursor)
    cursor += 6

    autoTable(doc, {
      startY: cursor,
      head: [['Usuário', 'E-mail', 'Receitas', 'Despesas', 'Saldo']],
      body: users.map((u) => [
        u.displayName,
        u.email,
        formatCurrency(u.monthlyReceitas),
        formatCurrency(u.monthlyDespesas),
        formatCurrency(u.monthlyReceitas - u.monthlyDespesas),
      ]),
      headStyles: { fillColor: primaryColor },
      bodyStyles: { fontSize: 9 },
      margin: { left: 14 },
    })
  }

  // ── Rodapé ─────────────────────────────────────────────────────────────────
  const pageCount = doc.internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(160, 160, 160)
    doc.text(
      `Learnendo Finanças  |  Página ${i} de ${pageCount}`,
      105,
      doc.internal.pageSize.height - 8,
      { align: 'center' }
    )
  }

  const fileName = isAdmin
    ? `learnendo-financas-admin-${y}-${String(m).padStart(2, '0')}.pdf`
    : `learnendo-financas-${y}-${String(m).padStart(2, '0')}.pdf`

  doc.save(fileName)
}
