#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { readFirebaseSnapshot } from './adapters/firebase-admin-readonly.mjs'
import { readSnapshot } from './adapters/snapshot.mjs'
import { runDryRun } from './dry-run.mjs'
import { renderMarkdownReport } from './report.mjs'

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (!value.startsWith('--')) continue
    const key = value.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) args[key] = true
    else {
      args[key] = next
      index += 1
    }
  }
  return args
}

function printHelp() {
  process.stdout.write(`Migrador EBD em modo dry run\n\n`)
  process.stdout.write(`Snapshot local (padrão seguro):\n`)
  process.stdout.write(`  npm run migration:dry-run -- --input snapshot.json --out migration-output --church-id igreja-principal\n\n`)
  process.stdout.write(`Firebase real (NÃO executar sem nova autorização):\n`)
  process.stdout.write(`  npm run migration:dry-run -- --source firebase --confirm-real-read --project-id PROJECT --service-account FILE --out migration-output\n\n`)
  process.stdout.write(`Opções: --church-name, --run-at, --default-lesson-start-time, --default-lesson-duration-minutes\n`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }

  const source = args.source || 'snapshot'
  const snapshot = source === 'firebase'
    ? await readFirebaseSnapshot({
      confirmRealRead: args['confirm-real-read'] === true,
      projectId: args['project-id'],
      serviceAccount: args['service-account'],
    })
    : await readSnapshot(args.input)

  const report = runDryRun(snapshot, {
    churchId: args['church-id'] || 'igreja-principal',
    church: {
      id: args['church-id'] || 'igreja-principal',
      name: args['church-name'] || 'Igreja principal',
    },
    runAt: args['run-at'],
    defaultLessonStartTime: args['default-lesson-start-time'],
    defaultLessonDurationMinutes: args['default-lesson-duration-minutes'] ? Number(args['default-lesson-duration-minutes']) : undefined,
  })

  const outputDirectory = resolve(args.out || 'migration-dry-run-output')
  await mkdir(outputDirectory, { recursive: true })
  const jsonPath = resolve(outputDirectory, 'migration-dry-run-report.json')
  const markdownPath = resolve(outputDirectory, 'migration-dry-run-report.md')
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
    writeFile(markdownPath, renderMarkdownReport(report), 'utf8'),
  ])

  process.stdout.write(`Dry run concluído. Nenhuma gravação externa foi executada.\n`)
  process.stdout.write(`JSON: ${jsonPath}\n`)
  process.stdout.write(`Markdown: ${markdownPath}\n`)
  process.stdout.write(`Documentos propostos: ${report.documentsToCreate.length}\n`)
  process.stdout.write(`Revisões manuais: ${report.manualReview.length}\n`)
}

main().catch((error) => {
  process.stderr.write(`Erro no dry run: ${error.stack || error.message}\n`)
  process.exitCode = 1
})
