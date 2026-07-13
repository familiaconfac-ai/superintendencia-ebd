import {
  asArray,
  asDate,
  asIso,
  groupBy,
  legacyRef,
  makeAudit,
  makeLegacy,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  parseLegacyDocument,
  safeId,
  sanitizeForJson,
  stableHash,
  targetId,
  unique,
} from './utils.mjs'
import { reconcilePeople } from './reconciliation.mjs'

const DEFAULT_CHURCH = Object.freeze({
  id: 'igreja-principal',
  name: 'Igreja principal',
  timezone: 'America/Sao_Paulo',
  locale: 'pt-BR',
})

function addMinutes(time, minutes) {
  const [hours = 0, mins = 0] = String(time || '18:30').split(':').map(Number)
  const total = ((hours * 60) + mins + minutes + 1440) % 1440
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function markToStatus(mark) {
  if (mark === 'PP') return 'punctual'
  if (mark === 'P') return 'present'
  if (mark === 'A') return 'absent'
  return 'unmarked'
}

function listStudentIds(record) {
  const data = record?.data || record || {}
  return unique([
    ...asArray(data.enrolledStudentIds),
    ...asArray(data.studentIds),
    ...asArray(data.studentsSnapshot).map((item) => item?.id || item?.personId || item?.studentId),
    ...asArray(data.students).map((item) => typeof item === 'string' ? item : item?.id || item?.personId || item?.studentId),
    ...Object.keys(data.attendanceByStudent || {}),
  ])
}

function getStudentSnapshot(record, legacyId) {
  const entries = [...asArray(record.data.studentsSnapshot), ...asArray(record.data.students)]
  return entries.find((item) => (item?.id || item?.personId || item?.studentId) === legacyId) || null
}

function getTeacherIdentity(data = {}) {
  return {
    legacyId: data.teacherId || data.defaultTeacherId || data.teacherProfileId || '',
    authUid: data.teacherAuthUid || data.teacherUid || data.teacherUserUid || '',
    email: data.teacherEmail || data.defaultTeacherEmail || '',
    name: data.teacherName || data.defaultTeacherName || '',
  }
}

function mapEnrollmentStatus(data = {}) {
  if (data.status === 'inactive' || data.enrolledInEBD === false) return 'inactive'
  if (['pending', 'active', 'completed', 'cancelled', 'transferred'].includes(data.status)) return data.status
  return 'active'
}

function mapTermStatus(data = {}, runDate) {
  if (data.active === false) return 'archived'
  const endDate = asDate(data.endDate)
  if (endDate && endDate < runDate) return 'completed'
  const startDate = asDate(data.startDate)
  if (startDate && startDate > runDate) return 'planned'
  return 'active'
}

function toHistory(data, status, runAt, actor) {
  const raw = [...asArray(data.statusHistory), ...asArray(data.activationHistory)]
  const mapped = raw.map((entry) => ({
    status: entry.status || (entry.type === 'inactivate' ? 'inactive' : entry.type === 'activate' ? 'active' : status),
    changedAt: asIso(entry.changedAt || entry.date, runAt),
    changedBy: actor,
    ...(entry.reason ? { reason: String(entry.reason) } : {}),
  }))
  if (!mapped.length || mapped.at(-1).status !== status) {
    mapped.push({ status, changedAt: asIso(data.updatedAt || data.createdAt, runAt), changedBy: actor })
  }
  return mapped.sort((left, right) => left.changedAt.localeCompare(right.changedAt))
}

function duplicateGroups(records, signature) {
  return Object.entries(groupBy(records, signature))
    .filter(([key, items]) => key && items.length > 1)
    .map(([key, items]) => ({ signature: key, paths: items.map((item) => item.path) }))
}

export function runDryRun(rawSnapshot = {}, options = {}) {
  const snapshot = sanitizeForJson(rawSnapshot || {})
  const runAt = options.runAt || new Date().toISOString()
  const runId = options.runId || `dry-${runAt.replace(/\D/g, '').slice(0, 14)}-${stableHash(snapshot, 8)}`
  const church = {
    ...DEFAULT_CHURCH,
    ...(options.church || {}),
    id: options.churchId || options.church?.id || DEFAULT_CHURCH.id,
  }
  const context = { runAt, runId, runDate: runAt.slice(0, 10), churchId: church.id }
  const parsed = asArray(snapshot.firestoreDocuments).map(parseLegacyDocument)
  const byKind = groupBy(parsed, (item) => item.kind)
  const authUsers = asArray(snapshot.authUsers)
  const authUsersIncluded = snapshot.authUsersIncluded === true || Array.isArray(snapshot.authUsers)

  const report = {
    metadata: {
      mode: 'dry-run',
      runId,
      generatedAt: runAt,
      churchId: church.id,
      source: snapshot.metadata?.source || 'snapshot-json',
      firestoreProjectId: snapshot.metadata?.projectId || null,
      authUsersIncluded,
      writesPerformed: 0,
      authChangesPerformed: 0,
      deletesPerformed: 0,
    },
    sourceSummary: { totalsByCollection: {}, totalsByOwner: {} },
    counts: { legacy: {}, projected: {} },
    matches: { safe: [], probable: [], ambiguous: [] },
    mappings: [],
    documentsToCreate: [],
    manualReview: [],
    duplicates: { peopleNames: [], emails: [], enrollments: [], registers: [], sessions: [] },
    orphans: {
      authAccounts: [],
      firestoreUsersWithoutAuth: [],
      peopleWithoutEnrollment: [],
      teachersWithoutAssignment: [],
      classesWithoutTeacher: [],
      registersWithoutClass: [],
    },
    inconsistencies: [],
    assumptions: [],
    limitations: [],
  }

  parsed.forEach((record) => {
    const collection = record.collection || record.kind
    report.sourceSummary.totalsByCollection[collection] = (report.sourceSummary.totalsByCollection[collection] || 0) + 1
    if (record.ownerUid) {
      if (!report.sourceSummary.totalsByOwner[record.ownerUid]) report.sourceSummary.totalsByOwner[record.ownerUid] = {}
      report.sourceSummary.totalsByOwner[record.ownerUid][collection] = (report.sourceSummary.totalsByOwner[record.ownerUid][collection] || 0) + 1
    }
  })

  const addDocument = (document) => {
    const existing = report.documentsToCreate.find((item) => item.path === document.path)
    if (existing) return existing
    report.documentsToCreate.push(document)
    return document
  }
  const addMapping = (sourcePath, targetPath, confidence, reasons = []) => {
    report.mappings.push({ sourcePath, targetPath, confidence, reasons: unique(reasons) })
  }
  const review = (type, sourcePaths, reason, details = {}) => {
    const entry = { id: targetId('review', [type, sourcePaths, reason, details]), type, sourcePaths: unique(sourcePaths), reason, details }
    if (!report.manualReview.some((item) => item.id === entry.id)) report.manualReview.push(entry)
    return entry
  }

  addDocument({
    path: `churches/${church.id}`,
    type: 'church',
    confidence: 'safe',
    sourcePaths: [],
    data: {
      name: church.name,
      normalizedName: normalizeName(church.name),
      status: 'active',
      timezone: church.timezone,
      locale: church.locale,
      ...makeAudit(runId, runAt),
      legacy: makeLegacy(runId, [], {}),
    },
  })

  const peopleReconciliation = reconcilePeople(byKind.people || [], byKind.teachers || [], context)
  peopleReconciliation.documents.forEach(addDocument)
  report.matches.safe.push(...peopleReconciliation.matches.safe)
  report.matches.probable.push(...peopleReconciliation.matches.probable)
  report.matches.ambiguous.push(...peopleReconciliation.matches.ambiguous)
  report.duplicates.peopleNames = peopleReconciliation.duplicateNames

  peopleReconciliation.documents.forEach((document) => {
    document.sourcePaths.forEach((sourcePath) => addMapping(sourcePath, document.path, document.confidence, document.data.legacy.reviewReasons))
  })
  report.matches.probable.forEach((match) => review('probable-person-match', [match.leftPath, match.rightPath].filter(Boolean), match.reason, match))
  report.matches.ambiguous.forEach((match) => review('ambiguous-person-match', match.paths || [match.leftPath, match.rightPath].filter(Boolean), match.reason, match))

  const personDocumentsById = new Map(peopleReconciliation.documents.map((item) => [item.path.split('/').at(-1), item]))
  const placeholderPersonByKey = new Map()
  const ensurePerson = ({ ownerUid = '', legacyId = '', authUid = '', email = '', name = '', sourceRecord = null, reason = '' }) => {
    const resolved = peopleReconciliation.resolve({ ownerUid, legacyId, authUid, email })
    if (resolved.personId) return resolved
    const key = `${ownerUid}:${legacyId || authUid || normalizeEmail(email) || normalizeName(name)}`
    if (placeholderPersonByKey.has(key)) return { personId: placeholderPersonByKey.get(key), confidence: 'ambiguous', key }
    const personId = targetId('placeholder-person', key)
    const sourcePaths = sourceRecord ? [sourceRecord.path] : []
    const displayName = String(name || `Pessoa legada ${legacyId || authUid || 'sem identificação'}`).trim()
    const path = `churches/${church.id}/people/${personId}`
    const document = addDocument({
      path,
      type: 'person',
      confidence: 'ambiguous',
      sourcePaths,
      data: {
        fullName: displayName,
        normalizedName: normalizeName(displayName),
        email: normalizeEmail(email) || null,
        normalizedEmail: normalizeEmail(email) || null,
        phone: null,
        normalizedPhone: null,
        birthDate: null,
        churchStatus: 'unknown',
        status: 'active',
        notes: '',
        dataQuality: 'incomplete',
        ...makeAudit(runId, runAt, sourceRecord?.data),
        legacy: makeLegacy(runId, sourceRecord ? [legacyRef(sourceRecord)] : [], {
          requiresReview: true,
          reviewReasons: [reason || 'Referência a pessoa sem cadastro canônico correspondente.'],
        }),
      },
    })
    personDocumentsById.set(personId, document)
    placeholderPersonByKey.set(key, personId)
    review('placeholder-person', sourcePaths, reason || 'Pessoa referenciada não foi localizada.', { personId, ownerUid, legacyId, authUid, email, name })
    return { personId, confidence: 'ambiguous', key }
  }

  const classSourceToId = new Map()
  const classIdsByLegacyId = new Map()
  const usedClassIds = new Set()
  const classDocumentsById = new Map()
  ;(byKind.classes || []).forEach((record) => {
    let classId = safeId(record.id, record.path)
    if (usedClassIds.has(classId)) classId = `${classId}-${stableHash(record.path, 8)}`
    usedClassIds.add(classId)
    classSourceToId.set(record.path, classId)
    if (!classIdsByLegacyId.has(record.id)) classIdsByLegacyId.set(record.id, new Set())
    classIdsByLegacyId.get(record.id).add(classId)
    const name = String(record.data.name || `Classe legada ${record.id}`).trim()
    const path = `churches/${church.id}/classes/${classId}`
    const document = addDocument({
      path,
      type: 'class',
      confidence: record.data.name ? 'safe' : 'ambiguous',
      sourcePaths: [record.path],
      data: {
        name,
        normalizedName: normalizeName(name),
        department: String(record.data.department || ''),
        description: String(record.data.description || ''),
        status: record.data.active === false ? 'inactive' : 'active',
        ...makeAudit(runId, runAt, record.data),
        legacy: makeLegacy(runId, [legacyRef(record)], {
          requiresReview: !record.data.name,
          reviewReasons: record.data.name ? [] : ['Classe sem nome no legado.'],
          unmapped: {
            studentIds: asArray(record.data.studentIds),
            legacyTeacherFields: getTeacherIdentity(record.data),
          },
        }),
      },
    })
    classDocumentsById.set(classId, document)
    addMapping(record.path, path, document.confidence, document.data.legacy.reviewReasons)
  })

  const placeholderClassByKey = new Map()
  const ensureClass = (record, legacyClassId = '', className = '') => {
    const exactPath = record?.ownerUid && legacyClassId ? `users/${record.ownerUid}/ebd_classes/${legacyClassId}` : ''
    if (exactPath && classSourceToId.has(exactPath)) return { classId: classSourceToId.get(exactPath), confidence: 'safe' }
    const globalMatches = [...(classIdsByLegacyId.get(legacyClassId) || [])]
    if (globalMatches.length === 1) return { classId: globalMatches[0], confidence: 'probable' }
    const key = `${record?.ownerUid || ''}:${legacyClassId || normalizeName(className) || record?.path || 'unknown'}`
    if (placeholderClassByKey.has(key)) return { classId: placeholderClassByKey.get(key), confidence: 'ambiguous' }
    const classId = targetId('placeholder-class', key)
    const name = String(className || `Classe legada ${legacyClassId || 'sem identificação'}`).trim()
    const path = `churches/${church.id}/classes/${classId}`
    addDocument({
      path,
      type: 'class',
      confidence: 'ambiguous',
      sourcePaths: record ? [record.path] : [],
      data: {
        name,
        normalizedName: normalizeName(name),
        department: '',
        description: '',
        status: 'inactive',
        ...makeAudit(runId, runAt, record?.data),
        legacy: makeLegacy(runId, record ? [legacyRef(record)] : [], {
          requiresReview: true,
          reviewReasons: ['Classe referenciada não foi localizada de forma inequívoca.'],
        }),
      },
    })
    placeholderClassByKey.set(key, classId)
    classDocumentsById.set(classId, report.documentsToCreate.find((item) => item.path === path))
    review('placeholder-class', record ? [record.path] : [], 'Classe ausente ou ambígua.', { classId, legacyClassId, className })
    return { classId, confidence: 'ambiguous' }
  }

  const termDocumentsById = new Map()
  const termsByClassId = new Map()
  const registerInfos = []
  const lessonByRegisterDate = new Map()
  const assignmentByKey = new Map()
  const attendanceByKey = new Map()

  const createAssignment = ({ personId, classId, classTermId, startDate, endDate, status, role = 'leadTeacher', sourceRecord, confidence, reasons = [] }) => {
    if (!personId || !classId || !classTermId) return null
    const key = `${personId}:${classTermId}:${role}`
    if (assignmentByKey.has(key)) return assignmentByKey.get(key)
    const assignmentId = targetId('assignment', key)
    const path = `churches/${church.id}/teacherAssignments/${assignmentId}`
    const document = addDocument({
      path,
      type: 'teacherAssignment',
      confidence,
      sourcePaths: sourceRecord ? [sourceRecord.path] : [],
      data: {
        personId,
        classId,
        classTermId,
        role,
        startDate,
        endDate: endDate || null,
        status,
        statusHistory: [{ status, changedAt: asIso(sourceRecord?.data?.createdAt, runAt), changedBy: `migration:${runId}` }],
        notes: '',
        ...makeAudit(runId, runAt, sourceRecord?.data),
        legacy: makeLegacy(runId, sourceRecord ? [legacyRef(sourceRecord)] : [], {
          requiresReview: confidence !== 'safe',
          reviewReasons: reasons,
        }),
      },
    })
    assignmentByKey.set(key, { assignmentId, document })
    return { assignmentId, document }
  }

  ;(byKind.registers || []).forEach((record) => {
    const classResolution = ensureClass(record, record.data.classId, record.data.className)
    if (!record.data.classId || classResolution.confidence === 'ambiguous') {
      report.orphans.registersWithoutClass.push({ path: record.path, legacyClassId: record.data.classId || '', proposedClassId: classResolution.classId })
    }
    const sundayDates = unique(asArray(record.data.sundayDates).map((value) => asDate(value)).filter(Boolean)).sort()
    const startDate = asDate(record.data.startDate, sundayDates[0] || asDate(record.data.createdAt, context.runDate))
    const endDate = asDate(record.data.endDate, sundayDates.at(-1) || startDate)
    const classTermId = targetId('term', record.path)
    const termName = record.data.startDate && record.data.endDate
      ? `${record.data.startDate} a ${record.data.endDate}`
      : `Período legado ${record.id}`
    const termPath = `churches/${church.id}/classTerms/${classTermId}`
    const termDocument = addDocument({
      path: termPath,
      type: 'classTerm',
      confidence: classResolution.confidence,
      sourcePaths: [record.path],
      data: {
        classId: classResolution.classId,
        name: termName,
        discipline: String(record.data.discipline || record.data.lessonName || record.data.lessonTitle || ''),
        periodType: ['weekly', 'monthly', 'quarterly', 'semester', 'annual', 'custom'].includes(record.data.periodType) ? record.data.periodType : 'quarterly',
        startDate,
        endDate,
        status: mapTermStatus(record.data, context.runDate),
        auditTrail: asArray(record.data.auditTrail),
        ...makeAudit(runId, runAt, record.data),
        legacy: makeLegacy(runId, [legacyRef(record)], {
          requiresReview: classResolution.confidence !== 'safe' || !record.data.startDate || !record.data.endDate,
          reviewReasons: [
            ...(classResolution.confidence !== 'safe' ? ['Classe da caderneta não foi resolvida com evidência segura.'] : []),
            ...(!record.data.startDate || !record.data.endDate ? ['Período inferido de datas disponíveis.'] : []),
          ],
          unmapped: {
            month: record.data.month,
            year: record.data.year,
            historicalTeacherLinks: asArray(record.data.historicalTeacherLinks),
            studentsSnapshot: asArray(record.data.studentsSnapshot),
            studentStatuses: record.data.studentStatuses || {},
          },
        }),
      },
    })
    termDocumentsById.set(classTermId, termDocument)
    if (!termsByClassId.has(classResolution.classId)) termsByClassId.set(classResolution.classId, [])
    termsByClassId.get(classResolution.classId).push({ classTermId, startDate, endDate, sourceRecord: record })
    addMapping(record.path, termPath, classResolution.confidence, termDocument.data.legacy.reviewReasons)

    const teacherIdentity = getTeacherIdentity(record.data)
    const teacherResolution = peopleReconciliation.resolve({
      ownerUid: record.ownerUid,
      legacyId: teacherIdentity.legacyId,
      authUid: teacherIdentity.authUid,
      email: teacherIdentity.email,
    })
    let teacherPersonId = teacherResolution.personId
    if (!teacherPersonId && (teacherIdentity.legacyId || teacherIdentity.authUid || teacherIdentity.email || teacherIdentity.name)) {
      teacherPersonId = ensurePerson({ ...teacherIdentity, ownerUid: record.ownerUid, sourceRecord: record, reason: 'Professor da caderneta sem pessoa canônica segura.' }).personId
    }
    const assignment = teacherPersonId
      ? createAssignment({
        personId: teacherPersonId,
        classId: classResolution.classId,
        classTermId,
        startDate,
        endDate,
        status: termDocument.data.status === 'completed' ? 'completed' : 'active',
        sourceRecord: record,
        confidence: teacherResolution.confidence === 'safe' && classResolution.confidence === 'safe' ? 'safe' : 'ambiguous',
        reasons: teacherResolution.confidence === 'safe' ? [] : ['Professor da caderneta não foi resolvido com evidência segura.'],
      })
      : null

    const registerInfo = {
      record,
      classId: classResolution.classId,
      classTermId,
      startDate,
      endDate,
      sundayDates,
      teacherPersonId,
      assignmentId: assignment?.assignmentId || null,
      studentIds: listStudentIds(record),
    }
    registerInfos.push(registerInfo)

    sundayDates.forEach((date) => {
      const lessonId = targetId('lesson', [record.path, date])
      const startTime = String(record.data.lessonStartTime || options.defaultLessonStartTime || '18:30')
      const endTime = String(record.data.lessonEndTime || addMinutes(startTime, Number(record.data.lessonDurationMinutes || options.defaultLessonDurationMinutes || 50)))
      const path = `churches/${church.id}/lessons/${lessonId}`
      const lessonDocument = addDocument({
        path,
        type: 'lesson',
        confidence: classResolution.confidence,
        sourcePaths: [record.path],
        data: {
          classId: classResolution.classId,
          classTermId,
          date,
          startTime,
          endTime,
          title: String(record.data.lessonTitle || ''),
          topic: String(record.data.discipline || record.data.lessonName || ''),
          status: date < context.runDate ? 'completed' : date === context.runDate ? 'open' : 'planned',
          ...makeAudit(runId, runAt, record.data),
          legacy: makeLegacy(runId, [legacyRef(record)], {
            requiresReview: !record.data.lessonStartTime,
            reviewReasons: !record.data.lessonStartTime ? ['Horário da aula veio do padrão global, pois a caderneta não o armazena.'] : [],
          }),
        },
      })
      lessonByRegisterDate.set(`${record.path}:${date}`, { lessonId, document: lessonDocument, registerInfo })

      registerInfo.studentIds.forEach((legacyStudentId) => {
        const snapshotStudent = getStudentSnapshot(record, legacyStudentId)
        const person = ensurePerson({
          ownerUid: record.ownerUid,
          legacyId: legacyStudentId,
          name: snapshotStudent?.fullName || snapshotStudent?.name || '',
          sourceRecord: record,
          reason: 'Aluno presente na caderneta sem cadastro canônico correspondente.',
        })
        const legacyMark = record.data.attendanceByStudent?.[legacyStudentId]?.[date] ?? ''
        const attendanceId = targetId('attendance', [lessonId, person.personId, 'student'])
        const attendancePath = `churches/${church.id}/attendance/${attendanceId}`
        const key = `${lessonId}:${person.personId}:student`
        if (attendanceByKey.has(key)) {
          review('duplicate-attendance-cell', [record.path, attendanceByKey.get(key).sourcePath], 'Mais de uma caderneta produziria a mesma presença estudantil.', { lessonId, personId: person.personId, date })
          return
        }
        const attendanceDocument = addDocument({
          path: attendancePath,
          type: 'attendance',
          confidence: person.confidence === 'safe' && classResolution.confidence === 'safe' ? 'safe' : 'ambiguous',
          sourcePaths: [record.path],
          data: {
            lessonId,
            classId: classResolution.classId,
            classTermId,
            personId: person.personId,
            participationType: 'student',
            enrollmentId: null,
            assignmentId: null,
            status: markToStatus(legacyMark),
            legacyMark,
            recordedAt: asIso(record.data.updatedAt || record.data.createdAt, runAt),
            recordedBy: record.data.createdByUid || `migration:${runId}`,
            auditTrail: asArray(record.data.auditTrail),
            ...makeAudit(runId, runAt, record.data),
            legacy: makeLegacy(runId, [legacyRef(record)], {
              requiresReview: person.confidence !== 'safe',
              reviewReasons: person.confidence !== 'safe' ? ['Pessoa da presença não foi resolvida com evidência segura.'] : [],
            }),
          },
        })
        attendanceByKey.set(key, { document: attendanceDocument, sourcePath: record.path })
      })
    })
  })

  const syntheticTermByClass = new Map()
  const ensureTermForEnrollment = (record, classId) => {
    const date = asDate(record.data.enrollmentDate, asDate(record.data.createdAt, context.runDate))
    const candidates = (termsByClassId.get(classId) || []).filter((term) => date >= term.startDate && date <= term.endDate)
    if (candidates.length === 1) return { ...candidates[0], confidence: 'safe' }
    const allTerms = termsByClassId.get(classId) || []
    if (!date && allTerms.length === 1) return { ...allTerms[0], confidence: 'probable' }
    if (syntheticTermByClass.has(classId)) return syntheticTermByClass.get(classId)
    const classTermId = targetId('synthetic-term', classId)
    const termPath = `churches/${church.id}/classTerms/${classTermId}`
    const startDate = date || context.runDate
    const result = { classTermId, startDate, endDate: startDate, confidence: 'ambiguous', synthetic: true }
    addDocument({
      path: termPath,
      type: 'classTerm',
      confidence: 'ambiguous',
      sourcePaths: [record.path],
      data: {
        classId,
        name: 'Período legado sem definição',
        discipline: '',
        periodType: 'custom',
        startDate,
        endDate: startDate,
        status: 'archived',
        auditTrail: [],
        ...makeAudit(runId, runAt, record.data),
        legacy: makeLegacy(runId, [legacyRef(record)], {
          requiresReview: true,
          reviewReasons: ['Matrícula não pôde ser vinculada a um período existente de forma inequívoca.'],
        }),
      },
    })
    syntheticTermByClass.set(classId, result)
    review('synthetic-class-term', [record.path], 'Período da matrícula precisa de definição administrativa.', { classId, classTermId, enrollmentDate: date })
    return result
  }

  const enrollmentByPersonTerm = new Map()
  const createEnrollment = ({ personId, classId, classTermId, startDate, endDate = null, status = 'active', sourceRecord, confidence = 'safe', notes = '', inferredReason = '' }) => {
    const key = `${personId}:${classTermId}`
    if (enrollmentByPersonTerm.has(key)) return enrollmentByPersonTerm.get(key)
    const enrollmentId = sourceRecord?.kind === 'enrollments'
      ? safeId(sourceRecord.id, sourceRecord.path)
      : targetId('enrollment', [key, sourceRecord?.path, inferredReason])
    const uniqueId = report.documentsToCreate.some((item) => item.path === `churches/${church.id}/enrollments/${enrollmentId}`)
      ? `${enrollmentId}-${stableHash(sourceRecord?.path || key, 8)}`
      : enrollmentId
    const path = `churches/${church.id}/enrollments/${uniqueId}`
    const document = addDocument({
      path,
      type: 'enrollment',
      confidence,
      sourcePaths: sourceRecord ? [sourceRecord.path] : [],
      data: {
        personId,
        classId,
        classTermId,
        startDate,
        endDate,
        status,
        statusHistory: toHistory(sourceRecord?.data || {}, status, runAt, `migration:${runId}`),
        inactivationReason: String(sourceRecord?.data?.inactivationReason || ''),
        notes: String(notes || sourceRecord?.data?.notes || ''),
        ...makeAudit(runId, runAt, sourceRecord?.data),
        legacy: makeLegacy(runId, sourceRecord ? [legacyRef(sourceRecord)] : [], {
          requiresReview: confidence !== 'safe',
          reviewReasons: inferredReason ? [inferredReason] : [],
          unmapped: sourceRecord?.kind === 'enrollments' ? {
            personName: sourceRecord.data.personName,
            className: sourceRecord.data.className,
            enrolledInEBD: sourceRecord.data.enrolledInEBD,
            activationHistory: asArray(sourceRecord.data.activationHistory),
          } : {},
        }),
      },
    })
    enrollmentByPersonTerm.set(key, { enrollmentId: uniqueId, document })
    return { enrollmentId: uniqueId, document }
  }

  ;(byKind.enrollments || []).forEach((record) => {
    const person = ensurePerson({ ownerUid: record.ownerUid, legacyId: record.data.personId, name: record.data.personName, sourceRecord: record, reason: 'Matrícula sem pessoa canônica segura.' })
    const classResolution = ensureClass(record, record.data.classId, record.data.className)
    const term = ensureTermForEnrollment(record, classResolution.classId)
    const status = mapEnrollmentStatus(record.data)
    const enrollment = createEnrollment({
      personId: person.personId,
      classId: classResolution.classId,
      classTermId: term.classTermId,
      startDate: asDate(record.data.enrollmentDate, term.startDate),
      endDate: status === 'active' ? null : asDate(record.data.updatedAt, term.endDate),
      status,
      sourceRecord: record,
      confidence: [person.confidence, classResolution.confidence, term.confidence].every((value) => value === 'safe') ? 'safe' : 'ambiguous',
    })
    addMapping(record.path, enrollment.document.path, enrollment.document.confidence, enrollment.document.data.legacy.reviewReasons)
  })

  registerInfos.forEach((info) => {
    info.studentIds.forEach((legacyStudentId) => {
      const snapshotStudent = getStudentSnapshot(info.record, legacyStudentId)
      const person = ensurePerson({
        ownerUid: info.record.ownerUid,
        legacyId: legacyStudentId,
        name: snapshotStudent?.fullName || snapshotStudent?.name || '',
        sourceRecord: info.record,
        reason: 'Participante da caderneta sem matrícula explícita.',
      })
      const key = `${person.personId}:${info.classTermId}`
      let enrollment = enrollmentByPersonTerm.get(key)
      if (!enrollment) {
        enrollment = createEnrollment({
          personId: person.personId,
          classId: info.classId,
          classTermId: info.classTermId,
          startDate: info.startDate,
          endDate: info.endDate,
          status: 'completed',
          sourceRecord: info.record,
          confidence: person.confidence === 'safe' ? 'probable' : 'ambiguous',
          notes: 'Matrícula inferida da lista histórica da caderneta.',
          inferredReason: 'Matrícula inferida de enrolledStudentIds/studentsSnapshot/attendanceByStudent.',
        })
        review('inferred-enrollment', [info.record.path], 'Matrícula foi inferida da caderneta.', { personId: person.personId, classTermId: info.classTermId })
      }
      info.sundayDates.forEach((date) => {
        const lesson = lessonByRegisterDate.get(`${info.record.path}:${date}`)
        const attendance = attendanceByKey.get(`${lesson?.lessonId}:${person.personId}:student`)
        if (attendance) attendance.document.data.enrollmentId = enrollment.enrollmentId
      })
    })
  })

  ;(byKind.classes || []).forEach((record) => {
    const classId = classSourceToId.get(record.path)
    const termCandidates = termsByClassId.get(classId) || []
    const teacherIdentity = getTeacherIdentity(record.data)
    if (!(teacherIdentity.legacyId || teacherIdentity.authUid || teacherIdentity.email || teacherIdentity.name)) return
    const person = peopleReconciliation.resolve({ ownerUid: record.ownerUid, ...teacherIdentity })
    if (!person.personId) {
      review('class-teacher-unresolved', [record.path], 'Professor padrão da classe não foi resolvido.', teacherIdentity)
      return
    }
    if (termCandidates.length !== 1) {
      review('class-assignment-period-ambiguous', [record.path], 'Professor padrão da classe não possui período inequívoco.', { personId: person.personId, classId, candidateTerms: termCandidates.map((item) => item.classTermId) })
      return
    }
    const term = termCandidates[0]
    createAssignment({
      personId: person.personId,
      classId,
      classTermId: term.classTermId,
      startDate: term.startDate,
      endDate: term.endDate,
      status: record.data.active === false ? 'inactive' : 'active',
      sourceRecord: record,
      confidence: person.confidence === 'safe' ? 'safe' : 'probable',
      reasons: person.confidence === 'safe' ? [] : ['Professor padrão resolvido somente por e-mail.'],
    })
  })

  const sessionLinks = []
  ;(byKind.sessions || []).forEach((record) => {
    const date = asDate(record.data.lessonDateKey || record.data.lessonDate)
    const registerId = record.data.monitoringRegisterId || record.data.registerId || ''
    let lessonCandidates = []
    if (registerId && date) {
      lessonCandidates = registerInfos
        .filter((info) => info.record.id === registerId)
        .map((info) => lessonByRegisterDate.get(`${info.record.path}:${date}`))
        .filter(Boolean)
    }
    const sessionTeacher = getTeacherIdentity({
      ...record.data,
      teacherAuthUid: record.data.teacherUid || record.ownerUid,
      teacherId: record.data.teacherProfileId,
    })
    const person = peopleReconciliation.resolve({ ownerUid: record.ownerUid, ...sessionTeacher })
    if (!lessonCandidates.length && date && person.personId) {
      lessonCandidates = [...lessonByRegisterDate.values()].filter((candidate) => (
        candidate.document.data.date === date
        && candidate.registerInfo.teacherPersonId === person.personId
      ))
    }
    lessonCandidates = unique(lessonCandidates.map((item) => item?.lessonId)).map((lessonId) => [...lessonByRegisterDate.values()].find((item) => item.lessonId === lessonId))

    if (lessonCandidates.length !== 1 || !person.personId) {
      const reason = !person.personId
        ? 'Sessão docente sem pessoa canônica inequívoca.'
        : lessonCandidates.length === 0
          ? 'Sessão docente sem aula/classe correspondente.'
          : 'Sessão docente corresponde a mais de uma aula possível.'
      review('unresolved-teacher-session', [record.path], reason, { date, registerId, personResolution: person, lessonCandidates: lessonCandidates.map((item) => item.lessonId) })
      sessionLinks.push({ sessionPath: record.path, status: 'manual-review', reason })
      return
    }

    const lesson = lessonCandidates[0]
    const assignment = assignmentByKey.get(`${person.personId}:${lesson.registerInfo.classTermId}:leadTeacher`)
    const attendanceId = targetId('attendance', [lesson.lessonId, person.personId, 'teacher'])
    const key = `${lesson.lessonId}:${person.personId}:teacher`
    if (attendanceByKey.has(key)) {
      review('duplicate-teacher-session', [record.path, attendanceByKey.get(key).sourcePath], 'Sessões docentes duplicadas para a mesma pessoa e aula.', { lessonId: lesson.lessonId, personId: person.personId })
      sessionLinks.push({ sessionPath: record.path, status: 'duplicate', lessonId: lesson.lessonId })
      return
    }

    lesson.document.data.openedAt = asIso(record.data.checkInAt || record.data.monitoringActivatedAt, lesson.document.data.openedAt)
    lesson.document.data.endedAt = asIso(record.data.endedAt, lesson.document.data.endedAt)
    lesson.document.data.warningTriggeredAt = asIso(record.data.warningTriggeredAt, lesson.document.data.warningTriggeredAt)
    lesson.document.data.endAlertTriggeredAt = asIso(record.data.endAlertTriggeredAt, lesson.document.data.endAlertTriggeredAt)
    if (record.data.endedAt) lesson.document.data.status = 'completed'
    lesson.document.sourcePaths.push(record.path)
    lesson.document.data.legacy.sourceRefs.push(legacyRef(record))

    const status = record.data.presenceConfirmed
      ? record.data.punctualityOk === false ? 'present' : 'punctual'
      : 'absent'
    const attendanceDocument = addDocument({
      path: `churches/${church.id}/attendance/${attendanceId}`,
      type: 'attendance',
      confidence: person.confidence === 'safe' && assignment ? 'safe' : 'probable',
      sourcePaths: [record.path],
      data: {
        lessonId: lesson.lessonId,
        classId: lesson.registerInfo.classId,
        classTermId: lesson.registerInfo.classTermId,
        personId: person.personId,
        participationType: 'teacher',
        enrollmentId: null,
        assignmentId: assignment?.assignmentId || null,
        status,
        legacyMark: status === 'punctual' ? 'PP' : status === 'present' ? 'P' : 'A',
        recordedAt: asIso(record.data.locationCheckedAt || record.data.checkInAt || record.data.updatedAt, runAt),
        recordedBy: record.ownerUid || `migration:${runId}`,
        ...(record.data.checkInAt ? { checkInAt: asIso(record.data.checkInAt, runAt) } : {}),
        ...(typeof record.data.punctualityOk === 'boolean' ? { punctualityOk: record.data.punctualityOk } : {}),
        ...(record.data.checkInStatus ? { checkInStatus: record.data.checkInStatus } : {}),
        ...(record.data.geoPoint?.lat != null && record.data.geoPoint?.lng != null ? { geoPoint: record.data.geoPoint } : {}),
        ...(Number.isFinite(Number(record.data.distanceMeters)) ? { distanceMeters: Number(record.data.distanceMeters) } : {}),
        ...(record.data.locationCheckedAt ? { locationCheckedAt: asIso(record.data.locationCheckedAt, runAt) } : {}),
        notes: String(record.data.locationError || record.data.homeWarningMessage || ''),
        auditTrail: [],
        ...makeAudit(runId, runAt, record.data),
        legacy: makeLegacy(runId, [legacyRef(record)], {
          requiresReview: !assignment,
          reviewReasons: assignment ? [] : ['Sessão vinculada à aula, mas sem designação docente correspondente.'],
        }),
      },
    })
    attendanceByKey.set(key, { document: attendanceDocument, sourcePath: record.path })
    addMapping(record.path, attendanceDocument.path, attendanceDocument.confidence, attendanceDocument.data.legacy.reviewReasons)
    sessionLinks.push({ sessionPath: record.path, status: 'linked', lessonId: lesson.lessonId, attendanceId })
  })

  ;(byKind.settings || []).forEach((record) => {
    const settingId = safeId(record.id, record.path)
    const knownType = ['communication', 'lessonSchedule', 'attendancePolicy', 'notifications', 'general'].includes(settingId) ? settingId : 'general'
    const path = `churches/${church.id}/settings/${settingId}`
    addDocument({
      path,
      type: 'setting',
      confidence: 'safe',
      sourcePaths: [record.path],
      data: {
        type: knownType,
        schemaVersion: 1,
        value: record.data,
        ...makeAudit(runId, runAt, record.data),
        legacy: makeLegacy(runId, [legacyRef(record)]),
      },
    })
    addMapping(record.path, path, 'safe')
  })

  const userProfileByUid = new Map((byKind.userProfiles || []).map((record) => [record.id, record]))
  const authByUid = new Map(authUsers.map((user) => [user.uid, user]))
  const allAccessUids = unique([...userProfileByUid.keys(), ...authByUid.keys()])
  allAccessUids.forEach((uid) => {
    const authUser = authByUid.get(uid) || null
    const profileRecord = userProfileByUid.get(uid) || null
    const email = normalizeEmail(authUser?.email || profileRecord?.data?.email)
    if (!authUser && profileRecord && authUsersIncluded) {
      report.orphans.firestoreUsersWithoutAuth.push({ uid, email, path: profileRecord.path })
    }
    let person = peopleReconciliation.resolve({ authUid: uid, email: '' })
    if (!person.personId && email) person = peopleReconciliation.resolve({ email })
    if (!person.personId || person.confidence !== 'safe') {
      if (authUser) report.orphans.authAccounts.push({ uid, email, displayName: authUser.displayName || '', probablePersonIds: person.candidates || [], confidence: person.confidence })
      review('orphan-auth-account', [profileRecord?.path].filter(Boolean), 'Conta Auth sem pessoa vinculada com evidência segura.', { uid, email, personResolution: person })
      return
    }

    const hasTeacherSource = (byKind.teachers || []).some((record) => peopleReconciliation.sourceToPersonId.get(record.path) === person.personId)
    const legacyRole = profileRecord?.data?.role || ''
    const roles = unique([
      legacyRole === 'admin' ? 'churchAdmin' : '',
      hasTeacherSource || legacyRole === 'teacher' ? 'teacher' : '',
    ])
    if (!roles.length) roles.push('teacher')
    const accessStatus = authUser?.disabled || profileRecord?.data?.active === false ? 'disabled' : 'active'
    const path = `users/${uid}`
    const userDocument = addDocument({
      path,
      type: 'user',
      confidence: 'safe',
      sourcePaths: [profileRecord?.path].filter(Boolean),
      data: {
        churchId: church.id,
        personId: person.personId,
        email,
        roles,
        accessStatus,
        authProvider: authUser?.providerData?.[0]?.providerId === 'password' ? 'password' : 'other',
        ...makeAudit(runId, runAt, profileRecord?.data || authUser),
        legacy: makeLegacy(runId, profileRecord ? [legacyRef(profileRecord)] : [], {
          unmapped: { legacyRole, authDisabled: Boolean(authUser?.disabled) },
        }),
      },
    })
    if (profileRecord) addMapping(profileRecord.path, path, 'safe')
    return userDocument
  })

  if (!authUsersIncluded) {
    report.limitations.push('O snapshot não informou authUsers; contas órfãs do Firebase Authentication não podem ser enumeradas completamente.')
  }

  report.duplicates.emails = Object.entries(groupBy(report.documentsToCreate.filter((item) => item.type === 'person' && item.data.normalizedEmail), (item) => item.data.normalizedEmail))
    .filter(([, items]) => items.length > 1)
    .map(([email, items]) => ({ email, personIds: items.map((item) => item.data ? item.path.split('/').at(-1) : '') }))
  report.duplicates.enrollments = duplicateGroups(byKind.enrollments || [], (record) => `${record.ownerUid}:${record.data.personId || ''}:${record.data.classId || ''}:${record.data.enrollmentDate || ''}`)
  report.duplicates.registers = duplicateGroups(byKind.registers || [], (record) => stableHash({
    classId: record.data.classId || normalizeName(record.data.className),
    startDate: record.data.startDate,
    endDate: record.data.endDate,
    discipline: normalizeName(record.data.discipline),
    teacher: record.data.teacherId || normalizeEmail(record.data.teacherEmail) || normalizeName(record.data.teacherName),
    sundayDates: unique(asArray(record.data.sundayDates)).sort(),
  }, 32))
  report.duplicates.sessions = duplicateGroups(byKind.sessions || [], (record) => `${record.data.teacherUid || record.ownerUid}:${record.data.lessonDateKey || ''}:${record.data.monitoringRegisterId || ''}`)

  report.duplicates.enrollments.forEach((duplicate) => review('duplicate-enrollment', duplicate.paths, 'Matrículas legadas com mesma pessoa, classe e data.', duplicate))
  report.duplicates.registers.forEach((duplicate) => review('duplicate-register', duplicate.paths, 'Cadernetas com assinatura estrutural idêntica.', duplicate))
  report.duplicates.sessions.forEach((duplicate) => review('duplicate-session', duplicate.paths, 'Sessões docentes com a mesma chave lógica.', duplicate))

  const enrollmentPersonIds = new Set(report.documentsToCreate.filter((item) => item.type === 'enrollment').map((item) => item.data.personId))
  report.orphans.peopleWithoutEnrollment = report.documentsToCreate
    .filter((item) => item.type === 'person' && !enrollmentPersonIds.has(item.path.split('/').at(-1)))
    .map((item) => ({ personId: item.path.split('/').at(-1), fullName: item.data.fullName, sourcePaths: item.sourcePaths }))

  const assignedPersonIds = new Set([...assignmentByKey.values()].map((item) => item.document.data.personId))
  const teacherPersonIds = new Set((byKind.teachers || []).map((record) => peopleReconciliation.sourceToPersonId.get(record.path)).filter(Boolean))
  report.orphans.teachersWithoutAssignment = [...teacherPersonIds]
    .filter((personId) => !assignedPersonIds.has(personId))
    .map((personId) => ({ personId, fullName: personDocumentsById.get(personId)?.data.fullName || '' }))

  const assignedClassIds = new Set([...assignmentByKey.values()].map((item) => item.document.data.classId))
  report.orphans.classesWithoutTeacher = [...classDocumentsById.keys()]
    .filter((classId) => !assignedClassIds.has(classId))
    .map((classId) => ({ classId, name: classDocumentsById.get(classId)?.data.name || '' }))

  ;(byKind.classes || []).forEach((classRecord) => {
    const classId = classSourceToId.get(classRecord.path)
    const classStudents = new Set(asArray(classRecord.data.studentIds))
    const explicitEnrollmentStudents = new Set((byKind.enrollments || [])
      .filter((record) => record.ownerUid === classRecord.ownerUid && record.data.classId === classRecord.id && mapEnrollmentStatus(record.data) === 'active')
      .map((record) => record.data.personId))
    const registerStudents = new Set(registerInfos
      .filter((info) => info.classId === classId)
      .flatMap((info) => info.studentIds))
    const onlyClass = [...classStudents].filter((id) => !explicitEnrollmentStudents.has(id))
    const onlyEnrollment = [...explicitEnrollmentStudents].filter((id) => !classStudents.has(id))
    const onlyRegister = [...registerStudents].filter((id) => !classStudents.has(id) && !explicitEnrollmentStudents.has(id))
    if (onlyClass.length || onlyEnrollment.length || onlyRegister.length) {
      report.inconsistencies.push({
        type: 'class-membership-mismatch',
        classPath: classRecord.path,
        classId,
        onlyInClassStudentIds: onlyClass,
        onlyInExplicitEnrollments: onlyEnrollment,
        onlyInRegisters: onlyRegister,
      })
    }
  })

  report.inconsistencies.push(...report.duplicates.enrollments.map((item) => ({ type: 'conflicting-enrollments', ...item })))
  report.inconsistencies.push(...report.duplicates.registers.map((item) => ({ type: 'duplicate-registers', ...item })))
  report.inconsistencies.push(...sessionLinks.filter((item) => item.status !== 'linked').map((item) => ({ type: 'unresolved-session', ...item })))

  const legacyAttendance = (byKind.registers || []).reduce((totals, record) => {
    const dates = unique(asArray(record.data.sundayDates))
    const students = listStudentIds(record)
    const cells = students.length * dates.length
    let marked = 0
    let pp = 0
    let p = 0
    let a = 0
    students.forEach((studentId) => dates.forEach((date) => {
      const mark = record.data.attendanceByStudent?.[studentId]?.[date] || ''
      if (mark) marked += 1
      if (mark === 'PP') pp += 1
      if (mark === 'P') p += 1
      if (mark === 'A') a += 1
    }))
    return { cells: totals.cells + cells, marked: totals.marked + marked, PP: totals.PP + pp, P: totals.P + p, A: totals.A + a }
  }, { cells: 0, marked: 0, PP: 0, P: 0, A: 0 })

  report.counts.legacy = {
    people: (byKind.people || []).length,
    teachers: (byKind.teachers || []).length,
    classes: (byKind.classes || []).length,
    enrollments: (byKind.enrollments || []).length,
    registers: (byKind.registers || []).length,
    lessonsFromRegisterDates: (byKind.registers || []).reduce((total, record) => total + unique(asArray(record.data.sundayDates)).length, 0),
    attendanceCells: legacyAttendance.cells,
    markedAttendance: legacyAttendance.marked,
    attendanceMarks: { PP: legacyAttendance.PP, P: legacyAttendance.P, A: legacyAttendance.A, unmarked: legacyAttendance.cells - legacyAttendance.marked },
    teacherSessions: (byKind.sessions || []).length,
    userProfiles: (byKind.userProfiles || []).length,
    authUsers: authUsers.length,
    settings: (byKind.settings || []).length,
    unknownEbdDocuments: (byKind.unknownEbd || []).length,
  }

  report.counts.projected = Object.fromEntries(
    Object.entries(groupBy(report.documentsToCreate, (item) => item.type)).map(([type, items]) => [type, items.length]),
  )
  report.assumptions.push(`Horário padrão de aulas sem horário explícito: ${options.defaultLessonStartTime || '18:30'} por ${options.defaultLessonDurationMinutes || 50} minutos.`)
  report.assumptions.push('Células vazias da matriz de presença são preservadas como status unmarked.')
  report.assumptions.push('Cadernetas distintas nunca são eliminadas automaticamente, mesmo quando parecem duplicadas.')
  report.limitations.push('Regras de negócio sobre matrícula simultânea em várias classes ainda dependem de decisão administrativa.')
  report.limitations.push('O legado não informa com precisão o período de todas as matrículas; termos sintéticos são apenas propostas.')
  report.limitations.push('Sessões docentes sem monitoringRegisterId podem permanecer ambíguas quando há várias classes na mesma data.')
  report.limitations.push('O dry run não valida regras Firestore publicadas nem disponibilidade de índices; ele apenas propõe dados e índices.')
  report.limitations.push('Coleções ebd_* conhecidas são encontradas por collectionGroup mesmo sem documento pai; uma coleção ebd_* desconhecida sob UID ausente simultaneamente de users e Auth não pode ser descoberta pela API genérica do Firestore.')
  if ((byKind.unknownEbd || []).length) {
    report.limitations.push(`${(byKind.unknownEbd || []).length} documento(s) em coleções ebd_* desconhecidas não possuem mapeamento automático.`)
    ;(byKind.unknownEbd || []).forEach((record) => review('unknown-ebd-collection', [record.path], 'Coleção ebd_* não reconhecida pelo migrador.', { collection: record.collection }))
  }

  report.documentsToCreate.forEach((document) => {
    document.sourcePaths.forEach((sourcePath) => {
      if (!report.mappings.some((item) => item.sourcePath === sourcePath && item.targetPath === document.path)) {
        addMapping(sourcePath, document.path, document.confidence, document.data?.legacy?.reviewReasons || [])
      }
    })
  })

  report.documentsToCreate.sort((left, right) => left.path.localeCompare(right.path))
  report.mappings.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath) || left.targetPath.localeCompare(right.targetPath))
  report.manualReview.sort((left, right) => left.type.localeCompare(right.type) || left.id.localeCompare(right.id))
  return report
}
