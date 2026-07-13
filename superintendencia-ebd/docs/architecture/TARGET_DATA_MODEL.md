# Especificação formal do modelo canônico da EBD

Status: aprovado para especificação e dry run. Este documento não autoriza gravação no Firebase real.

O contrato executável está em [`target-data-model.schema.json`](./target-data-model.schema.json), no padrão JSON Schema 2020-12. Todos os documentos rejeitam propriedades desconhecidas (`additionalProperties: false`), exceto objetos deliberadamente extensíveis como `settings.value`, endereços e trilhas históricas.

Os índices compostos propostos também estão disponíveis em formato importável, sem alterar o arquivo atualmente publicado: [`proposed-firestore.indexes.json`](./proposed-firestore.indexes.json).

## Convenções globais

- IDs são strings não vazias sem `/`.
- Datas civis usam `YYYY-MM-DD`; instantes usam ISO-8601 `date-time`.
- E-mails são gravados em minúsculas em `normalizedEmail`.
- Nomes para busca/deduplicação usam `normalizedName`: trim, minúsculas e sem diacríticos.
- Telefones para reconciliação usam somente dígitos em `normalizedPhone`.
- Exclusão operacional é lógica por status. Exclusão física requer processo administrativo separado.
- `createdBy` e `updatedBy` recebem UID do ator; em migração recebem `migration:{runId}`.
- `legacy` é temporário e somente para rastreabilidade da migração. Não é fonte operacional após o corte.
- Referências são IDs dentro da mesma igreja; o `churchId` vem do caminho e não é repetido nos documentos subordinados.

## Auditoria comum

Todos os documentos possuem:

| Campo | Tipo | Obrigatório | Regra |
|---|---|---:|---|
| `createdAt` | date-time | sim | Imutável após criação |
| `createdBy` | string | sim | UID ou ator de sistema |
| `updatedAt` | date-time | sim | Atualizado a cada mudança |
| `updatedBy` | string | sim | UID ou ator de sistema |
| `revision` | integer >= 1 | não | Controle otimista/auditoria |
| `legacy` | object | não | Metadados temporários da migração |

`legacy` pode conter `migrationVersion`, `migrationRunId`, `sourceRefs[]`, campos não mapeados e motivos de revisão. Cada `sourceRef` guarda caminho, coleção, ID, proprietário legado e hash do documento.

## `users/{uid}`

Responsabilidade exclusiva: identidade de acesso e autorização. Não contém cadastro pessoal, matrícula ou designação.

| Campo | Tipo | Obrigatório | Valores/semântica |
|---|---|---:|---|
| `churchId` | documentId | sim | Igreja padrão atual |
| `personId` | documentId | sim | Referência a `churches/{churchId}/people/{personId}` |
| `email` | email | sim | Deve coincidir com Firebase Auth |
| `roles` | role[] única | sim | Pelo menos um papel |
| `accessStatus` | enum | sim | `pending`, `active`, `disabled`, `revoked` |
| `lastLoginAt` | date-time | não | Último login conhecido |
| `disabledAt` | date-time | não | Obrigatório semanticamente quando desabilitado/revogado |
| `disabledReason` | string | não | Justificativa administrativa |
| `authProvider` | enum | não | `password`, `google`, `phone`, `other` |

Papéis permitidos: `churchAdmin`, `teacher`, `reportsViewer`, `attendanceManager`.

`teacher` autoriza o uso da área docente, mas não substitui `teacherAssignments`. Encerrar uma designação não revoga automaticamente o login.

Índices:

- `churchId ASC, accessStatus ASC`
- `churchId ASC, roles ARRAY_CONTAINS, accessStatus ASC`
- `churchId ASC, personId ASC` — deve ser verificado como único pela aplicação/backend.

## `churches/{churchId}`

| Campo | Tipo | Obrigatório | Valores/semântica |
|---|---|---:|---|
| `name` | string | sim | Nome de exibição |
| `normalizedName` | string | sim | Busca/deduplicação |
| `status` | enum | sim | `active`, `inactive` |
| `timezone` | string | sim | Ex.: `America/Sao_Paulo` |
| `locale` | string | sim | Ex.: `pt-BR` |
| `legalName` | string | não | Razão/nome legal |
| `email` | email | não | Contato institucional |
| `phone` | string | não | Contato institucional |
| `address` | object | não | Endereço estruturado |
| `geoPoint` | `{lat,lng}` | não | Local usado por check-in |

Índice: `status ASC, normalizedName ASC` somente se houver consulta entre igrejas por backend administrativo.

## `churches/{churchId}/people/{personId}`

Cadastro canônico de alunos, professores e administradores, inclusive pessoas sem login.

| Campo | Tipo | Obrigatório | Valores/semântica |
|---|---|---:|---|
| `fullName` | string | sim | Nome canônico |
| `normalizedName` | string | sim | Busca/reconciliação |
| `email` | email ou null | não | Contato, não identidade de autorização |
| `normalizedEmail` | email ou null | não | Busca/reconciliação |
| `phone` | string ou null | não | Contato |
| `normalizedPhone` | string ou null | não | Somente dígitos |
| `birthDate` | date ou null | não | Data civil |
| `churchStatus` | enum | sim | `member`, `attendee`, `visitor`, `unknown` |
| `status` | enum | sim | `active`, `inactive`, `deceased`, `transferred` |
| `notes` | string | não | Observações |
| `dataQuality` | enum | não | `verified`, `complete`, `incomplete`, `ambiguous` |

Não são permitidos `classId`, `authUid`, `roles` ou estado docente neste documento.

Índices:

- `status ASC, normalizedName ASC`
- `normalizedEmail ASC, status ASC`
- `churchStatus ASC, status ASC, normalizedName ASC`
- `normalizedPhone ASC, normalizedName ASC` para auditoria de duplicidade.

## `churches/{churchId}/classes/{classId}`

Entidade duradoura da classe, independente de trimestre e professor.

| Campo | Tipo | Obrigatório | Valores/semântica |
|---|---|---:|---|
| `name` | string | sim | Nome da classe |
| `normalizedName` | string | sim | Busca/deduplicação |
| `department` | string | não | Adultos, Jovens, Infantil etc. |
| `description` | string | não | Descrição permanente |
| `status` | enum | sim | `active`, `inactive`, `archived` |

Não contém `studentIds` nem professor padrão.

Índices:

- `status ASC, normalizedName ASC`
- `department ASC, status ASC, normalizedName ASC`

## `churches/{churchId}/classTerms/{classTermId}`

Oferta temporal de uma classe; substitui a parte estrutural da caderneta trimestral.

| Campo | Tipo | Obrigatório | Valores/semântica |
|---|---|---:|---|
| `classId` | documentId | sim | Referência a `classes/{classId}` |
| `name` | string | sim | Ex.: `1º trimestre de 2026` |
| `discipline` | string | não | Disciplina/tema do período |
| `periodType` | enum | não | `weekly`, `monthly`, `quarterly`, `semester`, `annual`, `custom` |
| `startDate` | date | sim | Início inclusivo |
| `endDate` | date | sim | Fim inclusivo, >= início |
| `status` | enum | sim | `planned`, `active`, `completed`, `cancelled`, `archived` |
| `auditTrail` | object[] | não | Trilha legada da caderneta |

Índices:

- `classId ASC, startDate DESC`
- `status ASC, startDate DESC`
- `classId ASC, status ASC, startDate DESC`

## `churches/{churchId}/enrollments/{enrollmentId}`

Relaciona uma pessoa a uma classe/oferta. A mesma pessoa pode ter várias matrículas históricas e simultâneas.

| Campo | Tipo | Obrigatório | Valores/semântica |
|---|---|---:|---|
| `personId` | documentId | sim | Referência a `people/{personId}` |
| `classId` | documentId | sim | Referência a `classes/{classId}` |
| `classTermId` | documentId | sim | Referência a `classTerms/{classTermId}` |
| `startDate` | date | sim | Início inclusivo |
| `endDate` | date ou null | não | Fim inclusivo; null enquanto aberta |
| `status` | enum | sim | `pending`, `active`, `inactive`, `completed`, `cancelled`, `transferred` |
| `statusHistory` | history[] | sim | Histórico cronológico completo |
| `inactivationReason` | string | não | Motivo operacional |
| `notes` | string | não | Observações |

Uma pessoa pode estar matriculada em mais de uma classe quando os períodos ou regras administrativas permitirem. Conflito não é definido apenas por quantidade, mas por sobreposição de datas e política da igreja.

Índices:

- `classTermId ASC, status ASC, personId ASC`
- `classId ASC, status ASC, startDate DESC`
- `personId ASC, status ASC, startDate DESC`
- `personId ASC, classTermId ASC, status ASC`

## `churches/{churchId}/teacherAssignments/{assignmentId}`

Designação temporal de uma pessoa para ensinar. Não controla o estado da pessoa nem do acesso.

| Campo | Tipo | Obrigatório | Valores/semântica |
|---|---|---:|---|
| `personId` | documentId | sim | Referência a `people/{personId}` |
| `classId` | documentId | sim | Referência a `classes/{classId}` |
| `classTermId` | documentId | sim | Referência a `classTerms/{classTermId}` |
| `role` | enum | sim | `leadTeacher`, `assistantTeacher`, `substituteTeacher` |
| `startDate` | date | sim | Início inclusivo |
| `endDate` | date ou null | não | Fim inclusivo |
| `status` | enum | sim | `planned`, `active`, `inactive`, `completed`, `cancelled` |
| `statusHistory` | history[] | sim | Histórico cronológico |
| `notes` | string | não | Observações |

Índices:

- `classTermId ASC, status ASC, role ASC`
- `classId ASC, status ASC, startDate DESC`
- `personId ASC, status ASC, startDate DESC`
- `personId ASC, classTermId ASC, status ASC`

## `churches/{churchId}/lessons/{lessonId}`

Encontro concreto de uma oferta de classe.

| Campo | Tipo | Obrigatório | Valores/semântica |
|---|---|---:|---|
| `classId` | documentId | sim | Referência a `classes/{classId}` |
| `classTermId` | documentId | sim | Referência a `classTerms/{classTermId}` |
| `date` | date | sim | Data civil na igreja |
| `startTime` | HH:mm | sim | Horário local |
| `endTime` | HH:mm | sim | Horário local |
| `title` | string | não | Título da aula |
| `topic` | string | não | Tema/conteúdo |
| `status` | enum | sim | `planned`, `open`, `completed`, `cancelled` |
| `openedAt` | date-time | não | Abertura efetiva |
| `endedAt` | date-time | não | Encerramento efetivo |
| `warningTriggeredAt` | date-time | não | Auditoria do alerta |
| `endAlertTriggeredAt` | date-time | não | Auditoria do alarme final |

Índices:

- `classTermId ASC, date ASC, startTime ASC`
- `classId ASC, date DESC`
- `date DESC, status ASC`
- `status ASC, date ASC`

A unicidade lógica é `classTermId + date + startTime`; deve ser garantida pelo ID determinístico/backend.

## `churches/{churchId}/attendance/{attendanceId}`

Um registro por pessoa, aula e tipo de participação. A mesma pessoa pode ter participação `teacher` e `student` na mesma data sem colisão.

| Campo | Tipo | Obrigatório | Valores/semântica |
|---|---|---:|---|
| `lessonId` | documentId | sim | Referência a `lessons/{lessonId}` |
| `classId` | documentId | sim | Referência a `classes/{classId}` |
| `classTermId` | documentId | sim | Referência a `classTerms/{classTermId}` |
| `personId` | documentId | sim | Referência a `people/{personId}` |
| `participationType` | enum | sim | `student`, `teacher` |
| `enrollmentId` | documentId ou null | não | Necessário para participação estudantil quando conhecido |
| `assignmentId` | documentId ou null | não | Necessário para participação docente quando conhecido |
| `status` | enum | sim | `unmarked`, `punctual`, `present`, `absent`, `excused` |
| `legacyMark` | enum | não | `PP`, `P`, `A`, vazio ou null |
| `recordedAt` | date-time | sim | Instante de criação/migração do registro |
| `recordedBy` | string | não | UID do ator |
| `checkInAt` | date-time | não | Check-in docente |
| `punctualityOk` | boolean | não | Pontualidade docente |
| `checkInStatus` | enum | não | `confirmed`, `outside_radius`, `permission_denied`, `gps_unavailable`, `not_required` |
| `geoPoint` | `{lat,lng}` | não | Evidência do check-in |
| `distanceMeters` | number >= 0 | não | Distância calculada |
| `locationCheckedAt` | date-time | não | Instante da leitura GPS |
| `notes` | string | não | Observações |
| `auditTrail` | object[] | não | Trilha da caderneta/sessão |

Índices:

- `lessonId ASC, participationType ASC, personId ASC`
- `classTermId ASC, personId ASC, participationType ASC`
- `personId ASC, participationType ASC, lessonId ASC`
- `classId ASC, lessonId ASC, status ASC`
- `assignmentId ASC, lessonId DESC`
- `enrollmentId ASC, lessonId DESC`

A unicidade lógica é `lessonId + personId + participationType`.

## `churches/{churchId}/settings/{settingId}`

| Campo | Tipo | Obrigatório | Valores/semântica |
|---|---|---:|---|
| `type` | enum | sim | `communication`, `lessonSchedule`, `attendancePolicy`, `notifications`, `general` |
| `schemaVersion` | integer >= 1 | sim | Versão do payload |
| `value` | object | sim | Configuração tipada pela aplicação conforme `type/schemaVersion` |

Índice: `type ASC, schemaVersion DESC` somente se forem mantidas várias versões por tipo. Com IDs determinísticos (`communication`, `lessonSchedule` etc.), leitura direta dispensa índice composto.

## Regras de reconciliação

### Evidências seguras — consolidação automática

1. Mesmo `authUid` não vazio, sem `authUid` conflitante e sem divergência forte de nome/data de nascimento.
2. `people.linkedTeacherId === teacher.id` no mesmo proprietário legado.
3. Mesmo ID em `ebd_people` e `ebd_teachers` no mesmo proprietário, com nome ou e-mail compatível.
4. Mesmo e-mail normalizado e mesmo nome normalizado, sem outro registro concorrente com o mesmo e-mail.

### Evidências prováveis — não consolidar no dry run

1. Mesmo e-mail, mas nomes diferentes ou incompletos.
2. Mesmo nome e mesmo telefone.
3. Mesmo nome e mesma data de nascimento.
4. Conta Auth e uma única pessoa com o mesmo e-mail, mas sem `authUid` explícito.

Todos os casos prováveis são exibidos em `probableMatches` e `manualReview`.

### Casos ambíguos — revisão obrigatória

- Nome igual sem outro identificador.
- E-mail compartilhado por mais de uma pessoa canônica candidata.
- Mesmo `authUid` associado a registros com dados pessoais incompatíveis.
- Registros sem e-mail e sem telefone/data de nascimento.
- Professor sem `authUid` que só coincide por nome.
- Conta Auth sem vínculo explícito ou e-mail único.
- Sessão docente que coincide com mais de uma aula na mesma data.

### Regras por cenário

| Cenário | Ação do dry run |
|---|---|
| Pessoa em `ebd_people` e `ebd_teachers` | Consolida apenas com evidência segura; `people` prevalece e professor preenche campos vazios |
| Mesmo e-mail | Consolida somente se nome também coincidir e não houver concorrentes; caso contrário revisa |
| Sem e-mail | Usa `authUid`, IDs vinculados, telefone+nome ou nascimento+nome; nunca nome isolado |
| Nomes iguais | Não consolida automaticamente |
| Professor com `authUid` | Vincula à conta Auth de mesmo UID e à pessoa segura |
| Professor sem `authUid` | E-mail único é provável; nome isolado é ambíguo |
| Conta Auth sem pessoa | Relata como órfã; não cria pessoa silenciosamente |
| Pessoa em várias classes | Preserva todas as matrículas; sinaliza apenas sobreposição proibida pela política |
| Matrículas conflitantes | Preserva documentos e sinaliza mesma pessoa/oferta com estados ou períodos incompatíveis |
| Cadernetas duplicadas | Compara classe, período, disciplina, datas e professor; não descarta nenhuma |
| Sessão sem classe inequívoca | Não gera presença docente operacional; cria sugestão e revisão manual |

## Política de precedência de campos pessoais

1. `ebd_people` verificado/mais completo.
2. `ebd_people` comum.
3. `ebd_teachers` para preencher campos vazios.
4. Firebase Auth apenas para e-mail/displayName quando não houver valor canônico.
5. Snapshots de caderneta somente para criar placeholder incompleto e preservar presença órfã.

Valores divergentes nunca são sobrescritos silenciosamente; são guardados em `legacy.unmapped` e no relatório.

## Restrições de execução do migrador

- O modo padrão lê um snapshot JSON local.
- O modo Firebase exige `--source firebase --confirm-real-read` e credenciais Admin somente de leitura operacional.
- Não há chamadas `set`, `update`, `create`, `delete`, `batch`, importação de usuários ou alteração do Auth.
- O adaptador Firebase chama apenas listagem/leitura de documentos e `listUsers`.
- Nenhuma execução contra Firebase real está autorizada por este documento.
