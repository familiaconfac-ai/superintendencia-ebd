import { isEnrollmentActiveAtDate, isEnrollmentCurrentlyActive } from './enrollmentMetrics'

function toDate(value) {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value?.toDate === 'function') {
    const converted = value.toDate()
    return Number.isNaN(converted?.getTime?.()) ? null : converted
  }

  const normalized = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T00:00:00`
    : value
  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function isPresenceMark(status) {
  return status === 'P' || status === 'PP'
}

function formatShortDate(date) {
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
  })
}

function getPresenceTimeline(registers = [], referenceDate = new Date()) {
  const byDate = new Map()
  const reference = toDate(referenceDate) || new Date()

  registers.forEach((register) => {
    Object.entries(register?.attendanceByStudent || {}).forEach(([personId, studentAttendance]) => {
      Object.entries(studentAttendance || {}).forEach(([dateKey, status]) => {
        if (!isPresenceMark(status)) return

        const date = toDate(dateKey)
        if (!date || date > reference) return

        const normalizedDateKey = date.toISOString().slice(0, 10)
        if (!byDate.has(normalizedDateKey)) {
          byDate.set(normalizedDateKey, {
            date,
            presentIds: new Set(),
          })
        }

        byDate.get(normalizedDateKey).presentIds.add(personId)
      })
    })
  })

  return byDate
}

export function calculateDashboardOverview({
  people = [],
  enrollments = [],
  attendanceRegisters = [],
  referenceDate = new Date(),
  lookbackDays = 30,
  timelineSize = 8,
} = {}) {
  const reference = toDate(referenceDate) || new Date()
  const cutoff = new Date(reference)
  cutoff.setDate(cutoff.getDate() - lookbackDays)
  cutoff.setHours(0, 0, 0, 0)

  const totalPeople = people.filter((person) => person?.active !== false).length

  const activeEnrolledIds = new Set(
    enrollments
      .filter((enrollment) => isEnrollmentCurrentlyActive(enrollment))
      .map((enrollment) => enrollment?.personId)
      .filter(Boolean),
  )

  const presenceTimeline = getPresenceTimeline(attendanceRegisters, reference)
  const lastPresenceByStudent = new Map()

  presenceTimeline.forEach(({ date, presentIds }) => {
    presentIds.forEach((personId) => {
      const currentDate = lastPresenceByStudent.get(personId)
      if (!currentDate || currentDate < date) {
        lastPresenceByStudent.set(personId, date)
      }
    })
  })

  const frequentIds = new Set(
    [...activeEnrolledIds].filter((personId) => {
      const lastPresence = lastPresenceByStudent.get(personId)
      return !!lastPresence && lastPresence >= cutoff
    }),
  )

  const inactiveIds = new Set(
    [...activeEnrolledIds].filter((personId) => !frequentIds.has(personId)),
  )

  const recentDates = [...presenceTimeline.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-timelineSize)

  const frequencyTimeline = recentDates.map(([dateKey, { date, presentIds }]) => {
    const activeEnrolledAtDate = new Set(
      enrollments
        .filter((enrollment) => isEnrollmentActiveAtDate(enrollment, date))
        .map((enrollment) => enrollment?.personId)
        .filter(Boolean),
    )

    const presentCount = presentIds.size
    const enrolledCount = activeEnrolledAtDate.size

    return {
      dateKey,
      label: formatShortDate(date),
      presentes: presentCount,
      matriculados: enrolledCount,
      faltas: Math.max(enrolledCount - presentCount, 0),
      percentual: enrolledCount ? (presentCount / enrolledCount) * 100 : 0,
    }
  })

  return {
    totalPeople,
    activeEnrolledCount: activeEnrolledIds.size,
    frequentCount: frequentIds.size,
    inactiveCount: inactiveIds.size,
    activeEnrolledIds,
    frequentIds,
    inactiveIds,
    lastPresenceByStudent,
    frequencyTimeline,
  }
}

export function getStudentAttendanceHealth(studentId, attendanceRegisters = [], referenceDate = new Date(), lookbackDays = 30) {
  if (!studentId) {
    return {
      variant: 'neutral',
      label: 'Sem historico',
      lastPresenceDate: null,
    }
  }

  const reference = toDate(referenceDate) || new Date()
  const cutoff = new Date(reference)
  cutoff.setDate(cutoff.getDate() - lookbackDays)
  cutoff.setHours(0, 0, 0, 0)

  let lastPresenceDate = null

  attendanceRegisters.forEach((register) => {
    const studentAttendance = register?.attendanceByStudent?.[studentId] || {}
    Object.entries(studentAttendance).forEach(([dateKey, status]) => {
      if (!isPresenceMark(status)) return
      const attendanceDate = toDate(dateKey)
      if (!attendanceDate || attendanceDate > reference) return
      if (!lastPresenceDate || attendanceDate > lastPresenceDate) {
        lastPresenceDate = attendanceDate
      }
    })
  })

  if (!lastPresenceDate) {
    return {
      variant: 'neutral',
      label: 'Sem historico',
      lastPresenceDate: null,
    }
  }

  if (lastPresenceDate >= cutoff) {
    return {
      variant: 'success',
      label: 'Frequente',
      lastPresenceDate,
    }
  }

  return {
    variant: 'danger',
    label: 'Inativo',
    lastPresenceDate,
  }
}
