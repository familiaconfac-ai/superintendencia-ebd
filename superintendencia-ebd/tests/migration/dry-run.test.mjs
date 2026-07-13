import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { readFirebaseSnapshot } from '../../scripts/migration/adapters/firebase-admin-readonly.mjs'
import { runDryRun } from '../../scripts/migration/dry-run.mjs'
import { renderMarkdownReport } from '../../scripts/migration/report.mjs'

const fixtureUrl = new URL('./fixtures/legacy-snapshot.json', import.meta.url)
const schemaUrl = new URL('../../docs/architecture/target-data-model.schema.json', import.meta.url)

async function fixture() {
  return JSON.parse(await readFile(fixtureUrl, 'utf8'))
}

async function report() {
  return runDryRun(await fixture(), {
    churchId: 'church-test',
    church: { id: 'church-test', name: 'Igreja de Teste' },
    runAt: '2026-07-13T15:00:00.000Z',
    runId: 'test-run-001',
  })
}

test('dry run mantém garantias de somente leitura e não altera o snapshot', async () => {
  const input = await fixture()
  const before = JSON.stringify(input)
  const result = runDryRun(input, { churchId: 'church-test', runAt: '2026-07-13T15:00:00.000Z', runId: 'test-run-001' })

  assert.equal(result.metadata.mode, 'dry-run')
  assert.equal(result.metadata.writesPerformed, 0)
  assert.equal(result.metadata.authChangesPerformed, 0)
  assert.equal(result.metadata.deletesPerformed, 0)
  assert.equal(JSON.stringify(input), before)
})

test('consolida pessoa/professor somente quando a evidência é segura', async () => {
  const result = await report()
  const joaoPeople = result.documentsToCreate.filter((item) => item.type === 'person' && item.data.normalizedEmail === 'joao@igreja.test')
  const lucasPeople = result.documentsToCreate.filter((item) => item.type === 'person' && item.data.normalizedName === 'lucas souza')

  assert.equal(joaoPeople.length, 1)
  assert.equal(joaoPeople[0].sourcePaths.length, 2)
  assert.equal(lucasPeople.length, 2)
  assert.ok(result.manualReview.some((item) => item.type === 'ambiguous-person-match' && item.reason.includes('Nome igual')))
})

test('e-mail compartilhado com nomes diferentes não é fundido automaticamente', async () => {
  const result = await report()
  const shared = result.documentsToCreate.filter((item) => item.type === 'person' && item.data.normalizedEmail === 'compartilhado@igreja.test')

  assert.equal(shared.length, 2)
  assert.ok(result.duplicates.emails.some((item) => item.email === 'compartilhado@igreja.test'))
  assert.ok(result.matches.probable.some((item) => item.reason.includes('Mesmo e-mail')))
})

test('conta Auth órfã e usuário Firestore sem Auth aparecem no relatório', async () => {
  const result = await report()

  assert.ok(result.orphans.authAccounts.some((item) => item.uid === 'orphan-auth-uid'))
  assert.ok(result.orphans.firestoreUsersWithoutAuth.some((item) => item.uid === 'firestore-only-uid'))
})

test('expande cadernetas em períodos, aulas e células de presença preservando vazios', async () => {
  const result = await report()

  assert.equal(result.counts.legacy.registers, 3)
  assert.equal(result.counts.legacy.lessonsFromRegisterDates, 5)
  assert.equal(result.counts.legacy.attendanceCells, 7)
  assert.deepEqual(result.counts.legacy.attendanceMarks, { PP: 2, P: 2, A: 2, unmarked: 1 })
  assert.equal(result.counts.projected.lesson, 5)
  assert.ok(result.documentsToCreate.some((item) => item.type === 'attendance' && item.data.status === 'unmarked'))
  assert.ok(result.documentsToCreate.some((item) => item.type === 'attendance' && item.data.participationType === 'teacher'))
})

test('detecta caderneta duplicada, classe ausente, classe sem professor e sessão ambígua', async () => {
  const result = await report()

  assert.ok(result.duplicates.registers.length >= 1)
  assert.ok(result.orphans.registersWithoutClass.some((item) => item.path.endsWith('register-no-class')))
  assert.ok(result.orphans.classesWithoutTeacher.some((item) => item.name === 'Visitantes'))
  assert.ok(result.manualReview.some((item) => item.type === 'unresolved-teacher-session'))
})

test('relatório Markdown contém todas as seções administrativas exigidas', async () => {
  const markdown = renderMarkdownReport(await report())

  for (const heading of [
    'Totais por proprietário legado',
    'Correspondências seguras',
    'Correspondências prováveis',
    'Casos ambíguos',
    'Contas órfãs do Firebase Auth',
    'Pessoas sem matrícula',
    'Professores sem designação',
    'Classes sem professor',
    'Cadernetas sem classe inequívoca',
    'Inconsistências entre matrícula, classe e caderneta',
    'Documentos que seriam criados',
  ]) {
    assert.match(markdown, new RegExp(heading))
  }
})

test('adaptador Firebase real é bloqueado antes de carregar credenciais ou SDK', async () => {
  await assert.rejects(
    () => readFirebaseSnapshot({ confirmRealRead: false }),
    /Leitura real bloqueada/,
  )
})

test('JSON Schema contém os dez contratos formais', async () => {
  const schema = JSON.parse(await readFile(schemaUrl, 'utf8'))
  const requiredDefinitions = ['user', 'church', 'person', 'class', 'classTerm', 'enrollment', 'teacherAssignment', 'lesson', 'attendance', 'setting']

  assert.deepEqual(requiredDefinitions.filter((name) => !schema.$defs[name]), [])
  assert.deepEqual(schema.$defs.user.properties.roles.items.$ref, '#/$defs/role')
  assert.ok(schema.$defs.attendance.required.includes('participationType'))
})

test('todos os documentos projetados respeitam campos obrigatórios e propriedades declaradas', async () => {
  const schema = JSON.parse(await readFile(schemaUrl, 'utf8'))
  const result = await report()
  const definitionByType = {
    user: 'user',
    church: 'church',
    person: 'person',
    class: 'class',
    classTerm: 'classTerm',
    enrollment: 'enrollment',
    teacherAssignment: 'teacherAssignment',
    lesson: 'lesson',
    attendance: 'attendance',
    setting: 'setting',
  }

  for (const document of result.documentsToCreate) {
    const definition = schema.$defs[definitionByType[document.type]]
    assert.ok(definition, `Tipo sem schema: ${document.type}`)
    for (const required of definition.required) {
      assert.notEqual(document.data[required], undefined, `${document.path} sem ${required}`)
      assert.notEqual(document.data[required], null, `${document.path} com ${required} nulo`)
    }
    const unexpected = Object.keys(document.data).filter((field) => !definition.properties[field])
    assert.deepEqual(unexpected, [], `${document.path} possui campos não declarados: ${unexpected.join(', ')}`)
  }
})
