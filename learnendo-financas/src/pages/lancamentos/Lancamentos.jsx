import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import MonthSelector from '../../components/ui/MonthSelector'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import { useFinance } from '../../context/FinanceContext'
import { useAuth } from '../../context/AuthContext'
import { useTransactions } from '../../hooks/useTransactions'
import { useCategories } from '../../hooks/useCategories'
import { useAccounts } from '../../hooks/useAccounts'
import { useWorkspace } from '../../context/WorkspaceContext'
import { useDebts } from '../../hooks/useDebts'
import { fetchTransactions } from '../../services/transactionService'
import { createRecurrenceRule } from '../../services/recurrenceService'
import { findDuplicateMatches } from '../../utils/transactionDuplicates'
import { formatCurrency } from '../../utils/formatCurrency'
import { formatDateBR } from '../../utils/formatDate'
import { suggestTypeAndCategory } from '../../utils/transactionAutoCategorizer'
import { resolveNatureAffectsBudget } from '../../constants/transactionNatures'
import './Lancamentos.css'

// ── Type chip navigation ──────────────────────────────────────────────────────
const TYPE_CHIPS = [
  { value: '',           label: 'Tudo'             },
  { value: 'income',     label: '📈 Receitas'      },
  { value: 'expense',    label: '📉 Despesas'       },
  { value: 'investment', label: '📊 Invest.'        },
  { value: 'transfer',   label: '↔️ Transf.'        },
]

// ── Section metadata (order = rendering order) ───────────────────────────────
const SECTION_ORDER = ['income', 'expense', 'investment', 'transfer']
const SECTION_META = {
  income:     { label: 'Receitas',        icon: '📈', addLabel: '+ Receita',      valCls: 'pos', formType: 'income'            },
  expense:    { label: 'Despesas',        icon: '📉', addLabel: '+ Despesa',       valCls: 'neg', formType: 'expense'           },
  investment: { label: 'Investimentos',   icon: '📊', addLabel: '+ Investimento',  valCls: 'inv', formType: 'investment'        },
  transfer:   { label: 'Transferências',  icon: '↔️', addLabel: '+ Transferência', valCls: 'neu', formType: 'transfer_internal' },
}

// ── Advanced filter options ───────────────────────────────────────────────────
const ORIGIN_OPTS = [
  { value: '',                   label: 'Todas as origens'   },
  { value: 'manual',             label: 'Manual'             },
  { value: 'bank_import',        label: 'Banco (extrato)'    },
  { value: 'credit_card_import', label: 'Cartão (fatura)'    },
  { value: 'recurring_auto',     label: 'Recorrência auto'   },
]

const ORIGIN_META = {
  manual:             { label: 'manual',  bg: '#6b7280' },
  bank_import:        { label: 'banco',   bg: '#1a56db' },
  credit_card_import: { label: 'cartão',  bg: '#8b5cf6' },
  recurring_auto:     { label: 'auto',    bg: '#047857' },
}
const STATUS_META = {
  confirmed:    { label: 'OK',         cls: 'status-ok'     },
  pending:      { label: 'Pendente',   cls: 'status-pending' },
}

function normalizeStatus(status) {
  if (status === 'pending' || status === 'needs_review') return 'pending'
  return 'confirmed'
}

/**
 * Maps any transfer sub-type to the canonical section key 'transfer'.
 * Both 'transfer' (legacy/imported) and 'transfer_internal' (manual/own-account)
 * appear in the Transferências section.
 */
function sectionKey(type) {
  if (type === 'transfer_internal') return 'transfer'
  return type
}

function sectionSum(txList, key) {
  return txList
    .filter((t) => sectionKey(t.type) === key)
    .reduce((s, t) => s + Number(t.amount || 0), 0)
}

function addMonthsToDate(isoDate, offset) {
  const [year, month, day] = String(isoDate || '').split('-').map(Number)
  if (!year || !month || !day) return ''
  const target = new Date(year, month - 1 + offset, 1)
  const maxDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  const safeDay = Math.min(day, maxDay)
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`
}

export default function Lancamentos({ view = 'confirmed' }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const {
    activeWorkspaceId,
    myRole,
    members,
    transactionNatures,
    contacts,
    permissions,
    renameNatureInline,
    addExternalContact,
  } = useWorkspace()
  const { selectedMonth, selectedYear } = useFinance()
  const isPendingView = view === 'pending'

  // Primary navigation: type chip
  const [activeType,   setActiveType]   = useState('')   // '' = show all sections
  // Secondary filters (hidden by default)
  const [filterOrigin, setFilterOrigin] = useState('')

  const [modalOpen,  setModalOpen]  = useState(false)
  const [editingTx,  setEditingTx]  = useState(null)
  const [form,       setForm]       = useState(defaultForm())
  const [saving,     setSaving]     = useState(false)
  const [editingNatureLabel, setEditingNatureLabel] = useState('')

  // Dados reais do Firestore — users/{uid}/transactions
  const { transactions: allTx, loading, error, add, update, remove } =
    useTransactions(selectedYear, selectedMonth)
  const { categories } = useCategories()
  const { accounts }   = useAccounts()
  const { debts } = useDebts()

  const availableContacts = [
    ...members.map((m) => ({ id: `member:${m.uid || m.id}`, name: m.displayName || m.email || 'Membro', type: 'internal' })),
    ...contacts,
  ]

  const scopedTransactions = allTx.filter((t) => {
    const txStatus = normalizeStatus(t.status)
    const statusOk = isPendingView ? txStatus === 'pending' : txStatus === 'confirmed'
    const roleOk = permissions.viewPrivateOthers || t.createdBy === user?.uid || t.userId === user?.uid
    return statusOk && roleOk
  })

  // Apply only secondary origin filter (type is handled by section logic)
  const transactions = scopedTransactions.filter((t) => {
    const matchOrigin = !filterOrigin || t.origin === filterOrigin
    return matchOrigin
  })

  const pendingCount = allTx.filter((t) => normalizeStatus(t.status) === 'pending').length

  // ── Event handlers ────────────────────────────────────────────────────────
  function handleChange(e) {
    const { name, value } = e.target

    if (name === 'transactionNatureId') {
      const selected = transactionNatures.find((nature) => nature.id === value)
      setForm((f) => ({
        ...f,
        transactionNatureId: value,
        transactionNatureLabel: selected?.label || '',
        debtId: value === 'nature_debt_payment' ? f.debtId : '',
      }))
      setEditingNatureLabel(selected?.label || '')
      return
    }

    if (name === 'recurrenceType') {
      setForm((f) => ({
        ...f,
        recurrenceType: value,
        totalInstallments: value === 'fixed' ? (f.totalInstallments || '12') : '',
        currentInstallment: value === 'fixed' ? (f.currentInstallment || '1') : '',
        recurringEndDate: value === 'fixed' ? f.recurringEndDate : '',
      }))
      return
    }

    if (name === 'totalInstallments' || name === 'currentInstallment') {
      setForm((f) => {
        const next = { ...f, [name]: value }
        const total = Number(next.totalInstallments || 0)
        const current = Number(next.currentInstallment || 0)
        if (next.recurrenceType === 'fixed' && total > 0 && current > 0 && current <= total && next.recurringStartDate) {
          next.recurringEndDate = addMonthsToDate(next.recurringStartDate, total - current)
        }
        return next
      })
      return
    }

    if (name === 'recurringStartDate') {
      setForm((f) => {
        const next = { ...f, recurringStartDate: value }
        const total = Number(next.totalInstallments || 0)
        const current = Number(next.currentInstallment || 0)
        if (next.recurrenceType === 'fixed' && total > 0 && current > 0 && current <= total) {
          next.recurringEndDate = addMonthsToDate(value, total - current)
        }
        return next
      })
      return
    }

    if (name === 'description') {
      setForm((f) => {
        const text = value
        const suggestion = suggestTypeAndCategory(text, categories, f.type)
        const keepType = f.type === 'transfer_internal' ? f.type : suggestion.suggestedType
        const nextCategoryId = f.categoryId || suggestion.suggestedCategoryId || ''

        return {
          ...f,
          description: text,
          type: keepType,
          categoryId: keepType === 'transfer_internal' ? '' : nextCategoryId,
        }
      })
      return
    }

    setForm((f) => ({ ...f, [name]: value }))
  }

  async function handleNatureLabelBlur() {
    const nextLabel = editingNatureLabel.trim()
    if (!form.transactionNatureId || !nextLabel) return
    const current = transactionNatures.find((nature) => nature.id === form.transactionNatureId)
    if (current?.label === nextLabel) return

    try {
      await renameNatureInline(form.transactionNatureId, nextLabel)
      setForm((f) => ({ ...f, transactionNatureLabel: nextLabel }))
    } catch (err) {
      alert('Erro ao atualizar natureza: ' + err.message)
    }
  }

  async function handleCreateContactFromInput() {
    const name = form.newContactName.trim()
    if (!name) return
    try {
      const created = await addExternalContact(name)
      if (created?.id) {
        setForm((f) => ({ ...f, contactId: created.id, newContactName: '' }))
      }
    } catch (err) {
      alert('Erro ao criar contato: ' + err.message)
    }
  }
  function handleCheck(e) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.checked }))
  }

  function openNewModal(typeValue) {
    setEditingTx(null)
    const base = { ...defaultForm(), type: typeValue || 'expense' }
    const defaultNature = transactionNatures.find((nature) => nature.direction === (base.type === 'income' ? 'income' : 'expense'))
    if (defaultNature) {
      base.transactionNatureId = defaultNature.id
      base.transactionNatureLabel = defaultNature.label
    }
    setForm(base)
    setEditingNatureLabel(base.transactionNatureLabel || '')
    setModalOpen(true)
  }

  function openEditModal(tx) {
    const suggestion = suggestTypeAndCategory(tx.description || '', categories, tx.type || 'expense')
    const suggestedType = tx.type === 'transfer_internal' ? 'transfer_internal' : suggestion.suggestedType

    setEditingTx(tx)
    setForm({
      type:        suggestedType,
      description: tx.description || '',
      amount:      tx.amount      || '',
      date:        tx.date        || '',
      accountId:   tx.accountId   || '',
      toAccountId: tx.toAccountId || '',
      categoryId:  tx.categoryId || (tx.type === 'transfer_internal' ? '' : suggestion.suggestedCategoryId || ''),
      notes:       tx.notes       || '',
      recurring:   tx.recurring   || !!tx.recurringId,
      recurrenceType: tx.recurringType || 'indefinite',
      recurringStartDate: tx.date || '',
      recurringEndDate: '',
      totalInstallments: '',
      currentInstallment: '',
      transactionNatureId: tx.transactionNatureId || '',
      transactionNatureLabel: tx.transactionNatureLabel || '',
      contactId: tx.contactId || '',
      newContactName: '',
      debtId: tx.debtId || '',
    })
    setEditingNatureLabel(tx.transactionNatureLabel || '')
    setModalOpen(true)
  }

  async function handleQuickConfirm(tx) {
    try {
      const isInternal = tx.type === 'transfer_internal'
      const inferred = suggestTypeAndCategory(tx.description, categories, tx.type)
      const resolvedType = isInternal ? 'transfer_internal' : (inferred.suggestedType || tx.type)
      const resolvedCategoryId = isInternal
        ? null
        : (tx.categoryId || inferred.suggestedCategoryId || null)
      const resolvedCategoryName = isInternal
        ? null
        : (categories.find((c) => c.id === resolvedCategoryId)?.name || null)

      await update(tx.id, {
        type: resolvedType,
        accountId: tx.accountId || accounts[0]?.id || null,
        categoryId: resolvedCategoryId,
        categoryName: resolvedCategoryName,
        status: 'confirmed',
      })
    } catch (err) {
      alert('Erro ao confirmar: ' + err.message)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.description || !form.amount || !form.date) return

    if (form.transactionNatureId === 'nature_debt_payment' && !form.debtId) {
      alert('Selecione a dívida para vincular o pagamento.')
      return
    }

    if (!editingTx && !permissions.canLaunch) {
      alert('Seu papel não permite lançar movimentações neste workspace.')
      return
    }

    if (form.recurring && form.recurrenceType === 'fixed') {
      const total = Number(form.totalInstallments)
      const current = Number(form.currentInstallment)
      if (!total || !current || current > total || total < 1 || current < 1) {
        alert('Preencha parcelas corretamente: parcela atual deve estar entre 1 e o total.')
        return
      }
    }

    if (!user?.uid) {
      alert('Usuário não autenticado.')
      return
    }
    setSaving(true)
    const isInternal = form.type === 'transfer_internal'
    const inferred = suggestTypeAndCategory(form.description, categories, form.type)
    const resolvedType = isInternal ? 'transfer_internal' : (inferred.suggestedType || form.type)
    const resolvedCategoryId = isInternal ? null : (form.categoryId || inferred.suggestedCategoryId || null)
    const resolvedCategoryName = isInternal
      ? null
      : (categories.find((c) => c.id === resolvedCategoryId)?.name || null)
    const resolvedAccountId = isInternal
      ? (form.accountId || editingTx?.accountId || null)
      : (form.accountId || editingTx?.accountId || accounts[0]?.id || null)

    const payload = {
      type:        resolvedType,
      description: form.description,
      amount:      form.amount,
      date:        form.date,
      accountId:   resolvedAccountId,
      toAccountId: isInternal ? (form.toAccountId || null) : null,
      categoryId:  resolvedCategoryId,
      categoryName: resolvedCategoryName,
      notes:       form.notes || '',
      recurring:   !!form.recurring,
      transactionNatureId: form.transactionNatureId || null,
      transactionNatureLabel: (editingNatureLabel || form.transactionNatureLabel || '').trim() || null,
      contactId: form.contactId || null,
      contactName: availableContacts.find((c) => c.id === form.contactId)?.name || null,
      debtId: form.transactionNatureId === 'nature_debt_payment' ? (form.debtId || null) : null,
      debtName: form.transactionNatureId === 'nature_debt_payment'
        ? (debts.find((debt) => debt.id === form.debtId)?.name || null)
        : null,
      workspaceId: activeWorkspaceId,
      createdBy: user.uid,
      userId: user.uid,
      affectsBudget: resolveNatureAffectsBudget(transactionNatures, form.transactionNatureId, resolvedType !== 'transfer_internal'),
      status:      editingTx
        ? (normalizeStatus(editingTx.status) === 'pending' ? 'confirmed' : normalizeStatus(editingTx.status))
        : 'confirmed',
    }

    const [txYear, txMonth] = String(payload.date || '')
      .slice(0, 7)
      .split('-')
      .map((n) => Number(n))

    const monthTransactions =
      txYear === selectedYear && txMonth === selectedMonth
        ? allTx
        : await fetchTransactions(user.uid, txYear, txMonth, {
          workspaceId: activeWorkspaceId,
          viewerRole: myRole,
          viewerUid: user.uid,
        })

    const duplicates = findDuplicateMatches(payload, monthTransactions, {
      ignoreId: editingTx?.id ?? null,
    })

    if (duplicates.isExactDuplicate) {
      setSaving(false)
      alert('Lançamento duplicado detectado. Revise data, valor, descrição e conta antes de salvar.')
      return
    }

    if (duplicates.hasPossibleDuplicate) {
      const proceed = window.confirm(
        `Encontramos ${duplicates.possible.length} lançamento(s) parecido(s). Deseja salvar mesmo assim?`,
      )
      if (!proceed) {
        setSaving(false)
        return
      }
    }

    try {
      if (editingTx) {
        await update(editingTx.id, payload)
      } else {
        const txId = await add(payload)

        if (form.recurring) {
          const recurrenceType = form.recurrenceType === 'fixed' ? 'fixed' : 'indefinite'
          const recurringStartDate = form.recurringStartDate || payload.date
          const currentInstallment = recurrenceType === 'fixed' ? Number(form.currentInstallment || 1) : 1
          const totalInstallments = recurrenceType === 'fixed' ? Number(form.totalInstallments || 1) : null
          const recurrence = await createRecurrenceRule(user.uid, payload, {
            recurrenceType,
            startDate: recurringStartDate,
            endDate: recurrenceType === 'fixed' ? (form.recurringEndDate || null) : null,
            totalInstallments,
            startInstallment: currentInstallment,
            currentInstallment,
            active: true,
          }, { workspaceId: activeWorkspaceId })

          await update(txId, {
            recurringId: recurrence.id,
            recurringType: recurrenceType,
            recurringInstanceMonth: String(payload.date).slice(0, 7),
            installmentNumber: recurrenceType === 'fixed' ? currentInstallment : null,
          })
        }
      }
      setModalOpen(false)
      setEditingTx(null)
      setForm(defaultForm())
    } catch (err) {
      alert('Erro ao salvar lançamento: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(tx) {
    if (!window.confirm(`Excluir "${tx.description}"?`)) return
    try {
      await remove(tx.id)
      setModalOpen(false)
      setEditingTx(null)
    } catch (err) {
      alert('Erro ao excluir: ' + err.message)
    }
  }

  // ── Render helpers ────────────────────────────────────────────────────────
  function renderTx(t) {
    const originMeta = ORIGIN_META[t.origin] ?? null
    const normalizedTxStatus = normalizeStatus(t.status)
    const statusMeta = STATUS_META[normalizedTxStatus] ?? { label: normalizedTxStatus, cls: '' }
    const isCredit   = t.type === 'income'
    const catName    = categories.find((c) => c.id === t.categoryId)?.name ?? null
    const natureLabel = t.transactionNatureLabel || transactionNatures.find((nature) => nature.id === t.transactionNatureId)?.label
    const contactLabel = t.contactName || contacts.find((c) => c.id === t.contactId)?.name
    const debtLabel = t.debtName || debts.find((debt) => debt.id === t.debtId)?.name
    return (
      <div key={t.id} className={`transaction-item${normalizedTxStatus === 'pending' ? ' tx-pending' : ''}`}>
        <div className="tx-info">
          <span className="tx-desc">
            {t.description}
            {normalizedTxStatus !== 'confirmed' && (
              <span className={`tx-status ${statusMeta.cls}`}>{statusMeta.label}</span>
            )}
          </span>
          <span className="tx-meta">
            {originMeta && t.origin !== 'manual' && (
              <span className="origin-badge" style={{ background: originMeta.bg }}>
                {originMeta.label}
              </span>
            )}
            {t.type === 'transfer_internal' && (
              <span className="origin-badge" style={{ background: '#6b7280' }}>interna</span>
            )}
            {catName && <span className="tx-cat">{catName}</span>}
            {natureLabel && <span className="tx-cat">• {natureLabel}</span>}
            {contactLabel && <span className="tx-cat">• {contactLabel}</span>}
            {debtLabel && <span className="tx-cat">• Dívida: {debtLabel}</span>}
            <span className="tx-date">{formatDateBR(t.date)}</span>
          </span>
        </div>
        <span className={`tx-value tx-value--${t.type}`}>
          {isCredit ? '+' : ''}{formatCurrency(t.amount)}
        </span>
        <div className="tx-actions">
          <button className="tx-action-btn" onClick={() => openEditModal(t)} title="Editar">✏️</button>
          {isPendingView ? (
            <button
              className="tx-action-btn tx-action-confirm"
              onClick={() => handleQuickConfirm(t)}
              title="Confirmar"
            >
              ✅
            </button>
          ) : (
            <button className="tx-action-btn tx-action-del" onClick={() => handleDelete(t)} title="Excluir">🗑️</button>
          )}
        </div>
      </div>
    )
  }

  function renderSection(key) {
    const meta  = SECTION_META[key]
    const group = transactions.filter((t) => sectionKey(t.type) === key)
    // In "Tudo" view, hide empty sections; in focused view always show (to display empty state)
    if (activeType === '' && group.length === 0) return null
    const total = sectionSum(transactions, key)
    return (
      <div key={key} className="type-section">
        <div className="section-header">
          <div className="section-header-left">
            <span className="section-icon">{meta.icon}</span>
            <span className="section-label">{meta.label}</span>
            <span className={`section-total section-total--${meta.valCls}`}>
              {formatCurrency(total)}
            </span>
          </div>
          <button
            className="section-add-btn"
            onClick={() => openNewModal(meta.formType)}
            title={meta.addLabel}
          >
            {meta.addLabel}
          </button>
        </div>
        <div className="section-items">
          {group.length === 0 ? (
            <p className="section-empty">
              {isPendingView ? 'Nenhuma pendência neste mês' : 'Nenhum lançamento confirmado neste mês'}
            </p>
          ) : (
            group.map(renderTx)
          )}
        </div>
      </div>
    )
  }

  // FAB pre-selects type based on active chip
  const fabType =
    activeType === '' ? 'expense' : (SECTION_META[activeType]?.formType ?? 'expense')

  // ── JSX ───────────────────────────────────────────────────────────────────
  return (
    <div className="lancamentos-page">
      <MonthSelector />

      {/* Type chip navigation — primary filter */}
      <div className="type-filter">
        {TYPE_CHIPS.map((chip) => (
          <button
            key={chip.value}
            className={`type-chip${activeType === chip.value ? ' active' : ''}`}
            onClick={() => setActiveType(chip.value)}
          >
            {chip.label}
          </button>
        ))}
        <button
          className="filter-toggle-btn import-btn"
          onClick={() => navigate('/importacao')}
          title="Importar extrato"
        >
          📥 Importar
        </button>
      </div>

      <div className="advanced-filters">
        <select
          value={filterOrigin}
          onChange={(e) => setFilterOrigin(e.target.value)}
          className="filter-select"
        >
          {ORIGIN_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {filterOrigin && (
          <button
            className="clear-filters-btn"
            onClick={() => setFilterOrigin('')}
          >
            Limpar
          </button>
        )}
      </div>

      {/* Review banner */}
      {!isPendingView && pendingCount > 0 && (
        <div className="review-banner">
          ⚠️ <strong>{pendingCount}</strong> lançamento(s) pendente(s)
          <button
            className="review-banner-btn"
            onClick={() => navigate('/lancar')}
          >
            Ver
          </button>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="empty-state"><p>Carregando lançamentos…</p></div>
      ) : error ? (
        <div className="empty-state">
          <span className="empty-icon">⚠️</span>
          <p>Erro ao carregar: {error}</p>
        </div>
      ) : (
        <div className="transaction-list">
          {activeType === '' ? (
            // ─ "Tudo" view: sections grouped by type ────────────────────────
            transactions.length === 0 ? (
              <div className="empty-state">
                <img src="/logo.jpg" alt="Learnendo Finanças" className="empty-logo" />
                <p className="empty-title">
                  {isPendingView ? 'Nenhuma pendência encontrada' : 'Nenhum lançamento confirmado encontrado'}
                </p>
                <p className="empty-hint">
                  {isPendingView ? 'Importe um extrato para revisar novos lançamentos' : 'Toque em ➕ para adicionar um lançamento'}
                </p>
              </div>
            ) : (
              SECTION_ORDER.map(renderSection)
            )
          ) : (
            // ─ Focused view: single section ─────────────────────────────────
            renderSection(activeType)
          )}
        </div>
      )}

      {/* FAB */}
      <button
        className="fab"
        onClick={() => openNewModal(fabType)}
        aria-label="Novo lançamento"
      >
        +
      </button>

      {/* Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => { setModalOpen(false); setEditingTx(null) }}
        title={editingTx ? 'Editar lançamento' : 'Novo lançamento'}
        footer={
          <>
            {editingTx && (
              <Button variant="danger" fullWidth onClick={() => handleDelete(editingTx)}>
                Excluir
              </Button>
            )}
            <Button variant="ghost" fullWidth onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button variant="primary" fullWidth onClick={handleSubmit} loading={saving}>Salvar</Button>
          </>
        }
      >
        <form className="launch-form" onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label>Data</label>
            <input name="date" type="date" value={form.date} onChange={handleChange} required />
          </div>
          <div className="form-group">
            <label>Tipo</label>
            <select name="type" value={form.type} onChange={handleChange} required>
              <option value="income">Receita</option>
              <option value="expense">Despesa</option>
              <option value="investment">Investimento</option>
              <option value="transfer_internal">Transferência entre contas</option>
            </select>
          </div>
          <div className="form-group">
            <label>Descrição</label>
            <input name="description" type="text" value={form.description} onChange={handleChange}
              placeholder="Ex: Supermercado" required />
          </div>
          <div className="form-group">
            <label>Valor (R$)</label>
            <input name="amount" type="number" inputMode="decimal" min="0.01" step="0.01"
              value={form.amount} onChange={handleChange} placeholder="0,00" required />
          </div>
          {form.type !== 'transfer_internal' ? (
            <div className="form-group">
              <label>Categoria</label>
              <select name="categoryId" value={form.categoryId} onChange={handleChange}>
                <option value="">Selecione…</option>
                {categories
                  .filter((c) => c.type === form.type)
                  .map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
              </select>
            </div>
          ) : (
            <>
              <div className="form-group">
                <label>Conta de origem</label>
                <select name="accountId" value={form.accountId} onChange={handleChange}>
                  <option value="">Selecione…</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Conta de destino</label>
                <select name="toAccountId" value={form.toAccountId} onChange={handleChange}>
                  <option value="">Selecione…</option>
                  {accounts
                    .filter((a) => a.id !== form.accountId)
                    .map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            </>
          )}
          <div className="form-group">
            <label>Natureza da movimentação</label>
            <select
              name="transactionNatureId"
              value={form.transactionNatureId}
              onChange={handleChange}
              required
            >
              <option value="">Selecione…</option>
              {transactionNatures.map((nature) => (
                <option key={nature.id} value={nature.id}>{nature.label}</option>
              ))}
            </select>
          </div>
          {form.transactionNatureId && (
            <div className="form-group">
              <label>Personalizar termo da natureza</label>
              <input
                type="text"
                value={editingNatureLabel}
                onChange={(e) => setEditingNatureLabel(e.target.value)}
                onBlur={handleNatureLabelBlur}
                placeholder="Renomeie a natureza para este workspace"
              />
              <p className="form-help-text">Ao sair do campo, o novo termo é salvo automaticamente no workspace.</p>
            </div>
          )}
          {form.transactionNatureId === 'nature_debt_payment' && (
            <div className="form-group">
              <label>Dívida vinculada</label>
              <select name="debtId" value={form.debtId} onChange={handleChange} required>
                <option value="">Selecione…</option>
                {debts.map((debt) => (
                  <option key={debt.id} value={debt.id}>
                    {debt.name} · restante {formatCurrency(debt.remainingAmount)}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="form-group">
            <label>Pessoa relacionada (opcional)</label>
            <select name="contactId" value={form.contactId} onChange={handleChange}>
              <option value="">Nenhuma</option>
                {availableContacts.map((contact) => (
                <option key={contact.id} value={contact.id}>{contact.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group contact-inline-row">
            <input
              name="newContactName"
              type="text"
              value={form.newContactName}
              onChange={handleChange}
              placeholder="Novo contato externo"
            />
            <button type="button" className="inline-add-btn" onClick={handleCreateContactFromInput}>Adicionar</button>
          </div>
          <div className="form-group">
            <label>Observação</label>
            <textarea name="notes" value={form.notes} onChange={handleChange} rows={2} placeholder="Opcional" />
          </div>
          <div className="form-check">
            <input id="recurring" name="recurring" type="checkbox"
              checked={form.recurring} onChange={handleCheck} />
            <label htmlFor="recurring">Lançamento recorrente</label>
          </div>
          {form.recurring && (
            <div className="recurrence-panel">
              <div className="form-group">
                <label>Tipo da recorrência</label>
                <select name="recurrenceType" value={form.recurrenceType} onChange={handleChange}>
                  <option value="indefinite">Tempo indeterminado</option>
                  <option value="fixed">Prazo definido</option>
                </select>
              </div>
              <div className="recurrence-grid">
                <div className="form-group">
                  <label>Data de início</label>
                  <input
                    name="recurringStartDate"
                    type="date"
                    value={form.recurringStartDate}
                    onChange={handleChange}
                    required
                  />
                </div>
                {form.recurrenceType === 'fixed' && (
                  <>
                    <div className="form-group">
                      <label>Total de parcelas/meses</label>
                      <input
                        name="totalInstallments"
                        type="number"
                        min="1"
                        step="1"
                        value={form.totalInstallments}
                        onChange={handleChange}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>Parcela atual</label>
                      <input
                        name="currentInstallment"
                        type="number"
                        min="1"
                        step="1"
                        value={form.currentInstallment}
                        onChange={handleChange}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>Data final</label>
                      <input
                        name="recurringEndDate"
                        type="date"
                        value={form.recurringEndDate}
                        onChange={handleChange}
                      />
                    </div>
                  </>
                )}
              </div>
              {form.recurrenceType === 'fixed' && form.totalInstallments && form.currentInstallment && (
                <p className="recurrence-progress">
                  Progresso atual: {form.currentInstallment} de {form.totalInstallments}
                </p>
              )}
            </div>
          )}
          <p className="form-help-text">
            Use para contas que se repetem com frequência, como aluguel, salário, internet ou mensalidades.
          </p>
        </form>
      </Modal>
    </div>
  )
}

function defaultForm() {
  const today = new Date().toISOString().split('T')[0]
  return {
    type: 'expense', description: '', amount: '', date: today,
    accountId: '', toAccountId: '', categoryId: '', notes: '', recurring: false,
    recurrenceType: 'indefinite', recurringStartDate: today, recurringEndDate: '',
    totalInstallments: '12', currentInstallment: '1',
    transactionNatureId: '', transactionNatureLabel: '',
    contactId: '', newContactName: '',
    debtId: '',
  }
}

