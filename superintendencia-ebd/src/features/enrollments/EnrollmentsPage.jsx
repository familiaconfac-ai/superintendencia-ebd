import { useEffect, useMemo, useState } from 'react'
import Button from '../../components/ui/Button'
import Card, { CardHeader } from '../../components/ui/Card'
import Modal from '../../components/ui/Modal'
import { useAuth } from '../../context/AuthContext'
import { listClasses } from '../../services/classService'
import { listEnrollments, saveEnrollment } from '../../services/enrollmentService'
import { listPeople } from '../../services/peopleService'
import { buildEnrollmentStatusHistory, calculateMemberEnrollmentMetrics, isEnrollmentCurrentlyActive } from '../../utils/enrollmentMetrics'

const ENROLLMENT_DEFAULT = {
  personId: '',
  classId: '',
  enrolledInEBD: true,
  enrollmentDate: new Date().toISOString().slice(0, 10),
  status: 'active',
  notes: '',
}

export default function EnrollmentsPage() {
  const { user, canManageEnrollments } = useAuth()
  const [people, setPeople] = useState([])
  const [classes, setClasses] = useState([])
  const [enrollments, setEnrollments] = useState([])
  const [isModalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(ENROLLMENT_DEFAULT)

  async function loadData() {
    if (!user?.uid) return

    const [peopleList, classList, enrollmentList] = await Promise.all([
      listPeople(user.uid),
      listClasses(user.uid),
      listEnrollments(user.uid),
    ])
    setPeople(peopleList)
    setClasses(classList)
    setEnrollments(enrollmentList)
  }

  useEffect(() => {
    loadData()
  }, [user?.uid])

  const personMap = useMemo(
    () => Object.fromEntries(people.map((item) => [item.id, item])),
    [people],
  )

  const classMap = useMemo(
    () => Object.fromEntries(classes.map((item) => [item.id, item])),
    [classes],
  )

  const memberMetrics = useMemo(
    () => calculateMemberEnrollmentMetrics(people, enrollments),
    [people, enrollments],
  )

  const activeEnrollmentRecords = useMemo(
    () => enrollments.filter((item) => isEnrollmentCurrentlyActive(item)),
    [enrollments],
  )

  const uniqueActiveEnrolledPersonIds = useMemo(
    () => new Set(activeEnrollmentRecords.map((item) => item.personId).filter(Boolean)),
    [activeEnrollmentRecords],
  )

  const duplicatedEnrollmentGroups = useMemo(() => {
    const groups = enrollments.reduce((acc, item) => {
      const personId = item?.personId || 'sem-personId'
      if (!acc[personId]) acc[personId] = []
      acc[personId].push(item)
      return acc
    }, {})

    return Object.entries(groups)
      .filter(([, items]) => items.length > 1)
      .map(([personId, items]) => ({
        personId,
        total: items.length,
        active: items.filter((item) => isEnrollmentCurrentlyActive(item)).length,
        classes: items.map((item) => item.classId || item.className || 'sem-classe'),
      }))
  }, [enrollments])

  const listEntries = useMemo(
    () => [...enrollments].sort((a, b) => {
      const activeDiff = Number(isEnrollmentCurrentlyActive(b)) - Number(isEnrollmentCurrentlyActive(a))
      if (activeDiff !== 0) return activeDiff
      return String(b.enrollmentDate || '').localeCompare(String(a.enrollmentDate || ''))
    }),
    [enrollments],
  )

  useEffect(() => {
    console.log('[ENROLLMENTS_DEBUG] cobertura', {
      collection: 'enrollments + people',
      filtros: {
        pessoasBase: "people.active !== false && people.churchStatus === 'member'",
        membrosMatriculados: "status === 'active' && enrolledInEBD !== false",
        unicidade: 'personId',
      },
      totalBrutoPeople: people.length,
      totalBrutoEnrollments: enrollments.length,
      totalAposFiltros: {
        membrosCadastrados: memberMetrics.totalMembers,
        membrosMatriculados: memberMetrics.currentEnrolledMembers,
        faltamMatricular: memberMetrics.missingMembers,
      },
    })

    console.log('[ENROLLMENTS_DEBUG] listaMatriculados', {
      collection: 'enrollments',
      filtros: {
        lista: 'sem filtro de status; exibe historico bruto de vinculos',
        ordenacao: 'ativos primeiro, depois data de matricula desc',
      },
      totalBruto: enrollments.length,
      totalAposFiltros: listEntries.length,
      amostra: listEntries.slice(0, 5).map((item) => ({
        id: item.id,
        personId: item.personId,
        classId: item.classId,
        status: item.status,
        enrolledInEBD: item.enrolledInEBD,
        enrollmentDate: item.enrollmentDate,
      })),
    })

    console.log('[ENROLLMENTS_DEBUG] totalRegistrosLista', {
      collection: 'enrollments',
      totalRegistrosLista: enrollments.length,
      totalVinculosAtivos: activeEnrollmentRecords.length,
      totalPessoasUnicasAtivas: uniqueActiveEnrolledPersonIds.size,
      repeticoesPorPessoaId: duplicatedEnrollmentGroups.slice(0, 10),
    })

    console.log('[ENROLLMENTS_DEBUG] totalMembrosCadastrados', {
      collection: 'people',
      filtros: {
        active: 'active !== false',
        churchStatus: "churchStatus === 'member'",
      },
      quantidadeFinal: memberMetrics.totalMembers,
      amostra: people
        .filter((item) => item?.active !== false && item?.churchStatus === 'member')
        .slice(0, 5)
        .map((item) => ({
          id: item.id,
          fullName: item.fullName,
          churchStatus: item.churchStatus,
        })),
    })

    console.log('[ENROLLMENTS_DEBUG] totalMembrosMatriculados', {
      collection: 'enrollments',
      filtros: {
        ativo: "status === 'active' && enrolledInEBD !== false",
        unicidade: 'personId',
      },
      quantidadeFinal: memberMetrics.currentEnrolledMembers,
      amostra: activeEnrollmentRecords.slice(0, 5).map((item) => ({
        id: item.id,
        personId: item.personId,
        classId: item.classId,
        status: item.status,
        enrolledInEBD: item.enrolledInEBD,
      })),
    })
  }, [
    activeEnrollmentRecords,
    duplicatedEnrollmentGroups,
    enrollments,
    listEntries,
    memberMetrics.currentEnrolledMembers,
    memberMetrics.missingMembers,
    memberMetrics.totalMembers,
    people,
    uniqueActiveEnrolledPersonIds,
  ])

  function openCreateModal() {
    if (!canManageEnrollments) {
      window.alert('Somente administradores podem criar matriculas.')
      return
    }
    setEditing(null)
    setForm(ENROLLMENT_DEFAULT)
    setModalOpen(true)
  }

  function openEditModal(item) {
    if (!canManageEnrollments) {
      window.alert('Somente administradores podem editar matriculas.')
      return
    }
    setEditing(item)
    setForm({
      personId: item.personId || '',
      classId: item.classId || '',
      enrolledInEBD: item.enrolledInEBD !== false,
      enrollmentDate: item.enrollmentDate || new Date().toISOString().slice(0, 10),
      status: item.status || 'active',
      notes: item.notes || '',
    })
    setModalOpen(true)
  }

  async function handleSave() {
    if (!canManageEnrollments) {
      window.alert('Acao nao permitida para o seu perfil.')
      return
    }
    if (!form.personId) {
      window.alert('Selecione um aluno para matricular.')
      return
    }
    if (!form.classId) {
      window.alert('Selecione uma classe para a matricula.')
      return
    }

    const className = classMap[form.classId]?.name || ''
    const personName = personMap[form.personId]?.fullName || ''
    const statusHistory = buildEnrollmentStatusHistory(editing, {
      status: form.status,
      enrolledInEBD: form.enrolledInEBD,
    })

    try {
      await saveEnrollment(
        user.uid,
        {
          personId: form.personId,
          personName,
          classId: form.classId,
          className,
          enrolledInEBD: form.enrolledInEBD,
          enrollmentDate: form.enrollmentDate,
          status: form.status,
          statusHistory,
          notes: form.notes.trim(),
        },
        editing?.id,
      )
    } catch (error) {
      console.error('[EnrollmentsPage][save] Erro ao salvar matricula:', {
        personId: form.personId,
        classId: form.classId,
        error,
      })
      window.alert('Erro ao salvar matricula. Verifique o console para detalhes.')
      return
    }

    setModalOpen(false)
    await loadData()
  }

  async function handleToggleStatus(item) {
    if (!canManageEnrollments) {
      window.alert('Acao nao permitida para o seu perfil.')
      return
    }

    const nextStatus = item.status === 'active' ? 'inactive' : 'active'
    const nextEnrolledInEBD = item.status === 'active' ? false : true

    await saveEnrollment(
      user.uid,
      {
        status: nextStatus,
        enrolledInEBD: nextEnrolledInEBD,
        statusHistory: buildEnrollmentStatusHistory(item, {
          status: nextStatus,
          enrolledInEBD: nextEnrolledInEBD,
        }),
      },
      item.id,
    )
    await loadData()
  }

  return (
    <div className="feature-page">
      <div className="feature-header">
        <div>
          <h2 className="feature-title">Matriculas EBD</h2>
          <p className="feature-subtitle">Vinculo entre cadastro geral e classes</p>
        </div>
        {canManageEnrollments && <Button onClick={openCreateModal}>Nova Matricula</Button>}
      </div>

      <Card>
        <CardHeader
          title="Cobertura de membros"
          subtitle={`${memberMetrics.previousMonthLabel} x ${memberMetrics.currentMonthLabel}`}
        />
        <div className="summary-grid">
          <div className="summary-item">
            <span className="summary-label">Membros cadastrados</span>
            <span className="summary-value">{memberMetrics.totalMembers}</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">Membros matriculados</span>
            <span className="summary-value">{memberMetrics.currentEnrolledMembers}</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">Percentual atual</span>
            <span className="summary-value">{memberMetrics.currentPercent.toFixed(1)}%</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">Faltam matricular</span>
            <span className="summary-value">{memberMetrics.missingMembers}</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">{memberMetrics.previousMonthLabel}</span>
            <span className="summary-value">{memberMetrics.previousPercent.toFixed(1)}%</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">Variacao mensal</span>
            <span className="summary-value">
              {memberMetrics.deltaPercent === null
                ? '--'
                : `${memberMetrics.deltaPercent >= 0 ? '+' : ''}${memberMetrics.deltaPercent.toFixed(1)} p.p.`}
            </span>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Registros de matrícula"
          subtitle={`${enrollments.length} registro(s) totais · ${activeEnrollmentRecords.length} vínculo(s) ativo(s) · ${uniqueActiveEnrolledPersonIds.size} pessoa(s) única(s) matriculada(s)`}
        />
        <div className="entity-list">
          {listEntries.length === 0 && <p className="feature-subtitle">Nenhuma matricula cadastrada.</p>}
          {listEntries.map((item) => (
            <div key={item.id} className="entity-row">
              <div>
                <div className="entity-title">{personMap[item.personId]?.fullName || 'Pessoa removida'}</div>
                <div className="entity-meta">
                  Classe: {classMap[item.classId]?.name || item.className || 'Nao informada'} - Matricula: {item.enrollmentDate || 'Sem data'}
                </div>
                <span className={`entity-status ${item.status === 'active' ? 'active' : 'inactive'}`}>
                  {item.status === 'active' ? 'Ativa' : 'Inativa'}
                </span>
              </div>
              <div className="row-actions">
                {canManageEnrollments && (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => openEditModal(item)}>Editar</Button>
                    <Button size="sm" variant="ghost" onClick={() => handleToggleStatus(item)}>
                      {item.status === 'active' ? 'Inativar' : 'Ativar'}
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {canManageEnrollments && (
        <Modal
          isOpen={isModalOpen}
          onClose={() => setModalOpen(false)}
          title={editing ? 'Editar matricula' : 'Matricular pessoa'}
          footer={<Button onClick={handleSave}>{editing ? 'Salvar alteracoes' : 'Matricular'}</Button>}
        >
          <div className="inline-form">
            <label htmlFor="enroll-person">Pessoa</label>
            <select
              id="enroll-person"
              value={form.personId}
              onChange={(event) => setForm((prev) => ({ ...prev, personId: event.target.value }))}
            >
              <option value="">Selecione</option>
              {people
                .filter((person) => person.active !== false)
                .map((person) => (
                  <option key={person.id} value={person.id}>{person.fullName}</option>
                ))}
            </select>

            <label htmlFor="enroll-class">Classe</label>
            <select
              id="enroll-class"
              value={form.classId}
              onChange={(event) => setForm((prev) => ({ ...prev, classId: event.target.value }))}
            >
              <option value="">Selecione</option>
              {classes
                .filter((item) => item.active !== false)
                .map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
            </select>

            <label htmlFor="enroll-date">Data da matricula</label>
            <input
              id="enroll-date"
              type="date"
              value={form.enrollmentDate}
              onChange={(event) => setForm((prev) => ({ ...prev, enrollmentDate: event.target.value }))}
            />

            <label htmlFor="enroll-status">Status</label>
            <select
              id="enroll-status"
              value={form.status}
              onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}
            >
              <option value="active">Ativa</option>
              <option value="inactive">Inativa</option>
            </select>

            <label htmlFor="enroll-notes">Observacoes</label>
            <textarea
              id="enroll-notes"
              value={form.notes}
              onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
            />
          </div>
        </Modal>
      )}
    </div>
  )
}
