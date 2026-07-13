function escapeCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

function table(headers, rows) {
  if (!rows.length) return '_Nenhum._\n'
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(escapeCell).join(' | ')} |`),
    '',
  ].join('\n')
}

function countTable(value = {}) {
  return table(['Item', 'Total'], Object.entries(value).map(([key, count]) => [key, typeof count === 'object' ? JSON.stringify(count) : count]))
}

function listSection(items, render) {
  if (!items.length) return '_Nenhum._\n'
  return `${items.map((item) => `- ${render(item)}`).join('\n')}\n`
}

export function renderMarkdownReport(report) {
  const owners = Object.entries(report.sourceSummary.totalsByOwner || {}).flatMap(([ownerUid, collections]) => (
    Object.entries(collections).map(([collection, total]) => [ownerUid, collection, total])
  ))
  const sourceCollections = Object.entries(report.sourceSummary.totalsByCollection || {}).map(([collection, total]) => [collection, total])
  const documents = report.documentsToCreate.map((item) => [item.type, item.path, item.confidence, item.sourcePaths.length])
  const mappings = report.mappings.map((item) => [item.sourcePath, item.targetPath, item.confidence, item.reasons.join('; ')])
  const manual = report.manualReview.map((item) => [item.type, item.sourcePaths.join(', '), item.reason])

  return `# Relatório do migrador EBD — dry run

## Segurança da execução

| Propriedade | Valor |
|---|---|
| Run ID | ${escapeCell(report.metadata.runId)} |
| Gerado em | ${escapeCell(report.metadata.generatedAt)} |
| Origem | ${escapeCell(report.metadata.source)} |
| Igreja de destino | ${escapeCell(report.metadata.churchId)} |
| Gravações no Firestore | **${report.metadata.writesPerformed}** |
| Alterações no Firebase Auth | **${report.metadata.authChangesPerformed}** |
| Exclusões | **${report.metadata.deletesPerformed}** |

## Totais legados

${countTable(report.counts.legacy)}
## Totais projetados

${countTable(report.counts.projected)}
## Totais por coleção de origem

${table(['Coleção', 'Total'], sourceCollections)}
## Totais por proprietário legado

${table(['UID proprietário', 'Coleção', 'Total'], owners)}
## Correspondências seguras

${table(['Origem A', 'Origem B', 'Motivo'], report.matches.safe.map((item) => [item.leftPath || item.type, item.rightPath || (item.paths || []).join(', '), item.reason]))}
## Correspondências prováveis

${table(['Origem A', 'Origem B', 'Motivo'], report.matches.probable.map((item) => [item.leftPath || item.type, item.rightPath || (item.paths || []).join(', '), item.reason]))}
## Casos ambíguos

${table(['Origem', 'Relacionado', 'Motivo'], report.matches.ambiguous.map((item) => [item.leftPath || item.type || (item.paths || [])[0], item.rightPath || (item.paths || []).slice(1).join(', '), item.reason]))}
## Revisão manual

${table(['Tipo', 'Documentos de origem', 'Motivo'], manual)}
## Contas órfãs do Firebase Auth

${table(['UID', 'E-mail', 'Nome', 'Confiança'], report.orphans.authAccounts.map((item) => [item.uid, item.email, item.displayName, item.confidence]))}
## Pessoas sem matrícula

${table(['Person ID', 'Nome', 'Origens'], report.orphans.peopleWithoutEnrollment.map((item) => [item.personId, item.fullName, item.sourcePaths.join(', ')]))}
## Professores sem designação

${table(['Person ID', 'Nome'], report.orphans.teachersWithoutAssignment.map((item) => [item.personId, item.fullName]))}
## Classes sem professor

${table(['Class ID', 'Nome'], report.orphans.classesWithoutTeacher.map((item) => [item.classId, item.name]))}
## Cadernetas sem classe inequívoca

${table(['Caderneta', 'Class ID legado', 'Class ID proposto'], report.orphans.registersWithoutClass.map((item) => [item.path, item.legacyClassId, item.proposedClassId]))}
## Inconsistências entre matrícula, classe e caderneta

${table(['Tipo', 'Detalhes'], report.inconsistencies.map((item) => [item.type, JSON.stringify(item)]))}
## Duplicidades

### Nomes de pessoas

${table(['Nome normalizado', 'Person IDs'], report.duplicates.peopleNames.map((item) => [item.normalizedName, item.personIds.join(', ')]))}
### E-mails

${table(['E-mail', 'Person IDs'], report.duplicates.emails.map((item) => [item.email, item.personIds.join(', ')]))}
### Matrículas

${table(['Assinatura', 'Documentos'], report.duplicates.enrollments.map((item) => [item.signature, item.paths.join(', ')]))}
### Cadernetas

${table(['Assinatura', 'Documentos'], report.duplicates.registers.map((item) => [item.signature, item.paths.join(', ')]))}
### Sessões docentes

${table(['Assinatura', 'Documentos'], report.duplicates.sessions.map((item) => [item.signature, item.paths.join(', ')]))}
## Documentos que seriam criados

${table(['Tipo', 'Caminho de destino', 'Confiança', 'Fontes'], documents)}
## Mapeamento origem → destino

${table(['Origem', 'Destino', 'Confiança', 'Observações'], mappings)}
## Premissas

${listSection(report.assumptions, (item) => item)}
## Limitações conhecidas

${listSection(report.limitations, (item) => item)}
`
}
