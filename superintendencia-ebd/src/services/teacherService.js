import { collection, getDocs, query, where, updateDoc, doc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { IS_MOCK_MODE } from '../firebase/mockMode'
import { listEbdDocuments, saveEbdDocument, softToggleEbdDocument, removeEbdDocument } from './ebdDataService'

const BUCKET = 'teachers'

export function listTeachers(uid) {
  return listEbdDocuments(uid, BUCKET).then((teachers) => {
    if (typeof window !== 'undefined' && window.location && window.location.href && window.location.href.includes('helton')) {
      // eslint-disable-next-line no-console
      console.log('[DIAG_HELTON][TEACHERS] listTeachers:', teachers)
    }
    return teachers
  })
}

export function saveTeacher(uid, payload, id = null) {
  return saveEbdDocument(uid, BUCKET, payload, id)
}

export function toggleTeacherStatus(uid, id, active) {
  return softToggleEbdDocument(uid, BUCKET, id, active)
}

export function removeTeacher(uid, id) {
  return removeEbdDocument(uid, BUCKET, id)
}

/**
 * Para cada professor em ebd_teachers que não possui uid/authUid,
 * busca o uid correspondente na coleção `users` pelo email
 * e grava de volta no documento do professor.
 * Retorna a lista de professores com UIDs atualizados na memória.
 */
export async function syncTeacherUidsFromUsers(adminUid, teachers = []) {
  if (IS_MOCK_MODE || !db) return teachers

  const needsSync = teachers.filter((t) => {
    const hasUid = t?.uid || t?.authUid || t?.teacherAuthUid || t?.userUid || t?.ownerUid
    return !hasUid && t?.email
  })

  if (needsSync.length === 0) {
    // eslint-disable-next-line no-console
    console.log('[TEACHER_SYNC_DEBUG] Todos os professores já possuem UID. Nenhuma sincronização necessária.')
    return teachers
  }

  // eslint-disable-next-line no-console
  console.log('[TEACHER_SYNC_DEBUG] Professores sem UID para sincronizar:', needsSync.map((t) => ({ id: t.id, email: t.email, name: t.fullName })))

  const updatedMap = {}

  for (const teacher of needsSync) {
    const email = (teacher.email || '').trim().toLowerCase()
    if (!email) continue

    try {
      const snap = await getDocs(query(collection(db, 'users'), where('email', '==', email)))
      if (!snap.empty) {
        const userDoc = snap.docs[0]
        const userData = userDoc.data()
        const resolvedUid = userData?.uid || userDoc.id

        // eslint-disable-next-line no-console
        console.log('[TEACHER_SYNC_DEBUG] Correspondência encontrada:', {
          teacherId: teacher.id,
          teacherName: teacher.fullName,
          teacherEmail: email,
          userDocId: userDoc.id,
          resolvedUid,
        })

        // Patch in-memory first — always succeeds
        updatedMap[teacher.id] = resolvedUid

        // Then try Firestore — failure here does NOT break in-memory result
        const docPath = `users/${adminUid}/ebd_teachers/${teacher.id}`
        updateDoc(doc(db, docPath), { uid: resolvedUid, authUid: resolvedUid }).catch((e) => {
          // eslint-disable-next-line no-console
          console.warn('[TEACHER_SYNC_DEBUG] Falha ao persistir UID no Firestore (em-memória OK):', docPath, e?.message)
        })
      } else {
        // eslint-disable-next-line no-console
        console.log('[TEACHER_SYNC_DEBUG] Nenhum user encontrado para email:', email, '— professor ainda sem UID.')
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[TEACHER_SYNC_DEBUG] Erro ao buscar user por email:', email, e?.message)
    }
  }

  // Always return patched list regardless of Firestore write outcome
  return teachers.map((t) => {
    if (updatedMap[t.id]) {
      return { ...t, uid: updatedMap[t.id], authUid: updatedMap[t.id] }
    }
    return t
  })
}
