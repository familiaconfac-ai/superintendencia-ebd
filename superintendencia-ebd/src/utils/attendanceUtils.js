const STATUS_ORDER = ['', 'PP', 'P', 'A']

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
    return `${formatDateLabel(register.startDate)} a ${formatDateLabel(register.endDate)}`
  }

  if (register?.month && register?.year) {
    return formatMonthYear(register.month, register.year)
  }

  return ''
}
