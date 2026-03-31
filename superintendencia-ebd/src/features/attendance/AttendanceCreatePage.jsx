import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { listClasses } from '../../services/classService'
import { listTeachers } from '../../services/teacherService'
import { listEnrollments } from '../../services/enrollmentService'
import { listPeople } from '../../services/peopleService'
import { saveAttendanceRegister } from '../../services/attendanceService'
import Button from '../../components/ui/Button'
import Card, { CardHeader } from '../../components/ui/Card'
import { getSundaysByMonthYear } from '../../utils/attendanceUtils'

const currentDate = new Date()
const REGISTER_DEFAULT = {
  teacherId: '',
  teacherName: '',
  classId: '',
  studentIds: [],
  discipline: '',
  month: currentDate.getMonth() + 1,
  year: currentDate.getFullYear(),
}

function extractClassStudentIds(classRecord) {
  if (!classRecord) return []
  const idsFromDirectFields = [
    ...(Array.isArray(classRecord.enrolledStudentIds) ? classRecord.enrolledStudentIds : []),
    ...(Array.isArray(classRecord.studentIds) ? classRecord.studentIds : []),
  ]
  const idsFromStudentsArray = Array.isArray(classRecord.students)
    ? classRecord.students.map((item) => {
        if (typeof item === 'string') return item
        return item?.personId || item?.studentId || item?.id || ''
      }).filter(Boolean)
    : []
  return [...new Set([...idsFromDirectFields, ...idsFromStudentsArray])]
}

export default function AttendanceCreatePage() {
  const { user, canManageStructure } = useAuth()
  const [people, setPeople] = useState([])
  const [teachers, setTeachers] = useState([])
  const [classes, setClasses] = useState([])
  const [enrollments, setEnrollments] = useState([])
  const [form, setForm] = useState(REGISTER_DEFAULT)
  const [studentSearch, setStudentSearch] = useState('')
  useEffect(() => {
    async function loadData() {
      const [peopleList, teacherList, classList, enrollmentList] = await Promise.all([
        listPeople(user.uid),
        listTeachers(user.uid),
        listClasses(user.uid),
        listEnrollments(user.uid),
      ])
      setPeople(peopleList)
      setTeachers(teacherList)
      setClasses(classList.filter((item) => item.active !== false))
      setEnrollments(enrollmentList)
    }
    if (user?.uid) loadData()
  }, [user?.uid])

  const classMap = useMemo(() => Object.fromEntries(classes.map((item) => [item.id, item])), [classes])
  const activeEnrollments = useMemo(() => enrollments.filter((item) => item.status === 'active' && item.enrolledInEBD !== false), [enrollments])

  function getClassLinkedStudentIds(classId) {
    if (!classId) return []
    const fromEnrollments = activeEnrollments.filter((item) => item.classId === classId).map((item) => item.personId)
    const fromLegacyClass = extractClassStudentIds(classMap[classId])
    return [...new Set([...fromEnrollments, ...fromLegacyClass])]
  }

  const availableStudents = useMemo(() => {
    return people
      .filter((item) => item.active !== false)
      .filter((item) => item.fullName.toLowerCase().includes(studentSearch.toLowerCase()))
      .sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''))
  }, [people, studentSearch])

  async function handleCreateRegister() {
    if (!form.classId) {
      window.alert('Selecione uma classe.')
      return
    }
    if (!form.teacherId) {
      window.alert('Selecione um professor.')
      return
    }
    if (!form.discipline.trim()) {
      window.alert('Informe a disciplina.')
      return
    }
    const selectedTeacher = teachers.find((t) => t.id === form.teacherId)
    // Corrigir: garantir que authUid do professor seja usado se existir
    const teacherAuthUid = selectedTeacher?.authUid || selectedTeacher?.userUid || selectedTeacher?.uid || ''
    const classRecord = classMap[form.classId]
    const sundayDates = getSundaysByMonthYear(Number(form.month), Number(form.year))
    const classEnrollments = enrollments.filter((item) => item.classId === form.classId && item.status === 'active' && item.enrolledInEBD !== false).map((item) => item.personId)
    const classLegacyIds = extractClassStudentIds(classRecord)
    const allStudentIds = [...new Set([...(form.studentIds || []), ...classEnrollments, ...classLegacyIds])]
    if (allStudentIds.length === 0) {
      window.alert('Esta classe ainda não tem alunos vinculados. Faça as matrículas antes de criar a caderneta.')
      return
    }
    const attendanceByStudent = allStudentIds.reduce((acc, personId) => {
      acc[personId] = {}
      return acc
    }, {})
    try {
      await saveAttendanceRegister(user.uid, {
        teacherId: form.teacherId,
        teacherName: selectedTeacher?.fullName || '',
        teacherAuthUid,
        teacherEmail: (selectedTeacher?.email || '').toLowerCase(),
        classId: form.classId,
        className: classMap[form.classId]?.name || '',
        discipline: form.discipline.trim(),
        month: Number(form.month),
        year: Number(form.year),
        sundayDates,
        enrolledStudentIds: allStudentIds,
        attendanceByStudent,
      })
      setForm(REGISTER_DEFAULT)
      window.alert('Caderneta criada com sucesso!')
    } catch (error) {
      window.alert('Erro ao criar caderneta. Verifique o console para detalhes.')
      console.error(error)
    }
  }

  if (!canManageStructure) {
    return <div className="feature-page"><h2>Somente administradores podem criar cadernetas.</h2></div>
  }

  return (
    <div className="feature-page">
      <div className="feature-header">
        <h2 className="feature-title">Cadastrar Caderneta</h2>
        <p className="feature-subtitle">Preencha os dados para criar uma nova caderneta</p>
      </div>
      <Card>
        <CardHeader title="Nova caderneta" />
        <div className="inline-form">
          <label htmlFor="attendance-teacher">Professor</label>
          <select
            id="attendance-teacher"
            value={form.teacherId}
            onChange={e => setForm(prev => ({ ...prev, teacherId: e.target.value }))}
          >
            <option value="">Selecione um professor</option>
            {teachers.filter((item) => item.active !== false).map((teacher) => (
              <option key={teacher.id} value={teacher.id}>{teacher.fullName}</option>
            ))}
          </select>
          <label htmlFor="attendance-class">Classe</label>
          <select
            id="attendance-class"
            value={form.classId}
            onChange={e => setForm(prev => ({ ...prev, classId: e.target.value, studentIds: getClassLinkedStudentIds(e.target.value) }))}
          >
            <option value="">Selecione uma classe</option>
            {classes.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
          <label htmlFor="attendance-students">Alunos</label>
          <input
            id="attendance-students-search"
            type="text"
            placeholder="Buscar aluno por nome"
            value={studentSearch}
            onChange={e => setStudentSearch(e.target.value)}
            style={{ marginBottom: 8, width: '100%' }}
          />
          <div className="selection-list">
            {availableStudents.length === 0 && (
              <div style={{ fontSize: '0.95em', color: '#888', padding: 8 }}>Nenhum aluno encontrado</div>
            )}
            {availableStudents.map(person => (
              <label key={person.id} className="selection-item">
                <input
                  type="checkbox"
                  checked={form.studentIds?.includes(person.id) || false}
                  onChange={e => {
                    setForm(prev => {
                      const ids = new Set(prev.studentIds || [])
                      if (e.target.checked) ids.add(person.id)
                      else ids.delete(person.id)
                      return { ...prev, studentIds: Array.from(ids) }
                    })
                  }}
                />
                <span>{person.fullName}</span>
              </label>
            ))}
          </div>
          <label htmlFor="attendance-discipline">Disciplina / Tema</label>
          <input
            id="attendance-discipline"
            value={form.discipline}
            onChange={e => setForm(prev => ({ ...prev, discipline: e.target.value }))}
            placeholder="Ex: Gênesis, Parábolas do Reino, etc"
          />
          <div className="filter-row">
            <div>
              <label htmlFor="attendance-month">Mês</label>
              <input
                id="attendance-month"
                type="number"
                min="1"
                max="12"
                value={form.month}
                onChange={e => setForm(prev => ({ ...prev, month: e.target.value }))}
              />
            </div>
            <div>
              <label htmlFor="attendance-year">Ano</label>
              <input
                id="attendance-year"
                type="number"
                min="2020"
                value={form.year}
                onChange={e => setForm(prev => ({ ...prev, year: e.target.value }))}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'end' }}>
              <Button onClick={handleCreateRegister}>Criar Caderneta</Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}
