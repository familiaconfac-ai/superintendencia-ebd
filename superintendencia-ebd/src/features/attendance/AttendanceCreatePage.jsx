import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { listClasses } from '../../services/classService'
import { listTeachers } from '../../services/teacherService'
import { listEnrollments } from '../../services/enrollmentService'
import { listPeople } from '../../services/peopleService'
import { saveAttendanceRegister } from '../../services/attendanceService'
import Button from '../../components/ui/Button'
import Card, { CardHeader } from '../../components/ui/Card'
import { formatDateLabel, getQuarterRange } from '../../utils/attendanceUtils'

const currentDate = new Date()

function getDefaultRegisterForm() {
  return {
    teacherId: '',
    teacherName: '',
    classId: '',
    studentIds: [],
    discipline: '',
    startDate: new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).toISOString().slice(0, 10),
  }
}

function extractClassStudentIds(classRecord) {
  if (!classRecord) return []

  const idsFromDirectFields = [
    ...(Array.isArray(classRecord.enrolledStudentIds) ? classRecord.enrolledStudentIds : []),
    ...(Array.isArray(classRecord.studentIds) ? classRecord.studentIds : []),
  ]
  const idsFromStudentsArray = Array.isArray(classRecord.students)
    ? classRecord.students
      .map((item) => {
        if (typeof item === 'string') return item
        return item?.personId || item?.studentId || item?.id || ''
      })
      .filter(Boolean)
    : []

  return [...new Set([...idsFromDirectFields, ...idsFromStudentsArray])]
}

function isGeneratedStudentPlaceholder(value = '') {
  return /^Aluno\s+\d+$/i.test(String(value || '').trim())
}

function extractRegisterStudentIds(register) {
  if (!register) return []

  const idsFromDirectFields = [
    ...(Array.isArray(register.enrolledStudentIds) ? register.enrolledStudentIds : []),
    ...(Array.isArray(register.studentIds) ? register.studentIds : []),
  ]
  const idsFromSnapshot = Array.isArray(register.studentsSnapshot)
    ? register.studentsSnapshot
      .filter((item) => !isGeneratedStudentPlaceholder(item?.fullName || item?.name || ''))
      .map((item) => item?.id || item?.personId || item?.studentId || '')
      .filter(Boolean)
    : []

  return [...new Set([...idsFromDirectFields, ...idsFromSnapshot])]
}

function buildStudentsSnapshot(studentIds, people) {
  const peopleMap = Object.fromEntries((people || []).map((item) => [item.id, item]))

  return (studentIds || []).map((personId) => {
    const person = peopleMap[personId]
    if (!person) return null
    return {
      id: personId,
      fullName: person.fullName || person.name || '',
      active: person.active !== false,
    }
  }).filter((item) => item?.id && item.fullName)
}

export default function AttendanceCreatePage() {
  const { user, canManageStructure } = useAuth()
  const location = useLocation()
  const editRegister = location.state?.editRegister || null
  const duplicateRegister = location.state?.duplicateRegister || null
  const sourceRegister = editRegister || duplicateRegister
  const isEditing = !!editRegister
  const isDuplicating = !isEditing && !!duplicateRegister
  const [people, setPeople] = useState([])
  const [teachers, setTeachers] = useState([])
  const [classes, setClasses] = useState([])
  const [enrollments, setEnrollments] = useState([])
  const [form, setForm] = useState(getDefaultRegisterForm)
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
  const activeEnrollments = useMemo(
    () => enrollments.filter((item) => item.status === 'active' && item.enrolledInEBD !== false),
    [enrollments],
  )

  function getClassLinkedStudentIds(classId) {
    if (!classId) return []
    const fromEnrollments = activeEnrollments.filter((item) => item.classId === classId).map((item) => item.personId)
    const fromLegacyClass = extractClassStudentIds(classMap[classId])
    return [...new Set([...fromEnrollments, ...fromLegacyClass])]
  }

  const availableStudents = useMemo(() => {
    const selectedStudentIds = new Set(form.studentIds || [])
    return people
      .filter((item) => item.active !== false || selectedStudentIds.has(item.id))
      .filter((item) => (item.fullName || '').toLowerCase().includes(studentSearch.toLowerCase()))
      .sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''))
  }, [form.studentIds, people, studentSearch])

  useEffect(() => {
    if (!sourceRegister) return

    setForm({
      teacherId: sourceRegister.teacherId || '',
      teacherName: sourceRegister.teacherName || '',
      classId: sourceRegister.classId || '',
      studentIds: extractRegisterStudentIds(sourceRegister),
      discipline: sourceRegister.discipline || '',
      startDate: sourceRegister.startDate || getDefaultRegisterForm().startDate,
    })
    setStudentSearch('')
  }, [sourceRegister])

  function buildAttendancePayload(studentIds, sundayDates) {
    if (!isEditing) {
      return studentIds.reduce((acc, personId) => {
        acc[personId] = {}
        return acc
      }, {})
    }

    const existingAttendance = sourceRegister?.attendanceByStudent || {}
    const validDates = new Set(sundayDates)

    return studentIds.reduce((acc, personId) => {
      const existingStudentAttendance = existingAttendance[personId] || {}
      acc[personId] = Object.keys(existingStudentAttendance).reduce((studentAcc, date) => {
        if (validDates.has(date)) {
          studentAcc[date] = existingStudentAttendance[date]
        }
        return studentAcc
      }, {})
      return acc
    }, {})
  }

  function buildStudentStatusesPayload(studentIds) {
    if (!isEditing) return undefined

    const existingStatuses = sourceRegister?.studentStatuses || {}
    return studentIds.reduce((acc, personId) => {
      if (existingStatuses[personId]) {
        acc[personId] = existingStatuses[personId]
      }
      return acc
    }, {})
  }

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

    const selectedTeacher = teachers.find((teacher) => teacher.id === form.teacherId)
    const teacherAuthUid = selectedTeacher?.authUid || selectedTeacher?.userUid || selectedTeacher?.uid || ''
    const classRecord = classMap[form.classId]
    const quarterRange = getQuarterRange(form.startDate)
    const sundayDates = quarterRange.sundayDates
    const classEnrollments = enrollments
      .filter((item) => item.classId === form.classId && item.status === 'active' && item.enrolledInEBD !== false)
      .map((item) => item.personId)
    const classLegacyIds = extractClassStudentIds(classRecord)
    const allStudentIds = [...new Set([...(form.studentIds || []), ...classEnrollments, ...classLegacyIds])]

    if (allStudentIds.length === 0) {
      window.alert('Esta classe ainda nao tem alunos vinculados. Faca as matriculas antes de criar a caderneta.')
      return
    }

    const attendanceByStudent = buildAttendancePayload(allStudentIds, sundayDates)
    const studentsSnapshot = buildStudentsSnapshot(allStudentIds, people)
    const studentStatuses = buildStudentStatusesPayload(allStudentIds)

    try {
      await saveAttendanceRegister(user.uid, {
        ownerUid: isEditing ? sourceRegister?.ownerUid || user.uid : user.uid,
        createdByUid: isEditing ? sourceRegister?.createdByUid || user.uid : user.uid,
        teacherId: form.teacherId,
        teacherName: selectedTeacher?.fullName || '',
        teacherAuthUid,
        teacherUid: teacherAuthUid,
        teacherEmail: (selectedTeacher?.email || '').toLowerCase(),
        classId: form.classId,
        className: classMap[form.classId]?.name || '',
        discipline: form.discipline.trim(),
        month: new Date(`${quarterRange.startDate}T00:00:00`).getMonth() + 1,
        year: new Date(`${quarterRange.startDate}T00:00:00`).getFullYear(),
        startDate: quarterRange.startDate,
        endDate: quarterRange.endDate,
        periodType: 'quarterly',
        sundayDates,
        enrolledStudentIds: allStudentIds,
        attendanceByStudent,
        studentsSnapshot,
        ...(studentStatuses ? { studentStatuses } : {}),
      }, isEditing ? sourceRegister.id : null)
      setForm(getDefaultRegisterForm())
      window.alert(
        isEditing
          ? 'Caderneta atualizada com sucesso!'
          : isDuplicating
            ? 'Copia da caderneta criada com sucesso!'
            : 'Caderneta trimestral criada com sucesso!',
      )
    } catch (error) {
      window.alert('Erro ao salvar caderneta. Verifique o console para detalhes.')
      console.error(error)
    }
  }

  if (!canManageStructure) {
    return <div className="feature-page"><h2>Somente administradores podem criar cadernetas.</h2></div>
  }

  return (
    <div className="feature-page">
      <div className="feature-header">
        <div>
          <h2 className="feature-title">
            {isEditing ? 'Editar Caderneta Trimestral' : isDuplicating ? 'Duplicar Caderneta Trimestral' : 'Cadastrar Caderneta Trimestral'}
          </h2>
          <p className="feature-subtitle">
            {isEditing
              ? 'Ajuste professor, alunos e periodo da caderneta existente.'
              : isDuplicating
              ? 'Ajuste professor, alunos e periodo antes de salvar a copia.'
              : 'Defina o inicio e o sistema calcula automaticamente o trimestre completo'}
          </p>
        </div>
      </div>
      <Card>
        <CardHeader
          title={isEditing ? 'Editar caderneta existente' : isDuplicating ? 'Nova copia da caderneta' : 'Nova caderneta trimestral'}
          subtitle={sourceRegister ? `${sourceRegister.className || 'Classe'} - ${sourceRegister.teacherName || 'Professor'}` : undefined}
        />
        <div className="inline-form">
          <label htmlFor="attendance-teacher">Professor</label>
          <select
            id="attendance-teacher"
            value={form.teacherId}
            onChange={(event) => setForm((prev) => ({ ...prev, teacherId: event.target.value }))}
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
            onChange={(event) => setForm((prev) => ({
              ...prev,
              classId: event.target.value,
              studentIds: getClassLinkedStudentIds(event.target.value),
            }))}
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
            onChange={(event) => setStudentSearch(event.target.value)}
            style={{ marginBottom: 8, width: '100%' }}
          />
          <div className="selection-list">
            {availableStudents.length === 0 && (
              <div style={{ fontSize: '0.95em', color: '#888', padding: 8 }}>Nenhum aluno encontrado</div>
            )}
            {availableStudents.map((person) => (
              <label key={person.id} className="selection-item">
                <input
                  type="checkbox"
                  checked={form.studentIds?.includes(person.id) || false}
                  onChange={(event) => {
                    setForm((prev) => {
                      const ids = new Set(prev.studentIds || [])
                      if (event.target.checked) ids.add(person.id)
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
            onChange={(event) => setForm((prev) => ({ ...prev, discipline: event.target.value }))}
            placeholder="Ex: Genesis, Parabolas do Reino, etc"
          />

          <div className="filter-row">
            <div>
              <label htmlFor="attendance-start-date">Inicio do trimestre</label>
              <input
                id="attendance-start-date"
                type="date"
                value={form.startDate}
                onChange={(event) => setForm((prev) => ({ ...prev, startDate: event.target.value }))}
              />
            </div>
            <div>
              <label htmlFor="attendance-end-date">Fim automatico</label>
              <input
                id="attendance-end-date"
                value={formatDateLabel(getQuarterRange(form.startDate).endDate)}
                readOnly
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'end' }}>
              <Button onClick={handleCreateRegister}>
                {isEditing ? 'Salvar Alteracoes' : isDuplicating ? 'Salvar Copia' : 'Criar Caderneta'}
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}
