import { useEffect, useMemo, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import Button from '../../components/ui/Button'
import Card, { CardHeader } from '../../components/ui/Card'
import { useAuth } from '../../context/AuthContext'
import { listAttendanceRegisters, removeAttendanceRegister, saveAttendanceRegister } from '../../services/attendanceService'
import { listClasses } from '../../services/classService'
import { listTeachers } from '../../services/teacherService'
import { listEnrollments, saveEnrollment } from '../../services/enrollmentService'
import { listPeople } from '../../services/peopleService'
import { generateAttendanceNotebookPDF } from '../../services/pdfService'
import { canAccessAttendanceRegister, isAdmin } from '../../utils/accessControl'
import {
  calculateClassSummary,
  calculateStudentAttendance,
  computeStudentEnrollmentStatus,
  cycleAttendanceStatus,
  formatMonthYear,
  formatRegisterPeriod,
  formatSundayLabel,
  getNextAttendanceStatus,
  getQuarterRange,
  getSundaysByMonthYear,
} from '../../utils/attendanceUtils'
import { buildEnrollmentStatusHistory } from '../../utils/enrollmentMetrics'

const currentDate = new Date()

const REGISTER_DEFAULT = {
  teacherId: '',
  teacherName: '',
  classId: '',
  studentIds: [],
  discipline: '',
  startDate: new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).toISOString().slice(0, 10),
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

function getRegisterOwnerUid(register, fallbackUid) {
  return register?.storageOwnerUid || register?.ownerUid || register?.createdByUid || fallbackUid || ''
}

function mergeById(list = []) {
  const map = new Map()
  list.forEach((item) => {
    if (!item?.id || map.has(item.id)) return
    map.set(item.id, item)
  })
  return Array.from(map.values())
}

function getOrderedUniqueIds(groups = []) {
  const ids = []
  const seen = new Set()

  groups.forEach((group) => {
    group.forEach((id) => {
      if (!id || seen.has(id)) return
      seen.add(id)
      ids.push(id)
    })
  })

  return ids
}

function isGeneratedStudentPlaceholder(value = '') {
  return /^Aluno\s+\d+$/i.test(String(value || '').trim())
}

function getRegisterStudents(register, classData, allStudents, activeEnrollments = []) {
  if (!register) return []

  const studentMap = Object.fromEntries((allStudents || []).map((item) => [item.id, item]))
  const snapshotStudents = Array.isArray(register.studentsSnapshot)
    ? register.studentsSnapshot.filter((item) => item?.id && !isGeneratedStudentPlaceholder(item?.fullName || item?.name || ''))
    : []
  snapshotStudents.forEach((item) => {
    if (!item?.id || studentMap[item.id]) return
    studentMap[item.id] = item
  })
  const idsFromRegister = Array.isArray(register.enrolledStudentIds) ? register.enrolledStudentIds : []
  const idsFromSnapshot = snapshotStudents.map((item) => item.id).filter(Boolean)
  const idsFromClassEnrollments = (activeEnrollments || [])
    .filter((item) => item.classId === register.classId)
    .map((item) => item.personId)
  const idsFromLegacyClass = extractClassStudentIds(classData)
  const idsFromAttendance = Object.keys(register.attendanceByStudent || {})

  return getOrderedUniqueIds([
    idsFromRegister,
    idsFromSnapshot,
    idsFromClassEnrollments,
    idsFromLegacyClass,
    idsFromAttendance,
  ])
    .map((personId) => studentMap[personId])
    .filter(Boolean)
}

function buildStudentStatuses(register, students) {
  const currentStatuses = register?.studentStatuses || {}

  return students.reduce((acc, student) => {
    const previousStatus = currentStatuses[student.id]?.enrollmentStatus || 'active'
    acc[student.id] = {
      ...currentStatuses[student.id],
      ...computeStudentEnrollmentStatus(register?.attendanceByStudent?.[student.id] || {}, previousStatus),
    }
    return acc
  }, {})
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

function buildRegisterTeacherPayload(teacherId, teachers = []) {
  const selectedTeacher = (teachers || []).find((item) => item.id === teacherId)
  const teacherAuthUid = selectedTeacher?.authUid || selectedTeacher?.userUid || selectedTeacher?.uid || ''

  return {
    teacherId: teacherId || '',
    teacherName: selectedTeacher?.fullName || '',
    teacherAuthUid,
    teacherUid: teacherAuthUid,
    teacherEmail: (selectedTeacher?.email || '').trim().toLowerCase(),
  }
}

function normalizeAttendanceMap(attendance = {}) {
  return Object.keys(attendance || {})
    .sort()
    .reduce((acc, personId) => {
      const dates = attendance?.[personId] || {}
      acc[personId] = Object.keys(dates)
        .sort()
        .reduce((dateAcc, date) => {
          dateAcc[date] = dates[date] || ''
          return dateAcc
        }, {})
      return acc
    }, {})
}

export default function AttendancePage() {
  const { user, profile, canManageStructure } = useAuth()
  const location = useLocation()
  const { registerId } = useParams()
  const [people, setPeople] = useState([])
  const [teachers, setTeachers] = useState([])
  const [classes, setClasses] = useState([])
  const [enrollments, setEnrollments] = useState([])
  const [registers, setRegisters] = useState([])
  const [form, setForm] = useState(REGISTER_DEFAULT)
  const [studentSearch, setStudentSearch] = useState('')
  const [selectedRegisterId, setSelectedRegisterId] = useState(registerId || location.state?.registerId || '')
  const [selectedRegisterOwnerUid, setSelectedRegisterOwnerUid] = useState(location.state?.registerOwnerUid || '')
  const [studentToAddId, setStudentToAddId] = useState('')
  const [dateToAdd, setDateToAdd] = useState('')
  const [dateToRemove, setDateToRemove] = useState('')
  const [draftAttendanceByStudent, setDraftAttendanceByStudent] = useState({})
  const [isRegisterOpen, setIsRegisterOpen] = useState(false)
  const [isSavingAttendance, setIsSavingAttendance] = useState(false)
  const [lastSavedRegisterId, setLastSavedRegisterId] = useState('')
  const [didAutoOpenRouteRegister, setDidAutoOpenRouteRegister] = useState(false)

  async function loadData() {
    if (!user?.uid) return
    try {
      const userIsAdmin = isAdmin(user)
      const registerList = await listAttendanceRegisters(user.uid)
      const peopleList = []
      const teacherList = []
      const classList = []
      const enrollmentList = []

      console.log('[ADMIN_CHECK]', {
        email: user?.email,
        isAdmin: userIsAdmin,
      })

      // Unificação: sempre usa attendanceRegisters como fonte de verdade
      setPeople(peopleList)
      setTeachers(teacherList)
      setClasses(classList.filter((item) => item.active !== false))
      setEnrollments(enrollmentList)
      // Admin vê todas as cadernetas, professor vê apenas as suas
      let filteredRegisters = []
      if (userIsAdmin) {
        filteredRegisters = registerList
      } else {
        filteredRegisters = registerList.filter((item) => canAccessAttendanceRegister(item, user, profile))
      }

      const [localPeople, localTeachers, localClasses, localEnrollments] = await Promise.all([
        listPeople(user.uid).catch(() => []),
        listTeachers(user.uid).catch(() => []),
        listClasses(user.uid).catch(() => []),
        listEnrollments(user.uid).catch(() => []),
      ])

      setPeople(mergeById(localPeople))
      setTeachers(mergeById(localTeachers))
      setClasses(mergeById(localClasses).filter((item) => item.active !== false))
      setEnrollments(mergeById(localEnrollments))
      setRegisters(filteredRegisters)
    } catch (error) {
      console.error('[AttendancePage] Erro ao carregar dados da caderneta:', error)
      window.alert('Erro ao carregar a caderneta. Verifique o console para detalhes.')
    }
  }

  useEffect(() => {
    loadData()
  }, [user?.uid])

  useEffect(() => {
    setDidAutoOpenRouteRegister(false)
    if (registerId) {
      setSelectedRegisterId(registerId)
      setSelectedRegisterOwnerUid(location.state?.registerOwnerUid || '')
      return
    }

    if (location.state?.registerId) {
      setSelectedRegisterId(location.state.registerId)
      setSelectedRegisterOwnerUid(location.state?.registerOwnerUid || '')
    }
  }, [location.state, registerId])

  const classMap = useMemo(
    () => Object.fromEntries(classes.map((item) => [item.id, item])),
    [classes],
  )

  const personMap = useMemo(
    () => Object.fromEntries(people.map((item) => [item.id, item])),
    [people],
  )

  const activeEnrollments = useMemo(
    () => enrollments.filter((item) => item.status === 'active' && item.enrolledInEBD !== false),
    [enrollments],
  )

  const selectedRegister = useMemo(
    () => registers.find((item) => (
      item.id === selectedRegisterId
      && (
        !selectedRegisterOwnerUid
        || getRegisterOwnerUid(item, user?.uid) === selectedRegisterOwnerUid
      )
    )) || registers.find((item) => item.id === selectedRegisterId) || null,
    [registers, selectedRegisterId, selectedRegisterOwnerUid, user?.uid],
  )

  const registerSundayDates = useMemo(() => {
    if (!selectedRegister) return []
    if (Array.isArray(selectedRegister.sundayDates) && selectedRegister.sundayDates.length > 0) {
      return selectedRegister.sundayDates
    }
    return getSundaysByMonthYear(Number(selectedRegister.month), Number(selectedRegister.year))
  }, [selectedRegister])

  const selectedClass = useMemo(
    () => (selectedRegister?.classId ? classMap[selectedRegister.classId] : null),
    [classMap, selectedRegister],
  )

  function getClassLinkedStudentIds(classId) {
    if (!classId) return []
    const fromEnrollments = activeEnrollments
      .filter((item) => item.classId === classId)
      .map((item) => item.personId)
    const fromLegacyClass = extractClassStudentIds(classMap[classId])
    return [...new Set([...fromEnrollments, ...fromLegacyClass])]
  }

  const registerStudents = useMemo(() => {
    const students = getRegisterStudents(selectedRegister, selectedClass, people, activeEnrollments)
    return students.sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''))
  }, [activeEnrollments, people, selectedClass, selectedRegister])

  useEffect(() => {
    if (!selectedRegister) {
      setDraftAttendanceByStudent({})
      setIsRegisterOpen(false)
      return
    }

    if (!selectedRegisterOwnerUid) {
      setSelectedRegisterOwnerUid(getRegisterOwnerUid(selectedRegister, user?.uid))
    }

    setDraftAttendanceByStudent(selectedRegister.attendanceByStudent || {})
    if (registerId && !didAutoOpenRouteRegister) {
      setIsRegisterOpen(true)
      setDidAutoOpenRouteRegister(true)
    }
  }, [didAutoOpenRouteRegister, registerId, selectedRegister, selectedRegisterOwnerUid, user?.uid])

  useEffect(() => {
    async function loadRegisterOwnerContext() {
      const registerOwnerUid = getRegisterOwnerUid(selectedRegister, user?.uid)
      if (!registerOwnerUid || registerOwnerUid === user?.uid) return

      try {
        const [ownerPeople, ownerTeachers, ownerClasses, ownerEnrollments] = await Promise.all([
          listPeople(registerOwnerUid).catch(() => []),
          listTeachers(registerOwnerUid).catch(() => []),
          listClasses(registerOwnerUid).catch(() => []),
          listEnrollments(registerOwnerUid).catch(() => []),
        ])

        setPeople((prev) => mergeById([...prev, ...ownerPeople]))
        setTeachers((prev) => mergeById([...prev, ...ownerTeachers]))
        setClasses((prev) => mergeById([...prev, ...ownerClasses]).filter((item) => item.active !== false))
        setEnrollments((prev) => mergeById([...prev, ...ownerEnrollments]))
      } catch (error) {
        console.warn('[AttendancePage] Nao foi possivel carregar o contexto do dono da caderneta:', {
          registerId: selectedRegister?.id,
          registerOwnerUid,
          error,
        })
      }
    }

    if (selectedRegister && canManageStructure) {
      loadRegisterOwnerContext()
    }
  }, [canManageStructure, selectedRegister, user?.uid])

  useEffect(() => {
    if (!selectedRegisterId) return
    const registerData = selectedRegister
    const classData = selectedClass
    const finalStudents = registerStudents
    const sourceUsed = (() => {
      if (Array.isArray(registerData?.enrolledStudentIds) && registerData.enrolledStudentIds.length > 0) return 'register.enrolledStudentIds'
      if (registerData?.attendanceByStudent && Object.keys(registerData.attendanceByStudent).length > 0) return 'register.attendanceByStudent'
      if (Array.isArray(classData?.students) && classData.students.length > 0) return 'class.students'
      if (activeEnrollments.filter(e => e.classId === registerData?.classId).length > 0) return 'enrollments'
      return 'empty'
    })()

    // 1. Logar o registerId
    console.log('[ATTENDANCE_OPEN_DEBUG] registerId', selectedRegisterId)

    // 2. Logar o objeto bruto e JSON
    console.log('[ATTENDANCE_OPEN_DEBUG] register raw object', registerData)
    console.log('[ATTENDANCE_OPEN_DEBUG] register json', JSON.stringify(registerData, null, 2))

    // 3. Logar campos explícitos do registro
    console.log('[ATTENDANCE_OPEN_DEBUG] register fields', {
      id: registerData?.id || null,
      classId: registerData?.classId || null,
      className: registerData?.className || null,
      studentsCount: Array.isArray(registerData?.students) ? registerData.students.length : 0,
      studentsSample: Array.isArray(registerData?.students) ? registerData.students.slice(0, 5) : [],
      enrolledStudentIdsCount: Array.isArray(registerData?.enrolledStudentIds) ? registerData.enrolledStudentIds.length : 0,
      enrolledStudentIdsSample: Array.isArray(registerData?.enrolledStudentIds) ? registerData.enrolledStudentIds.slice(0, 10) : [],
      attendanceByStudentKeys: registerData?.attendanceByStudent ? Object.keys(registerData.attendanceByStudent) : [],
    })

    // 4. Logar dados da turma se houver
    if (classData) {
      console.log('[ATTENDANCE_OPEN_DEBUG] class data', classData)
      console.log('[ATTENDANCE_OPEN_DEBUG] class json', JSON.stringify(classData, null, 2))
      console.log('[ATTENDANCE_OPEN_DEBUG] class fields', {
        id: classData?.id || null,
        name: classData?.name || null,
        studentsCount: Array.isArray(classData?.students) ? classData.students.length : 0,
        studentsSample: Array.isArray(classData?.students) ? classData.students.slice(0, 5) : [],
        enrolledStudentIdsCount: Array.isArray(classData?.enrolledStudentIds) ? classData.enrolledStudentIds.length : 0,
      })
    }

    // 5. Logar fonte e amostra dos alunos finais
    console.log('[ATTENDANCE_OPEN_DEBUG] final students source', {
      sourceUsed,
      finalStudentsCount: Array.isArray(finalStudents) ? finalStudents.length : 0,
      finalStudentsSample: Array.isArray(finalStudents) ? finalStudents.slice(0, 10) : [],
    })

    if (!selectedRegister) {
      console.warn('[AttendancePage][open] Registro não encontrado para o ID informado.')
      return
    }
  }, [selectedRegisterId, selectedRegister, registerStudents.length])

  const currentAttendanceByStudent = useMemo(
    () => (isRegisterOpen ? draftAttendanceByStudent : (selectedRegister?.attendanceByStudent || {})),
    [draftAttendanceByStudent, isRegisterOpen, selectedRegister],
  )

  const hasUnsavedAttendanceChanges = useMemo(() => {
    if (!selectedRegister || !isRegisterOpen) return false

    const savedAttendance = normalizeAttendanceMap(selectedRegister.attendanceByStudent || {})
    const draftAttendance = normalizeAttendanceMap(draftAttendanceByStudent || {})
    return JSON.stringify(savedAttendance) !== JSON.stringify(draftAttendance)
  }, [draftAttendanceByStudent, isRegisterOpen, selectedRegister])

  const currentStudentStatuses = useMemo(
    () => buildStudentStatuses({ ...selectedRegister, attendanceByStudent: currentAttendanceByStudent }, registerStudents),
    [currentAttendanceByStudent, registerStudents, selectedRegister],
  )

  const availableStudentsForRegister = useMemo(() => {
    const selectedIds = new Set((selectedRegister?.enrolledStudentIds || []).concat(registerStudents.map((item) => item.id)))
    return people
      .filter((item) => item.active !== false)
      .filter((item) => !selectedIds.has(item.id))
      .filter((item) => item.fullName.toLowerCase().includes(studentSearch.toLowerCase()))
      .sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''))
  }, [people, registerStudents, selectedRegister, studentSearch])

  useEffect(() => {
    if (!selectedRegister) {
      setDateToAdd('')
      setDateToRemove('')
      return
    }
    const firstDate = registerSundayDates[0] || ''
    setDateToRemove((prev) => prev || firstDate)
  }, [selectedRegister, registerSundayDates])

  const filteredRegisters = useMemo(() => {
    const classIdFilter = location.state?.classId || ''

    return registers.filter((item) => {
      if (classIdFilter && item.classId !== classIdFilter) return false
      if (form.classId && item.classId !== form.classId) return false
      if (Number(form.month) && Number(item.month) !== Number(form.month)) return false
      if (Number(form.year) && Number(item.year) !== Number(form.year)) return false
      return true
    })
  }, [registers, form.classId, form.month, form.year, location.state])

  async function handleCreateRegister() {
    if (!canManageStructure) {
      window.alert('Somente administradores podem criar cadernetas. Você pode apenas lançar presença nas turmas permitidas.')
      return
    }
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

    try {
      const selectedTeacher = teachers.find((t) => t.id === form.teacherId)
      const teacherAuthUid = selectedTeacher?.authUid || selectedTeacher?.userUid || selectedTeacher?.uid || ''
      const teacherEmail = (selectedTeacher?.email || '').trim().toLowerCase()
      const classRecord = classMap[form.classId]

      const quarterRange = getQuarterRange(form.startDate)
      const sundayDates = quarterRange.sundayDates
      const classEnrollments = enrollments
        .filter((item) => item.classId === form.classId && item.status === 'active' && item.enrolledInEBD !== false)
        .map((item) => item.personId)

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
      const studentsSnapshot = buildStudentsSnapshot(allStudentIds, people)

      const payload = {
        ownerUid: user.uid,
        createdByUid: user.uid,
        teacherId: form.teacherId,
        teacherName: selectedTeacher?.fullName || '',
        teacherAuthUid,
        teacherUid: teacherAuthUid,
        teacherEmail,
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
      }

      const id = await saveAttendanceRegister(user.uid, payload)
      console.log('[AttendancePage][create] registerId:', id)
      console.log('[AttendancePage][create] classId:', payload.classId)
      console.log('[AttendancePage][create] alunos vinculados:', payload.enrolledStudentIds.length)
      setSelectedRegisterId(id)
      await loadData()
    } catch (error) {
      console.error('[AttendancePage][create] Erro ao criar caderneta:', error)
      window.alert('Erro ao criar caderneta. Verifique o console para detalhes.')
    }
  }

  async function handleToggleAttendance(personId, sunday) {
    if (!selectedRegister) return
    if (!canAccessAttendanceRegister(selectedRegister, user, profile)) {
      window.alert('Você não tem permissão para alterar esta caderneta.')
      return
    }

    console.log('[ADMIN_CHECK]', {
      email: user?.email,
      isAdmin: isAdmin(user),
    })

    const attendance = selectedRegister.attendanceByStudent || {}
    const current = attendance[personId]?.[sunday] || ''
    const next = cycleAttendanceStatus(current)

    const nextAttendanceByStudent = {
      ...attendance,
      [personId]: {
        ...(attendance[personId] || {}),
        [sunday]: next,
      },
    }

    // Busca matrícula do aluno na turma
    const enrollment = enrollments.find(e => e.personId === personId && e.classId === selectedRegister.classId)
    let updatedEnrollment = { ...enrollment }
    let enrollmentChanged = false
    const allDates = Object.keys(nextAttendanceByStudent[personId] || {}).sort()
    // Verifica faltas consecutivas
    let consecutiveAbsences = 0
    for (let i = allDates.length - 1; i >= 0; i--) {
      const status = nextAttendanceByStudent[personId][allDates[i]]
      if (status === 'A') consecutiveAbsences++
      else if (status === 'P' || status === 'PP') break
      else break
    }
    // Inativação automática
    if (enrollment && enrollment.status === 'active' && consecutiveAbsences >= 4) {
      updatedEnrollment.status = 'inactive'
      updatedEnrollment.enrolledInEBD = false
      updatedEnrollment.inactivationReason = '4 faltas consecutivas'
      updatedEnrollment.activationHistory = Array.isArray(enrollment.activationHistory) ? [...enrollment.activationHistory] : []
      updatedEnrollment.activationHistory.push({ date: new Date().toISOString(), type: 'inactivate', reason: '4 faltas consecutivas' })
      enrollmentChanged = true
    }
    // Reativação automática
    if (enrollment && enrollment.status === 'inactive') {
      // Conta presenças após inativação
      const lastInactivation = Array.isArray(enrollment.activationHistory)
        ? [...enrollment.activationHistory].reverse().find(h => h.type === 'inactivate')
        : null
      let presencesAfterInactivation = 0
      for (const date of allDates) {
        if (lastInactivation && date < lastInactivation.date) continue
        const status = nextAttendanceByStudent[personId][date]
        if (status === 'P' || status === 'PP') presencesAfterInactivation++
      }
      if (presencesAfterInactivation >= 4) {
        updatedEnrollment.status = 'active'
        updatedEnrollment.enrolledInEBD = true
        updatedEnrollment.inactivationReason = ''
        updatedEnrollment.activationHistory = Array.isArray(enrollment.activationHistory) ? [...enrollment.activationHistory] : []
        updatedEnrollment.activationHistory.push({ date: new Date().toISOString(), type: 'activate', reason: '4 presenças após inativação' })
        enrollmentChanged = true
      }
    }

    try {
      const registerOwnerUid = getRegisterOwnerUid(selectedRegister, user.uid)
      await saveAttendanceRegister(
        registerOwnerUid,
        {
          attendanceByStudent: nextAttendanceByStudent,
        },
        selectedRegister.id,
      )
      if (enrollmentChanged) {
        updatedEnrollment.statusHistory = buildEnrollmentStatusHistory(enrollment, {
          status: updatedEnrollment.status,
          enrolledInEBD: updatedEnrollment.enrolledInEBD,
        })
        await saveEnrollment(registerOwnerUid, updatedEnrollment, updatedEnrollment.id)
      }
    } catch (error) {
      console.error('[AttendancePage][toggle] Erro ao salvar presença:', {
        registerId: selectedRegister.id,
        classId: selectedRegister.classId,
        personId,
        sunday,
        error,
      })
      window.alert('Erro ao salvar presença. Verifique o console para detalhes.')
      return
    }

    setRegisters((prev) => prev.map((item) => {
      if (item.id !== selectedRegister.id) return item
      return { ...item, attendanceByStudent: nextAttendanceByStudent }
    }))
  }

  function handleOpenRegister() {
    if (!selectedRegister) return
    console.log('[ADMIN_CHECK]', {
      email: user?.email,
      isAdmin: isAdmin(user),
    })
    setDraftAttendanceByStudent(selectedRegister.attendanceByStudent || {})
    setIsRegisterOpen(true)
    setLastSavedRegisterId('')
  }

  function handleSelectRegister(nextRegisterId, autoOpen = true, nextRegisterOwnerUid = '') {
    if (!nextRegisterId) return
    const isCurrentRegister = selectedRegisterId === nextRegisterId

    if (!isCurrentRegister && !confirmDiscardUnsavedAttendance()) {
      return
    }

    setSelectedRegisterId(nextRegisterId)
    setSelectedRegisterOwnerUid(nextRegisterOwnerUid)
    if (autoOpen) setIsRegisterOpen(true)
    setLastSavedRegisterId('')
  }

  function handleDraftAttendanceToggle(personId, sunday) {
    if (!selectedRegister || !isRegisterOpen) return
    if (!canAccessAttendanceRegister(selectedRegister, user, profile)) {
      window.alert('VocÃª nÃ£o tem permissÃ£o para alterar esta caderneta.')
      return
    }

    setDraftAttendanceByStudent((prev) => {
      setLastSavedRegisterId('')
      const current = prev[personId]?.[sunday] || ''
      const next = getNextAttendanceStatus(current)

      return {
        ...prev,
        [personId]: {
          ...(prev[personId] || {}),
          [sunday]: next,
        },
      }
    })
  }

  async function handleSaveAttendance() {
    if (!selectedRegister || !isRegisterOpen || isSavingAttendance) return
    if (!canAccessAttendanceRegister(selectedRegister, user, profile)) {
      window.alert('VocÃª nÃ£o tem permissÃ£o para salvar esta caderneta.')
      return
    }

    setIsSavingAttendance(true)
    try {
      const registerOwnerUid = getRegisterOwnerUid(selectedRegister, user.uid)
      const nextRegister = {
        ...selectedRegister,
        attendanceByStudent: draftAttendanceByStudent,
      }
      const studentStatuses = buildStudentStatuses(nextRegister, registerStudents)

      await saveAttendanceRegister(
        registerOwnerUid,
        {
          attendanceByStudent: draftAttendanceByStudent,
          studentStatuses,
        },
        selectedRegister.id,
      )

      setRegisters((prev) => prev.map((item) => {
        if (item.id !== selectedRegister.id) return item
        return {
          ...item,
          attendanceByStudent: draftAttendanceByStudent,
          studentStatuses,
        }
      }))
      setIsRegisterOpen(true)
      setLastSavedRegisterId(selectedRegister.id)
    } catch (error) {
      console.error('[AttendancePage][save] Erro ao salvar presenÃ§a:', {
        registerId: selectedRegister.id,
        classId: selectedRegister.classId,
        error,
      })
      window.alert('Erro ao salvar presenÃ§a. Verifique o console para detalhes.')
    } finally {
      setIsSavingAttendance(false)
    }
  }

  async function handleUpdateMeta() {
    if (!selectedRegister) return
    if (!canAccessAttendanceRegister(selectedRegister, user, profile)) {
      window.alert('Você não tem permissão para alterar esta caderneta.')
      return
    }

    try {
      const registerOwnerUid = getRegisterOwnerUid(selectedRegister, user.uid)
      await saveAttendanceRegister(
        registerOwnerUid,
        {
          teacherId: selectedRegister.teacherId || '',
          teacherName: selectedRegister.teacherName,
          teacherAuthUid: selectedRegister.teacherAuthUid || '',
          teacherUid: selectedRegister.teacherUid || '',
          teacherEmail: (selectedRegister.teacherEmail || '').trim().toLowerCase(),
          discipline: selectedRegister.discipline,
        },
        selectedRegister.id,
      )

      await loadData()
    } catch (error) {
      console.error('[AttendancePage][meta] Erro ao salvar registro:', {
        registerId: selectedRegister.id,
        classId: selectedRegister.classId,
        error,
      })
      window.alert('Erro ao salvar registro. Verifique o console para detalhes.')
    }
  }

  async function handleDeleteRegister(item) {
    if (!canManageStructure) {
      window.alert('Somente administradores podem excluir cadernetas.')
      return
    }

    const confirmed = window.confirm(`Excluir a caderneta ${item.className || 'sem classe'} (${formatMonthYear(item.month, item.year)})?`)
    if (!confirmed) return

    try {
      await removeAttendanceRegister(getRegisterOwnerUid(item, user.uid), item.id)
      setRegisters((prev) => prev.filter((register) => register.id !== item.id))
      if (selectedRegisterId === item.id) {
        setSelectedRegisterId('')
      }
    } catch (error) {
      console.error('[AttendancePage][delete] Erro ao excluir caderneta:', { registerId: item.id, error })
      window.alert('Erro ao excluir caderneta. Verifique o console para detalhes.')
    }
  }

  async function handleAddStudentToRegister() {
    if (!selectedRegister || !studentToAddId) return
    if (!canAccessAttendanceRegister(selectedRegister, user, profile)) {
      window.alert('Você não tem permissão para adicionar aluno nesta caderneta.')
      return
    }

    const attendance = selectedRegister.attendanceByStudent || {}
    const currentIds = selectedRegister.enrolledStudentIds || []
    const nextIds = [...new Set([...currentIds, studentToAddId])]
    const nextStudentsSnapshot = buildStudentsSnapshot(nextIds, people)
    const nextAttendanceByStudent = {
      ...attendance,
      [studentToAddId]: attendance[studentToAddId] || {},
    }

    try {
      const registerOwnerUid = getRegisterOwnerUid(selectedRegister, user.uid)
      await saveAttendanceRegister(
        registerOwnerUid,
        {
          enrolledStudentIds: nextIds,
          studentsSnapshot: nextStudentsSnapshot,
          attendanceByStudent: nextAttendanceByStudent,
        },
        selectedRegister.id,
      )

      if (canManageStructure && selectedRegister.classId) {
        const alreadyEnrolled = enrollments.some((item) => (
          item.classId === selectedRegister.classId
          && item.personId === studentToAddId
          && item.status === 'active'
          && item.enrolledInEBD !== false
        ))

        if (!alreadyEnrolled) {
          await saveEnrollment(registerOwnerUid, {
            ownerUid: registerOwnerUid,
            classId: selectedRegister.classId,
            className: selectedRegister.className || classMap[selectedRegister.classId]?.name || '',
            personId: studentToAddId,
            personName: personMap[studentToAddId]?.fullName || '',
            enrolledInEBD: true,
            status: 'active',
            statusHistory: buildEnrollmentStatusHistory(null, { status: 'active', enrolledInEBD: true }),
            enrollmentDate: new Date().toISOString().slice(0, 10),
            notes: 'Matrícula criada automaticamente ao adicionar aluno na caderneta.',
          })
        }
      }

      console.log('[AttendancePage][add-student] registerId:', selectedRegister.id)
      console.log('[AttendancePage][add-student] classId:', selectedRegister.classId)
      console.log('[AttendancePage][add-student] aluno adicionado:', studentToAddId)

      setRegisters((prev) => prev.map((item) => {
        if (item.id !== selectedRegister.id) return item
        return {
          ...item,
          enrolledStudentIds: nextIds,
          studentsSnapshot: nextStudentsSnapshot,
          attendanceByStudent: nextAttendanceByStudent,
        }
      }))
      setStudentToAddId('')
    } catch (error) {
      console.error('[AttendancePage][add-student] Erro ao adicionar aluno:', {
        registerId: selectedRegister.id,
        classId: selectedRegister.classId,
        personId: studentToAddId,
        error,
      })
      window.alert('Erro ao adicionar aluno na caderneta. Verifique o console para detalhes.')
    }
  }

  async function handleRemoveStudentFromRegister(personId) {
    if (!selectedRegister || !personId) return
    if (!canAccessAttendanceRegister(selectedRegister, user, profile)) {
      window.alert('Você não tem permissão para remover aluno desta caderneta.')
      return
    }

    const studentName = personMap[personId]?.fullName || 'este aluno'
    const confirmed = window.confirm(`Remover ${studentName} desta caderneta?`)
    if (!confirmed) return

    const currentIds = Array.isArray(selectedRegister.enrolledStudentIds) ? selectedRegister.enrolledStudentIds : []
    const nextIds = currentIds.filter((id) => id !== personId)
    const nextStudentsSnapshot = buildStudentsSnapshot(nextIds, people)
    const attendance = { ...(selectedRegister.attendanceByStudent || {}) }
    delete attendance[personId]

    try {
      const registerOwnerUid = getRegisterOwnerUid(selectedRegister, user.uid)
      await saveAttendanceRegister(
        registerOwnerUid,
        {
          enrolledStudentIds: nextIds,
          studentsSnapshot: nextStudentsSnapshot,
          attendanceByStudent: attendance,
        },
        selectedRegister.id,
      )

      setRegisters((prev) => prev.map((item) => {
        if (item.id !== selectedRegister.id) return item
        return {
          ...item,
          enrolledStudentIds: nextIds,
          studentsSnapshot: nextStudentsSnapshot,
          attendanceByStudent: attendance,
        }
      }))
    } catch (error) {
      console.error('[AttendancePage][remove-student] Erro ao remover aluno:', {
        registerId: selectedRegister.id,
        classId: selectedRegister.classId,
        personId,
        error,
      })
      window.alert('Erro ao remover aluno da caderneta. Verifique o console para detalhes.')
    }
  }

  async function handleAddDateToRegister() {
    if (!selectedRegister || !dateToAdd) return
    if (!canAccessAttendanceRegister(selectedRegister, user, profile)) {
      window.alert('Você não tem permissão para alterar as datas desta caderneta.')
      return
    }

    const currentDates = Array.isArray(selectedRegister.sundayDates) ? selectedRegister.sundayDates : []
    const nextDates = [...new Set([...currentDates, dateToAdd])].sort()

    try {
      const registerOwnerUid = getRegisterOwnerUid(selectedRegister, user.uid)
      await saveAttendanceRegister(
        registerOwnerUid,
        { sundayDates: nextDates },
        selectedRegister.id,
      )

      setRegisters((prev) => prev.map((item) => {
        if (item.id !== selectedRegister.id) return item
        return { ...item, sundayDates: nextDates }
      }))
      setDateToAdd('')
      setDateToRemove((prev) => prev || nextDates[0] || '')
    } catch (error) {
      console.error('[AttendancePage][add-date] Erro ao adicionar data:', {
        registerId: selectedRegister.id,
        classId: selectedRegister.classId,
        dateToAdd,
        error,
      })
      window.alert('Erro ao adicionar data na caderneta. Verifique o console para detalhes.')
    }
  }

  async function handleRemoveDateFromRegister() {
    if (!selectedRegister || !dateToRemove) return
    if (!canAccessAttendanceRegister(selectedRegister, user, profile)) {
      window.alert('Você não tem permissão para alterar as datas desta caderneta.')
      return
    }

    const currentDates = Array.isArray(selectedRegister.sundayDates) ? selectedRegister.sundayDates : []
    const nextDates = currentDates.filter((date) => date !== dateToRemove)
    const attendance = selectedRegister.attendanceByStudent || {}

    const nextAttendanceByStudent = Object.fromEntries(
      Object.entries(attendance).map(([personId, record]) => {
        const nextRecord = { ...(record || {}) }
        delete nextRecord[dateToRemove]
        return [personId, nextRecord]
      }),
    )

    try {
      const registerOwnerUid = getRegisterOwnerUid(selectedRegister, user.uid)
      await saveAttendanceRegister(
        registerOwnerUid,
        {
          sundayDates: nextDates,
          attendanceByStudent: nextAttendanceByStudent,
        },
        selectedRegister.id,
      )

      setRegisters((prev) => prev.map((item) => {
        if (item.id !== selectedRegister.id) return item
        return {
          ...item,
          sundayDates: nextDates,
          attendanceByStudent: nextAttendanceByStudent,
        }
      }))
      setDateToRemove(nextDates[0] || '')
    } catch (error) {
      console.error('[AttendancePage][remove-date] Erro ao remover data:', {
        registerId: selectedRegister.id,
        classId: selectedRegister.classId,
        dateToRemove,
        error,
      })
      window.alert('Erro ao remover data da caderneta. Verifique o console para detalhes.')
    }
  }

  async function handleExportPdf() {
    if (!selectedRegister) return
    await generateAttendanceNotebookPDF({
      register: selectedRegister,
      students: registerStudents,
    })
  }

  const classSummary = useMemo(
    () => calculateClassSummary({ ...selectedRegister, attendanceByStudent: currentAttendanceByStudent }, registerStudents),
    [currentAttendanceByStudent, registerStudents, selectedRegister],
  )

  function confirmDiscardUnsavedAttendance() {
    if (!hasUnsavedAttendanceChanges || isSavingAttendance) return true
    return window.confirm('Existe chamada com alteracoes nao salvas. Deseja sair sem salvar?')
  }

  useEffect(() => {
    if (!hasUnsavedAttendanceChanges) return undefined

    const handleBeforeUnload = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }

    const handleDocumentClick = (event) => {
      const target = event.target
      if (!(target instanceof Element)) return

      const navigationTrigger = target.closest('a.bottom-nav-item, button.menu-link, button.menu-logout-btn')
      if (!navigationTrigger) return

      const canLeave = window.confirm('Existe chamada com alteracoes nao salvas. Deseja sair sem salvar?')
      if (canLeave) return

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation?.()
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    document.addEventListener('click', handleDocumentClick, true)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      document.removeEventListener('click', handleDocumentClick, true)
    }
  }, [hasUnsavedAttendanceChanges])

  return (
    <div className="feature-page">
      <div className="feature-header">
        <div>
          <h2 className="feature-title">Caderneta Trimestral</h2>
          <p className="feature-subtitle">Presença por domingo com cálculo automático</p>
        </div>
      </div>

      {false && canManageStructure && <Card>
        <CardHeader title="Nova caderneta" subtitle="Núcleo principal do MVP" />
        <div className="inline-form">
          <label htmlFor="attendance-teacher">Professor</label>
          <select
            id="attendance-teacher"
            value={form.teacherId}
            onChange={(event) => {
              const teacherId = event.target.value
              const teacher = teachers.find((t) => t.id === teacherId)
              setForm((prev) => ({
                ...prev,
                teacherId,
                teacherName: teacher?.fullName || '',
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

          <label htmlFor="attendance-class">Classe</label>
          <select
            id="attendance-class"
            value={form.classId}
            onChange={(event) => {
              const classId = event.target.value
              setForm((prev) => ({
                ...prev,
                classId,
                studentIds: getClassLinkedStudentIds(classId),
              }))
            }}
          >
            <option value="">Selecione uma classe</option>
            {classes
              .filter((item) => item.active !== false)
              .map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
          </select>
          {classes.filter((item) => item.active !== false).length === 0 && (
            <p className="feature-subtitle" style={{ marginTop: '8px', fontSize: '0.85rem' }}>
              📌 Nenhuma classe ativa. <a href="/classes" style={{ textDecoration: 'underline', color: '#0066cc' }}>Cadastre uma classe</a>
            </p>
          )}

          <label htmlFor="attendance-students">Seleção inicial de alunos</label>
          <input
            id="attendance-students-search"
            type="text"
            placeholder="Buscar aluno por nome"
            value={studentSearch}
            onChange={e => setStudentSearch(e.target.value)}
            style={{ marginBottom: 8, width: '100%' }}
          />
          <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid #eee', borderRadius: 4, padding: 8 }}>
            {availableStudentsForRegister.length === 0 && (
              <div style={{ fontSize: '0.95em', color: '#888' }}>Nenhum aluno encontrado</div>
            )}
            {availableStudentsForRegister.map(person => (
              <label key={person.id} style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
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
                  style={{ marginRight: 8 }}
                />
                {person.fullName}
              </label>
            ))}
          </div>
          <p className="feature-subtitle" style={{ marginTop: '6px', fontSize: '0.85rem' }}>
            Toque para selecionar/remover alunos. Ordem alfabética. Busca disponível acima.
          </p>

          <label htmlFor="attendance-discipline">Disciplina / Tema</label>
          <input
            id="attendance-discipline"
            value={form.discipline}
            onChange={(event) => setForm((prev) => ({ ...prev, discipline: event.target.value }))}
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
                onChange={(event) => setForm((prev) => ({ ...prev, month: event.target.value }))}
              />
            </div>
            <div>
              <label htmlFor="attendance-year">Ano</label>
              <input
                id="attendance-year"
                type="number"
                min="2020"
                value={form.year}
                onChange={(event) => setForm((prev) => ({ ...prev, year: event.target.value }))}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'end' }}>
              <Button onClick={handleCreateRegister}>Criar Caderneta</Button>
            </div>
          </div>
        </div>
      </Card>}

      {!selectedRegister && <Card>
        <CardHeader title="Classe" subtitle="Selecione a caderneta do professor" />
        <div className="entity-list">
          {filteredRegisters.length === 0 && <p className="feature-subtitle">Nenhuma caderneta encontrada para os filtros atuais.</p>}
          {filteredRegisters.map((item) => (
            <div className="entity-row" key={item.id}>
              <div>
                <div className="entity-title">{item.className}</div>
                <div className="entity-meta">{formatRegisterPeriod(item)} - {item.teacherName}</div>
              </div>
              <div className="row-actions">
                <Button
                  size="sm"
                  onClick={() => {
                    const isCurrentRegister = selectedRegisterId === item.id

                    if (isCurrentRegister && isRegisterOpen) {
                      handleSaveAttendance()
                      return
                    }

                    handleSelectRegister(item.id, true, getRegisterOwnerUid(item, user?.uid))
                  }}
                  disabled={isSavingAttendance}
                  variant={selectedRegisterId === item.id && lastSavedRegisterId === item.id && !hasUnsavedAttendanceChanges ? 'secondary' : 'primary'}
                >
                  {isSavingAttendance && selectedRegisterId === item.id
                    ? 'Salvando...'
                    : selectedRegisterId === item.id && lastSavedRegisterId === item.id && !hasUnsavedAttendanceChanges
                      ? 'Salvo'
                    : selectedRegisterId === item.id && isRegisterOpen
                      ? 'Salvar'
                        : 'Abrir'}
                </Button>
                {canManageStructure && (
                  <Button size="sm" variant="danger" onClick={() => handleDeleteRegister(item)}>Excluir</Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>}

      {selectedRegister && (
        <>
          <div className="attendance-floating-bar">
            <div>
              <div className="entity-title">{selectedRegister.className}</div>
              <div className="entity-meta">{formatRegisterPeriod(selectedRegister)} - {selectedRegister.teacherName}</div>
            </div>
            <div className="row-actions">
              <Button
                size="sm"
                onClick={() => {
                  if (isRegisterOpen) {
                    handleSaveAttendance()
                    return
                  }

                  handleOpenRegister()
                }}
                disabled={isSavingAttendance}
                variant={lastSavedRegisterId === selectedRegister.id && !hasUnsavedAttendanceChanges ? 'secondary' : 'primary'}
              >
                {isSavingAttendance
                  ? 'Salvando...'
                  : lastSavedRegisterId === selectedRegister.id && !hasUnsavedAttendanceChanges
                    ? 'Salvo'
                  : isRegisterOpen
                    ? 'Salvar'
                      : 'Abrir'}
              </Button>
            </div>
          </div>

          <div className="attendance-floating-bar-spacer" />

          <Card>
            <CardHeader
              title={`${selectedRegister.className} - ${formatRegisterPeriod(selectedRegister)}`}
              subtitle={isRegisterOpen ? 'Toque em cada célula para alternar: vazio -> PP -> P -> A' : 'Use o menu fixo acima para abrir a caderneta.'}
              action={<Button size="sm" variant="secondary" onClick={handleExportPdf}>PDF</Button>}
            />

            <div className="inline-form">
              <label htmlFor="selected-period">Período da caderneta</label>
              <input
                id="selected-period"
                value={formatRegisterPeriod(selectedRegister)}
                readOnly
              />

              <label htmlFor="selected-teacher">Professor</label>
              {canManageStructure ? (
                <select
                  id="selected-teacher"
                  value={selectedRegister.teacherId || ''}
                  onChange={(event) => {
                    const teacherPayload = buildRegisterTeacherPayload(event.target.value, teachers)
                    setRegisters((prev) => prev.map((item) => (
                      item.id === selectedRegister.id
                        ? { ...item, ...teacherPayload }
                        : item
                    )))
                  }}
                >
                  <option value="">Selecione um professor</option>
                  {teachers
                    .filter((item) => item.active !== false)
                    .map((teacher) => (
                      <option key={teacher.id} value={teacher.id}>{teacher.fullName}</option>
                    ))}
                </select>
              ) : (
                <input
                  id="selected-teacher"
                  value={selectedRegister.teacherName || ''}
                  readOnly
                />
              )}

              <label htmlFor="selected-discipline">Disciplina</label>
              <input
                id="selected-discipline"
                value={selectedRegister.discipline || ''}
                readOnly={!canManageStructure}
                onChange={(event) => {
                  if (!canManageStructure) return
                  const value = event.target.value
                  setRegisters((prev) => prev.map((item) => item.id === selectedRegister.id ? { ...item, discipline: value } : item))
                }}
              />

              {canManageStructure && (
                <>
                  <label htmlFor="add-student-register">Alunos da caderneta</label>
                  <div className="filter-row">
                    <div>
                      <select
                        id="add-student-register"
                        value={studentToAddId}
                        onChange={(event) => setStudentToAddId(event.target.value)}
                      >
                        <option value="">Selecione um aluno</option>
                        {availableStudentsForRegister.map((student) => (
                          <option key={student.id} value={student.id}>{student.fullName}</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'end' }}>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={handleAddStudentToRegister}
                        disabled={!studentToAddId}
                      >
                        Adicionar aluno
                      </Button>
                    </div>
                  </div>

                  {registerStudents.length > 0 && (
                    <div className="selection-list">
                      {registerStudents.map((student) => (
                        <div key={student.id} className="selection-item">
                          <span>{student.fullName}</span>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => handleRemoveStudentFromRegister(student.id)}
                          >
                            Remover
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  <label htmlFor="add-date-register">Datas da caderneta</label>
                  <div className="filter-row">
                    <div>
                      <input
                        id="add-date-register"
                        type="date"
                        value={dateToAdd}
                        onChange={(event) => setDateToAdd(event.target.value)}
                      />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'end' }}>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={handleAddDateToRegister}
                        disabled={!dateToAdd}
                      >
                        Adicionar data
                      </Button>
                    </div>
                    <div>
                      <select
                        id="remove-date-register"
                        value={dateToRemove}
                        onChange={(event) => setDateToRemove(event.target.value)}
                      >
                        <option value="">Selecione a data</option>
                        {registerSundayDates.map((date) => (
                          <option key={date} value={date}>{formatSundayLabel(date)}</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'end' }}>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={handleRemoveDateFromRegister}
                        disabled={!dateToRemove}
                      >
                        Remover data
                      </Button>
                    </div>
                  </div>

                  <Button size="sm" variant="ghost" onClick={handleUpdateMeta}>Salvar registro</Button>
                </>
              )}
            </div>

            {isRegisterOpen && <div className="attendance-wrapper">
              <table className="attendance-table">
                <thead>
                  <tr>
                    <th>Alunos</th>
                    {registerSundayDates.map((sunday) => (
                      <th key={sunday}>{formatSundayLabel(sunday)}</th>
                    ))}
                    <th>PP</th>
                    <th>P</th>
                    <th>A</th>
                    <th>%</th>
                  </tr>
                </thead>
                <tbody>
                  {registerStudents.length === 0 && (() => {
                    // 6. Logar decisão de empty-state
                    const registerData = selectedRegister
                    const classData = selectedClass
                    const finalStudents = registerStudents
                    console.log('[ATTENDANCE_OPEN_DEBUG] empty-state decision', {
                      registerId: registerData?.id || null,
                      classId: registerData?.classId || null,
                      hasRegisterStudents: Array.isArray(registerData?.students) && registerData.students.length > 0,
                      hasClassStudents: Array.isArray(classData?.students) && classData.students.length > 0,
                      hasEnrolledIds: Array.isArray(registerData?.enrolledStudentIds) && registerData.enrolledStudentIds.length > 0,
                      finalStudentsCount: Array.isArray(finalStudents) ? finalStudents.length : 0,
                    })
                    return (
                      <tr>
                        <td colSpan={registerSundayDates.length + 5}>Nenhum aluno nesta caderneta.</td>
                      </tr>
                    )
                  })()}
                  {registerStudents.map((student) => {
                    const studentAttendance = currentAttendanceByStudent?.[student.id] || {}
                    const resume = calculateStudentAttendance(registerSundayDates, studentAttendance)
                    const studentStatus = currentStudentStatuses?.[student.id]?.enrollmentStatus || 'active'

                    return (
                      <tr key={student.id}>
                        <td>{student.fullName}{studentStatus === 'inactive' ? ' IN' : ''}</td>
                        {registerSundayDates.map((sunday) => {
                          const value = studentAttendance[sunday] || ''
                          return (
                            <td key={`${student.id}-${sunday}`}>
                              <button
                                className={`attendance-cell status-${value || 'none'}`}
                                onClick={() => handleDraftAttendanceToggle(student.id, sunday)}
                                type="button"
                              >
                                {value || '-'}
                              </button>
                            </td>
                          )
                        })}
                        <td>{resume.totalPP}</td>
                        <td>{resume.totalP}</td>
                        <td>{resume.totalA}</td>
                        <td>{resume.percentualFinal.toFixed(1)}%</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>}
          </Card>

          <Card>
            <CardHeader title="Resumo geral da turma" subtitle="Indicadores consolidados da caderneta" />
            <div className="summary-grid">
              <div className="summary-item"><span className="summary-label">Matriculados</span><span className="summary-value">{classSummary.totalMatriculados}</span></div>
              <div className="summary-item"><span className="summary-label">Total PP</span><span className="summary-value">{classSummary.totalGeralPP}</span></div>
              <div className="summary-item"><span className="summary-label">Total P</span><span className="summary-value">{classSummary.totalGeralP}</span></div>
              <div className="summary-item"><span className="summary-label">Total A</span><span className="summary-value">{classSummary.totalGeralA}</span></div>
              <div className="summary-item"><span className="summary-label">Presenças</span><span className="summary-value">{classSummary.totalPresencas}</span></div>
              <div className="summary-item"><span className="summary-label">Ausências</span><span className="summary-value">{classSummary.totalAusencias}</span></div>
              <div className="summary-item"><span className="summary-label">Média da turma</span><span className="summary-value">{classSummary.mediaGeralTurma.toFixed(1)}%</span></div>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
