import { useState } from 'react'
import MonthSelector from '../../components/ui/MonthSelector'
import Card, { CardHeader } from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import { useFinance } from '../../context/FinanceContext'
import { useBudget } from '../../hooks/useBudget'
import { useCategories } from '../../hooks/useCategories'
import { formatCurrency } from '../../utils/formatCurrency'
import './Orcamento.css'

const TYPES = [
  { value: 'expense',    label: 'Despesa',      cls: 'type-btn-expense' },
  { value: 'income',     label: 'Receita',      cls: 'type-btn-income' },
  { value: 'investment', label: 'Investimento', cls: 'type-btn-investment' },
]

const TYPE_LABELS = {
  expense:    'Despesas',
  income:     'Receitas',
  investment: 'Investimentos',
}

const NEW_CAT_PLACEHOLDER = {
  expense:    'Ex: Alimentação, Casa, Saúde',
  income:     'Ex: Salário, Prebenda, Renda Extra',
  investment: 'Ex: Poupança, Ações, Reserva',
}

const EMPTY_FORM = { type: 'expense', categoryId: '', categoryName: '', newCatName: '', amount: '' }

export default function Orcamento() {
  const { selectedMonth, selectedYear } = useFinance()
  const { budgetItems, loading, error, add, remove, totalBudgeted, totalSpent } =
    useBudget(selectedYear, selectedMonth)
  const { categories, add: addCategory } = useCategories()
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)

  function showToast(msg, type = 'ok') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  const filteredCats = categories.filter((c) => c.type === form.type)
  const isNewCat = form.categoryId === '__new__'

  function openModal() { setForm(EMPTY_FORM); setModalOpen(true) }
  function closeModal() { setModalOpen(false); setForm(EMPTY_FORM) }

  function handleTypeChange(newType) {
    setForm((f) => ({ ...f, type: newType, categoryId: '', categoryName: '', newCatName: '' }))
  }

  function handleCategoryChange(e) {
    const val = e.target.value
    if (val === '__new__') {
      setForm((f) => ({ ...f, categoryId: '__new__', categoryName: '', newCatName: '' }))
    } else {
      const cat = categories.find((c) => c.id === val)
      setForm((f) => ({ ...f, categoryId: val, categoryName: cat?.name ?? '' }))
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const amount = parseFloat(form.amount)
    if (!amount || amount <= 0) return showToast('Informe um valor válido.', 'err')

    let catId = form.categoryId
    let catName = form.categoryName

    if (isNewCat) {
      const name = form.newCatName.trim()
      if (!name) return showToast('Digite o nome da nova categoria.', 'err')
      catName = name
    } else if (!catId) {
      return showToast('Selecione ou crie uma categoria.', 'err')
    }

    setSaving(true)
    const competencyMonth = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`
    try {
      if (isNewCat) {
        catId = await addCategory({ name: catName, type: form.type })
      }
      await add({
        categoryId:      catId,
        categoryName:    catName,
        type:            form.type,
        plannedAmount:   amount,
        competencyMonth,
      })
      closeModal()
      showToast('Item adicionado ao orçamento ✅')
    } catch (err) {
      showToast('Erro ao salvar: ' + err.message, 'err')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(item) {
    if (!window.confirm(`Remover "${item.categoryName}" do orçamento?`)) return
    try {
      await remove(item.id)
      showToast('Item removido.')
    } catch (err) {
      showToast('Erro ao remover: ' + err.message, 'err')
    }
  }

  const byType = TYPES
    .map(({ value }) => ({
      type:  value,
      label: TYPE_LABELS[value],
      items: budgetItems.filter((b) => (b.type || 'expense') === value),
    }))
    .filter((g) => g.items.length > 0)

  return (
    <div className="orcamento-page">
      <MonthSelector />

      <div className="orcamento-content">
        <div className="orcamento-header-row">
          <h2 className="section-title">Orçamento</h2>
          <Button size="sm" onClick={openModal}>+ Adicionar</Button>
        </div>

        {loading && <p className="orcamento-loading">Carregando orçamento…</p>}
        {error   && <p className="orcamento-error">Erro: {error}</p>}

        {!loading && !error && budgetItems.length === 0 && (
          <Card className="orcamento-empty">
            <p>Nenhuma meta orçada para este mês.</p>
            <p className="orcamento-empty-hint">Toque em "+ Adicionar" para começar.</p>
          </Card>
        )}

        {byType.map((group) => (
          <div key={group.type}>
            <p className={`budget-type-heading budget-type-${group.type}`}>{group.label}</p>
            {group.items.map((item) => (
              <Card key={item.id} className="budget-cat-card">
                <div className="budget-cat-header">
                  <CardHeader
                    title={item.categoryName}
                    subtitle={`${formatCurrency(item.spent)} de ${formatCurrency(item.plannedAmount)}`}
                  />
                  <button className="budget-del-btn" onClick={() => handleDelete(item)} title="Remover">🗑️</button>
                </div>
                <div className="budget-cat-bar-track">
                  <div
                    className={`budget-cat-bar-fill bar-${item.type || 'expense'}${item.spent > item.plannedAmount ? ' over' : ''}`}
                    style={{ width: `${Math.min((item.spent / (item.plannedAmount || 1)) * 100, 100)}%` }}
                  />
                </div>
              </Card>
            ))}
          </div>
        ))}

        {budgetItems.length > 0 && (
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
        )}
      </div>

      {/* Modal – novo item */}
      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title="Adicionar ao orçamento"
        footer={
          <>
            <Button variant="ghost" fullWidth onClick={closeModal}>Cancelar</Button>
            <Button variant="primary" fullWidth onClick={handleSubmit} loading={saving}>Salvar</Button>
          </>
        }
      >
        <form className="budget-form" onSubmit={handleSubmit} noValidate>

          {/* Tipo */}
          <div className="form-group">
            <label>Tipo</label>
            <div className="type-btn-group">
              {TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  className={`type-btn ${t.cls}${form.type === t.value ? ' active' : ''}`}
                  onClick={() => handleTypeChange(t.value)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Categoria */}
          <div className="form-group">
            <label>Categoria</label>
            <select value={form.categoryId} onChange={handleCategoryChange}>
              <option value="">Selecionar…</option>
              {filteredCats.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
              <option value="__new__">+ Nova categoria…</option>
            </select>
          </div>

          {/* New category name */}
          {isNewCat && (
            <div className="form-group">
              <label>Nome da nova categoria</label>
              <input
                type="text"
                value={form.newCatName}
                onChange={(e) => setForm((f) => ({ ...f, newCatName: e.target.value }))}
                placeholder={NEW_CAT_PLACEHOLDER[form.type]}
                autoFocus
                maxLength={60}
              />
              <span className="form-hint">
                Será criada e vinculada ao tipo {TYPES.find((t) => t.value === form.type)?.label}.
              </span>
            </div>
          )}

          {/* Valor */}
          <div className="form-group">
            <label>Valor orçado (R$)</label>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              placeholder="0,00"
              required
            />
          </div>
        </form>
      </Modal>

      {/* Toast */}
      {toast && (
        <div className={`orcamento-toast${toast.type === 'err' ? ' toast-err' : ''}`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}