// Função utilitária para debug detalhado de visibilidade de cadernetas
export function isRegisterVisibleToTeacher(user, register, teacherProfile, debug = false) {
  const identity = getUserIdentityTokens(user, teacherProfile)
  const reasons = []
  let visible = false

  // UID
  const ownerUid = register.ownerUid || register.teacherAuthUid || register.teacherUid || register.teacherUserUid || register.createdByUid || ''
  if (ownerUid && identity.uid && ownerUid === identity.uid) {
    reasons.push('UID bateu')
    visible = true
  }

  // teacherId/profileId
  const ownerTeacherId = register.teacherId || register.defaultTeacherId || ''
  if (!visible && ownerTeacherId && identity.profileId && ownerTeacherId === identity.profileId) {
    reasons.push('teacherId/profileId bateu')
    visible = true
  }

  // Email
  const ownerEmail = normalizeEmail(register.teacherEmail || register.defaultTeacherEmail || '')
  if (!visible && ownerEmail && identity.email && ownerEmail === identity.email) {
    reasons.push('Email bateu')
    visible = true
  }

  // Nome
  const ownerName = normalizeText(register.teacherName || register.defaultTeacherName || '')
  if (!visible && ownerName && identity.names.includes(ownerName)) {
    reasons.push('Nome bateu')
    visible = true
  }

  // Links históricos
  if (!visible && Array.isArray(register.historicalTeacherLinks)) {
    for (const link of register.historicalTeacherLinks) {
      const linkUid = link?.uid || link?.teacherUid || link?.teacherAuthUid || ''
      if (linkUid && identity.uid && linkUid === identity.uid) {
        reasons.push('Link histórico UID bateu')
        visible = true
        break
      }
      const linkProfileId = link?.profileId || link?.teacherId || ''
      if (linkProfileId && identity.profileId && linkProfileId === identity.profileId) {
        reasons.push('Link histórico profileId bateu')
        visible = true
        break
      }
      const linkEmail = normalizeEmail(link?.email || link?.teacherEmail || '')
      if (linkEmail && identity.email && linkEmail === identity.email) {
        reasons.push('Link histórico email bateu')
        visible = true
        break
      }
      const linkNames = [link?.name, link?.teacherName].map(normalizeText).filter(Boolean)
      if (linkNames.some((name) => identity.names.includes(name))) {
        reasons.push('Link histórico nome bateu')
        visible = true
        break
      }
    }
  }

  if (debug) {
    // Log detalhado serializado para facilitar leitura
    const logObj = {
      registerId: register?.id,
      teacherName: register?.teacherName,
      teacherEmail: register?.teacherEmail,
      teacherAuthUid: register?.teacherAuthUid,
      teacherUid: register?.teacherUid,
      teacherUserUid: register?.teacherUserUid,
      teacherId: register?.teacherId,
      ownerUid: register?.ownerUid,
      createdByUid: register?.createdByUid,
      userUid: user?.uid,
      userEmail: user?.email,
      profileId: teacherProfile?.id,
      profileUid: teacherProfile?.uid,
      profileEmail: teacherProfile?.email,
      profileName: teacherProfile?.displayName || teacherProfile?.name,
      resultadoFinal: visible,
      motivo: reasons.join(' | '),
      comparacoes: {
        ownerUid: (register?.ownerUid || register?.teacherAuthUid || register?.teacherUid || register?.teacherUserUid || register?.createdByUid || '') === (user?.uid || ''),
        teacherAuthUid: (register?.teacherAuthUid || '') === (user?.uid || ''),
        teacherUid: (register?.teacherUid || '') === (user?.uid || ''),
        teacherUserUid: (register?.teacherUserUid || '') === (user?.uid || ''),
        teacherId: (register?.teacherId || '') === (teacherProfile?.id || teacherProfile?.uid || ''),
        teacherEmail: (register?.teacherEmail || '').toLowerCase() === (teacherProfile?.email || '').toLowerCase(),
        teacherName: (register?.teacherName || '').toLowerCase() === ((teacherProfile?.displayName || teacherProfile?.name || '').toLowerCase()),
      },
    }
    // eslint-disable-next-line no-console
    console.log('[DEBUG][isRegisterVisibleToTeacher]', JSON.stringify(logObj, null, 2))
  }
  return visible
}
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

  // PATCH: profileId agora pega o documentId real do profile se existir
  const profileId = profile?.id || profile?.uid || profile?.teacherId || ''

  // Log detalhado de identidade
  console.log('[ATTENDANCE_ACCESS][IDENTITY] user.uid:', user?.uid, 'profile.id:', profile?.id, 'profile.uid:', profile?.uid, 'profile.teacherId:', profile?.teacherId, 'profileId usado:', profileId, 'names:', names)

  return {
    uid: user?.uid || '',
    email,
    profileId,
    names,
  }
}

function getHistoricalTeacherLinks(record) {
  return Array.isArray(record?.historicalTeacherLinks)
    ? record.historicalTeacherLinks.filter(Boolean)
    : []
}

export function belongsToTeacherRecordByPrimaryFields(record, user, profile) {
  if (!record) {
    console.log('[ATTENDANCE_ACCESS][PRIMARY] Registro vazio, retorna false')
    return false
  }

  const identity = getUserIdentityTokens(user, profile)
  if (!identity.uid && !identity.email && identity.names.length === 0) {
    console.log('[ATTENDANCE_ACCESS][PRIMARY] Usuário/profile sem identidade, retorna false')
    return false
  }

  const ownerUid = record.ownerUid || ''
  const teacherAuthUid = record.teacherAuthUid || ''
  const teacherUid = record.teacherUid || ''
  const teacherUserUid = record.teacherUserUid || ''
  const ownerTeacherId = record.teacherId || record.defaultTeacherId || ''
  const ownerEmail = normalizeEmail(record.teacherEmail || record.defaultTeacherEmail || '')
  const ownerName = normalizeText(record.teacherName || record.defaultTeacherName || '')

  const matchedByOwnerUid = ownerUid && identity.uid && ownerUid === identity.uid
  const matchedByTeacherAuthUid = teacherAuthUid && identity.uid && teacherAuthUid === identity.uid
  const matchedByTeacherUid = teacherUid && identity.uid && teacherUid === identity.uid
  const matchedByTeacherUserUid = teacherUserUid && identity.uid && teacherUserUid === identity.uid
  const matchedByTeacherId = ownerTeacherId && identity.profileId && ownerTeacherId === identity.profileId
  const matchedByTeacherEmail = ownerEmail && identity.email && ownerEmail === identity.email
  const matchedByTeacherName = ownerName && identity.names.includes(ownerName)

  const resultadoFinal = matchedByOwnerUid || matchedByTeacherAuthUid || matchedByTeacherUid || matchedByTeacherUserUid || matchedByTeacherId || matchedByTeacherEmail || matchedByTeacherName

  // Log final resumido
  console.log('[ATTENDANCE_ACCESS][RESUMO]', {
    registerId: record?.id,
    matchedByOwnerUid,
    matchedByTeacherAuthUid,
    matchedByTeacherUid,
    matchedByTeacherUserUid,
    matchedByTeacherId,
    matchedByTeacherEmail,
    matchedByTeacherName,
    resultadoFinal,
    ownerUid,
    teacherAuthUid,
    teacherUid,
    teacherUserUid,
    ownerTeacherId,
    ownerEmail,
    ownerName,
    identity,
  })

  return resultadoFinal
}

export function belongsToTeacherRecord(record, user, profile) {
  if (belongsToTeacherRecordByPrimaryFields(record, user, profile)) {
    console.log('[ATTENDANCE_ACCESS][belongsToTeacherRecord] PRIMARY bateu, retorna true')
    return true
  }

  const identity = getUserIdentityTokens(user, profile)
  if (!identity.uid && !identity.email && identity.names.length === 0) {
    console.log('[ATTENDANCE_ACCESS][belongsToTeacherRecord] Usuário/profile sem identidade, retorna false')
    return false
  }

  const links = getHistoricalTeacherLinks(record)
  for (const link of links) {
    const linkUid = link?.uid || link?.teacherUid || link?.teacherAuthUid || ''
    console.log('[ATTENDANCE_ACCESS][HISTORICAL] compare linkUid:', linkUid, 'usuario.uid:', identity.uid, '=>', linkUid === identity.uid)
    if (linkUid && identity.uid && linkUid === identity.uid) return true

    const linkProfileId = link?.profileId || link?.teacherId || ''
    console.log('[ATTENDANCE_ACCESS][HISTORICAL] compare linkProfileId:', linkProfileId, 'profileId:', identity.profileId, '=>', linkProfileId === identity.profileId)
    if (linkProfileId && identity.profileId && linkProfileId === identity.profileId) return true

    const linkEmail = normalizeEmail(link?.email || link?.teacherEmail || '')
    console.log('[ATTENDANCE_ACCESS][HISTORICAL] compare linkEmail:', linkEmail, 'usuario.email:', identity.email, '=>', linkEmail === identity.email)
    if (linkEmail && identity.email && linkEmail === identity.email) return true

    const linkNames = [link?.name, link?.teacherName]
      .map(normalizeText)
      .filter(Boolean)
    console.log('[ATTENDANCE_ACCESS][HISTORICAL] compare linkNames:', linkNames, 'usuario.names:', identity.names, '=>', linkNames.some((name) => identity.names.includes(name)))
    if (linkNames.some((name) => identity.names.includes(name))) return true
  }
  return false
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
  if (isAdmin(user)) {
    console.log('[ATTENDANCE_ACCESS][canAccessAttendanceRegister] Usuário é admin, retorna true')
    return true
  }
  const result = belongsToTeacherRecord(record, user, profile)
  console.log('[ATTENDANCE_ACCESS][canAccessAttendanceRegister] belongsToTeacherRecord:', result)
  return result
}
