import test from 'node:test'
import assert from 'node:assert/strict'

import {
  belongsToTeacherRecord,
  canAccessAttendanceRegister,
  isRegisterVisibleToTeacher,
} from '../../src/utils/accessControl.js'

const vitor = {
  user: { uid: 'auth-vitor', email: 'vcavrelli95@gmail.com', displayName: 'Vitor Cabrelli' },
  profile: { id: 'teacher-vitor', email: 'vcavrelli95@gmail.com', displayName: 'Vitor Cabrelli' },
}

const fabiana = {
  user: { uid: 'auth-fabiana', email: 'fabiana@example.com', displayName: 'Fabiana' },
  profile: {
    uid: 'auth-fabiana',
    linkedTeacherId: 'teacher-fabiana',
    email: 'fabiana@example.com',
    displayName: 'Fabiana',
  },
}

test('Vitor encontra a propria caderneta pelo UID mesmo quando o nome cadastrado diverge', () => {
  const register = { teacherAuthUid: 'auth-vitor', teacherName: 'Vitor Cavrelli' }
  assert.equal(canAccessAttendanceRegister(register, vitor.user, vitor.profile), true)
})

test('Fabiana encontra a propria caderneta pelo ID canonico do professor', () => {
  const register = { teacherId: 'teacher-fabiana', teacherName: 'Fabiana de Souza' }
  assert.equal(isRegisterVisibleToTeacher(fabiana.user, register, fabiana.profile), true)
})

test('professor legado encontra a caderneta por e-mail normalizado', () => {
  const user = { uid: 'auth-ok', email: 'professor@example.com', displayName: 'Professor Atual' }
  const profile = { id: 'teacher-ok', email: 'PROFESSOR@example.com' }
  const register = { teacherEmail: 'professor@example.com' }
  assert.equal(belongsToTeacherRecord(register, user, profile), true)
})

test('nome exibido igual nao concede acesso sem UID, ID ou e-mail correspondente', () => {
  const otherUser = { uid: 'auth-other', email: 'outra@example.com', displayName: 'Fabiana' }
  const otherProfile = { id: 'teacher-other', email: 'outra@example.com', displayName: 'Fabiana' }
  const register = { teacherAuthUid: 'auth-fabiana', teacherEmail: 'fabiana@example.com', teacherName: 'Fabiana' }
  assert.equal(canAccessAttendanceRegister(register, otherUser, otherProfile), false)
})

test('professor nao acessa caderneta vinculada a outro professor', () => {
  const register = { teacherAuthUid: 'auth-fabiana', teacherId: 'teacher-fabiana', teacherEmail: 'fabiana@example.com' }
  assert.equal(canAccessAttendanceRegister(register, vitor.user, vitor.profile), false)
})
