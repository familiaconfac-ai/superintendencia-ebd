import { useState } from 'react'
import MonthSelector from '../../components/ui/MonthSelector'
import Card, { CardHeader } from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import { useFinance } from '../../context/FinanceContext'
import { useBudget } from '../../hooks/useBudget'
import { formatCurrency } from '../../utils/formatCurrency'
import './Orcamento.css'

export default function Orcamento() {
  const { selectedMonth, selectedYear } = useFinance()
  const { budgetItems, loading, error, add, remove, totalBudgeted, totalSpent } =
    useBudget(selectedYear, selectedMonth)
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState({ categoryName: '', icon: '', amount: '' })
  const [saving, setSaving] = useState(false)

  function handleChange(e) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.categoryName || !form.amount) return
    setSaving(true)
    const competencyMonth = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`
    try {
      await add({
        categoryName:    form.categoryName.trim(),
        icon:            form.icon.trim() || '📦',
        plannedAmount:   form.amount,
        competencyMonth,
      })
      setModalOpen(false)
      setForm({ categoryName: '', icon: '', amount: '' })
    } catch (err) {
      alert('Erro ao salvar: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(item) {
    if (!window.confirm(`Remover categoria "${item.categoryName}" do orçamento?`)) return
    try {
      await remove(item.id)
    } catch (err) {
      alert('Erro ao remover: ' + err.message)
    }
  }

  return (
    <div className="orcamento-page">
      <MonthSelector />

      <div className="orcamento-content">
        <div className="orcamento-header-row">
          <h2 className="section-title">Categorias</h2>
          <Button size="sm" onClick={() => setModalOpen(true)}>+ Adicionar</Button>
        </div>

        {loading && <p className="orcamento-loading">Carregando orçamento…</p>}
        {error   && <p className="orcamento-error">Erro: {error}</p>}

        {!loading && !error && budgetItems.length === 0 && (
          <Card className="orcamento-empty">
            <p>Nenhuma categoria orçada para este mês.</p>
            <p className="orcamento-empty-hint">Toque em “+ Adicionar” para começar.</p>
          </Card>
        )}

        {budgetItems.map((item) => (
          <Card key={item.id} className="budget-cat-card">
            <div className="budget-cat-header">
              <CardHeader
                title={`${item.icon || '📦'} ${item.categoryName}`}
                subtitle={`${formatCurrency(item.spent)} de ${formatCurrency(item.plannedAmount)}`}
              />
              <button className="budget-del-btn" onClick={() => handleDelete(item)} title="Remover">🗑️</button>
            </div>
            <div className="budget-cat-bar-track">
              <div
                className={`budget-cat-bar-fill${item.spent > item.plannedAmount ? ' over' : ''}`}
                style={{ width: `${Math.min((item.spent / (item.plannedAmount || 1)) * 100, 100)}%` }}
              />
            </div>
          </Card>
        ))}

        {/* Totais */}
        <Card className="budget-totals-card">
          <div className="budget-total-row">
            <span>Total orçado</span>
            <strong>{formatCurrency(totalBudgeted)}</strong>
          </div>
          <div className="budget-total-row">
            <span>Total realizado</span>
            <strong className={totalSpent > totalBudgeted ? 'text-danger' : 'text-success'}>
              {formatCurrency(totalSpent)}
            </strong>
          </div>
          <div className="budget-total-row">
            <span>Saldo</span>
            <strong className={totalBudgeted - totalSpent >= 0 ? 'text-success' : 'text-danger'}>
              {formatCurrency(totalBudgeted - totalSpent)}
            </strong>
          </div>
        </Card>
      </div>

      {/* Modal – nova categoria */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Nova categoria"
        footer={
          <>
            <Button variant="ghost" fullWidth onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button variant="primary" fullWidth onClick={handleSubmit} loading={saving}>Salvar</Button>
          </>
        }
      >
        <form className="launch-form" onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label>Categoria</label>
            <input name="categoryName" type="text" value={form.categoryName} onChange={handleChange}
              placeholder="Ex: Alimentação" required />
          </div>
          <div className="form-group">
            <label>Ícone (emoji)</label>
            <input name="icon" type="text" value={form.icon} onChange={handleChange}
              placeholder="Ex: 🍽️" maxLength={4} />
          </div>
          <div className="form-group">
            <label>Valor orçado (R$)</label>
            <input name="amount" type="number" inputMode="decimal" min="0" step="0.01"
              value={form.amount} onChange={handleChange} placeholder="0,00" required />
          </div>
        </form>
      </Modal>
    </div>
  )
}
