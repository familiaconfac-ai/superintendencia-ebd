import { useState } from 'react'
import MonthSelector from '../../components/ui/MonthSelector'
import Card, { CardHeader } from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import { formatCurrency } from '../../utils/formatCurrency'
import { MOCK_SUMMARY, MOCK_BUDGET } from '../../utils/mockData'
import { generateMonthlyPDF } from '../../services/pdfService'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import './Relatorios.css'

const REPORT_TYPES = ['Mensal', 'Por Categoria', 'Orçado x Realizado']

export default function Relatorios() {
  const [activeReport, setActiveReport] = useState('Mensal')
  const [loadingPDF, setLoadingPDF] = useState(false)

  // TODO: usar hooks reais
  const summary = MOCK_SUMMARY
  const budget = MOCK_BUDGET

  const barData = budget.categories.map((c) => ({
    name: c.name.length > 10 ? c.name.slice(0, 10) + '…' : c.name,
    Orçado: c.budgeted,
    Realizado: c.spent,
  }))

  async function handleExportPDF() {
    setLoadingPDF(true)
    try {
      await generateMonthlyPDF({ summary, budget })
    } finally {
      setLoadingPDF(false)
    }
  }

  return (
    <div className="relatorios-page">
      <MonthSelector />

      {/* Tabs */}
      <div className="report-tabs">
        {REPORT_TYPES.map((r) => (
          <button
            key={r}
            className={`report-tab${activeReport === r ? ' active' : ''}`}
            onClick={() => setActiveReport(r)}
          >
            {r}
          </button>
        ))}
      </div>

      <div className="relatorios-content">
        {activeReport === 'Mensal' && (
          <Card>
            <CardHeader title="Resumo mensal" />
            <div className="report-row"><span>Receitas</span><strong className="text-success">{formatCurrency(summary.receitas)}</strong></div>
            <div className="report-row"><span>Despesas</span><strong className="text-danger">{formatCurrency(summary.despesas)}</strong></div>
            <div className="report-row"><span>Investimentos</span><strong className="text-warning">{formatCurrency(summary.investimentos)}</strong></div>
            <div className="report-row report-row--total">
              <span>Saldo final</span>
              <strong className={summary.saldo >= 0 ? 'text-success' : 'text-danger'}>
                {formatCurrency(summary.saldo)}
              </strong>
            </div>
          </Card>
        )}

        {activeReport === 'Por Categoria' && (
          <Card>
            <CardHeader title="Gastos por categoria" />
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={barData} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v) => formatCurrency(v)} />
                <Bar dataKey="Realizado" fill="#1a56db" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        )}

        {activeReport === 'Orçado x Realizado' && (
          <Card>
            <CardHeader title="Orçado x Realizado" />
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={barData} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v) => formatCurrency(v)} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Orçado"    fill="#93c5fd" radius={[4,4,0,0]} />
                <Bar dataKey="Realizado" fill="#1a56db" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        )}

        <Button variant="secondary" fullWidth loading={loadingPDF} onClick={handleExportPDF}>
          📄 Exportar PDF
        </Button>
      </div>
    </div>
  )
}
