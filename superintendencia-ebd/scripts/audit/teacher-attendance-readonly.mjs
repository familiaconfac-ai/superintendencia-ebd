import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PROJECT_ID = 'app-ebd-85cd0'
const CHURCH_EMAIL = 'igrejabatistaolimpia@gmail.com'
const TARGETS = [
  {
    key: 'vitor',
    names: ['vitor cabrelli', 'vitor cavrelli'],
    knownAuthUids: ['ldQolOxSloPRj5NvJN82TQtobkn1'],
  },
  { key: 'fabiana', names: ['fabiana'] },
]

function normalize(value = '') {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function compact(value) {
  if (value == null) return null
  if (typeof value?.toDate === 'function') return value.toDate().toISOString()
  if (Array.isArray(value)) return value.map(compact)
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, compact(item)]))
  }
  return value
}

function decodeFirestoreValue(value = {}) {
  if ('nullValue' in value) return null
  if ('stringValue' in value) return value.stringValue
  if ('booleanValue' in value) return value.booleanValue
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return Number(value.doubleValue)
  if ('timestampValue' in value) return value.timestampValue
  if ('referenceValue' in value) return value.referenceValue
  if ('geoPointValue' in value) return value.geoPointValue
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeFirestoreValue)
  if ('mapValue' in value) return decodeFirestoreFields(value.mapValue.fields || {})
  return null
}

function decodeFirestoreFields(fields = {}) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, decodeFirestoreValue(value)]),
  )
}

function restDocumentMeta(document) {
  const marker = '/documents/'
  const path = document.name.includes(marker) ? document.name.split(marker)[1] : document.name
  const segments = path.split('/')
  return {
    path,
    id: segments.at(-1) || '',
    ownerUid: segments.length >= 2 ? segments.at(-3) || '' : '',
    data: decodeFirestoreFields(document.fields || {}),
  }
}

async function authorizedJson(accessToken, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(`${response.status} ${body?.error?.status || ''}: ${body?.error?.message || 'Falha na API Google.'}`.trim())
  }
  return body
}

async function runFirestoreQuery(accessToken, collectionId, allDescendants = true) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`
  const body = await authorizedJson(accessToken, url, {
    method: 'POST',
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId, allDescendants }],
      },
    }),
  })
  return body.map((entry) => entry.document).filter(Boolean).map(restDocumentMeta)
}

async function listAuthUsers(accessToken) {
  const users = []
  let offset = 0
  while (true) {
    const body = await authorizedJson(
      accessToken,
      `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:query`,
      {
        method: 'POST',
        body: JSON.stringify({ returnUserInfo: true, limit: '500', offset: String(offset) }),
      },
    )
    const page = body.userInfo || []
    users.push(...page)
    if (page.length < 500) return users
    offset += page.length
  }
}

function encodeFirestoreValue(value) {
  if (typeof value === 'boolean') return { booleanValue: value }
  return { stringValue: String(value ?? '') }
}

async function patchFirestoreDocument(accessToken, path, fields) {
  const masks = Object.keys(fields)
    .map((field) => `updateMask.fieldPaths=${encodeURIComponent(field)}`)
    .join('&')
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}?${masks}`
  return authorizedJson(accessToken, url, {
    method: 'PATCH',
    body: JSON.stringify({
      fields: Object.fromEntries(
        Object.entries(fields).map(([key, value]) => [key, encodeFirestoreValue(value)]),
      ),
    }),
  })
}

function matchesTarget(target, values = []) {
  const haystack = values.map(normalize).filter(Boolean)
  return target.names.some((name) => haystack.some((value) => value.includes(name)))
}

function documentMeta(item) {
  return {
    path: item.ref.path,
    id: item.id,
    ownerUid: item.ref.parent?.parent?.id || '',
    data: item.data(),
  }
}

function summarizeUserDoc(item) {
  const data = item.data
  return {
    path: item.path,
    documentId: item.id,
    uid: data.uid || '',
    email: normalize(data.email),
    role: data.role || '',
    active: data.active !== false,
    displayName: data.displayName || data.fullName || data.name || '',
    linkedTeacherId: data.linkedTeacherId || data.teacherId || '',
  }
}

function summarizeTeacherDoc(item) {
  const data = item.data
  return {
    path: item.path,
    ownerUid: item.ownerUid,
    teacherId: item.id,
    uid: data.uid || '',
    authUid: data.authUid || '',
    email: normalize(data.email),
    name: data.fullName || data.displayName || data.name || '',
    active: data.active !== false,
    classId: data.classId || data.linkedClassId || '',
  }
}

function summarizeRegister(item) {
  const data = item.data
  const attendanceByStudent = data.attendanceByStudent || {}
  const studentIds = new Set([
    ...(Array.isArray(data.enrolledStudentIds) ? data.enrolledStudentIds : []),
    ...(Array.isArray(data.studentIds) ? data.studentIds : []),
    ...(Array.isArray(data.students) ? data.students.map((student) => student?.id).filter(Boolean) : []),
    ...(Array.isArray(data.studentsSnapshot) ? data.studentsSnapshot.map((student) => student?.id).filter(Boolean) : []),
    ...Object.keys(attendanceByStudent),
  ])
  const markedAttendanceCount = Object.values(attendanceByStudent).reduce((total, marks) => (
    total + Object.values(marks || {}).filter(Boolean).length
  ), 0)

  return {
    path: item.path,
    storageOwnerUid: item.ownerUid,
    registerId: item.id,
    ownerUid: data.ownerUid || '',
    createdByUid: data.createdByUid || '',
    teacherId: data.teacherId || '',
    teacherAuthUid: data.teacherAuthUid || '',
    teacherUid: data.teacherUid || '',
    teacherUserUid: data.teacherUserUid || '',
    teacherEmail: normalize(data.teacherEmail),
    teacherName: data.teacherName || '',
    classId: data.classId || '',
    className: data.className || '',
    studentCount: studentIds.size,
    markedAttendanceCount,
    hasStudentsSnapshot: Array.isArray(data.studentsSnapshot) && data.studentsSnapshot.length > 0,
    hasStudents: Array.isArray(data.students) && data.students.length > 0,
  }
}

function identitySets(authUsers, userDocs, teacherDocs) {
  return {
    uids: new Set([
      ...authUsers.map((item) => item.uid),
      ...userDocs.flatMap((item) => [item.documentId, item.uid]),
      ...teacherDocs.flatMap((item) => [item.uid, item.authUid]),
    ].filter(Boolean)),
    emails: new Set([
      ...authUsers.map((item) => normalize(item.email)),
      ...userDocs.map((item) => normalize(item.email)),
      ...teacherDocs.map((item) => normalize(item.email)),
    ].filter(Boolean)),
    teacherIds: new Set(teacherDocs.map((item) => item.teacherId).filter(Boolean)),
  }
}

function registerMatchesIdentity(register, identity) {
  return [register.ownerUid, register.teacherAuthUid, register.teacherUid, register.teacherUserUid]
    .some((value) => value && identity.uids.has(value))
    || Boolean(register.teacherId && identity.teacherIds.has(register.teacherId))
    || Boolean(register.teacherEmail && identity.emails.has(normalize(register.teacherEmail)))
}

function findIssues(target) {
  const issues = []
  const authUids = new Set(target.authUsers.map((item) => item.uid))
  const authEmails = new Set(target.authUsers.map((item) => normalize(item.email)).filter(Boolean))
  const teacherIds = new Set(target.teacherDocs.map((item) => item.teacherId))

  if (target.authUsers.length === 0) issues.push('Nenhum usuario correspondente no Firebase Authentication.')
  if (target.userDocs.length === 0) issues.push('Nenhum documento users/{authUid} correspondente.')
  if (target.teacherDocs.length === 0) issues.push('Nenhum cadastro ebd_teachers correspondente.')
  if (target.registers.length === 0) issues.push('Nenhuma caderneta vinculada por UID, teacherId ou email.')

  for (const teacher of target.teacherDocs) {
    const linkedUid = teacher.authUid || teacher.uid
    if (!linkedUid) issues.push(`${teacher.path}: professor sem uid/authUid.`)
    else if (!authUids.has(linkedUid)) issues.push(`${teacher.path}: uid/authUid nao corresponde ao usuario Auth localizado.`)
    if (teacher.email && authEmails.size > 0 && !authEmails.has(teacher.email)) {
      issues.push(`${teacher.path}: email diverge do Firebase Authentication.`)
    }
  }

  for (const register of target.registers) {
    const linkedUids = [register.teacherAuthUid, register.teacherUid, register.teacherUserUid].filter(Boolean)
    if (!linkedUids.some((uid) => authUids.has(uid))) {
      issues.push(`${register.path}: campos de UID da caderneta nao correspondem ao usuario Auth localizado.`)
    }
    if (!teacherIds.has(register.teacherId)) {
      issues.push(`${register.path}: teacherId nao corresponde ao cadastro do professor localizado.`)
    }
    if (register.teacherEmail && authEmails.size > 0 && !authEmails.has(register.teacherEmail)) {
      issues.push(`${register.path}: teacherEmail diverge do Firebase Authentication.`)
    }
    if (!register.classId) issues.push(`${register.path}: classId ausente.`)
    if (register.studentCount === 0) issues.push(`${register.path}: nenhum aluno/snapshot vinculado.`)
  }

  return [...new Set(issues)]
}

async function main() {
  if (!process.argv.includes('--confirm-real-read')) {
    throw new Error('Leitura real bloqueada. Execute com --confirm-real-read.')
  }

  const configPath = join(homedir(), '.config', 'configstore', 'firebase-tools.json')
  const firebaseCliConfig = JSON.parse(await readFile(configPath, 'utf8'))
  const activeEmail = normalize(firebaseCliConfig.user?.email)
  if (activeEmail !== CHURCH_EMAIL) {
    throw new Error(`Conta Firebase ativa incorreta: ${activeEmail || 'nao identificada'}`)
  }

  const accessToken = firebaseCliConfig.tokens?.access_token
  const expiresAt = Number(firebaseCliConfig.tokens?.expires_at || 0)
  if (!accessToken || expiresAt <= Date.now() + 60_000) {
    throw new Error('Token da conta da igreja ausente ou expirado. Execute firebase login:add novamente.')
  }

  const [authRecords, allUsers, allTeachers, allRegisters, allClasses, allEnrollments] = await Promise.all([
    listAuthUsers(accessToken),
    runFirestoreQuery(accessToken, 'users', false),
    runFirestoreQuery(accessToken, 'ebd_teachers'),
    runFirestoreQuery(accessToken, 'ebd_attendanceRegisters'),
    runFirestoreQuery(accessToken, 'ebd_classes'),
    runFirestoreQuery(accessToken, 'ebd_enrollments'),
  ])

  const allAuthUsers = authRecords.map((item) => ({
    uid: item.localId || '',
    email: normalize(item.email),
    displayName: item.displayName || '',
    disabled: item.disabled === true,
  }))

  if (process.argv.includes('--auth-directory')) {
    process.stdout.write(`${JSON.stringify(allAuthUsers, null, 2)}\n`)
    return
  }

  const targets = TARGETS.map((target) => {
    const initialUserDocs = allUsers
      .filter((item) => matchesTarget(target, [item.data.displayName, item.data.fullName, item.data.name, item.data.email]))
      .map(summarizeUserDoc)
    const teacherDocs = allTeachers
      .filter((item) => matchesTarget(target, [item.data.fullName, item.data.displayName, item.data.name, item.data.email]))
      .map(summarizeTeacherDoc)
    const discoveredEmails = new Set([
      ...initialUserDocs.map((item) => item.email),
      ...teacherDocs.map((item) => item.email),
    ].map(normalize).filter(Boolean))
    const authUsers = allAuthUsers.filter((item) => (
      matchesTarget(target, [item.displayName, item.email])
      || discoveredEmails.has(normalize(item.email))
      || (target.knownAuthUids || []).includes(item.uid)
    ))
    const authUids = new Set(authUsers.map((item) => item.uid).filter(Boolean))
    const authEmails = new Set(authUsers.map((item) => normalize(item.email)).filter(Boolean))
    const userDocs = allUsers
      .map(summarizeUserDoc)
      .filter((item) => (
        matchesTarget(target, [item.displayName, item.email])
        || authUids.has(item.documentId)
        || authUids.has(item.uid)
        || authEmails.has(item.email)
      ))
    const identity = identitySets(authUsers, userDocs, teacherDocs)
    const registers = allRegisters
      .map(summarizeRegister)
      .filter((item) => registerMatchesIdentity(item, identity))
    const classIds = new Set(registers.map((item) => item.classId).filter(Boolean))
    const classes = allClasses
      .filter((item) => classIds.has(item.id))
      .map((item) => ({ path: item.path, id: item.id, name: item.data.name || '' }))
    const enrollments = allEnrollments
      .filter((item) => classIds.has(item.data.classId))
      .map((item) => ({
        path: item.path,
        id: item.id,
        classId: item.data.classId || '',
        personId: item.data.personId || '',
        status: item.data.status || '',
        enrolledInEBD: item.data.enrolledInEBD !== false,
      }))

    const result = {
      key: target.key,
      authUsers,
      userDocs,
      teacherDocs,
      registers,
      classes,
      enrollmentCount: enrollments.length,
      activeEnrollmentCount: enrollments.filter((item) => item.status === 'active' && item.enrolledInEBD).length,
    }
    result.issues = findIssues(result)
    return result
  })

  const targetUids = new Set(targets.flatMap((target) => target.authUsers.map((item) => item.uid)))
  const workingComparison = allRegisters
    .map(summarizeRegister)
    .find((register) => (
      register.teacherAuthUid
      && !targetUids.has(register.teacherAuthUid)
      && allAuthUsers.some((user) => user.uid === register.teacherAuthUid)
      && register.teacherId
      && register.teacherEmail
      && register.classId
      && register.studentCount > 0
    )) || null

  if (process.argv.includes('--apply-vitor-link')) {
    const vitor = targets.find((target) => target.key === 'vitor')
    if (!vitor || vitor.authUsers.length !== 1 || vitor.teacherDocs.length !== 1 || vitor.registers.length === 0) {
      throw new Error('Correcao de Vitor bloqueada: correlacao real nao e univoca.')
    }

    const authUser = vitor.authUsers[0]
    const teacher = vitor.teacherDocs[0]
    if (authUser.uid !== 'ldQolOxSloPRj5NvJN82TQtobkn1' || authUser.email !== 'vcabrelli95@gmail.com') {
      throw new Error('Correcao de Vitor bloqueada: UID/email Auth inesperados.')
    }
    if (teacher.email !== 'vcavrelli95@gmail.com' || teacher.uid || teacher.authUid) {
      throw new Error('Correcao de Vitor bloqueada: cadastro atual diverge do estado auditado.')
    }
    if (vitor.registers.some((register) => (
      register.teacherId !== teacher.teacherId
      || register.teacherEmail !== 'vcavrelli95@gmail.com'
      || register.teacherAuthUid
      || register.teacherUid
      || register.teacherUserUid
    ))) {
      throw new Error('Correcao de Vitor bloqueada: uma caderneta diverge do estado auditado.')
    }

    const backup = {
      projectId: PROJECT_ID,
      account: activeEmail,
      createdAt: new Date().toISOString(),
      authUser,
      userDocsBefore: vitor.userDocs,
      teacherBefore: teacher,
      registersBefore: vitor.registers,
      attendanceFieldsIncluded: false,
    }
    const outputDir = join(process.cwd(), 'tmp')
    await mkdir(outputDir, { recursive: true })
    const backupPath = join(outputDir, 'vitor-link-fix-before.json')
    await writeFile(backupPath, `${JSON.stringify(backup, null, 2)}\n`, 'utf8')

    await patchFirestoreDocument(accessToken, `users/${authUser.uid}`, {
      uid: authUser.uid,
      email: authUser.email,
      displayName: authUser.displayName || teacher.name,
      role: 'teacher',
      active: true,
      linkedTeacherId: teacher.teacherId,
    })
    await patchFirestoreDocument(accessToken, teacher.path, {
      uid: authUser.uid,
      authUid: authUser.uid,
      email: authUser.email,
    })
    for (const register of vitor.registers) {
      await patchFirestoreDocument(accessToken, register.path, {
        teacherAuthUid: authUser.uid,
        teacherUid: authUser.uid,
        teacherUserUid: authUser.uid,
        teacherEmail: authUser.email,
      })
    }

    process.stdout.write(`${JSON.stringify({
      status: 'applied',
      projectId: PROJECT_ID,
      account: activeEmail,
      backupPath,
      userPath: `users/${authUser.uid}`,
      teacherPath: teacher.path,
      registerPaths: vitor.registers.map((register) => register.path),
      preserved: ['attendanceByStudent', 'students', 'studentsSnapshot', 'classId', 'dates', 'auditTrail'],
    }, null, 2)}\n`)
    return
  }

  const report = compact({
    metadata: {
      projectId: PROJECT_ID,
      account: activeEmail,
      generatedAt: new Date().toISOString(),
      mode: 'read-only',
      authUserCount: allAuthUsers.length,
      userDocumentCount: allUsers.length,
      teacherDocumentCount: allTeachers.length,
      attendanceRegisterCount: allRegisters.length,
    },
    targets,
    workingComparison,
  })

  const outputDir = join(process.cwd(), 'tmp')
  const outputPath = join(outputDir, 'attendance-real-audit.json')
  await mkdir(outputDir, { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  process.stderr.write(`Relatorio salvo em ${outputPath}\n`)
}

main().catch((error) => {
  process.stderr.write(`AUDIT_ERROR: ${error.message}\n`)
  process.exitCode = 1
})
