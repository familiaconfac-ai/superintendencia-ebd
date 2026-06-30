import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import Button from '../../components/ui/Button'
import Card, { CardHeader } from '../../components/ui/Card'
import { useAuth } from '../../context/AuthContext'
import { listAttendanceRegisters } from '../../services/attendanceService'
import { listLessonSessions } from '../../services/lessonControlService'
import { listPeople } from '../../services/peopleService'
import { generateQuarterlyAttendanceReportPDF } from '../../services/pdfService'
import { calculateStudentAttendance, formatRegisterPeriod } from '../../utils/attendanceUtils'
import { canAccessAttendanceRegister } from '../../utils/accessControl'

const LESSON_END_GRACE_MINUTES = 5

function formatSessionTime(isoValue) {
  if (!isoValue) return '--:--'
  return new Date(isoValue).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatSessionDate(dateKey) {
  if (!dateKey) return ''
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString('pt-BR')
}

function formatCoordinate(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(5) : '--'
}

function formatLocationTimestamp(isoValue) {
  if (!isoValue) return '--'
  const date = new Date(isoValue)
  if (Number.isNaN(date.getTime())) return '--'
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function buildMapsUrl(point) {
  if (!point || !Number.isFinite(Number(point.lat)) || !Number.isFinite(Number(point.lng))) return ''
  return `https://www.google.com/maps?q=${Number(point.lat)},${Number(point.lng)}`
}

function buildScheduledDateTime(dateKey, timeValue) {
  if (!dateKey || !timeValue) return null
  const candidate = new Date(`${dateKey}T${timeValue}:00`)
  return Number.isNaN(candidate.getTime()) ? null : candidate
}

function getSessionOpenIso(session) {
  return session?.monitoringActivatedAt || session?.checkInAt || null
}

function getDeltaMinutes(actualIso, scheduledDate) {
  if (!actualIso || !scheduledDate) return null
  const actualDate = new Date(actualIso)
  if (Number.isNaN(actualDate.getTime())) return null
  return Math.round((actualDate.getTime() - scheduledDate.getTime()) / 60000)
}

function formatDeltaLabel(deltaMinutes, { emptyLabel = '--', onTimeLabel = 'No horário' } = {}) {
  if (!Number.isFinite(deltaMinutes)) return emptyLabel
  if (deltaMinutes === 0) return onTimeLabel
  if (deltaMinutes > 0) return `${deltaMinutes} min atrasado`
  return `${Math.abs(deltaMinutes)} min adiantado`
}

function average(values = []) {
  if (!values.length) return null
  return values.reduce((total, value) => total + value, 0) / values.length
}

function sumPositive(values = []) {
  return values.filter((value) => Number.isFinite(value) && value > 0).reduce((total, value) => total + value, 0)
}

function sumNegativeAbsolute(values = []) {
  return Math.abs(values.filter((value) => Number.isFinite(value) && value < 0).reduce((total, value) => total + value, 0))
}

function compareNames(a = '', b = '') {
  return String(a).localeCompare(String(b), 'pt-BR')
}

function normalizeIdentityValue(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function compareAttendanceWithPunctuality(a, b, nameSelector) {
  return (
    Number(b?.attendanceRate || 0) - Number(a?.attendanceRate || 0)
    || Number(b?.totalPP || 0) - Number(a?.totalPP || 0)
    || compareNames(nameSelector(a), nameSelector(b))
  )
}

function buildQuarterKey(register) {
  const startDate = register?.startDate || ''
  const endDate = register?.endDate || ''
  if (startDate && endDate) return `${startDate}__${endDate}`

  const sundayDates = Array.isArray(register?.sundayDates) ? [...register.sundayDates].sort() : []
  if (sundayDates.length > 0) {
    return `${sundayDates[0]}__${sundayDates[sundayDates.length - 1]}`
  }

  const month = String(register?.month || '').padStart(2, '0')
  const year = String(register?.year || '')
  return `${year}-${month}`
}

function buildQuarterLabel(register) {
  return formatRegisterPeriod(register) || 'Período não identificado'
}

function getSortedSundayDates(register) {
  return [...new Set(Array.isArray(register?.sundayDates) ? register.sundayDates.filter(Boolean) : [])].sort()
}

function getRegisterPeriodMeta(register) {
  const sundayDates = getSortedSundayDates(register)
  const startDate = register?.startDate || sundayDates[0] || ''
  const endDate = register?.endDate || sundayDates[sundayDates.length - 1] || ''
  const start = startDate ? new Date(`${startDate}T00:00:00`) : null
  const year = start && !Number.isNaN(start.getTime()) ? start.getFullYear() : Number(register?.year || 0)
  const monthIndex = start && !Number.isNaN(start.getTime()) ? start.getMonth() : Math.max(Number(register?.month || 1) - 1, 0)
  const quarterNumber = Number.isFinite(monthIndex) ? Math.floor(monthIndex / 3) + 1 : null
  const semesterNumber = quarterNumber ? (quarterNumber <= 2 ? 1 : 2) : null
  const serial = year && quarterNumber ? (year * 4) + quarterNumber : 0

  return {
    startDate,
    endDate,
    year,
    quarterNumber,
    semesterNumber,
    serial,
  }
}

function buildPeriodLabel(startDate, endDate) {
  return buildQuarterLabel({ startDate, endDate }) || 'Período não identificado'
}

function buildSelectedPeriodLabel(options = []) {
  if (!options.length) return 'Período'

  const orderedOptions = [...options].sort((a, b) => String(a.startDate || '').localeCompare(String(b.startDate || '')))
  if (orderedOptions.length === 1) return orderedOptions[0].label

  const years = [...new Set(orderedOptions.map((option) => option.year).filter(Boolean))]
  const quarterNumbers = [...new Set(orderedOptions.map((option) => option.quarterNumber).filter(Boolean))].sort((a, b) => a - b)
  const serials = [...new Set(orderedOptions.map((option) => option.serial).filter(Boolean))].sort((a, b) => a - b)
  const isContiguous = serials.every((serial, index) => index === 0 || serials[index - 1] + 1 === serial)

  if (years.length === 1) {
    const year = years[0]
    if (quarterNumbers.length === 4 && quarterNumbers.join(',') === '1,2,3,4') {
      return `Ano de ${year}`
    }
    if (quarterNumbers.length === 2 && quarterNumbers.join(',') === '1,2') {
      return `1º semestre de ${year}`
    }
    if (quarterNumbers.length === 2 && quarterNumbers.join(',') === '3,4') {
      return `2º semestre de ${year}`
    }
  }

  if (isContiguous) {
    return buildPeriodLabel(orderedOptions[0].startDate, orderedOptions[orderedOptions.length - 1].endDate)
  }

  return `${orderedOptions.length} trimestres selecionados`
}

function isDateWithinRange(dateKey = '', startDate = '', endDate = '') {
  if (!dateKey || !startDate || !endDate) return false
  return dateKey >= startDate && dateKey <= endDate
}

function getRegisterStudentEntries(register) {
  const studentsMap = new Map()

  ;(Array.isArray(register?.students) ? register.students : []).forEach((student) => {
    if (!student?.id) return
    studentsMap.set(student.id, {
      id: student.id,
      fullName: student?.fullName || student?.name || '',
    })
  })

  ;(Array.isArray(register?.studentsSnapshot) ? register.studentsSnapshot : []).forEach((student) => {
    if (!student?.id) return
    if (!studentsMap.has(student.id)) {
      studentsMap.set(student.id, {
        id: student.id,
        fullName: student?.fullName || student?.name || '',
      })
    }
  })

  const ids = [
    ...(Array.isArray(register?.enrolledStudentIds) ? register.enrolledStudentIds : []),
    ...Object.keys(register?.attendanceByStudent || {}),
    ...Array.from(studentsMap.keys()),
  ].filter(Boolean)

  return [...new Set(ids)].map((studentId) => {
    const student = studentsMap.get(studentId)
    return {
      id: studentId,
      fullName: student?.fullName || student?.name || `Aluno ${String(studentId).slice(0, 6)}`,
    }
  })
}

function buildQuarterRegisterSummary(register) {
  const sundayDates = getSortedSundayDates(register)
  const periodMeta = getRegisterPeriodMeta(register)
  const students = getRegisterStudentEntries(register)
  const studentRows = students.map((student) => {
    const attendance = calculateStudentAttendance(sundayDates, register?.attendanceByStudent?.[student.id] || {})
    return {
      studentId: student.id,
      studentName: student.fullName,
      classId: register?.classId || '',
      className: register?.className || 'Classe não informada',
      teacherName: register?.teacherName || 'Professor não informado',
      totalPP: attendance.totalPP,
      totalP: attendance.totalP,
      totalA: attendance.totalA,
      totalPresences: attendance.totalPP + attendance.totalP,
      totalRecorded: attendance.totalPP + attendance.totalP + attendance.totalA,
      attendanceRate: attendance.percentualFinal,
    }
  })

  const totalPP = studentRows.reduce((total, row) => total + row.totalPP, 0)
  const totalP = studentRows.reduce((total, row) => total + row.totalP, 0)
  const totalA = studentRows.reduce((total, row) => total + row.totalA, 0)
  const totalRecorded = totalPP + totalP + totalA

  return {
    registerId: register?.id || '',
    periodKey: buildQuarterKey(register),
    classId: register?.classId || '',
    className: register?.className || 'Classe não informada',
    teacherName: register?.teacherName || 'Professor não informado',
    periodLabel: buildQuarterLabel(register),
    startDate: periodMeta.startDate,
    endDate: periodMeta.endDate,
    sundayDates,
    sundayCount: sundayDates.length,
    studentCount: students.length,
    totalPP,
    totalP,
    totalA,
    totalPresences: totalPP + totalP,
    totalRecorded,
    attendanceRate: totalRecorded ? ((totalPP + totalP) / totalRecorded) * 100 : 0,
    studentRows,
  }
}

function getSessionTiming(session) {
  const scheduledStart = buildScheduledDateTime(session?.lessonDateKey, session?.lessonStartTime)
  const scheduledEnd = buildScheduledDateTime(session?.lessonDateKey, session?.lessonEndTime)
  const openDeltaMinutes = getDeltaMinutes(getSessionOpenIso(session), scheduledStart)
  const closeDeltaMinutes = getDeltaMinutes(session?.endedAt, scheduledEnd)

  return {
    openDeltaMinutes,
    closeDeltaMinutes,
    hasOpenTiming: Number.isFinite(openDeltaMinutes),
    hasCloseTiming: Number.isFinite(closeDeltaMinutes),
    openedOnTime: Number.isFinite(openDeltaMinutes) ? openDeltaMinutes <= 0 : false,
    closedOnTime: Number.isFinite(closeDeltaMinutes) ? closeDeltaMinutes <= LESSON_END_GRACE_MINUTES : false,
  }
}

export default function ReportsPage() {
  const { user, profile, canManageStructure } = useAuth()
  const [sessions, setSessions] = useState([])
  const [attendanceRegisters, setAttendanceRegisters] = useState([])
  const [people, setPeople] = useState([])
  const [selectedQuarterKeys, setSelectedQuarterKeys] = useState([])
  const [isExportingQuarterPdf, setIsExportingQuarterPdf] = useState(false)

  useEffect(() => {
    if (!user?.uid) return

    async function load() {
      const [lessonSessions, registers, peopleList] = await Promise.all([
        listLessonSessions(user.uid, {
          includeAll: canManageStructure,
        }).catch(() => []),
        listAttendanceRegisters(user.uid).catch(() => []),
        listPeople(user.uid).catch(() => []),
      ])

      const visibleRegisters = canManageStructure
        ? registers
        : registers.filter((item) => canAccessAttendanceRegister(item, user, profile))

      setSessions(lessonSessions)
      setAttendanceRegisters(visibleRegisters)
      setPeople(peopleList)
    }

    load()
  }, [canManageStructure, profile, user, user?.uid])

  const summary = useMemo(() => {
    const totalSessions = sessions.length
    const confirmedPresence = sessions.filter((session) => session?.presenceConfirmed).length
    const punctualSessions = sessions.filter((session) => session?.punctualityOk).length
    const extrapolatedSessions = sessions.filter((session) => session?.finishStatus === 'extrapolated').length
    const finalizedSessions = sessions.filter((session) => !!session?.endedAt).length
    const sessionTimings = sessions.map((session) => getSessionTiming(session))
    const openingRows = sessionTimings.filter((item) => item.hasOpenTiming)
    const closingRows = sessionTimings.filter((item) => item.hasCloseTiming)
    const openingOnTimeCount = openingRows.filter((item) => item.openedOnTime).length
    const closingOnTimeCount = closingRows.filter((item) => item.closedOnTime).length
    const averageOpenDeltaMinutes = average(openingRows.map((item) => item.openDeltaMinutes))
    const averageCloseDeltaMinutes = average(closingRows.map((item) => item.closeDeltaMinutes))

    return {
      totalSessions,
      confirmedPresence,
      punctualSessions,
      extrapolatedSessions,
      finalizedSessions,
      openingRowsCount: openingRows.length,
      closingRowsCount: closingRows.length,
      openingOnTimeCount,
      closingOnTimeCount,
      averageOpenDeltaMinutes,
      averageCloseDeltaMinutes,
    }
  }, [sessions])

  const sundayChartData = useMemo(() => {
    const grouped = sessions.reduce((acc, session) => {
      const dateKey = session?.lessonDateKey || 'sem-data'
      if (!acc[dateKey]) {
        acc[dateKey] = {
          dateKey,
          label: formatSessionDate(dateKey),
          pontuais: 0,
          extrapoladas: 0,
        }
      }

      if (session?.punctualityOk) acc[dateKey].pontuais += 1
      if (session?.finishStatus === 'extrapolated') acc[dateKey].extrapoladas += 1

      return acc
    }, {})

    return Object.values(grouped)
      .sort((a, b) => a.dateKey.localeCompare(b.dateKey))
      .slice(-8)
  }, [sessions])

  const teacherRows = useMemo(() => {
    const grouped = sessions.reduce((acc, session) => {
      const teacherKey = session?.teacherUid || session?.teacherEmail || session?.teacherName || 'sem-professor'
      const timing = getSessionTiming(session)
      if (!acc[teacherKey]) {
        acc[teacherKey] = {
          teacherName: session?.teacherName || 'Professor não identificado',
          total: 0,
          pontuais: 0,
          extrapoladas: 0,
          openTimings: [],
          closeTimings: [],
          openOnTimeCount: 0,
          closeOnTimeCount: 0,
        }
      }

      acc[teacherKey].total += 1
      if (session?.punctualityOk) acc[teacherKey].pontuais += 1
      if (session?.finishStatus === 'extrapolated') acc[teacherKey].extrapoladas += 1
      if (timing.hasOpenTiming) {
        acc[teacherKey].openTimings.push(timing.openDeltaMinutes)
        if (timing.openedOnTime) acc[teacherKey].openOnTimeCount += 1
      }
      if (timing.hasCloseTiming) {
        acc[teacherKey].closeTimings.push(timing.closeDeltaMinutes)
        if (timing.closedOnTime) acc[teacherKey].closeOnTimeCount += 1
      }

      return acc
    }, {})

    return Object.values(grouped)
      .map((item) => ({
        ...item,
        taxaPontualidade: item.total ? (item.pontuais / item.total) * 100 : 0,
        averageOpenDeltaMinutes: average(item.openTimings),
        averageCloseDeltaMinutes: average(item.closeTimings),
      }))
      .sort((a, b) => b.total - a.total)
  }, [sessions])

  const orderedSessions = useMemo(
    () => [...sessions].sort((a, b) => String(b.lessonDateKey || '').localeCompare(String(a.lessonDateKey || ''))),
    [sessions],
  )

  const monthlyTeacherRows = useMemo(() => {
    const grouped = sessions.reduce((acc, session) => {
      const monthKey = String(session?.lessonDateKey || '').slice(0, 7) || 'sem-mes'
      const teacherKey = session?.teacherUid || session?.teacherEmail || session?.teacherName || 'sem-professor'
      const entryKey = `${monthKey}:${teacherKey}`
      const timing = getSessionTiming(session)

      if (!acc[entryKey]) {
        acc[entryKey] = {
          monthKey,
          teacherName: session?.teacherName || 'Professor não identificado',
          totalSessions: 0,
          openTimings: [],
          closeTimings: [],
        }
      }

      acc[entryKey].totalSessions += 1
      if (timing.hasOpenTiming) acc[entryKey].openTimings.push(timing.openDeltaMinutes)
      if (timing.hasCloseTiming) acc[entryKey].closeTimings.push(timing.closeDeltaMinutes)
      return acc
    }, {})

    return Object.values(grouped)
      .map((item) => ({
        ...item,
        openLateMinutes: sumPositive(item.openTimings),
        openEarlyMinutes: sumNegativeAbsolute(item.openTimings),
        closeLateMinutes: sumPositive(item.closeTimings),
        closeEarlyMinutes: sumNegativeAbsolute(item.closeTimings),
      }))
      .sort((a, b) => b.monthKey.localeCompare(a.monthKey) || a.teacherName.localeCompare(b.teacherName))
  }, [sessions])

  const quarterOptions = useMemo(() => {
    const grouped = attendanceRegisters.reduce((acc, register) => {
      const quarterKey = buildQuarterKey(register)
      if (!quarterKey) return acc

      if (!acc[quarterKey]) {
        const periodMeta = getRegisterPeriodMeta(register)
        acc[quarterKey] = {
          value: quarterKey,
          label: buildQuarterLabel(register),
          sortKey: periodMeta.startDate || `${register?.year || ''}-${String(register?.month || '').padStart(2, '0')}`,
          startDate: periodMeta.startDate,
          endDate: periodMeta.endDate,
          year: periodMeta.year,
          quarterNumber: periodMeta.quarterNumber,
          semesterNumber: periodMeta.semesterNumber,
          serial: periodMeta.serial,
        }
      }

      return acc
    }, {})

    return Object.values(grouped).sort((a, b) => String(b.sortKey).localeCompare(String(a.sortKey)))
  }, [attendanceRegisters])

  const periodGroups = useMemo(() => {
    const grouped = quarterOptions.reduce((acc, option) => {
      const groupKey = String(option.year || 'sem-ano')
      if (!acc[groupKey]) {
        acc[groupKey] = {
          year: option.year || 'Sem ano',
          options: [],
          firstSemesterKeys: [],
          secondSemesterKeys: [],
          yearKeys: [],
        }
      }

      acc[groupKey].options.push(option)
      acc[groupKey].yearKeys.push(option.value)
      if (option.semesterNumber === 1) acc[groupKey].firstSemesterKeys.push(option.value)
      if (option.semesterNumber === 2) acc[groupKey].secondSemesterKeys.push(option.value)
      return acc
    }, {})

    return Object.values(grouped).sort((a, b) => Number(b.year || 0) - Number(a.year || 0))
  }, [quarterOptions])

  useEffect(() => {
    if (!quarterOptions.length) {
      setSelectedQuarterKeys([])
      return
    }

    const availableKeys = new Set(quarterOptions.map((option) => option.value))
    const nextSelectedKeys = selectedQuarterKeys.filter((key) => availableKeys.has(key))

    if (!nextSelectedKeys.length) {
      setSelectedQuarterKeys([quarterOptions[0].value])
      return
    }

    if (nextSelectedKeys.length !== selectedQuarterKeys.length) {
      setSelectedQuarterKeys(nextSelectedKeys)
    }
  }, [quarterOptions, selectedQuarterKeys])

  const selectedQuarterKeySet = useMemo(() => new Set(selectedQuarterKeys), [selectedQuarterKeys])

  const selectedQuarterOptions = useMemo(
    () => quarterOptions.filter((option) => selectedQuarterKeySet.has(option.value)),
    [quarterOptions, selectedQuarterKeySet],
  )

  const selectedQuarterOptionsAsc = useMemo(
    () => [...selectedQuarterOptions].sort((a, b) => String(a.startDate || '').localeCompare(String(b.startDate || ''))),
    [selectedQuarterOptions],
  )

  const selectedPeriodLabel = useMemo(
    () => buildSelectedPeriodLabel(selectedQuarterOptions),
    [selectedQuarterOptions],
  )

  const peopleById = useMemo(
    () => new Map((people || []).filter((person) => person?.id).map((person) => [person.id, person])),
    [people],
  )

  const peopleByEmail = useMemo(
    () => new Map((people || [])
      .filter((person) => person?.email)
      .map((person) => [String(person.email).trim().toLowerCase(), person])),
    [people],
  )

  const peopleByNormalizedName = useMemo(() => {
    const map = new Map()
    ;(people || []).forEach((person) => {
      const normalizedName = normalizeIdentityValue(person?.fullName || person?.name || '')
      if (!normalizedName) return
      const current = map.get(normalizedName) || []
      current.push(person)
      map.set(normalizedName, current)
    })
    return map
  }, [people])

  const uniquePersonIdByNormalizedName = useMemo(() => {
    const map = new Map()
    peopleByNormalizedName.forEach((peopleList, normalizedName) => {
      if (peopleList.length === 1 && peopleList[0]?.id) {
        map.set(normalizedName, peopleList[0].id)
      }
    })
    return map
  }, [peopleByNormalizedName])

  function resolveStudentParticipantIdentity({ personId = '', name = '' } = {}) {
    if (personId) return `person:${personId}`

    const normalizedName = normalizeIdentityValue(name)
    if (normalizedName) return `student-name:${normalizedName}`

    return 'student:sem-identidade'
  }

  function resolveTeacherLinkedPersonId({ personId = '', email = '', name = '' } = {}) {
    if (personId && peopleById.has(personId)) return personId

    const normalizedEmail = String(email || '').trim().toLowerCase()
    if (normalizedEmail && peopleByEmail.get(normalizedEmail)?.id) return peopleByEmail.get(normalizedEmail).id

    const normalizedName = normalizeIdentityValue(name)
    if (normalizedName) {
      const matchedPersonId = uniquePersonIdByNormalizedName.get(normalizedName)
      if (matchedPersonId) return matchedPersonId
    }

    return ''
  }

  function resolveTeacherParticipantIdentity({ personId = '', email = '', name = '' } = {}) {
    const linkedPersonId = resolveTeacherLinkedPersonId({ personId, email, name })
    if (linkedPersonId) return `person:${linkedPersonId}`

    const normalizedEmail = String(email || '').trim().toLowerCase()
    if (normalizedEmail) return `teacher-email:${normalizedEmail}`

    const normalizedName = normalizeIdentityValue(name)
    if (normalizedName) return `teacher-name:${normalizedName}`

    if (personId) return `teacher-id:${personId}`
    return 'teacher:sem-identidade'
  }

  function resolveParticipantDisplayName({ personId = '', email = '', name = '', fallbackName = '' } = {}) {
    const normalizedEmail = String(email || '').trim().toLowerCase()
    if (personId && peopleById.get(personId)?.fullName) return peopleById.get(personId).fullName
    if (normalizedEmail && peopleByEmail.get(normalizedEmail)?.fullName) return peopleByEmail.get(normalizedEmail).fullName

    const normalizedName = normalizeIdentityValue(name)
    const matchedPeople = normalizedName ? (peopleByNormalizedName.get(normalizedName) || []) : []
    if (matchedPeople.length === 1 && matchedPeople[0]?.fullName) return matchedPeople[0].fullName

    return fallbackName || name || 'Matriculado não identificado'
  }

  function applyQuarterSelection(keys) {
    const keySet = new Set(keys)
    setSelectedQuarterKeys(quarterOptions.filter((option) => keySet.has(option.value)).map((option) => option.value))
  }

  function toggleQuarterSelection(key) {
    setSelectedQuarterKeys((currentKeys) => {
      const currentKeySet = new Set(currentKeys)
      if (currentKeySet.has(key)) currentKeySet.delete(key)
      else currentKeySet.add(key)

      return quarterOptions
        .filter((option) => currentKeySet.has(option.value))
        .map((option) => option.value)
    })
  }

  const selectedRegisterSummaries = useMemo(
    () => attendanceRegisters
      .filter((register) => selectedQuarterKeySet.has(buildQuarterKey(register)))
      .map(buildQuarterRegisterSummary),
    [attendanceRegisters, selectedQuarterKeySet],
  )

  const quarterRegisterRows = useMemo(() => {
    const sortedByPeriod = [...selectedRegisterSummaries].sort((a, b) => (
      String(a.startDate || '').localeCompare(String(b.startDate || ''))
      || compareAttendanceWithPunctuality(a, b, (entry) => entry.className)
    ))

    return sortedByPeriod.map((summary) => ({
      registerId: summary.registerId,
      periodKey: summary.periodKey,
      classId: summary.classId,
      className: summary.className,
      teacherName: summary.teacherName,
      periodLabel: summary.periodLabel,
      startDate: summary.startDate,
      endDate: summary.endDate,
      sundayCount: summary.sundayCount,
      studentCount: summary.studentCount,
      totalPP: summary.totalPP,
      totalP: summary.totalP,
      totalA: summary.totalA,
      totalPresences: summary.totalPresences,
      totalRecorded: summary.totalRecorded,
      attendanceRate: summary.attendanceRate,
    }))
  }, [selectedRegisterSummaries])

  const periodSummaries = useMemo(
    () => selectedQuarterOptionsAsc.map((option) => {
      const rows = selectedRegisterSummaries
        .filter((summary) => summary.periodKey === option.value)
        .sort((a, b) => compareAttendanceWithPunctuality(a, b, (entry) => entry.className))

      const participantSet = new Set([
        ...rows.flatMap((summary) => summary.studentRows.map((student) => resolveStudentParticipantIdentity({
          personId: student.studentId,
          name: student.studentName,
        }))),
        ...sessions
          .filter((session) => isDateWithinRange(session?.lessonDateKey, option.startDate, option.endDate))
          .map((session) => resolveTeacherParticipantIdentity({
            personId: session?.teacherUid || '',
            email: session?.teacherEmail || '',
            name: session?.teacherName || '',
          })),
      ])

      const totalPP = rows.reduce((total, row) => total + row.totalPP, 0)
      const totalP = rows.reduce((total, row) => total + row.totalP, 0)
      const totalA = rows.reduce((total, row) => total + row.totalA, 0)
      const teacherSessions = sessions.filter((session) => isDateWithinRange(session?.lessonDateKey, option.startDate, option.endDate))
      const teacherPP = teacherSessions.filter((session) => session?.presenceConfirmed && session?.punctualityOk).length
      const teacherP = teacherSessions.filter((session) => session?.presenceConfirmed && session?.punctualityOk === false).length
      const teacherA = teacherSessions.filter((session) => !session?.presenceConfirmed).length
      const totalRecorded = rows.reduce((total, row) => total + row.totalRecorded, 0) + teacherSessions.length

      return {
        periodKey: option.value,
        periodLabel: option.label,
        rows,
        totalClasses: rows.length,
        totalStudents: participantSet.size,
        totalSundays: [...new Set(rows.flatMap((row) => row.sundayDates || []))].length,
        totalPP: totalPP + teacherPP,
        totalP: totalP + teacherP,
        totalA: totalA + teacherA,
        totalPresences: totalPP + totalP + teacherPP + teacherP,
        attendanceRate: totalRecorded ? ((totalPP + totalP + teacherPP + teacherP) / totalRecorded) * 100 : 0,
      }
    }),
    [resolveStudentParticipantIdentity, resolveTeacherParticipantIdentity, selectedQuarterOptionsAsc, selectedRegisterSummaries, sessions],
  )

  const quarterSummary = useMemo(() => {
    const uniqueClassKeys = new Set(
      selectedRegisterSummaries.map((row) => row.classId || row.className),
    )
    const uniqueSundayDates = new Set(
      selectedRegisterSummaries.flatMap((row) => row.sundayDates || []),
    )
    const totalPP = periodSummaries.reduce((total, row) => total + row.totalPP, 0)
    const totalP = periodSummaries.reduce((total, row) => total + row.totalP, 0)
    const totalA = periodSummaries.reduce((total, row) => total + row.totalA, 0)
    const totalRecorded = totalPP + totalP + totalA
    const totalPresences = totalPP + totalP

    return {
      totalClasses: uniqueClassKeys.size,
      totalStudents: 0,
      totalSundays: uniqueSundayDates.size,
      totalPP,
      totalP,
      totalA,
      totalRecorded,
      totalPresences,
      attendanceRate: totalRecorded ? (totalPresences / totalRecorded) * 100 : 0,
    }
  }, [periodSummaries, selectedRegisterSummaries])

  const quarterStudentRows = useMemo(
    () => {
      const participantMap = selectedRegisterSummaries.reduce((acc, summary) => {
        summary.studentRows.forEach((student) => {
          const participantKey = resolveStudentParticipantIdentity({
            personId: student.studentId,
            name: student.studentName,
          })

          if (!acc[participantKey]) {
            acc[participantKey] = {
              participantKey,
              participantName: resolveParticipantDisplayName({
                personId: student.studentId,
                name: student.studentName,
                fallbackName: student.studentName,
              }),
              classNames: new Set(),
              roleLabels: new Set(),
              teacherNames: new Set(),
              totalPP: 0,
              totalP: 0,
              totalA: 0,
              totalRecorded: 0,
            }
          }

          const current = acc[participantKey]
          current.classNames.add(summary.className)
          current.roleLabels.add('Aluno')
          current.teacherNames.add(summary.teacherName)
          current.totalPP += student.totalPP
          current.totalP += student.totalP
          current.totalA += student.totalA
          current.totalRecorded += student.totalRecorded
        })

        return acc
      }, {})

      selectedQuarterOptionsAsc.forEach((option) => {
        sessions
          .filter((session) => isDateWithinRange(session?.lessonDateKey, option.startDate, option.endDate))
          .forEach((session) => {
            const linkedPersonId = resolveTeacherLinkedPersonId({
              personId: session?.teacherUid || '',
              email: session?.teacherEmail || '',
              name: session?.teacherName || '',
            })

            const participantKey = resolveTeacherParticipantIdentity({
              personId: session?.teacherUid || '',
              email: session?.teacherEmail || '',
              name: session?.teacherName || '',
            })

            if (!participantMap[participantKey]) {
              participantMap[participantKey] = {
                participantKey,
                participantName: resolveParticipantDisplayName({
                  personId: linkedPersonId,
                  email: session?.teacherEmail || '',
                  name: session?.teacherName || '',
                  fallbackName: session?.teacherName || 'Professor não informado',
                }),
                classNames: new Set(),
                roleLabels: new Set(),
                teacherNames: new Set(),
                totalPP: 0,
                totalP: 0,
                totalA: 0,
                totalRecorded: 0,
              }
            }

            const current = participantMap[participantKey]
            current.classNames.add(session?.monitoringClassName || session?.className || 'Classe não informada')
            current.roleLabels.add('Professor')
            current.teacherNames.add(session?.teacherName || 'Professor não informado')

            if (session?.presenceConfirmed) {
              if (session?.punctualityOk) current.totalPP += 1
              else current.totalP += 1
            } else {
              current.totalA += 1
            }
            current.totalRecorded += 1
          })
      })

      return Object.values(participantMap)
        .map((participant) => ({
          studentId: participant.participantKey,
          studentName: participant.participantName,
          classId: participant.participantKey,
          className: [...participant.classNames].sort(compareNames).join(' / '),
          roleLabel: [...participant.roleLabels].sort(compareNames).join(' / '),
          teacherName: [...participant.teacherNames].sort(compareNames).join(' / '),
          totalPP: participant.totalPP,
          totalP: participant.totalP,
          totalA: participant.totalA,
          totalPresences: participant.totalPP + participant.totalP,
          totalRecorded: participant.totalRecorded,
          attendanceRate: participant.totalRecorded ? ((participant.totalPP + participant.totalP) / participant.totalRecorded) * 100 : 0,
        }))
        .sort((a, b) => (
          compareAttendanceWithPunctuality(a, b, (entry) => entry.studentName)
          || compareNames(a.className, b.className)
        ))
    },
    [resolveParticipantDisplayName, resolveStudentParticipantIdentity, resolveTeacherLinkedPersonId, resolveTeacherParticipantIdentity, selectedQuarterOptionsAsc, selectedRegisterSummaries, sessions],
  )

  const quarterSummaryWithStudents = useMemo(
    () => ({
      ...quarterSummary,
      totalStudents: quarterStudentRows.length,
    }),
    [quarterStudentRows, quarterSummary],
  )

  async function handleExportQuarterPdf() {
    if (!quarterRegisterRows.length || isExportingQuarterPdf) return

    setIsExportingQuarterPdf(true)
    try {
      await generateQuarterlyAttendanceReportPDF({
        quarterLabel: selectedPeriodLabel,
        generatedAtLabel: new Date().toLocaleString('pt-BR'),
        summary: quarterSummaryWithStudents,
        periodSummaries,
        registerRows: quarterRegisterRows,
        studentRows: quarterStudentRows,
      })
    } finally {
      setIsExportingQuarterPdf(false)
    }
  }

  return (
    <div className="feature-page">
      <div className="feature-header">
        <div>
          <h2 className="feature-title">Relatórios</h2>
          <p className="feature-subtitle">
            {canManageStructure
              ? 'Painel consolidado de pontualidade, check-in e extrapolação das aulas.'
              : 'Histórico pessoal de pontualidade, check-in e encerramento das suas aulas.'}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader
          title="Relatório consolidado de presenças"
          subtitle={canManageStructure
            ? 'Consolidação de um ou mais trimestres, com desempate por pontualidade.'
            : 'Consolidação dos trimestres vinculados ao seu acesso, com desempate por pontualidade.'}
          action={(
            <Button
              variant="secondary"
              onClick={handleExportQuarterPdf}
              loading={isExportingQuarterPdf}
              disabled={!quarterRegisterRows.length}
            >
              Exportar PDF do período
            </Button>
          )}
        />

        <div className="inline-form">
          <label>Períodos consolidados</label>
          {quarterOptions.length === 0 ? (
            <p className="feature-subtitle">Nenhum trimestre disponível.</p>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <Button size="sm" variant="secondary" onClick={() => applyQuarterSelection(quarterOptions.map((option) => option.value))}>
                  Selecionar tudo
                </Button>
                <Button size="sm" variant="secondary" onClick={() => applyQuarterSelection([])}>
                  Limpar
                </Button>
              </div>

              {periodGroups.map((group) => (
                <div key={String(group.year)} style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
                  <div className="entity-title" style={{ marginBottom: 8 }}>{group.year}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                    {group.options.map((option) => (
                      <label
                        key={option.value}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '6px 10px',
                          border: '1px solid #d1d5db',
                          borderRadius: 999,
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedQuarterKeySet.has(option.value)}
                          onChange={() => toggleQuarterSelection(option.value)}
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {group.firstSemesterKeys.length > 0 && (
                      <Button size="sm" variant="secondary" onClick={() => applyQuarterSelection(group.firstSemesterKeys)}>
                        1º semestre
                      </Button>
                    )}
                    {group.secondSemesterKeys.length > 0 && (
                      <Button size="sm" variant="secondary" onClick={() => applyQuarterSelection(group.secondSemesterKeys)}>
                        2º semestre
                      </Button>
                    )}
                    {group.yearKeys.length > 0 && (
                      <Button size="sm" variant="secondary" onClick={() => applyQuarterSelection(group.yearKeys)}>
                        Ano todo
                      </Button>
                    )}
                  </div>
                </div>
              ))}

              <p className="feature-subtitle">Período selecionado: {selectedPeriodLabel}</p>
            </div>
          )}
        </div>

        {quarterRegisterRows.length > 0 ? (
          <>
            <div className="summary-grid">
              <div className="summary-item">
                <span className="summary-label">Classes</span>
                <span className="summary-value">{quarterSummaryWithStudents.totalClasses}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Matriculados no período</span>
                <span className="summary-value">{quarterSummaryWithStudents.totalStudents}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Domingos somados</span>
                <span className="summary-value">{quarterSummaryWithStudents.totalSundays}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Presenças (PP + P)</span>
                <span className="summary-value">{quarterSummaryWithStudents.totalPresences}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Ausências</span>
                <span className="summary-value">{quarterSummaryWithStudents.totalA}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">PP</span>
                <span className="summary-value">{quarterSummaryWithStudents.totalPP}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Aproveitamento geral</span>
                <span className="summary-value">{quarterSummaryWithStudents.attendanceRate.toFixed(1)}%</span>
              </div>
            </div>

            {periodSummaries.length > 1 && (
              <div className="entity-list" style={{ marginTop: 16 }}>
                {periodSummaries.map((period) => (
                  <div key={period.periodKey} className="entity-row">
                    <div>
                      <div className="entity-title">{period.periodLabel}</div>
                      <div className="entity-meta">
                        classes: {period.totalClasses} • matriculados: {period.totalStudents} • domingos: {period.totalSundays}
                      </div>
                      <div className="entity-meta">
                        presenças: {period.totalPresences} • ausências: {period.totalA} • PP: {period.totalPP} • P: {period.totalP}
                      </div>
                    </div>
                    <span className={`entity-status ${period.attendanceRate < 75 ? 'inactive' : 'active'}`}>
                      {period.attendanceRate.toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="entity-list" style={{ marginTop: 16 }}>
              {periodSummaries.map((period) => (
                <div key={period.periodKey} style={{ marginBottom: 16 }}>
                  <div className="entity-title" style={{ marginBottom: 8 }}>{period.periodLabel}</div>
                  {period.rows.map((row) => (
                    <div key={row.registerId} className="entity-row">
                      <div>
                        <div className="entity-title">{row.className}</div>
                        <div className="entity-meta">
                          {row.teacherName}
                        </div>
                        <div className="entity-meta">
                          matriculados: {row.studentCount} • domingos: {row.sundayCount} • presenças: {row.totalPresences} • ausências: {row.totalA}
                        </div>
                        <div className="entity-meta">
                          PP: {row.totalPP} • P: {row.totalP} • aproveitamento: {row.attendanceRate.toFixed(1)}%
                        </div>
                      </div>
                      <span className={`entity-status ${row.attendanceRate < 75 ? 'inactive' : 'active'}`}>
                        {row.attendanceRate.toFixed(1)}%
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="feature-subtitle">Nenhuma caderneta encontrada para os períodos selecionados.</p>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Matriculados no período"
          subtitle="Lista geral por matriculado, somando participações como aluno e professor."
        />
        <div className="entity-list">
          {quarterStudentRows.length === 0 && <p className="feature-subtitle">Nenhum matriculado consolidado para os períodos selecionados.</p>}
          {quarterStudentRows.map((student) => (
            <div key={`${student.classId}-${student.studentId}`} className="entity-row">
              <div>
                <div className="entity-title">{student.studentName}</div>
                <div className="entity-meta">
                  {student.className}
                </div>
                <div className="entity-meta">
                  Funções: {student.roleLabel || 'Aluno'} • Presenças: {student.totalPresences} • Ausências: {student.totalA} • PP: {student.totalPP} • P: {student.totalP}
                </div>
              </div>
              <span className={`entity-status ${student.attendanceRate < 75 ? 'inactive' : 'active'}`}>
                {student.attendanceRate.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Resumo da aula"
          subtitle="Indicadores consolidados das sessões registradas pelo painel de controle."
        />
        <div className="summary-grid">
          <div className="summary-item">
            <span className="summary-label">Aulas registradas</span>
            <span className="summary-value">{summary.totalSessions}</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">Check-ins confirmados</span>
            <span className="summary-value">{summary.confirmedPresence}</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">Pontualidade OK</span>
            <span className="summary-value">{summary.punctualSessions}</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">Aulas extrapoladas</span>
            <span className="summary-value">{summary.extrapolatedSessions}</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">Aberturas no horário</span>
            <span className="summary-value">{summary.openingRowsCount ? `${summary.openingOnTimeCount}/${summary.openingRowsCount}` : '--'}</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">Fechamentos no prazo</span>
            <span className="summary-value">{summary.closingRowsCount ? `${summary.closingOnTimeCount}/${summary.closingRowsCount}` : '--'}</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">Média de abertura</span>
            <span className="summary-value">{formatDeltaLabel(summary.averageOpenDeltaMinutes, { emptyLabel: '--', onTimeLabel: 'No horário' })}</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">Média de fechamento</span>
            <span className="summary-value">{formatDeltaLabel(summary.averageCloseDeltaMinutes, { emptyLabel: '--', onTimeLabel: 'No horário' })}</span>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Curva de extrapolação por domingo"
          subtitle="Comparativo entre aulas pontuais e extrapoladas nas últimas 8 datas registradas."
        />
        {sundayChartData.length > 0 ? (
          <div className="dashboard-frequency-chart">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={sundayChartData} margin={{ top: 5, right: 5, left: -15, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="pontuais" name="Pontuais" fill="#15803d" radius={[4, 4, 0, 0]} />
                <Bar dataKey="extrapoladas" name="Extrapoladas" fill="#b91c1c" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="feature-subtitle">Ainda não há sessões suficientes para montar o gráfico.</p>
        )}
      </Card>

      {canManageStructure && (
        <Card>
          <CardHeader
            title="Comparativo por professor"
            subtitle="Ajuda a superintendência a identificar quem está mantendo o horário e quem precisa de acompanhamento."
          />
          <div className="entity-list">
            {teacherRows.length === 0 && <p className="feature-subtitle">Nenhum professor com sessões registradas ainda.</p>}
            {teacherRows.map((teacher) => (
              <div key={teacher.teacherName} className="entity-row">
                <div>
                  <div className="entity-title">{teacher.teacherName}</div>
                  <div className="entity-meta">
                    {teacher.total} aula(s) • {teacher.pontuais} pontual(is) • {teacher.extrapoladas} extrapolada(s)
                  </div>
                  <div className="entity-meta">
                    Abertura média: {formatDeltaLabel(teacher.averageOpenDeltaMinutes, { emptyLabel: 'sem dado', onTimeLabel: 'no horário' })} • Fechamento médio: {formatDeltaLabel(teacher.averageCloseDeltaMinutes, { emptyLabel: 'sem dado', onTimeLabel: 'no horário' })}
                  </div>
                </div>
                <span className={`entity-status ${teacher.extrapoladas > 0 ? 'inactive' : 'active'}`}>
                  {teacher.openTimings.length ? `${Math.round((teacher.openOnTimeCount / teacher.openTimings.length) * 100)}% na abertura` : `${teacher.taxaPontualidade.toFixed(0)}% pontual`}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Fechamento mensal de pontualidade"
          subtitle="Soma de minutos adiantados e atrasados por professor ao longo do mes."
        />
        <div className="entity-list">
          {monthlyTeacherRows.length === 0 && <p className="feature-subtitle">Nenhum dado mensal disponivel ainda.</p>}
          {monthlyTeacherRows.map((item) => (
            <div key={`${item.monthKey}-${item.teacherName}`} className="entity-row">
              <div>
                <div className="entity-title">
                  {item.teacherName} • {item.monthKey}
                </div>
                <div className="entity-meta">
                  {item.totalSessions} aula(s) • abertura atrasada: {item.openLateMinutes} min • abertura adiantada: {item.openEarlyMinutes} min
                </div>
                <div className="entity-meta">
                  fechamento atrasado: {item.closeLateMinutes} min • fechamento adiantado: {item.closeEarlyMinutes} min
                </div>
              </div>
              <span className={`entity-status ${item.openLateMinutes > 0 || item.closeLateMinutes > 0 ? 'inactive' : 'active'}`}>
                {item.openLateMinutes + item.closeLateMinutes} min de atraso
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Últimos registros"
          subtitle="Linha do tempo dos fechamentos de aula para auditoria rápida."
        />
        <div className="entity-list">
          {orderedSessions.length === 0 && <p className="feature-subtitle">Nenhum registro de aula encontrado.</p>}
          {orderedSessions.map((session) => {
            const timing = getSessionTiming(session)
            const sessionMapUrl = buildMapsUrl(session?.geoPoint)
            return (
              <div key={`${session.storageOwnerUid || 'uid'}-${session.id}`} className="entity-row">
                <div>
                  <div className="entity-title">
                    {canManageStructure ? session.teacherName || 'Professor não identificado' : formatSessionDate(session.lessonDateKey)}
                  </div>
                  <div className="entity-meta">
                    {canManageStructure ? formatSessionDate(session.lessonDateKey) : 'Sua aula'} • Abertura: {formatSessionTime(getSessionOpenIso(session))} ({formatDeltaLabel(timing.openDeltaMinutes, { emptyLabel: 'sem dado', onTimeLabel: 'no horário' })})
                  </div>
                  <div className="entity-meta">
                    Check-in: {session.presenceConfirmed ? 'Confirmado' : 'Pendente'} • Término: {formatSessionTime(session.endedAt)} ({formatDeltaLabel(timing.closeDeltaMinutes, { emptyLabel: 'sem dado', onTimeLabel: 'no horário' })})
                  </div>
                  <div className="entity-meta">
                    GPS: {session.locationCheckedAt ? formatLocationTimestamp(session.locationCheckedAt) : 'sem leitura'} • Distância: {Number.isFinite(Number(session.distanceMeters)) ? `${Math.round(Number(session.distanceMeters))} m` : '--'} • Coordenadas: {session?.geoPoint ? `${formatCoordinate(session.geoPoint.lat)}, ${formatCoordinate(session.geoPoint.lng)}` : '--'}
                  </div>
                  {sessionMapUrl && (
                    <div className="entity-meta">
                      <a href={sessionMapUrl} target="_blank" rel="noreferrer">Abrir ponto no mapa</a>
                    </div>
                  )}
                </div>
                <span className={`entity-status ${session.finishStatus === 'extrapolated' ? 'inactive' : 'active'}`}>
                  {timing.openedOnTime ? 'Abertura OK' : Number.isFinite(timing.openDeltaMinutes) ? 'Abertura tardia' : 'Sem abertura'}
                </span>
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}
