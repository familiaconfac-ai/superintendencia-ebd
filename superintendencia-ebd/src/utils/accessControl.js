export const ROLES = {
  ADMIN: 'admin',
  TEACHER: 'teacher',
}

export const PRIMARY_ADMIN_EMAIL = 'igrejabatistaolimpia@gmail.com'

function normalizeEmail(email) {
  return (email || '').trim().toLowerCase()
}

function normalizeDateKey(value) {
  if (!value) return ''
  if (typeof value === 'string') return value.slice(0, 10)

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function isAdmin(user) {
  return normalizeEmail(user?.email) === PRIMARY_ADMIN_EMAIL
}

export function resolveRoleFromEmail(email) {
  return isAdmin({ email })
    ? ROLES.ADMIN
    : ROLES.TEACHER
}

export function isAdminRole(role) {
  return role === ROLES.ADMIN
}

export function isTeacherRole(role) {
  return role === ROLES.TEACHER
}

export function normalizeText(value) {
  return (value || '')
    .toString()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

export function getUserIdentityTokens(user, profile) {
  const email = normalizeEmail(profile?.email || user?.email || '')
  const emailName = email.includes('@') ? email.split('@')[0] : email
  const names = [profile?.displayName, user?.displayName, emailName]
    .map(normalizeText)
    .filter(Boolean)

  return {
    uid: user?.uid || '',
    email,
    profileId: profile?.id || profile?.uid || '',
    names,
  }
}

function getHistoricalTeacherLinks(record) {
  return Array.isArray(record?.historicalTeacherLinks)
    ? record.historicalTeacherLinks.filter(Boolean)
    : []
}

export function belongsToTeacherRecordByPrimaryFields(record, user, profile) {
  if (!record) return false

  const identity = getUserIdentityTokens(user, profile)
  if (!identity.uid && !identity.email && identity.names.length === 0) return false

  const ownerUid = record.ownerUid || record.teacherAuthUid || record.teacherUid || record.teacherUserUid || record.createdByUid || ''
  if (ownerUid && identity.uid && ownerUid === identity.uid) return true

  const ownerTeacherId = record.teacherId || record.defaultTeacherId || ''
  if (ownerTeacherId && identity.profileId && ownerTeacherId === identity.profileId) return true

  const ownerEmail = normalizeEmail(record.teacherEmail || record.defaultTeacherEmail || '')
  if (ownerEmail && identity.email && ownerEmail === identity.email) return true

  const ownerName = normalizeText(record.teacherName || record.defaultTeacherName || '')
  if (ownerName && identity.names.includes(ownerName)) return true

  return false
}

export function belongsToTeacherRecord(record, user, profile) {
  if (belongsToTeacherRecordByPrimaryFields(record, user, profile)) return true

  const identity = getUserIdentityTokens(user, profile)
  if (!identity.uid && !identity.email && identity.names.length === 0) return false

  return getHistoricalTeacherLinks(record).some((link) => {
    const linkUid = link?.uid || link?.teacherUid || link?.teacherAuthUid || ''
    if (linkUid && identity.uid && linkUid === identity.uid) return true

    const linkProfileId = link?.profileId || link?.teacherId || ''
    if (linkProfileId && identity.profileId && linkProfileId === identity.profileId) return true

    const linkEmail = normalizeEmail(link?.email || link?.teacherEmail || '')
    if (linkEmail && identity.email && linkEmail === identity.email) return true

    const linkNames = [link?.name, link?.teacherName]
      .map(normalizeText)
      .filter(Boolean)

    return linkNames.some((name) => identity.names.includes(name))
  })
}

export function getAttendanceRegisterLifecycle(record, now = new Date()) {
  const candidates = []

  if (Array.isArray(record?.sundayDates)) {
    candidates.push(...record.sundayDates.map(normalizeDateKey).filter(Boolean))
  }

  const endDate = normalizeDateKey(record?.endDate)
  const startDate = normalizeDateKey(record?.startDate)
  if (endDate) candidates.push(endDate)
  if (startDate) candidates.push(startDate)

  const lastClassDate = [...new Set(candidates)].sort().at(-1) || ''
  const todayKey = normalizeDateKey(now)
  const isHistorical = Boolean(lastClassDate) && Boolean(todayKey) && lastClassDate < todayKey

  return {
    lastClassDate,
    isHistorical,
  }
}

export function isAttendanceRegisterReadOnly(record, user, now = new Date()) {
  if (isAdmin(user)) return false
  return getAttendanceRegisterLifecycle(record, now).isHistorical
}

export function canAccessAttendanceRegister(record, user, profile) {
  if (isAdmin(user)) return true
  return belongsToTeacherRecord(record, user, profile)
}
