import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { listClasses } from '../../services/classService'
import { listTeachers, syncTeacherUidsFromUsers } from '../../services/teacherService'
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
  // NOVO: lê do campo students (prioridade se os anteriores estiverem vazios)
  const idsFromStudentsField = Array.isArray(register.students)
    ? register.students.map((item) => item?.id || '').filter(Boolean)
    : []

  return [...new Set([...idsFromDirectFields, ...idsFromSnapshot, ...idsFromStudentsField])]
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
      // Sync UIDs: garante que professores sem uid/authUid recebam o UID do users collection
      const syncedTeachers = await syncTeacherUidsFromUsers(user.uid, teacherList).catch((e) => {
        // eslint-disable-next-line no-console
        console.warn('[TEACHER_SYNC_DEBUG] Erro na sincronização automática de UIDs:', e?.message)
        return teacherList
      })
      // eslint-disable-next-line no-console
      console.log('[REGISTER_DEBUG] teachers após sync:', syncedTeachers.map((t) => ({
        id: t.id,
        name: t.fullName,
        email: t.email,
        uid: t.uid,
        authUid: t.authUid,
      })))
      setPeople(peopleList)
      setTeachers(syncedTeachers)
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

    const extractedStudentIds = extractRegisterStudentIds(sourceRegister)

    // [DUPLICATE_DEBUG] logs da caderneta original
    // eslint-disable-next-line no-console
    console.log('[DUPLICATE_DEBUG] caderneta original id:', sourceRegister.id)
    console.log('[DUPLICATE_DEBUG] caderneta original completa:', JSON.stringify(sourceRegister, null, 2))
    console.log('[DUPLICATE_DEBUG] classId original:', sourceRegister.classId)
    console.log('[DUPLICATE_DEBUG] teacherEmail original:', sourceRegister.teacherEmail)
    console.log('[DUPLICATE_DEBUG] ownerUid original:', sourceRegister.ownerUid)
    console.log('[DUPLICATE_DEBUG] createdByUid original:', sourceRegister.createdByUid)
    console.log('[DUPLICATE_DEBUG] students original count:', Array.isArray(sourceRegister.students) ? sourceRegister.students.length : 0)
    console.log('[DUPLICATE_DEBUG] students original sample:', Array.isArray(sourceRegister.students) ? sourceRegister.students.slice(0, 3) : [])
    console.log('[DUPLICATE_DEBUG] studentIds extraídos para o form:', extractedStudentIds)

    // eslint-disable-next-line no-console
    console.log('[REGISTER_DEBUG_FORM] === ORIGEM DA DUPLICAÇÃO/EDIÇÃO ===')
    console.log('[REGISTER_DEBUG_FORM] sourceRegister.id:', sourceRegister.id)
    console.log('[REGISTER_DEBUG_FORM] originalTeacherId (sourceRegister.teacherId):', sourceRegister.teacherId)
    console.log('[REGISTER_DEBUG_FORM] originalTeacherName (sourceRegister.teacherName):', sourceRegister.teacherName)
    console.log('[REGISTER_DEBUG_FORM] originalClassId (sourceRegister.classId):', sourceRegister.classId)
    console.log('[REGISTER_DEBUG_FORM] ownerUid da caderneta original:', sourceRegister.ownerUid)
    console.log('[REGISTER_DEBUG_FORM] createdByUid da caderneta original:', sourceRegister.createdByUid)

    setForm({
      teacherId: sourceRegister.teacherId || '',
      teacherName: sourceRegister.teacherName || '',
      classId: sourceRegister.classId || '',
      studentIds: extractedStudentIds,
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


    // [REGISTER_DEBUG_FORM] diagnóstico do professor visível vs resolvido
    // eslint-disable-next-line no-console
    const visibleTeacher = teachers.filter((t) => t.active !== false || t.id === form.teacherId).find((t) => t.id === form.teacherId) || null
    const resolvedTeacherAll = teachers.find((t) => t.id === form.teacherId) || null
    console.log('[REGISTER_DEBUG_FORM] === DIAGNÓSTICO DO PROFESSOR NO SAVE ===')
    console.log('[REGISTER_DEBUG_FORM] form.teacherId:', form.teacherId)
    console.log('[REGISTER_DEBUG_FORM] form.classId:', form.classId)
    console.log('[REGISTER_DEBUG_FORM] professor EXIBIDO no select (ativo ou pré-selecionado):', visibleTeacher ? `${visibleTeacher.fullName} (id: ${visibleTeacher.id}, ativo: ${visibleTeacher.active !== false})` : 'NENHUM — teacherId não encontrado em nenhum professor')
    console.log('[REGISTER_DEBUG_FORM] professor RESOLVIDO no save (todos os professores):', resolvedTeacherAll ? `${resolvedTeacherAll.fullName} (id: ${resolvedTeacherAll.id})` : 'NENHUM')
    if (visibleTeacher?.id !== resolvedTeacherAll?.id) {
      console.warn('[REGISTER_DEBUG_FORM] ⚠️ DIVERGÊNCIA: professor exibido na UI ≠ professor resolvido no save')
      console.warn('[REGISTER_DEBUG_FORM] exibido:', JSON.stringify(visibleTeacher))
      console.warn('[REGISTER_DEBUG_FORM] será salvo:', JSON.stringify(resolvedTeacherAll))
    }
    // Detectar caso onde o professor está no form mas invisível no select (professor inativo pré-selecionado)
    const teacherInActiveList = teachers.filter((t) => t.active !== false).find((t) => t.id === form.teacherId)
    if (!teacherInActiveList && resolvedTeacherAll) {
      console.warn('[REGISTER_DEBUG_FORM] ⚠️ Professor pré-selecionado está INATIVO e invisível no select:', JSON.stringify(resolvedTeacherAll))
    }

    // [REGISTER_DEBUG_SAVE] diagnóstico completo no momento exato do save
    console.log('[REGISTER_DEBUG_SAVE] === INÍCIO DO SAVE ===')
    console.log('[REGISTER_DEBUG_SAVE] form.teacherId:', form.teacherId)
    console.log('[REGISTER_DEBUG_SAVE] lista teachers no momento do save (id/name/email/uid/authUid):',
      teachers.map((t) => ({ id: t.id, name: t.fullName, email: t.email, uid: t.uid, authUid: t.authUid }))
    )

    const selectedTeacher = teachers.find((teacher) => teacher.id === form.teacherId)

    console.log('[REGISTER_DEBUG_SAVE] professor encontrado por form.teacherId:', selectedTeacher ? 'SIM' : 'NÃO — id não bate com nenhum teacher')
    console.log('[REGISTER_DEBUG_SAVE] professor selecionado completo:', JSON.stringify(selectedTeacher, null, 2))
    console.log('[REGISTER_DEBUG_SAVE] campos de UID no professor resolvido:', {
      uid: selectedTeacher?.uid,
      authUid: selectedTeacher?.authUid,
      teacherAuthUid: selectedTeacher?.teacherAuthUid,
      userUid: selectedTeacher?.userUid,
      ownerUid: selectedTeacher?.ownerUid,
    })
    console.log('[REGISTER_DEBUG_SAVE] variável usada para validar UID: teacherAuthUid = uid || authUid || teacherAuthUid || userUid || ownerUid')
    console.log('[REGISTER_DEBUG_SAVE] classId:', form.classId)
    console.log('[REGISTER_DEBUG_SAVE] teacherEmail:', selectedTeacher?.email)
    console.log('[REGISTER_DEBUG_SAVE] teacherName:', selectedTeacher?.fullName || selectedTeacher?.name)

    // Fallback cobre todos os nomes de campo possíveis — prioriza uid (campo da coleção users)
    const teacherAuthUid = (
      selectedTeacher?.uid
      || selectedTeacher?.authUid
      || selectedTeacher?.teacherAuthUid
      || selectedTeacher?.userUid
      || selectedTeacher?.ownerUid
      || ''
    )
    const teacherUid = teacherAuthUid
    const teacherUserUid = teacherAuthUid
    const teacherId = selectedTeacher?.id || '' // id do professor na coleção de professores
    const teacherName = selectedTeacher?.fullName || selectedTeacher?.name || ''
    const teacherEmail = (selectedTeacher?.email || '').trim().toLowerCase()

    console.log('[REGISTER_DEBUG] teacherAuthUid resolvido:', teacherAuthUid)
    console.log('[REGISTER_DEBUG] campo-origem do UID:', (
      selectedTeacher?.uid ? 'uid'
      : selectedTeacher?.authUid ? 'authUid'
      : selectedTeacher?.teacherAuthUid ? 'teacherAuthUid'
      : selectedTeacher?.userUid ? 'userUid'
      : selectedTeacher?.ownerUid ? 'ownerUid'
      : 'NENHUM — professor sem UID no documento'
    ))
    const defaultTeacherId = teacherId
    const defaultTeacherName = teacherName
    const defaultTeacherEmail = teacherEmail
    const classRecord = classMap[form.classId]
    const quarterRange = getQuarterRange(form.startDate)
    const sundayDates = quarterRange.sundayDates
    const classEnrollments = enrollments
      .filter((item) => item.classId === form.classId && item.status === 'active' && item.enrolledInEBD !== false)
      .map((item) => item.personId)
    const classLegacyIds = extractClassStudentIds(classRecord)
    const allStudentIds = [...new Set([...(form.studentIds || []), ...classEnrollments, ...classLegacyIds])]

    // NOVO: Montar students array obrigatório
    const students = buildStudentsSnapshot(allStudentIds, people).map(s => ({ id: s.id, name: s.fullName }))

    // Validação obrigatória
    if (!students.length) {
      window.alert('Selecione ao menos um aluno para criar a caderneta.')
      return
    }

    // Validação extra dos campos obrigatórios
    if (!form.classId) {
      window.alert('Classe obrigatória.')
      return
    }
    if (!teacherEmail) {
      window.alert('Professor sem email.')
      return
    }
    if (!teacherAuthUid) {
      // eslint-disable-next-line no-console
      console.warn('[REGISTER_DEBUG] Professor sem UID. Documento completo:', JSON.stringify(selectedTeacher, null, 2))
      window.alert(
        'Professor selecionado não possui UID vinculado no cadastro.\n\n'
        + 'Campos verificados: authUid, teacherAuthUid, uid, userUid, ownerUid.\n\n'
        + 'Atualize o cadastro do professor antes de criar a caderneta.',
      )
      return
    }

    const attendanceByStudent = buildAttendancePayload(allStudentIds, sundayDates)
    const studentsSnapshot = buildStudentsSnapshot(allStudentIds, people)
    const studentStatuses = buildStudentStatusesPayload(allStudentIds)

    try {
      // Atualizar historicalTeacherLinks: mantém apenas links do professor selecionado
      let historicalTeacherLinks = []
      if (Array.isArray(sourceRegister?.historicalTeacherLinks)) {
        historicalTeacherLinks = sourceRegister.historicalTeacherLinks.filter(link => {
          const linkUid = link?.uid || link?.teacherUid || link?.teacherAuthUid || ''
          const linkEmail = (link?.email || link?.teacherEmail || '').trim().toLowerCase()
          return linkUid === teacherAuthUid || linkEmail === teacherEmail
        })
      }
      // Se não houver link do professor selecionado, adiciona
      if (!historicalTeacherLinks.some(link => (link?.uid || link?.teacherUid || link?.teacherAuthUid || '') === teacherAuthUid)) {
        historicalTeacherLinks.push({
          uid: teacherAuthUid,
          email: teacherEmail,
          name: teacherName,
          profileId: teacherId,
          linkedAt: new Date().toISOString(),
          source: 'edit-or-create',
        })
      }

      // LOG DE DIAGNÓSTICO
      // eslint-disable-next-line no-console
      console.log('[REGISTER_DEBUG]', {
        quantidadeAlunos: students.length,
        alunos: students,
        professor: {
          teacherId,
          teacherName,
          teacherEmail,
          teacherAuthUid,
          teacherUid,
          teacherUserUid,
        },
        classId: form.classId,
        ownerUid: teacherAuthUid,
        createdByUid: isEditing ? sourceRegister?.createdByUid || user.uid : user.uid,
      })
      if (isDuplicating) {
        // [DUPLICATE_DEBUG] payload exato antes de salvar cópia
        console.log('[DUPLICATE_DEBUG] payload nova caderneta (antes de salvar):', JSON.stringify({
          classId: form.classId,
          teacherEmail,
          ownerUid: teacherAuthUid,
          createdByUid: user.uid,
          studentsCount: students.length,
          students,
          enrolledStudentIds: allStudentIds,
        }, null, 2))
      }

      await saveAttendanceRegister(user.uid, {
        ownerUid: teacherAuthUid, // O professor selecionado é o dono
        createdByUid: isEditing ? sourceRegister?.createdByUid || user.uid : user.uid, // preserva quem criou
        teacherId,
        teacherName,
        teacherAuthUid,
        teacherUid,
        teacherUserUid,
        teacherEmail,
        defaultTeacherId,
        defaultTeacherName,
        defaultTeacherEmail,
        historicalTeacherLinks,
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
        students, // NOVO: campo obrigatório
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
            {teachers.filter((item) => item.active !== false || item.id === form.teacherId).map((teacher) => (
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
