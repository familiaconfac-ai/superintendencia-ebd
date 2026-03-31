import { useEffect, useState } from 'react'
import Button from '../../components/ui/Button'
import Card, { CardHeader } from '../../components/ui/Card'
import Modal from '../../components/ui/Modal'
import { useAuth } from '../../context/AuthContext'
import { listClasses, removeClass, saveClass, toggleClassStatus } from '../../services/classService'
import { listTeachers } from '../../services/teacherService'
import { listPeople } from '../../services/peopleService'
import { belongsToTeacherRecord } from '../../utils/accessControl'

const CLASS_DEFAULT = {
  name: '',
  department: '',
  defaultTeacherId: '',
  defaultTeacherName: '',
  active: true,
}

export default function ClassesPage() {
  const { user, profile, canManageClasses } = useAuth()
  const [classes, setClasses] = useState([])
  const [teachers, setTeachers] = useState([])
  const [students, setStudents] = useState([])
  const [isModalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(CLASS_DEFAULT)

  async function loadData() {
    if (!user?.uid) return
    const [classList, teacherList, studentList] = await Promise.all([
      listClasses(user.uid),
      listTeachers(user.uid),
      listPeople(user.uid),
    ])
    // Exibe todas as classes ativas para admin, e as do professor para professor
    const allowedClasses = canManageClasses
      ? classList.filter((item) => item.active !== false)
      : classList.filter((item) => item.active !== false && belongsToTeacherRecord(item, user, profile))
    setClasses(allowedClasses)
    setTeachers(teacherList)
    setStudents(studentList)
  }

  useEffect(() => {
    loadData()
  }, [user?.uid])

  function openCreateModal() {
    if (!canManageClasses) {
      window.alert('Somente administradores podem criar classes.')
      return
    }
    setEditing(null)
    setForm(CLASS_DEFAULT)
    setModalOpen(true)
  }

  function openEditModal(item) {
    if (!canManageClasses) {
      window.alert('Somente administradores podem editar classes.')
      return
    }
    setEditing(item)
    setForm({
      name: item.name || '',
      department: item.department || '',
      defaultTeacherId: item.defaultTeacherId || '',
      defaultTeacherName: item.defaultTeacherName || '',
      active: item.active !== false,
      studentIds: item.studentIds || [],
    })
    setModalOpen(true)
  }

  async function handleSave() {
    if (!canManageClasses) {
      window.alert('Ação não permitida para o seu perfil.')
      return
    }
    if (!form.name.trim()) return
    
    const selectedTeacher = teachers.find((t) => t.id === form.defaultTeacherId)
    // Novos campos para controle de acesso
    const teacherEmail = selectedTeacher?.email || ''
    const teacherName = selectedTeacher?.fullName || ''
    const teacherUid = selectedTeacher?.userUid || selectedTeacher?.uid || ''

    await saveClass(
      user.uid,
      {
        name: form.name.trim(),
        department: form.department.trim(),
        defaultTeacherId: form.defaultTeacherId,
        defaultTeacherName: teacherName,
        teacherEmail,
        teacherName,
        teacherUid,
        active: form.active,
        studentIds: form.studentIds || [],
      },
      editing?.id,
    )
    setModalOpen(false)
    await loadData()
  }

  async function handleToggle(item) {
    if (!canManageClasses) {
      window.alert('Ação não permitida para o seu perfil.')
      return
    }
    await toggleClassStatus(user.uid, item.id, item.active === false)
    await loadData()
  }

  async function handleRemove(item) {
    if (!canManageClasses) {
      window.alert('Ação não permitida para o seu perfil.')
      return
    }
    const confirmed = window.confirm(`Remover a classe ${item.name}?`)
    if (!confirmed) return
    await removeClass(user.uid, item.id)
    await loadData()
  }

  return (
    <div className="feature-page">
      <div className="feature-header">
        <div>
          <h2 className="feature-title">Classes e Departamentos</h2>
          <p className="feature-subtitle">
            {canManageClasses ? 'Estrutura de turmas da EBD' : 'Visualização das suas classes'}
          </p>
        </div>
        {canManageClasses && <Button onClick={openCreateModal}>Nova Classe</Button>}
      </div>

      <Card>
        <CardHeader title="Lista de classes" subtitle={`${classes.length} registro(s)`} />
        <div className="entity-list">
          {classes.length === 0 && <p className="feature-subtitle">Nenhuma classe cadastrada.</p>}
          {classes.map((item) => {
            // Permissão: admin acessa tudo, professor só a própria classe
            const canAccess = canManageClasses || (window.accessControlHelpers?.canAccessClass
              ? window.accessControlHelpers.canAccessClass(profile, item, user)
              : true)
            return (
              <div key={item.id} className="entity-row">
                <div>
                  <div className="entity-title">{item.name}</div>
                  <div className="entity-meta">Departamento: {item.department || 'Não informado'} • Professor padrão: {item.defaultTeacherName || 'Não informado'}</div>
                  <span className={`entity-status ${item.active === false ? 'inactive' : 'active'}`}>
                    {item.active === false ? 'Inativa' : 'Ativa'}
                  </span>
                </div>
                <div className="row-actions">
                  {canManageClasses && (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => openEditModal(item)}>Editar</Button>
                      <Button size="sm" variant="ghost" onClick={() => handleToggle(item)}>
                        {item.active === false ? 'Ativar' : 'Inativar'}
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => handleRemove(item)}>Excluir</Button>
                    </>
                  )}
                  {/* Botão abrir: admin vê todos, professor só a própria classe */}
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={!canAccess}
                    onClick={() => canAccess && window.open(`/classes/${item.id}`, '_self')}
                  >
                    Abrir
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      </Card>

      {canManageClasses && <Modal
        isOpen={isModalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Editar classe' : 'Nova classe'}
        footer={<Button onClick={handleSave}>{editing ? 'Salvar alterações' : 'Cadastrar classe'}</Button>}
      >
        <div className="inline-form">
          <label htmlFor="class-name">Nome da classe</label>
          <input
            id="class-name"
            value={form.name}
            onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
          />

          <label htmlFor="class-department">Departamento</label>
          <input
            id="class-department"
            value={form.department}
            onChange={(event) => setForm((prev) => ({ ...prev, department: event.target.value }))}
            placeholder="Adultos, Jovens, Infantil..."
          />

          <label htmlFor="class-teacher">Professor padrão (opcional)</label>
          <select
            id="class-teacher"
            value={form.defaultTeacherId}
            onChange={(event) => {
              const teacherId = event.target.value
              const teacher = teachers.find((t) => t.id === teacherId)
              setForm((prev) => ({
                ...prev,
                defaultTeacherId: teacherId,
                defaultTeacherName: teacher?.fullName || '',
              }))
            }}
          >
            <option value="">Selecione um professor</option>
            {teachers
              .filter((item) => item.active !== false)
              .map((teacher) => (
                <option key={teacher.id} value={teacher.id}>{teacher.fullName}</option>
              ))}
          </select>
          {teachers.filter((item) => item.active !== false).length === 0 && (
            <p className="feature-subtitle" style={{ marginTop: '8px', fontSize: '0.85rem' }}>
              📌 Nenhum professor ativo. <a href="/professores" style={{ textDecoration: 'underline', color: '#0066cc' }}>Cadastre um professor</a>
            </p>
          )}

          <label htmlFor="class-students">Alunos da classe</label>
          <input
            id="class-students-search"
            type="text"
            placeholder="Buscar aluno por nome"
            value={form.studentSearch || ''}
            onChange={e => setForm(prev => ({ ...prev, studentSearch: e.target.value }))}
            style={{ marginBottom: 8, width: '100%' }}
          />
          <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid #eee', borderRadius: 4, padding: 8 }}>
            {students
              .filter(s => s.active !== false)
              .filter(s => !form.studentSearch || (s.fullName || '').toLowerCase().includes(form.studentSearch.toLowerCase()))
              .sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''))
              .map(student => (
                <label key={student.id} style={{ display: 'flex', alignItems: 'center', marginBottom: 4, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={Array.isArray(form.studentIds) && form.studentIds.includes(student.id)}
                    onChange={e => {
                      setForm(prev => {
                        const ids = Array.isArray(prev.studentIds) ? [...prev.studentIds] : []
                        if (e.target.checked) {
                          if (!ids.includes(student.id)) ids.push(student.id)
                        } else {
                          const idx = ids.indexOf(student.id)
                          if (idx > -1) ids.splice(idx, 1)
                        }
                        return { ...prev, studentIds: ids }
                      })
                    }}
                    style={{ marginRight: 8 }}
                  />
                  {student.fullName}
                </label>
              ))}
            {students.filter(s => s.active !== false).length === 0 && (
              <p className="feature-subtitle" style={{ marginTop: '8px', fontSize: '0.85rem' }}>
                📌 Nenhum aluno ativo. <a href="/alunos" style={{ textDecoration: 'underline', color: '#0066cc' }}>Cadastre um aluno</a>
              </p>
            )}
          </div>
        </div>
      </Modal>}
    </div>
  )
}
