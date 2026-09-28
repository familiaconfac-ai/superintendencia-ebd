import { createHash, randomBytes } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PROJECT_ID = 'app-ebd-85cd0'
const WEB_APP_ID = '1:497133135469:web:4fe586a9c67d7be15d0164'
const CHURCH_EMAIL = 'igrejabatistaolimpia@gmail.com'
const EMAIL = 'fabianamartines509@gmail.com'
const TEACHER_ID = 'rAD1oxYNWy41ZLo8Am2F'
const OWNER_UID = 'lPElyxdVK7dNAHUzvSK6w80qGls2'
const TEACHER_PATH = `users/${OWNER_UID}/ebd_teachers/${TEACHER_ID}`
const REGISTER_IDS = ['FuZXsjShnbkWSr8UYEre', 'cxtPQEIuvlWnRaGnpWPl']
const REGISTER_PATHS = REGISTER_IDS.map((id) => `users/${OWNER_UID}/ebd_attendanceRegisters/${id}`)
const OTHER_TEACHER_REGISTER_PATH = `users/${OWNER_UID}/ebd_attendanceRegisters/1pMhCJ9wPhmLNtVp6Vu0`
const BACKUP_PATH = join(process.cwd(), 'tmp', 'fabiana-access-backup-before.json')

function normalize(value = '') {
  return String(value || '').trim().toLowerCase()
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
  }
  return value
}

function checksum(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')
}

function decodeValue(value = {}) {
  if ('nullValue' in value) return null
  if ('stringValue' in value) return value.stringValue
  if ('booleanValue' in value) return value.booleanValue
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return value.doubleValue
  if ('timestampValue' in value) return value.timestampValue
  if ('referenceValue' in value) return value.referenceValue
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeValue)
  if ('mapValue' in value) return decodeFields(value.mapValue.fields || {})
  return null
}

function decodeFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]))
}

function encodeValue(value) {
  if (typeof value === 'boolean') return { booleanValue: value }
  return { stringValue: String(value ?? '') }
}

function countMarkedAttendance(value) {
  if (!value || typeof value !== 'object') return 0
  return Object.values(value).reduce((total, item) => {
    if (item && typeof item === 'object') return total + countMarkedAttendance(item)
    return total + (String(item || '').trim() ? 1 : 0)
  }, 0)
}

function summarizeRegister(document) {
  const data = decodeFields(document.fields || {})
  const students = Array.isArray(data.studentsSnapshot)
    ? data.studentsSnapshot
    : (Array.isArray(data.students) ? data.students : [])
  return {
    id: document.name.split('/').at(-1),
    teacherId: data.teacherId || '',
    teacherAuthUid: data.teacherAuthUid || '',
    teacherUid: data.teacherUid || '',
    teacherUserUid: data.teacherUserUid || '',
    teacherEmail: normalize(data.teacherEmail),
    classId: data.classId || '',
    className: data.className || '',
    studentCount: students.length,
    markedAttendanceCount: countMarkedAttendance(data.attendanceByStudent),
    auditTrailCount: Array.isArray(data.auditTrail) ? data.auditTrail.length : 0,
  }
}

function authSummary(user) {
  return {
    email: normalize(user.email),
    uid: user.localId || '',
    providerData: (user.providerUserInfo || []).map((provider) => ({
      providerId: provider.providerId || '',
      email: normalize(provider.email),
    })),
    createdAt: user.createdAt || '',
    lastLoginAt: user.lastLoginAt || '',
    disabled: user.disabled === true,
    emailVerified: user.emailVerified === true,
  }
}

async function requestJson(url, options = {}, expectedStatuses = [200]) {
  const response = await fetch(url, options)
  const body = await response.json().catch(() => ({}))
  if (!expectedStatuses.includes(response.status)) {
    throw new Error(`${response.status} ${body?.error?.status || ''}: ${body?.error?.message || 'Falha na API Google.'}`.trim())
  }
  return { status: response.status, body }
}

async function loadContext() {
  const cliPath = join(homedir(), '.config', 'configstore', 'firebase-tools.json')
  const cli = JSON.parse(await readFile(cliPath, 'utf8'))
  if (normalize(cli.user?.email) !== CHURCH_EMAIL) throw new Error('Conta Firebase CLI ativa incorreta.')
  if (!cli.tokens?.access_token || Number(cli.tokens?.expires_at || 0) <= Date.now() + 60_000) {
    throw new Error('Token Firebase CLI ausente ou expirado.')
  }

  const { body: webConfig } = await requestJson(
    `https://firebase.googleapis.com/v1beta1/projects/${PROJECT_ID}/webApps/${encodeURIComponent(WEB_APP_ID)}/config`,
    { headers: { Authorization: `Bearer ${cli.tokens.access_token}` } },
  )
  if (!webConfig.apiKey) throw new Error('API key do app web nao encontrada.')
  if (webConfig.projectId !== PROJECT_ID) throw new Error('Config do app web pertence a outro projeto.')

  return {
    accessToken: cli.tokens.access_token,
    apiKey: webConfig.apiKey,
    oauthHeaders: {
      Authorization: `Bearer ${cli.tokens.access_token}`,
      'Content-Type': 'application/json',
    },
  }
}

async function listAuthUsers(context) {
  const { body } = await requestJson(
    `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:query`,
    {
      method: 'POST',
      headers: context.oauthHeaders,
      body: JSON.stringify({ returnUserInfo: true, limit: '500', offset: '0' }),
    },
  )
  return body.userInfo || []
}

function findFabianaCandidates(users) {
  return users.filter((user) => {
    const haystack = `${user.email || ''} ${user.displayName || ''}`.toLowerCase()
    return normalize(user.email) === EMAIL
      || haystack.includes('fabiana')
      || haystack.includes('martines')
      || haystack.includes('509')
  })
}

async function getFirestoreDocument(context, path, allowMissing = false, idToken = '') {
  const { status, body } = await requestJson(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`,
    { headers: { Authorization: `Bearer ${idToken || context.accessToken}` } },
    allowMissing ? [200, 404] : [200],
  )
  return status === 404 ? null : body
}

async function patchFirestoreDocument(context, path, fields) {
  const masks = Object.keys(fields).map((field) => `updateMask.fieldPaths=${encodeURIComponent(field)}`).join('&')
  const { body } = await requestJson(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}?${masks}`,
    {
      method: 'PATCH',
      headers: context.oauthHeaders,
      body: JSON.stringify({
        fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, encodeValue(value)])),
      }),
    },
  )
  return body
}

async function getAuthConfig(context) {
  const { body } = await requestJson(
    `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT_ID}/config`,
    { headers: { Authorization: `Bearer ${context.accessToken}` } },
  )
  const template = body.notification?.sendEmail?.resetPasswordTemplate
  return {
    emailPasswordEnabled: body.signIn?.email?.enabled === true,
    sendEmailMethod: body.notification?.sendEmail?.method || '',
    resetTemplatePresent: Boolean(template?.subject && template?.body),
    resetTemplateBodyFormat: template?.bodyFormat || '',
    callbackUriPresent: Boolean(body.notification?.sendEmail?.callbackUri),
  }
}

function stripAllowedFields(document, allowedFields) {
  const fields = { ...(document.fields || {}) }
  for (const field of allowedFields) delete fields[field]
  return fields
}

async function createBackup() {
  const context = await loadContext()
  const users = await listAuthUsers(context)
  const candidates = findFabianaCandidates(users)
  if (candidates.length > 0) {
    throw new Error(`Backup bloqueado: ${candidates.length} conta(s) possivelmente correspondente(s) encontrada(s).`)
  }

  const [teacher, ...registers] = await Promise.all([
    getFirestoreDocument(context, TEACHER_PATH),
    ...REGISTER_PATHS.map((path) => getFirestoreDocument(context, path)),
  ])
  const teacherData = decodeFields(teacher.fields || {})
  const summaries = registers.map(summarizeRegister)
  if (normalize(teacherData.email) !== EMAIL || teacherData.uid || teacherData.authUid) {
    throw new Error('Backup bloqueado: cadastro da professora diverge do estado esperado.')
  }
  if (summaries.some((register) => (
    register.teacherId !== TEACHER_ID
    || register.teacherAuthUid
    || register.teacherUid
    || register.teacherUserUid
    || register.teacherEmail !== EMAIL
  ))) {
    throw new Error('Backup bloqueado: uma caderneta diverge do estado esperado.')
  }

  const backup = {
    metadata: {
      projectId: PROJECT_ID,
      account: CHURCH_EMAIL,
      createdAt: new Date().toISOString(),
      mode: 'full-raw-firestore-backup',
      authCandidates: [],
    },
    paths: { teacher: TEACHER_PATH, registers: REGISTER_PATHS },
    rawDocuments: { teacher, registers },
    checksums: {
      teacher: checksum(teacher),
      registers: Object.fromEntries(registers.map((document) => [document.name.split('/').at(-1), checksum(document)])),
    },
    summaries: { teacher: teacherData, registers: summaries },
  }
  await mkdir(join(process.cwd(), 'tmp'), { recursive: true })
  await writeFile(BACKUP_PATH, `${JSON.stringify(backup, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  process.stdout.write(`${JSON.stringify({
    status: 'backup-created',
    backupPath: BACKUP_PATH,
    teacherPath: TEACHER_PATH,
    registerPaths: REGISTER_PATHS,
    summaries,
    checksums: backup.checksums,
  }, null, 2)}\n`)
}

async function signInWithTemporaryPassword(context, password) {
  const { body } = await requestJson(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(context.apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password, returnSecureToken: true }),
    },
  )
  return { idToken: body.idToken, uid: body.localId }
}

async function queryOwnRegisters(context, idToken, uid) {
  const { body } = await requestJson(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'ebd_attendanceRegisters', allDescendants: true }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'teacherAuthUid' },
              op: 'EQUAL',
              value: { stringValue: uid },
            },
          },
        },
      }),
    },
  )
  return body.map((entry) => entry.document).filter(Boolean)
}

async function applyRepair() {
  const context = await loadContext()
  const backup = JSON.parse(await readFile(BACKUP_PATH, 'utf8'))
  if (backup.metadata?.projectId !== PROJECT_ID || backup.metadata?.account !== CHURCH_EMAIL) {
    throw new Error('Correcao bloqueada: backup pertence a outro projeto ou conta.')
  }

  const usersBefore = await listAuthUsers(context)
  const candidatesBefore = findFabianaCandidates(usersBefore)
  if (candidatesBefore.length > 0) {
    throw new Error(`Correcao bloqueada: ${candidatesBefore.length} conta(s) possivelmente correspondente(s) encontrada(s).`)
  }
  const authConfig = await getAuthConfig(context)
  if (!authConfig.emailPasswordEnabled || !authConfig.resetTemplatePresent || !authConfig.callbackUriPresent) {
    throw new Error('Correcao bloqueada: login por email ou template de redefinicao incompleto.')
  }

  const [teacherBefore, ...registersBefore] = await Promise.all([
    getFirestoreDocument(context, TEACHER_PATH),
    ...REGISTER_PATHS.map((path) => getFirestoreDocument(context, path)),
  ])
  if (checksum(teacherBefore) !== backup.checksums.teacher) throw new Error('Correcao bloqueada: professora mudou apos o backup.')
  for (const register of registersBefore) {
    const id = register.name.split('/').at(-1)
    if (checksum(register) !== backup.checksums.registers[id]) {
      throw new Error(`Correcao bloqueada: caderneta ${id} mudou apos o backup.`)
    }
  }

  const temporaryPassword = `Aa9!${randomBytes(32).toString('base64url')}`
  const { body: created } = await requestJson(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(context.apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: EMAIL,
        password: temporaryPassword,
        displayName: decodeFields(teacherBefore.fields || {}).name || 'Fabiana Martinez',
        returnSecureToken: true,
      }),
    },
  )
  const uid = created.localId
  if (!uid) throw new Error('Conta criada sem UID retornado.')

  await patchFirestoreDocument(context, `users/${uid}`, {
    uid,
    email: EMAIL,
    displayName: decodeFields(teacherBefore.fields || {}).name || 'Fabiana Martinez',
    role: 'teacher',
    active: true,
    linkedTeacherId: TEACHER_ID,
  })
  await patchFirestoreDocument(context, TEACHER_PATH, { uid, authUid: uid, email: EMAIL })
  for (const path of REGISTER_PATHS) {
    await patchFirestoreDocument(context, path, {
      teacherAuthUid: uid,
      teacherUid: uid,
      teacherUserUid: uid,
      teacherEmail: EMAIL,
    })
  }

  const session = await signInWithTemporaryPassword(context, temporaryPassword)
  if (session.uid !== uid) throw new Error('Login de auditoria retornou UID inesperado.')
  const ownDocuments = await queryOwnRegisters(context, session.idToken, uid)
  const ownSummaries = ownDocuments.map(summarizeRegister)
  const ownIds = ownSummaries.map((item) => item.id).sort()
  if (JSON.stringify(ownIds) !== JSON.stringify([...REGISTER_IDS].sort())) {
    throw new Error(`Auditoria bloqueada: cadernetas acessiveis inesperadas (${ownIds.join(', ')}).`)
  }
  const otherAccess = await requestJson(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${OTHER_TEACHER_REGISTER_PATH}`,
    { headers: { Authorization: `Bearer ${session.idToken}` } },
    [403],
  )

  const [teacherAfter, ...registersAfter] = await Promise.all([
    getFirestoreDocument(context, TEACHER_PATH),
    ...REGISTER_PATHS.map((path) => getFirestoreDocument(context, path)),
  ])
  const teacherPreserved = checksum(stripAllowedFields(teacherAfter, ['uid', 'authUid', 'email']))
    === checksum(stripAllowedFields(teacherBefore, ['uid', 'authUid', 'email']))
  const registersPreserved = registersAfter.every((document, index) => (
    checksum(stripAllowedFields(document, ['teacherAuthUid', 'teacherUid', 'teacherUserUid', 'teacherEmail']))
      === checksum(stripAllowedFields(registersBefore[index], ['teacherAuthUid', 'teacherUid', 'teacherUserUid', 'teacherEmail']))
  ))
  if (!teacherPreserved || !registersPreserved) throw new Error('Auditoria bloqueada: campos fora do vinculo foram alterados.')

  const { body: resetResponse } = await requestJson(
    `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(context.apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestType: 'PASSWORD_RESET', email: EMAIL }),
    },
  )

  const exactUsersAfter = (await listAuthUsers(context)).filter((user) => normalize(user.email) === EMAIL)
  if (exactUsersAfter.length !== 1 || exactUsersAfter[0].localId !== uid) {
    throw new Error('Auditoria bloqueada: conta final nao e univoca.')
  }

  process.stdout.write(`${JSON.stringify({
    status: 'applied-and-audited',
    projectId: PROJECT_ID,
    account: CHURCH_EMAIL,
    authUser: authSummary(exactUsersAfter[0]),
    backupPath: BACKUP_PATH,
    changedDocuments: [
      { path: `users/${uid}`, fields: ['uid', 'email', 'displayName', 'role', 'active', 'linkedTeacherId'] },
      { path: TEACHER_PATH, fields: ['uid', 'authUid', 'email'] },
      ...REGISTER_PATHS.map((path) => ({ path, fields: ['teacherAuthUid', 'teacherUid', 'teacherUserUid', 'teacherEmail'] })),
    ],
    passwordReset: {
      accepted: normalize(resetResponse.email) === EMAIL,
      email: normalize(resetResponse.email),
      template: authConfig,
    },
    audit: {
      signedInWithCreatedIdentity: true,
      ownRegisterIds: ownIds,
      ownRegisterSummaries: ownSummaries,
      otherTeacherRegisterDenied: otherAccess.status === 403,
      teacherFieldsOutsideLinkPreserved: teacherPreserved,
      registerFieldsOutsideLinkPreserved: registersPreserved,
    },
  }, null, 2)}\n`)
}

if (process.argv.includes('--backup')) await createBackup()
else if (process.argv.includes('--apply')) await applyRepair()
else throw new Error('Use --backup ou --apply.')
