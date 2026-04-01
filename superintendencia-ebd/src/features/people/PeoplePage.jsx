import { useEffect, useMemo, useState } from 'react'
import Button from '../../components/ui/Button'
import Card, { CardHeader } from '../../components/ui/Card'
import Modal from '../../components/ui/Modal'
import { useAuth } from '../../context/AuthContext'
import { listPeople, removePerson, savePerson, togglePersonStatus } from '../../services/peopleService'
import { listClasses } from '../../services/classService'
import { parsePeoplePdfFile } from '../../utils/peopleImportUtils'

const PERSON_DEFAULT = {
  fullName: '',
  email: '',
  phone: '',
  birthDate: '',
  churchStatus: 'member',
  notes: '',
  active: true,
  authUid: '',
  roles: [],
}

function getImportState() {
  return {
    fileName: '',
    items: [],
    totalLines: 0,
    duplicateCount: 0,
    newCount: 0,
  }
}

function formatBirthDate(value) {
  if (!value) return 'Nascimento nao informado'
  return new Date(`${value}T00:00:00`).toLocaleDateString('pt-BR')
}

export default function PeoplePage() {
  const { user, canManageStudents } = useAuth()
  const [people, setPeople] = useState([])
  const [classes, setClasses] = useState([])
  const [query, setQuery] = useState('')
  const [isModalOpen, setModalOpen] = useState(false)
  const [isImportModalOpen, setImportModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(PERSON_DEFAULT)
  const [importState, setImportState] = useState(getImportState)
  const [isParsingImport, setParsingImport] = useState(false)
  const [isImporting, setImporting] = useState(false)

  async function loadPeople() {
    if (!user?.uid) return
    const [data, classList] = await Promise.all([
      listPeople(user.uid),
      listClasses(user.uid),
    ])
    setPeople(data)
    setClasses(classList)
  }

  useEffect(() => {
    loadPeople()
  }, [user?.uid])

  const filtered = useMemo(() => {
    const sorted = [...people].sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''))
    if (!query.trim()) return sorted
    const normalized = query.toLowerCase()
    return sorted.filter((person) => person.fullName?.toLowerCase().includes(normalized))
  }, [people, query])

  const importSelectedCount = useMemo(
    () => importState.items.filter((item) => item.selected && !item.isDuplicate).length,
    [importState.items],
  )

  function openCreateModal() {
    if (!canManageStudents) {
      window.alert('Somente administradores podem cadastrar alunos.')
      return
    }
    setEditing(null)
    setForm(PERSON_DEFAULT)
    setModalOpen(true)
  }

  function openImportModal() {
    if (!canManageStudents) {
      window.alert('Somente administradores podem importar alunos.')
      return
    }
    setImportState(getImportState())
    setImportModalOpen(true)
  }

  function closeImportModal() {
    if (isParsingImport || isImporting) return
    setImportModalOpen(false)
    setImportState(getImportState())
  }

  function openEditModal(person) {
    if (!canManageStudents) {
      window.alert('Somente administradores podem editar alunos.')
      return
    }
    setEditing(person)
    setForm({
      fullName: person.fullName || '',
      email: person.email || '',
      phone: person.phone || '',
      birthDate: person.birthDate || '',
      churchStatus: person.churchStatus || 'member',
      notes: person.notes || '',
      active: person.active !== false,
      classId: person.classId || '',
      authUid: person.authUid || '',
      roles: person.roles || [],
    })
    setModalOpen(true)
  }

  async function handleSave() {
    if (!canManageStudents) {
      window.alert('Acao nao permitida para o seu perfil.')
      return
    }
    if (!form.fullName.trim()) return

    const base = {
      fullName: form.fullName.trim(),
      email: (form.email || '').trim().toLowerCase(),
      phone: form.phone.trim(),
      birthDate: form.birthDate || '',
      churchStatus: form.churchStatus,
      notes: form.notes.trim(),
      active: form.active,
      classId: form.classId || '',
      authUid: form.authUid || '',
      roles: form.roles || [],
    }
    await savePerson(user.uid, base, editing?.id)
    setModalOpen(false)
    await loadPeople()
  }

  async function handleToggle(person) {
    if (!canManageStudents) {
      window.alert('Acao nao permitida para o seu perfil.')
      return
    }
    await togglePersonStatus(user.uid, person.id, person.active === false)
    await loadPeople()
  }

  async function handleRemove(person) {
    if (!canManageStudents) {
      window.alert('Acao nao permitida para o seu perfil.')
      return
    }
    const confirmed = window.confirm(`Remover ${person.fullName}?`)
    if (!confirmed) return
    await removePerson(user.uid, person.id)
    await loadPeople()
  }

  async function handlePdfChange(event) {
    const file = event.target.files?.[0]
    if (!file) return

    setParsingImport(true)
    try {
      const parsed = await parsePeoplePdfFile(file, people)
      setImportState({
        ...parsed,
        fileName: file.name,
        items: parsed.items.map((item) => ({
          ...item,
          selected: !item.isDuplicate,
        })),
      })
    } catch (error) {
      window.alert(error?.message || 'Nao foi possivel ler esse PDF.')
      setImportState(getImportState())
    } finally {
      setParsingImport(false)
      event.target.value = ''
    }
  }

  function toggleImportSelection(itemId) {
    setImportState((prev) => ({
      ...prev,
      items: prev.items.map((item) => (
        item.id === itemId && !item.isDuplicate
          ? { ...item, selected: !item.selected }
          : item
      )),
    }))
  }

  async function handleImportPeople() {
    if (!user?.uid) return

    const selectedItems = importState.items.filter((item) => item.selected && !item.isDuplicate)
    if (selectedItems.length === 0) {
      window.alert('Selecione pelo menos um nome novo para importar.')
      return
    }

    setImporting(true)
    try {
      for (const item of selectedItems) {
        await savePerson(user.uid, {
          fullName: item.fullName,
          phone: '',
          birthDate: '',
          churchStatus: 'member',
          notes: '',
          active: true,
          classId: '',
        })
      }

      setImportModalOpen(false)
      setImportState(getImportState())
      await loadPeople()
      window.alert(`${selectedItems.length} membro(s) importado(s) com sucesso!`)
    } catch (error) {
      window.alert('Erro ao importar membros. Verifique o console para detalhes.')
      console.error(error)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="feature-page">
      <div className="feature-header">
        <div>
          <h2 className="feature-title">Cadastro de Alunos</h2>
          <p className="feature-subtitle">Alunos da Escola Biblica Dominical</p>
        </div>
        {canManageStudents && (
          <div className="feature-actions">
            <Button variant="secondary" onClick={openImportModal}>Importar PDF</Button>
            <Button onClick={openCreateModal}>Novo Aluno</Button>
          </div>
        )}
      </div>

      <Card>
        <div className="inline-form">
          <label htmlFor="people-search">Buscar por nome</label>
          <input
            id="people-search"
            placeholder="Digite um nome"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </Card>

      <Card>
        <CardHeader title="Lista de alunos" subtitle={`${filtered.length} registro(s)`} />
        <div className="entity-list">
          {filtered.length === 0 && <p className="feature-subtitle">Nenhum aluno cadastrado.</p>}
          {filtered.map((person) => (
            <div className="entity-row" key={person.id}>
              <div>
                <div className="entity-title">{person.fullName}</div>
                <div className="entity-meta">
                  {person.phone || 'Sem telefone'} - {formatBirthDate(person.birthDate)} - {person.churchStatus === 'member' ? 'Membro' : person.churchStatus === 'attendee' ? 'Frequentante' : 'Visitante'}
                </div>
                <span className={`entity-status ${person.active === false ? 'inactive' : 'active'}`}>
                  {person.active === false ? 'Inativo' : 'Ativo'}
                </span>
              </div>
              <div className="row-actions">
                {canManageStudents && (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => openEditModal(person)}>Editar</Button>
                    <Button size="sm" variant="ghost" onClick={() => handleToggle(person)}>
                      {person.active === false ? 'Ativar' : 'Inativar'}
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => handleRemove(person)}>Remover</Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {canManageStudents && (
        <Modal
          isOpen={isModalOpen}
          onClose={() => setModalOpen(false)}
          title={editing ? 'Editar aluno' : 'Novo aluno'}
          footer={<Button onClick={handleSave}>{editing ? 'Salvar alteracoes' : 'Cadastrar'}</Button>}
        >
          <div className="inline-form">
            <label htmlFor="person-name">Nome completo</label>
            <input
              id="person-name"
              value={form.fullName}
              onChange={(event) => setForm((prev) => ({ ...prev, fullName: event.target.value }))}
            />

            <label htmlFor="person-phone">Telefone</label>
            <input
              id="person-phone"
              value={form.phone}
              onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
            />

            <label htmlFor="person-email">E-mail</label>
            <input
              id="person-email"
              type="email"
              value={form.email || ''}
              onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
              placeholder="exemplo@email.com"
              autoComplete="email"
            />

            <label htmlFor="person-birth-date">Data de nascimento</label>
            <input
              id="person-birth-date"
              type="date"
              value={form.birthDate}
              onChange={(event) => setForm((prev) => ({ ...prev, birthDate: event.target.value }))}
            />

            <label htmlFor="person-status">Situacao na igreja</label>
            <select
              id="person-status"
              value={form.churchStatus}
              onChange={(event) => setForm((prev) => ({ ...prev, churchStatus: event.target.value }))}
            >
              <option value="member">Membro</option>
              <option value="attendee">Frequentante</option>
              <option value="visitor">Visitante</option>
            </select>

            <label htmlFor="person-notes">Observacoes</label>
            <textarea
              id="person-notes"
              value={form.notes}
              onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
            />

            <label htmlFor="person-class">Classe</label>
            <select
              id="person-class"
              value={form.classId || ''}
              onChange={(event) => setForm((prev) => ({ ...prev, classId: event.target.value }))}
            >
              <option value="">Sem classe</option>
              {classes.filter((item) => item.active !== false).map((classe) => (
                <option key={classe.id} value={classe.id}>{classe.name}</option>
              ))}
            </select>
          </div>
        </Modal>
      )}

      {canManageStudents && (
        <Modal
          isOpen={isImportModalOpen}
          onClose={closeImportModal}
          title="Importar membros por PDF"
          footer={(
            <div className="row-actions" style={{ justifyContent: 'space-between', width: '100%' }}>
              <Button variant="ghost" onClick={closeImportModal} disabled={isParsingImport || isImporting}>Fechar</Button>
              <Button onClick={handleImportPeople} loading={isImporting} disabled={isParsingImport || importSelectedCount === 0}>
                {importSelectedCount > 0 ? `Importar ${importSelectedCount}` : 'Importar'}
              </Button>
            </div>
          )}
        >
          <div className="inline-form">
            <label htmlFor="people-import-pdf">Arquivo PDF</label>
            <input
              id="people-import-pdf"
              type="file"
              accept="application/pdf"
              onChange={handlePdfChange}
              disabled={isParsingImport || isImporting}
            />
            <p className="feature-subtitle">
              O sistema tenta ler nomes do PDF, evita repetir quem ja existe e deixa a exclusao normal disponivel na lista.
            </p>

            {isParsingImport && <p className="feature-subtitle">Lendo PDF...</p>}

            {!isParsingImport && importState.fileName && (
              <>
                <Card variant="default">
                  <div className="summary-grid">
                    <div className="summary-item">
                      <span className="summary-label">Arquivo</span>
                      <span className="summary-value" style={{ fontSize: '0.95rem' }}>{importState.fileName}</span>
                    </div>
                    <div className="summary-item">
                      <span className="summary-label">Linhas lidas</span>
                      <span className="summary-value">{importState.totalLines}</span>
                    </div>
                    <div className="summary-item">
                      <span className="summary-label">Novos</span>
                      <span className="summary-value">{importState.newCount}</span>
                    </div>
                    <div className="summary-item">
                      <span className="summary-label">Duplicados</span>
                      <span className="summary-value">{importState.duplicateCount}</span>
                    </div>
                  </div>
                </Card>

                <div className="selection-list">
                  {importState.items.map((item) => (
                    <label key={item.id} className="selection-item">
                      <input
                        type="checkbox"
                        checked={item.isDuplicate ? false : item.selected}
                        disabled={item.isDuplicate || isImporting}
                        onChange={() => toggleImportSelection(item.id)}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600 }}>{item.fullName}</div>
                        {item.sourceLine !== item.fullName && (
                          <div className="entity-meta">{item.sourceLine}</div>
                        )}
                      </div>
                      <span className={`entity-status ${item.isDuplicate ? 'inactive' : 'active'}`}>
                        {item.isDuplicate ? 'Ja existe' : 'Novo'}
                      </span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
