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

function normalizeMonthLabel(date) {
  const label = date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function normalizeStatusEntry(entry) {
  const changedAt = toDate(entry?.changedAt)
  if (!changedAt) return null

  return {
    status: entry?.status === 'inactive' ? 'inactive' : 'active',
    enrolledInEBD: entry?.enrolledInEBD !== false,
    changedAt: changedAt.toISOString(),
  }
}

export function isEnrollmentCurrentlyActive(enrollment) {
  return enrollment?.status === 'active' && enrollment?.enrolledInEBD !== false
}

export function buildEnrollmentStatusHistory(existingEnrollment, nextState, changedAt = new Date().toISOString()) {
  const history = Array.isArray(existingEnrollment?.statusHistory)
    ? existingEnrollment.statusHistory.map(normalizeStatusEntry).filter(Boolean)
    : []

  const nextEntry = normalizeStatusEntry({
    status: nextState?.status,
    enrolledInEBD: nextState?.enrolledInEBD,
    changedAt,
  })

  if (!nextEntry) return history

  const lastEntry = history[history.length - 1]
  if (lastEntry && lastEntry.status === nextEntry.status && lastEntry.enrolledInEBD === nextEntry.enrolledInEBD) {
    return history
  }

  return [...history, nextEntry]
}

export function isEnrollmentActiveAtDate(enrollment, targetDateInput) {
  const targetDate = toDate(targetDateInput)
  if (!targetDate) return false

  const enrollmentDate = toDate(enrollment?.enrollmentDate)
  if (enrollmentDate && enrollmentDate > targetDate) return false

  const history = Array.isArray(enrollment?.statusHistory)
    ? enrollment.statusHistory.map(normalizeStatusEntry).filter(Boolean)
    : []

  if (history.length > 0) {
    const applicable = history
      .filter((entry) => toDate(entry.changedAt) <= targetDate)
      .sort((a, b) => a.changedAt.localeCompare(b.changedAt))

    if (applicable.length === 0) return false

    const lastApplicable = applicable[applicable.length - 1]
    return lastApplicable.status === 'active' && lastApplicable.enrolledInEBD !== false
  }

  // Fallback conservador para registros antigos sem historico.
  if (isEnrollmentCurrentlyActive(enrollment)) return true

  const updatedAt = toDate(enrollment?.updatedAt)
  if (enrollment?.status === 'inactive' && updatedAt && updatedAt > targetDate) {
    return enrollment?.enrollmentDate ? true : false
  }

  return false
}

export function calculateMemberEnrollmentMetrics(people = [], enrollments = [], referenceDateInput = new Date()) {
  const referenceDate = toDate(referenceDateInput) || new Date()
  const previousMonthDate = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - 1, 1)
  const previousMonthEnd = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 0, 23, 59, 59, 999)

  const memberIds = new Set(
    people
      .filter((person) => person?.active !== false && person?.churchStatus === 'member')
      .map((person) => person.id)
      .filter(Boolean),
  )

  const currentEnrolledMemberIds = new Set()
  const previousEnrolledMemberIds = new Set()

  enrollments.forEach((enrollment) => {
    if (!memberIds.has(enrollment?.personId)) return

    if (isEnrollmentCurrentlyActive(enrollment)) {
      currentEnrolledMemberIds.add(enrollment.personId)
    }

    if (isEnrollmentActiveAtDate(enrollment, previousMonthEnd)) {
      previousEnrolledMemberIds.add(enrollment.personId)
    }
  })

  const totalMembers = memberIds.size
  const currentEnrolledMembers = currentEnrolledMemberIds.size
  const previousEnrolledMembers = previousEnrolledMemberIds.size
  const currentPercent = totalMembers ? (currentEnrolledMembers / totalMembers) * 100 : 0
  const previousPercent = totalMembers ? (previousEnrolledMembers / totalMembers) * 100 : 0
  const deltaPercent = previousEnrolledMembers > 0 ? currentPercent - previousPercent : null

  return {
    totalMembers,
    currentEnrolledMembers,
    previousEnrolledMembers,
    missingMembers: Math.max(totalMembers - currentEnrolledMembers, 0),
    currentPercent,
    previousPercent,
    deltaPercent,
    currentMonthLabel: normalizeMonthLabel(referenceDate),
    previousMonthLabel: normalizeMonthLabel(previousMonthDate),
  }
}
