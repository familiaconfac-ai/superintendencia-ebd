const STATUS_ORDER = ['', 'PP', 'P', 'A']

function toMonthName(date) {
  return date.toLocaleDateString('pt-BR', { month: 'long' })
}

function capitalize(value = '') {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : ''
}

export function getSundaysByMonthYear(month, year) {
  const date = new Date(year, month - 1, 1)
  const sundays = []

  while (date.getMonth() === month - 1) {
    if (date.getDay() === 0) {
      sundays.push(date.toISOString().slice(0, 10))
    }
    date.setDate(date.getDate() + 1)
  }

  return sundays
}

export function getQuarterRange(startDateInput) {
  if (!startDateInput) {
    return { startDate: '', endDate: '', sundayDates: [] }
  }

  const baseDate = new Date(`${startDateInput}T00:00:00`)
  if (Number.isNaN(baseDate.getTime())) {
    return { startDate: '', endDate: '', sundayDates: [] }
  }

  const startDate = new Date(baseDate)
  while (startDate.getDay() !== 0) {
    startDate.setDate(startDate.getDate() + 1)
  }

  const endDate = new Date(startDate.getFullYear(), startDate.getMonth() + 3, 0)
  while (endDate.getDay() !== 0) {
    endDate.setDate(endDate.getDate() - 1)
  }

  const sundayDates = []
  const cursor = new Date(startDate)
  while (cursor <= endDate) {
    if (cursor.getDay() === 0) {
      sundayDates.push(cursor.toISOString().slice(0, 10))
    }
    cursor.setDate(cursor.getDate() + 1)
  }

  return {
    startDate: startDate.toISOString().slice(0, 10),
    endDate: endDate.toISOString().slice(0, 10),
    sundayDates,
  }
}

export function cycleAttendanceStatus(currentStatus = '') {
  const normalizedStatus = currentStatus ?? ''
  const index = STATUS_ORDER.indexOf(normalizedStatus)
  if (index === -1) return 'PP'
  const next = STATUS_ORDER[(index + 1) % STATUS_ORDER.length]
  return next
}

export function getNextAttendanceStatus(currentStatus = '') {
  return cycleAttendanceStatus(currentStatus)
}

function isPresenceStatus(status) {
  return status === 'P' || status === 'PP'
}

export function computeStudentEnrollmentStatus(attendanceHistory = {}, currentStatus = 'active') {
  const orderedDates = Object.keys(attendanceHistory).sort()
  let status = currentStatus === 'inactive' ? 'inactive' : 'active'
  let consecutiveAbsences = 0
  let consecutivePresences = 0
  let inactivationCount = 0
  let reactivationCount = 0
  let inactivatedAt = null
  let reactivatedAt = null

  orderedDates.forEach((date) => {
    const mark = attendanceHistory[date] || ''

    if (mark === 'A') {
      consecutiveAbsences += 1
      consecutivePresences = 0
    } else if (isPresenceStatus(mark)) {
      consecutivePresences += 1
      consecutiveAbsences = 0
    } else {
      consecutiveAbsences = 0
      consecutivePresences = 0
    }

    if (status === 'active' && consecutiveAbsences >= 4) {
      status = 'inactive'
      inactivationCount += 1
      inactivatedAt = date
      consecutivePresences = 0
    }

    if (status === 'inactive' && consecutivePresences >= 4) {
      status = 'active'
      reactivationCount += 1
      reactivatedAt = date
      consecutiveAbsences = 0
    }
  })

  return {
    enrollmentStatus: status,
    inactivatedAt,
    reactivatedAt,
    inactivationCount,
    reactivationCount,
  }
}

export function calculateStudentAttendance(sundayDates, studentAttendance = {}) {
  let totalPP = 0
  let totalP = 0
  let totalA = 0
  let totalLancadas = 0

  sundayDates.forEach((date) => {
    const status = studentAttendance[date] || ''
    if (status === 'PP') totalPP += 1
    if (status === 'P') totalP += 1
    if (status === 'A') totalA += 1
    if (status) totalLancadas += 1
  })

  const presencasValidas = totalPP + totalP
  const divisor = totalLancadas || 1
  const percentualFinal = (presencasValidas / divisor) * 100

  return {
    totalPP,
    totalP,
    totalA,
    percentualFinal,
  }
}

export function calculateClassSummary(register, students) {
  const sundayDates = register?.sundayDates || []
  const attendanceByStudent = register?.attendanceByStudent || {}

  let totalGeralPP = 0
  let totalGeralP = 0
  let totalGeralA = 0
  let sumPercent = 0

  students.forEach((student) => {
    const studentData = calculateStudentAttendance(sundayDates, attendanceByStudent[student.id])
    totalGeralPP += studentData.totalPP
    totalGeralP += studentData.totalP
    totalGeralA += studentData.totalA
    sumPercent += studentData.percentualFinal
  })

  const totalMatriculados = students.length
  const mediaGeralTurma = totalMatriculados ? sumPercent / totalMatriculados : 0

  return {
    totalMatriculados,
    totalGeralPP,
    totalGeralP,
    totalGeralA,
    totalPresencas: totalGeralPP + totalGeralP,
    totalAusencias: totalGeralA,
    mediaGeralTurma,
  }
}

export function formatSundayLabel(isoDate) {
  const date = new Date(`${isoDate}T00:00:00`)
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

export function formatMonthYear(month, year) {
  return new Date(year, month - 1, 1).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  })
}

export function formatDateLabel(isoDate) {
  if (!isoDate) return ''
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString('pt-BR')
}

export function formatRegisterPeriod(register) {
  if (register?.startDate && register?.endDate) {
    const start = new Date(`${register.startDate}T00:00:00`)
    const end = new Date(`${register.endDate}T00:00:00`)

    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      const startLabel = capitalize(toMonthName(start))
      const endLabel = capitalize(toMonthName(end))

      if (start.getFullYear() === end.getFullYear()) {
        if (start.getMonth() === end.getMonth()) {
          return `${startLabel} de ${start.getFullYear()}`
        }
        return `${startLabel} a ${endLabel} de ${start.getFullYear()}`
      }

      return `${startLabel} de ${start.getFullYear()} a ${endLabel} de ${end.getFullYear()}`
    }
  }

  if (register?.month && register?.year) {
    return capitalize(formatMonthYear(register.month, register.year))
  }

  return ''
}
