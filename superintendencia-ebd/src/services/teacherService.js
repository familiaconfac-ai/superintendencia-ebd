import { collection, getDocs, query, where, updateDoc, doc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { IS_MOCK_MODE } from '../firebase/mockMode'
import { listEbdDocuments, saveEbdDocument, softToggleEbdDocument, removeEbdDocument } from './ebdDataService'
import { listPeople, savePerson } from './peopleService'

const BUCKET = 'teachers'

function normalizeTeacherEmail(email = '') {
  return (email || '').trim().toLowerCase()
}

function normalizeTeacherName(name = '') {
  return String(name || '').trim().toLowerCase()
}

function mergeTeacherRoles(existingRoles = []) {
  const nextRoles = Array.isArray(existingRoles) ? [...existingRoles] : []
  if (!nextRoles.includes('teacher')) nextRoles.push('teacher')
  return nextRoles
}

function findMatchingPerson(people = [], teacher = null) {
  if (!teacher?.fullName?.trim()) return null

  const teacherEmail = normalizeTeacherEmail(teacher.email)
  const teacherName = teacher.fullName.trim()
  const teacherUid = getTeacherLinkedUid(teacher)

  return people.find((person) => {
    if (!person) return false

    if (teacherUid && person.authUid && person.authUid === teacherUid) return true
    if (teacherEmail && normalizeTeacherEmail(person.email) === teacherEmail) return true
    return normalizeTeacherName(person.fullName) === normalizeTeacherName(teacherName)
  }) || null
}

function buildTeacherAsPerson(teacher = null, matchedPerson = null, teacherId = '') {
  const teacherEmail = normalizeTeacherEmail(teacher?.email)
  const teacherName = teacher?.fullName?.trim() || ''
  const teacherUid = getTeacherLinkedUid(teacher)

  return {
    id: matchedPerson?.id || teacherId || teacher?.id || '',
    fullName: matchedPerson?.fullName || teacherName,
    email: matchedPerson?.email || teacherEmail,
    phone: matchedPerson?.phone || (teacher?.phone || '').trim(),
    birthDate: matchedPerson?.birthDate || '',
    churchStatus: matchedPerson?.churchStatus || 'member',
    notes: matchedPerson?.notes || (teacher?.notes || '').trim(),
    active: matchedPerson?.active !== false && teacher?.active !== false,
    classId: matchedPerson?.classId || '',
    authUid: matchedPerson?.authUid || teacherUid || '',
    roles: mergeTeacherRoles(matchedPerson?.roles),
    linkedTeacherId: matchedPerson?.linkedTeacherId || teacherId || teacher?.id || '',
  }
}

export function mergeTeachersIntoPeopleList(people = [], teachers = []) {
  const merged = Array.isArray(people) ? [...people] : []

  ;(teachers || []).forEach((teacher) => {
    if (!teacher?.fullName?.trim()) return

    const matchedPerson = findMatchingPerson(merged, teacher)
    const teacherAsPerson = buildTeacherAsPerson(teacher, matchedPerson, teacher?.id || '')

    if (matchedPerson) {
      const index = merged.findIndex((item) => item?.id === matchedPerson.id)
      if (index >= 0) {
        merged[index] = { ...matchedPerson, ...teacherAsPerson, id: matchedPerson.id }
      }
      return
    }

    if (teacherAsPerson.id) {
      merged.push(teacherAsPerson)
    }
  })

  return merged
}

async function ensureTeacherPersonRecord(adminUid, teacher = null, teacherId = '') {
  if (!adminUid || !teacher?.fullName?.trim()) return

  const allPeople = await listPeople(adminUid)
  const matchedPerson = findMatchingPerson(allPeople, teacher)
  const nextPayload = buildTeacherAsPerson(teacher, matchedPerson, teacherId)

  await savePerson(adminUid, nextPayload, matchedPerson?.id || teacherId || null)
}

export async function syncTeachersIntoPeople(adminUid, teachers = []) {
  if (!adminUid || !Array.isArray(teachers) || teachers.length === 0) return

  for (const teacher of teachers) {
    await ensureTeacherPersonRecord(adminUid, teacher, teacher?.id || '')
  }
}

export function getTeacherLinkedUid(teacher = null) {
  return teacher?.uid || teacher?.authUid || teacher?.teacherAuthUid || teacher?.userUid || teacher?.ownerUid || ''
}

async function persistTeacherUid(adminUid, teacherId, resolvedUid) {
  if (!adminUid || !teacherId || !resolvedUid || IS_MOCK_MODE || !db) return

  const docPath = `users/${adminUid}/ebd_teachers/${teacherId}`
  updateDoc(doc(db, docPath), { uid: resolvedUid, authUid: resolvedUid }).catch((e) => {
    // eslint-disable-next-line no-console
    console.warn('[TEACHER_SYNC_DEBUG] Falha ao persistir UID no Firestore (em-memoria OK):', docPath, e?.message)
  })
}

export function listTeachers(uid) {
  return listEbdDocuments(uid, BUCKET).then((teachers) => {
    if (typeof window !== 'undefined' && window.location && window.location.href && window.location.href.includes('helton')) {
      // eslint-disable-next-line no-console
      console.log('[DIAG_HELTON][TEACHERS] listTeachers:', teachers)
    }
    return teachers
  })
}

export async function saveTeacher(uid, payload, id = null) {
  const savedTeacherId = await saveEbdDocument(uid, BUCKET, payload, id)
  await ensureTeacherPersonRecord(uid, payload, id || savedTeacherId)
  return savedTeacherId
}

export function toggleTeacherStatus(uid, id, active) {
  return softToggleEbdDocument(uid, BUCKET, id, active)
}

export function removeTeacher(uid, id) {
  return removeEbdDocument(uid, BUCKET, id)
}

export async function resolveTeacherLink(adminUid, teacher = null) {
  const teacherEmail = normalizeTeacherEmail(teacher?.email)
  const linkedUid = getTeacherLinkedUid(teacher)

  if (linkedUid || !teacherEmail || IS_MOCK_MODE || !db) {
    return {
      teacherEmail,
      teacherAuthUid: linkedUid,
      teacherUid: linkedUid,
      teacherUserUid: linkedUid,
      resolvedFrom: linkedUid ? 'document' : 'missing',
    }
  }

  try {
    const snap = await getDocs(query(collection(db, 'users'), where('email', '==', teacherEmail)))
    if (!snap.empty) {
      const userDoc = snap.docs[0]
      const userData = userDoc.data()
      const resolvedUid = userData?.uid || userDoc.id

      await persistTeacherUid(adminUid, teacher?.id, resolvedUid)

      return {
        teacherEmail,
        teacherAuthUid: resolvedUid,
        teacherUid: resolvedUid,
        teacherUserUid: resolvedUid,
        resolvedFrom: 'users-email',
      }
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[TEACHER_SYNC_DEBUG] Erro ao resolver UID do professor por email:', teacherEmail, e?.message)
  }

  return {
    teacherEmail,
    teacherAuthUid: '',
    teacherUid: '',
    teacherUserUid: '',
    resolvedFrom: 'missing',
  }
}

/**
 * Para cada professor em ebd_teachers que nao possui uid/authUid,
 * busca o uid correspondente na colecao `users` pelo email
 * e grava de volta no documento do professor.
 * Retorna a lista de professores com UIDs atualizados na memoria.
 */
export async function syncTeacherUidsFromUsers(adminUid, teachers = []) {
  if (IS_MOCK_MODE || !db) return teachers

  const needsSync = teachers.filter((t) => {
    const hasUid = getTeacherLinkedUid(t)
    return !hasUid && t?.email
  })

  if (needsSync.length === 0) {
    // eslint-disable-next-line no-console
    console.log('[TEACHER_SYNC_DEBUG] Todos os professores ja possuem UID. Nenhuma sincronizacao necessaria.')
    return teachers
  }

  // eslint-disable-next-line no-console
  console.log('[TEACHER_SYNC_DEBUG] Professores sem UID para sincronizar:', needsSync.map((t) => ({ id: t.id, email: t.email, name: t.fullName })))

  const updatedMap = {}

  for (const teacher of needsSync) {
    const email = normalizeTeacherEmail(teacher.email)
    if (!email) continue

    try {
      const snap = await getDocs(query(collection(db, 'users'), where('email', '==', email)))
      if (!snap.empty) {
        const userDoc = snap.docs[0]
        const userData = userDoc.data()
        const resolvedUid = userData?.uid || userDoc.id

        // eslint-disable-next-line no-console
        console.log('[TEACHER_SYNC_DEBUG] Correspondencia encontrada:', {
          teacherId: teacher.id,
          teacherName: teacher.fullName,
          teacherEmail: email,
          userDocId: userDoc.id,
          resolvedUid,
        })

        updatedMap[teacher.id] = resolvedUid
        await persistTeacherUid(adminUid, teacher.id, resolvedUid)
        await ensureTeacherPersonRecord(adminUid, {
          ...teacher,
          uid: resolvedUid,
          authUid: resolvedUid,
        }, teacher.id)
      } else {
        // eslint-disable-next-line no-console
        console.log('[TEACHER_SYNC_DEBUG] Nenhum user encontrado para email:', email, '- professor ainda sem UID.')
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[TEACHER_SYNC_DEBUG] Erro ao buscar user por email:', email, e?.message)
    }
  }

  return teachers.map((t) => {
    if (updatedMap[t.id]) {
      return { ...t, uid: updatedMap[t.id], authUid: updatedMap[t.id] }
    }
    return t
  })
}
