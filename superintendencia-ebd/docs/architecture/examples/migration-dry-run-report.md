# Relatório do migrador EBD — dry run

## Segurança da execução

| Propriedade | Valor |
|---|---|
| Run ID | dry-20260713150000-939528e4 |
| Gerado em | 2026-07-13T15:00:00.000Z |
| Origem | automated-test-fixture |
| Igreja de destino | church-test |
| Gravações no Firestore | **0** |
| Alterações no Firebase Auth | **0** |
| Exclusões | **0** |

## Totais legados

| Item | Total |
| --- | --- |
| people | 5 |
| teachers | 3 |
| classes | 2 |
| enrollments | 2 |
| registers | 3 |
| lessonsFromRegisterDates | 5 |
| attendanceCells | 7 |
| markedAttendance | 6 |
| attendanceMarks | {"PP":2,"P":2,"A":2,"unmarked":1} |
| teacherSessions | 2 |
| userProfiles | 3 |
| authUsers | 3 |
| settings | 1 |
| unknownEbdDocuments | 1 |

## Totais projetados

| Item | Total |
| --- | --- |
| church | 1 |
| person | 8 |
| class | 3 |
| classTerm | 4 |
| teacherAssignment | 2 |
| lesson | 5 |
| attendance | 8 |
| enrollment | 5 |
| setting | 1 |
| user | 2 |

## Totais por coleção de origem

| Coleção | Total |
| --- | --- |
| userProfiles | 3 |
| ebd_people | 5 |
| ebd_teachers | 3 |
| ebd_classes | 2 |
| ebd_enrollments | 2 |
| ebd_attendanceRegisters | 3 |
| ebd_lessonSessions | 2 |
| ebd_unknown | 1 |
| ebdSystemSettings | 1 |

## Totais por proprietário legado

| UID proprietário | Coleção | Total |
| --- | --- | --- |
| admin-auth-uid | userProfiles | 1 |
| admin-auth-uid | ebd_people | 5 |
| admin-auth-uid | ebd_teachers | 3 |
| admin-auth-uid | ebd_classes | 2 |
| admin-auth-uid | ebd_enrollments | 2 |
| admin-auth-uid | ebd_attendanceRegisters | 3 |
| admin-auth-uid | ebd_unknown | 1 |
| teacher-auth-uid | userProfiles | 1 |
| teacher-auth-uid | ebd_lessonSessions | 1 |
| firestore-only-uid | userProfiles | 1 |
| unknown-teacher-uid | ebd_lessonSessions | 1 |

## Correspondências seguras

| Origem A | Origem B | Motivo |
| --- | --- | --- |
| users/admin-auth-uid/ebd_people/teacher-joao | users/admin-auth-uid/ebd_teachers/teacher-joao | Mesmo authUid explícito. |

## Correspondências prováveis

| Origem A | Origem B | Motivo |
| --- | --- | --- |
| users/admin-auth-uid/ebd_people/shared-maria | users/admin-auth-uid/ebd_teachers/shared-marcos | Mesmo e-mail, mas nomes diferentes. |

## Casos ambíguos

| Origem | Relacionado | Motivo |
| --- | --- | --- |
| users/admin-auth-uid/ebd_people/lucas-student | users/admin-auth-uid/ebd_teachers/lucas-teacher | Nome igual sem outro identificador seguro. |
| shared-email | users/admin-auth-uid/ebd_teachers/shared-marcos | E-mail compartilhado por registros com nomes diferentes. |

## Revisão manual

| Tipo | Documentos de origem | Motivo |
| --- | --- | --- |
| ambiguous-person-match | users/admin-auth-uid/ebd_people/lucas-student, users/admin-auth-uid/ebd_teachers/lucas-teacher | Nome igual sem outro identificador seguro. |
| ambiguous-person-match | users/admin-auth-uid/ebd_people/shared-maria, users/admin-auth-uid/ebd_teachers/shared-marcos | E-mail compartilhado por registros com nomes diferentes. |
| class-assignment-period-ambiguous | users/admin-auth-uid/ebd_classes/class-adultos | Professor padrão da classe não possui período inequívoco. |
| duplicate-enrollment | users/admin-auth-uid/ebd_enrollments/enrollment-ana, users/admin-auth-uid/ebd_enrollments/enrollment-ana-duplicate | Matrículas legadas com mesma pessoa, classe e data. |
| duplicate-register | users/admin-auth-uid/ebd_attendanceRegisters/register-q1, users/admin-auth-uid/ebd_attendanceRegisters/register-q1-copy | Cadernetas com assinatura estrutural idêntica. |
| inferred-enrollment | users/admin-auth-uid/ebd_attendanceRegisters/register-q1-copy | Matrícula foi inferida da caderneta. |
| inferred-enrollment | users/admin-auth-uid/ebd_attendanceRegisters/register-no-class | Matrícula foi inferida da caderneta. |
| inferred-enrollment | users/admin-auth-uid/ebd_attendanceRegisters/register-q1 | Matrícula foi inferida da caderneta. |
| inferred-enrollment | users/admin-auth-uid/ebd_attendanceRegisters/register-q1 | Matrícula foi inferida da caderneta. |
| orphan-auth-account |  | Conta Auth sem pessoa vinculada com evidência segura. |
| orphan-auth-account | users/firestore-only-uid | Conta Auth sem pessoa vinculada com evidência segura. |
| placeholder-class | users/admin-auth-uid/ebd_attendanceRegisters/register-no-class | Classe ausente ou ambígua. |
| placeholder-person | users/admin-auth-uid/ebd_attendanceRegisters/register-no-class | Aluno presente na caderneta sem cadastro canônico correspondente. |
| probable-person-match | users/admin-auth-uid/ebd_people/shared-maria, users/admin-auth-uid/ebd_teachers/shared-marcos | Mesmo e-mail, mas nomes diferentes. |
| synthetic-class-term | users/admin-auth-uid/ebd_enrollments/enrollment-ana | Período da matrícula precisa de definição administrativa. |
| unknown-ebd-collection | users/admin-auth-uid/ebd_unknown/custom-1 | Coleção ebd_* não reconhecida pelo migrador. |
| unresolved-teacher-session | users/unknown-teacher-uid/ebd_lessonSessions/2026-01-11_1830_50 | Sessão docente sem pessoa canônica inequívoca. |

## Contas órfãs do Firebase Auth

| UID | E-mail | Nome | Confiança |
| --- | --- | --- | --- |
| orphan-auth-uid | orfao@igreja.test | Conta Órfã | unmatched |

## Pessoas sem matrícula

| Person ID | Nome | Origens |
| --- | --- | --- |
| admin-person | Administrador | users/admin-auth-uid/ebd_people/admin-person |
| shared-maria | Maria Silva | users/admin-auth-uid/ebd_people/shared-maria |
| lucas-student | Lucas Souza | users/admin-auth-uid/ebd_people/lucas-student |
| shared-marcos | Marcos Silva | users/admin-auth-uid/ebd_teachers/shared-marcos |
| lucas-teacher | Lucas Souza | users/admin-auth-uid/ebd_teachers/lucas-teacher |

## Professores sem designação

| Person ID | Nome |
| --- | --- |
| shared-marcos | Marcos Silva |
| lucas-teacher | Lucas Souza |

## Classes sem professor

| Class ID | Nome |
| --- | --- |
| class-sem-professor | Visitantes |
| placeholder-class-0309ad30d69a8823 | Classe apagada |

## Cadernetas sem classe inequívoca

| Caderneta | Class ID legado | Class ID proposto |
| --- | --- | --- |
| users/admin-auth-uid/ebd_attendanceRegisters/register-no-class |  | placeholder-class-0309ad30d69a8823 |

## Inconsistências entre matrícula, classe e caderneta

| Tipo | Detalhes |
| --- | --- |
| class-membership-mismatch | {"type":"class-membership-mismatch","classPath":"users/admin-auth-uid/ebd_classes/class-adultos","classId":"class-adultos","onlyInClassStudentIds":["teacher-joao"],"onlyInExplicitEnrollments":[],"onlyInRegisters":[]} |
| conflicting-enrollments | {"type":"conflicting-enrollments","signature":"admin-auth-uid:student-ana:class-adultos:2026-01-04","paths":["users/admin-auth-uid/ebd_enrollments/enrollment-ana","users/admin-auth-uid/ebd_enrollments/enrollment-ana-duplicate"]} |
| duplicate-registers | {"type":"duplicate-registers","signature":"8da3ae25956ccaff6197e8427846a048","paths":["users/admin-auth-uid/ebd_attendanceRegisters/register-q1","users/admin-auth-uid/ebd_attendanceRegisters/register-q1-copy"]} |
| unresolved-session | {"type":"unresolved-session","sessionPath":"users/unknown-teacher-uid/ebd_lessonSessions/2026-01-11_1830_50","status":"manual-review","reason":"Sessão docente sem pessoa canônica inequívoca."} |

## Duplicidades

### Nomes de pessoas

| Nome normalizado | Person IDs |
| --- | --- |
| lucas souza | lucas-student, lucas-teacher |

### E-mails

| E-mail | Person IDs |
| --- | --- |
| compartilhado@igreja.test | shared-maria, shared-marcos |

### Matrículas

| Assinatura | Documentos |
| --- | --- |
| admin-auth-uid:student-ana:class-adultos:2026-01-04 | users/admin-auth-uid/ebd_enrollments/enrollment-ana, users/admin-auth-uid/ebd_enrollments/enrollment-ana-duplicate |

### Cadernetas

| Assinatura | Documentos |
| --- | --- |
| 8da3ae25956ccaff6197e8427846a048 | users/admin-auth-uid/ebd_attendanceRegisters/register-q1, users/admin-auth-uid/ebd_attendanceRegisters/register-q1-copy |

### Sessões docentes

_Nenhum._

## Documentos que seriam criados

| Tipo | Caminho de destino | Confiança | Fontes |
| --- | --- | --- | --- |
| church | churches/church-test | safe | 0 |
| attendance | churches/church-test/attendance/attendance-0c5fb10787a76b79 | ambiguous | 1 |
| attendance | churches/church-test/attendance/attendance-47053ed0b7e43bd3 | safe | 1 |
| attendance | churches/church-test/attendance/attendance-4b3651399a3676f5 | safe | 1 |
| attendance | churches/church-test/attendance/attendance-608c5f638ffc8308 | safe | 1 |
| attendance | churches/church-test/attendance/attendance-77bddcaa4dd4350c | safe | 1 |
| attendance | churches/church-test/attendance/attendance-8f9c84c50c96f269 | safe | 1 |
| attendance | churches/church-test/attendance/attendance-93fd5da0a966e385 | safe | 1 |
| attendance | churches/church-test/attendance/attendance-f56572d33f1b38ae | safe | 1 |
| class | churches/church-test/classes/class-adultos | safe | 1 |
| class | churches/church-test/classes/class-sem-professor | safe | 1 |
| class | churches/church-test/classes/placeholder-class-0309ad30d69a8823 | ambiguous | 1 |
| classTerm | churches/church-test/classTerms/synthetic-term-7848fda47ea625e6 | ambiguous | 1 |
| classTerm | churches/church-test/classTerms/term-72ff353b2df32559 | safe | 1 |
| classTerm | churches/church-test/classTerms/term-a7a55f5f6bd273dd | safe | 1 |
| classTerm | churches/church-test/classTerms/term-bbcbdc475d059f28 | ambiguous | 1 |
| enrollment | churches/church-test/enrollments/enrollment-204f76e3b1e6df2e | ambiguous | 1 |
| enrollment | churches/church-test/enrollments/enrollment-4323f4a931856dac | probable | 1 |
| enrollment | churches/church-test/enrollments/enrollment-5114d0a83f559741 | probable | 1 |
| enrollment | churches/church-test/enrollments/enrollment-ana | ambiguous | 1 |
| enrollment | churches/church-test/enrollments/enrollment-e80733c12cd8e7e0 | probable | 1 |
| lesson | churches/church-test/lessons/lesson-102e3bd9a327de50 | safe | 1 |
| lesson | churches/church-test/lessons/lesson-1887f3ca84b65367 | safe | 1 |
| lesson | churches/church-test/lessons/lesson-bb9fda696ef06a2a | safe | 1 |
| lesson | churches/church-test/lessons/lesson-dcd6adad3724f6ed | ambiguous | 1 |
| lesson | churches/church-test/lessons/lesson-f4022eb0e35b5bfc | safe | 2 |
| person | churches/church-test/people/admin-person | safe | 1 |
| person | churches/church-test/people/lucas-student | ambiguous | 1 |
| person | churches/church-test/people/lucas-teacher | ambiguous | 1 |
| person | churches/church-test/people/placeholder-person-ddaae890717a6954 | ambiguous | 1 |
| person | churches/church-test/people/shared-marcos | ambiguous | 1 |
| person | churches/church-test/people/shared-maria | ambiguous | 1 |
| person | churches/church-test/people/student-ana | safe | 1 |
| person | churches/church-test/people/teacher-joao | safe | 2 |
| setting | churches/church-test/settings/communication | safe | 1 |
| teacherAssignment | churches/church-test/teacherAssignments/assignment-21b1e52ed7111eea | safe | 1 |
| teacherAssignment | churches/church-test/teacherAssignments/assignment-5cf3c461c9956ba9 | safe | 1 |
| user | users/admin-auth-uid | safe | 1 |
| user | users/teacher-auth-uid | safe | 1 |

## Mapeamento origem → destino

| Origem | Destino | Confiança | Observações |
| --- | --- | --- | --- |
| ebdSystemSettings/communication | churches/church-test/settings/communication | safe |  |
| users/admin-auth-uid | users/admin-auth-uid | safe |  |
| users/admin-auth-uid/ebd_attendanceRegisters/register-no-class | churches/church-test/attendance/attendance-0c5fb10787a76b79 | ambiguous | Pessoa da presença não foi resolvida com evidência segura. |
| users/admin-auth-uid/ebd_attendanceRegisters/register-no-class | churches/church-test/classes/placeholder-class-0309ad30d69a8823 | ambiguous | Classe referenciada não foi localizada de forma inequívoca. |
| users/admin-auth-uid/ebd_attendanceRegisters/register-no-class | churches/church-test/classTerms/term-bbcbdc475d059f28 | ambiguous | Classe da caderneta não foi resolvida com evidência segura. |
| users/admin-auth-uid/ebd_attendanceRegisters/register-no-class | churches/church-test/enrollments/enrollment-204f76e3b1e6df2e | ambiguous | Matrícula inferida de enrolledStudentIds/studentsSnapshot/attendanceByStudent. |
| users/admin-auth-uid/ebd_attendanceRegisters/register-no-class | churches/church-test/lessons/lesson-dcd6adad3724f6ed | ambiguous | Horário da aula veio do padrão global, pois a caderneta não o armazena. |
| users/admin-auth-uid/ebd_attendanceRegisters/register-no-class | churches/church-test/people/placeholder-person-ddaae890717a6954 | ambiguous | Aluno presente na caderneta sem cadastro canônico correspondente. |
| users/admin-auth-uid/ebd_attendanceRegisters/register-q1 | churches/church-test/attendance/attendance-47053ed0b7e43bd3 | safe |  |
| users/admin-auth-uid/ebd_attendanceRegisters/register-q1 | churches/church-test/attendance/attendance-608c5f638ffc8308 | safe |  |
| users/admin-auth-uid/ebd_attendanceRegisters/register-q1 | churches/church-test/attendance/attendance-8f9c84c50c96f269 | safe |  |
| users/admin-auth-uid/ebd_attendanceRegisters/register-q1 | churches/church-test/attendance/attendance-93fd5da0a966e385 | safe |  |
| users/admin-auth-uid/ebd_attendanceRegisters/register-q1 | churches/church-test/classTerms/term-a7a55f5f6bd273dd | safe |  |
| users/admin-auth-uid/ebd_attendanceRegisters/register-q1 | churches/church-test/enrollments/enrollment-4323f4a931856dac | probable | Matrícula inferida de enrolledStudentIds/studentsSnapshot/attendanceByStudent. |
| users/admin-auth-uid/ebd_attendanceRegisters/register-q1 | churches/church-test/enrollments/enrollment-e80733c12cd8e7e0 | probable | Matrícula inferida de enrolledStudentIds/studentsSnapshot/attendanceByStudent. |
| users/admin-auth-uid/ebd_attendanceRegisters/register-q1 | churches/church-test/lessons/lesson-102e3bd9a327de50 | safe | Horário da aula veio do padrão global, pois a caderneta não o armazena. |
| users/admin-auth-uid/ebd_attendanceRegisters/register-q1 | churches/church-test/lessons/lesson-f4022eb0e35b5bfc | safe | Horário da aula veio do padrão global, pois a caderneta não o armazena. |
| users/admin-auth-uid/ebd_attendanceRegisters/register-q1 | churches/church-test/teacherAssignments/assignment-5cf3c461c9956ba9 | safe |  |
| users/admin-auth-uid/ebd_attendanceRegisters/register-q1-copy | churches/church-test/attendance/attendance-77bddcaa4dd4350c | safe |  |
| users/admin-auth-uid/ebd_attendanceRegisters/register-q1-copy | churches/church-test/attendance/attendance-f56572d33f1b38ae | safe |  |
| users/admin-auth-uid/ebd_attendanceRegisters/register-q1-copy | churches/church-test/classTerms/term-72ff353b2df32559 | safe |  |
| users/admin-auth-uid/ebd_attendanceRegisters/register-q1-copy | churches/church-test/enrollments/enrollment-5114d0a83f559741 | probable | Matrícula inferida de enrolledStudentIds/studentsSnapshot/attendanceByStudent. |
| users/admin-auth-uid/ebd_attendanceRegisters/register-q1-copy | churches/church-test/lessons/lesson-1887f3ca84b65367 | safe | Horário da aula veio do padrão global, pois a caderneta não o armazena. |
| users/admin-auth-uid/ebd_attendanceRegisters/register-q1-copy | churches/church-test/lessons/lesson-bb9fda696ef06a2a | safe | Horário da aula veio do padrão global, pois a caderneta não o armazena. |
| users/admin-auth-uid/ebd_attendanceRegisters/register-q1-copy | churches/church-test/teacherAssignments/assignment-21b1e52ed7111eea | safe |  |
| users/admin-auth-uid/ebd_classes/class-adultos | churches/church-test/classes/class-adultos | safe |  |
| users/admin-auth-uid/ebd_classes/class-sem-professor | churches/church-test/classes/class-sem-professor | safe |  |
| users/admin-auth-uid/ebd_enrollments/enrollment-ana | churches/church-test/classTerms/synthetic-term-7848fda47ea625e6 | ambiguous | Matrícula não pôde ser vinculada a um período existente de forma inequívoca. |
| users/admin-auth-uid/ebd_enrollments/enrollment-ana | churches/church-test/enrollments/enrollment-ana | ambiguous |  |
| users/admin-auth-uid/ebd_enrollments/enrollment-ana-duplicate | churches/church-test/enrollments/enrollment-ana | ambiguous |  |
| users/admin-auth-uid/ebd_people/admin-person | churches/church-test/people/admin-person | safe |  |
| users/admin-auth-uid/ebd_people/lucas-student | churches/church-test/people/lucas-student | ambiguous | Nome igual sem outro identificador seguro. |
| users/admin-auth-uid/ebd_people/shared-maria | churches/church-test/people/shared-maria | ambiguous | E-mail compartilhado por registros com nomes diferentes.; Mesmo e-mail, mas nomes diferentes. |
| users/admin-auth-uid/ebd_people/student-ana | churches/church-test/people/student-ana | safe |  |
| users/admin-auth-uid/ebd_people/teacher-joao | churches/church-test/people/teacher-joao | safe |  |
| users/admin-auth-uid/ebd_teachers/lucas-teacher | churches/church-test/people/lucas-teacher | ambiguous | Nome igual sem outro identificador seguro. |
| users/admin-auth-uid/ebd_teachers/shared-marcos | churches/church-test/people/shared-marcos | ambiguous | E-mail compartilhado por registros com nomes diferentes.; Mesmo e-mail, mas nomes diferentes. |
| users/admin-auth-uid/ebd_teachers/teacher-joao | churches/church-test/people/teacher-joao | safe |  |
| users/teacher-auth-uid | users/teacher-auth-uid | safe |  |
| users/teacher-auth-uid/ebd_lessonSessions/2026-01-04_1830_50 | churches/church-test/attendance/attendance-4b3651399a3676f5 | safe |  |
| users/teacher-auth-uid/ebd_lessonSessions/2026-01-04_1830_50 | churches/church-test/lessons/lesson-f4022eb0e35b5bfc | safe | Horário da aula veio do padrão global, pois a caderneta não o armazena. |

## Premissas

- Horário padrão de aulas sem horário explícito: 18:30 por 50 minutos.
- Células vazias da matriz de presença são preservadas como status unmarked.
- Cadernetas distintas nunca são eliminadas automaticamente, mesmo quando parecem duplicadas.

## Limitações conhecidas

- Regras de negócio sobre matrícula simultânea em várias classes ainda dependem de decisão administrativa.
- O legado não informa com precisão o período de todas as matrículas; termos sintéticos são apenas propostas.
- Sessões docentes sem monitoringRegisterId podem permanecer ambíguas quando há várias classes na mesma data.
- O dry run não valida regras Firestore publicadas nem disponibilidade de índices; ele apenas propõe dados e índices.
- Coleções ebd_* conhecidas são encontradas por collectionGroup mesmo sem documento pai; uma coleção ebd_* desconhecida sob UID ausente simultaneamente de users e Auth não pode ser descoberta pela API genérica do Firestore.
- 1 documento(s) em coleções ebd_* desconhecidas não possuem mapeamento automático.

