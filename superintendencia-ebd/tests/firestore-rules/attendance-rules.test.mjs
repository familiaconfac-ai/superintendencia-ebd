import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  collectionGroup,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'

const PROJECT_ID = 'demo-ebd-attendance'
const CHURCH_EMAIL = 'igrejabatistaolimpia@gmail.com'
const OWNER_UID = 'admin-owner'
const VITOR_UID = 'vitor-auth-uid'
const FABIANA_UID = 'fabiana-auth-uid'
const CANONICAL_UID = 'canonical-auth-uid'
const SUPERINTENDENT_UID = 'superintendent-auth-uid'
const UNLINKED_UID = 'unlinked-auth-uid'

let testEnv

function authedDb(uid, email) {
  return testEnv.authenticatedContext(uid, { email, email_verified: true }).firestore()
}

function registerRef(db, id) {
  return doc(db, `users/${OWNER_UID}/ebd_attendanceRegisters/${id}`)
}

function teacherRef(db, id) {
  return doc(db, `users/${OWNER_UID}/ebd_teachers/${id}`)
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8'),
    },
  })

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    await Promise.all([
      setDoc(doc(db, `users/${OWNER_UID}`), {
        uid: OWNER_UID,
        email: CHURCH_EMAIL,
        role: 'admin',
        active: true,
      }),
      setDoc(doc(db, `users/${SUPERINTENDENT_UID}`), {
        uid: SUPERINTENDENT_UID,
        email: 'superintendencia@example.com',
        role: 'superintendente',
        active: true,
      }),
      setDoc(doc(db, `users/${CANONICAL_UID}`), {
        uid: CANONICAL_UID,
        email: 'canonical@example.com',
        role: 'teacher',
        active: true,
        linkedTeacherId: 'teacher-canonical',
      }),
      setDoc(registerRef(db, 'vitor-register'), {
        ownerUid: VITOR_UID,
        teacherId: 'teacher-vitor',
        teacherAuthUid: VITOR_UID,
        teacherUid: VITOR_UID,
        teacherUserUid: VITOR_UID,
        teacherEmail: 'vitor@example.com',
        classId: 'class-vitor',
        studentsSnapshot: [{ id: 'student-v1', fullName: 'Aluno Vitor' }],
        attendanceByStudent: { 'student-v1': { '2026-08-02': 'P' } },
      }),
      setDoc(registerRef(db, 'fabiana-register'), {
        ownerUid: FABIANA_UID,
        teacherId: 'teacher-fabiana',
        teacherAuthUid: FABIANA_UID,
        teacherUid: FABIANA_UID,
        teacherUserUid: FABIANA_UID,
        teacherEmail: 'fabiana@example.com',
        classId: 'class-fabiana',
        studentsSnapshot: [{ id: 'student-f1', fullName: 'Aluno Fabiana' }],
        attendanceByStudent: { 'student-f1': { '2026-08-02': 'A' } },
      }),
      setDoc(registerRef(db, 'canonical-register'), {
        teacherId: 'teacher-canonical',
        teacherEmail: 'legacy-address@example.com',
        classId: 'class-vitor',
        studentsSnapshot: [],
        attendanceByStudent: {},
      }),
      setDoc(doc(db, `users/${OWNER_UID}/ebd_classes/class-vitor`), { name: 'Classe Vitor' }),
      setDoc(teacherRef(db, 'teacher-vitor'), { fullName: 'Professor Vitor', active: true }),
      setDoc(doc(db, `users/${OWNER_UID}/ebd_people/student-v1`), { fullName: 'Aluno Vitor' }),
      setDoc(doc(db, `users/${OWNER_UID}/ebd_enrollments/enrollment-v1`), {
        classId: 'class-vitor',
        personId: 'student-v1',
        status: 'active',
      }),
      setDoc(doc(db, `users/${VITOR_UID}/ebd_lessonSessions/session-vitor`), {
        teacherUid: VITOR_UID,
        updatedAt: new Date('2026-08-02T12:00:00Z'),
      }),
    ])
  })
})

after(async () => {
  await testEnv?.cleanup()
})

test('administrador da igreja le todas as cadernetas para dashboard e relatorios', async () => {
  const db = authedDb(OWNER_UID, CHURCH_EMAIL)
  const snapshot = await assertSucceeds(getDocs(collectionGroup(db, 'ebd_attendanceRegisters')))
  assert.equal(snapshot.size, 3)
})

test('perfil superintendente armazenado no usuario preserva acesso administrativo', async () => {
  const db = authedDb(SUPERINTENDENT_UID, 'superintendencia@example.com')
  const snapshot = await assertSucceeds(getDocs(collectionGroup(db, 'ebd_attendanceRegisters')))
  assert.equal(snapshot.size, 3)
})

test('professor consulta e abre somente a propria caderneta por UID', async () => {
  const db = authedDb(VITOR_UID, 'vitor@example.com')
  const ownQuery = query(
    collectionGroup(db, 'ebd_attendanceRegisters'),
    where('teacherAuthUid', '==', VITOR_UID),
  )
  const snapshot = await assertSucceeds(getDocs(ownQuery))
  assert.deepEqual(snapshot.docs.map((item) => item.id), ['vitor-register'])
  await assertSucceeds(getDoc(registerRef(db, 'vitor-register')))
})

test('professor nao le caderneta de outro professor', async () => {
  const db = authedDb(VITOR_UID, 'vitor@example.com')
  await assertFails(getDoc(registerRef(db, 'fabiana-register')))
})

test('professor consulta caderneta legada pelo ID canonico administrado', async () => {
  const db = authedDb(CANONICAL_UID, 'canonical@example.com')
  const ownQuery = query(
    collectionGroup(db, 'ebd_attendanceRegisters'),
    where('teacherId', '==', 'teacher-canonical'),
  )
  const snapshot = await assertSucceeds(getDocs(ownQuery))
  assert.deepEqual(snapshot.docs.map((item) => item.id), ['canonical-register'])
  await assertFails(getDoc(registerRef(db, 'vitor-register')))
})

test('usuario nao pode atribuir a si mesmo um ID canonico de professor', async () => {
  const uid = 'self-link-attempt'
  const db = authedDb(uid, 'self-link@example.com')
  await assertFails(setDoc(doc(db, `users/${uid}`), {
    uid,
    email: 'self-link@example.com',
    role: 'teacher',
    linkedTeacherId: 'teacher-vitor',
  }))
})

test('usuario autenticado sem vinculo recebe permissao negada', async () => {
  const db = authedDb(UNLINKED_UID, 'sem-vinculo@example.com')
  await assertFails(getDoc(registerRef(db, 'vitor-register')))
})

test('professor salva presenca e auditoria sem alterar o vinculo', async () => {
  const db = authedDb(VITOR_UID, 'vitor@example.com')
  await assertSucceeds(updateDoc(registerRef(db, 'vitor-register'), {
    'attendanceByStudent.student-v1.2026-08-02': 'PP',
    studentStatuses: { 'student-v1': { enrollmentStatus: 'active' } },
    auditTrail: [{ action: 'attendance-save', actor: { uid: VITOR_UID } }],
  }))
  const saved = await getDoc(registerRef(db, 'vitor-register'))
  assert.equal(saved.data().attendanceByStudent['student-v1']['2026-08-02'], 'PP')
  assert.equal(saved.data().teacherAuthUid, VITOR_UID)
})

test('professor nao altera nem remove campos de vinculo', async () => {
  const db = authedDb(VITOR_UID, 'vitor@example.com')
  await assertFails(updateDoc(registerRef(db, 'vitor-register'), {
    teacherAuthUid: FABIANA_UID,
  }))
  await assertFails(updateDoc(registerRef(db, 'vitor-register'), {
    teacherUid: deleteField(),
  }))
})

test('professor le turmas, alunos e matriculas necessarios para a chamada', async () => {
  const db = authedDb(VITOR_UID, 'vitor@example.com')
  await assertSucceeds(getDoc(doc(db, `users/${OWNER_UID}/ebd_classes/class-vitor`)))
  await assertSucceeds(getDoc(doc(db, `users/${OWNER_UID}/ebd_people/student-v1`)))
  await assertSucceeds(getDoc(doc(db, `users/${OWNER_UID}/ebd_enrollments/enrollment-v1`)))
})

test('administrador acessa sessoes globais usadas pelos relatorios', async () => {
  const db = authedDb(OWNER_UID, CHURCH_EMAIL)
  const snapshot = await assertSucceeds(getDocs(collectionGroup(db, 'ebd_lessonSessions')))
  assert.equal(snapshot.size, 1)
})

test('usuario nao autenticado nao acessa dados da EBD', async () => {
  const db = testEnv.unauthenticatedContext().firestore()
  await assertFails(getDoc(registerRef(db, 'vitor-register')))
  await assertFails(getDoc(doc(db, `users/${OWNER_UID}/ebd_classes/class-vitor`)))
})

test('administrador e superintendente podem arquivar professor', async () => {
  await assertSucceeds(updateDoc(teacherRef(authedDb(OWNER_UID, CHURCH_EMAIL), 'teacher-vitor'), {
    active: false,
  }))
  await assertSucceeds(updateDoc(teacherRef(authedDb(SUPERINTENDENT_UID, 'superintendencia@example.com'), 'teacher-vitor'), {
    active: false,
  }))
})

test('professor nao pode alterar o status de outro perfil de professor', async () => {
  await assertFails(updateDoc(teacherRef(authedDb(VITOR_UID, 'vitor@example.com'), 'teacher-vitor'), {
    active: false,
  }))
})

test('nenhum perfil pode excluir definitivamente um professor', async () => {
  await assertFails(deleteDoc(teacherRef(authedDb(OWNER_UID, CHURCH_EMAIL), 'teacher-vitor')))
  await assertFails(deleteDoc(teacherRef(authedDb(SUPERINTENDENT_UID, 'superintendencia@example.com'), 'teacher-vitor')))
})
