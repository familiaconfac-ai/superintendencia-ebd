import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export async function readSnapshot(inputPath) {
  if (!inputPath) throw new Error('Informe --input <snapshot.json>.')
  const absolutePath = resolve(inputPath)
  const raw = await readFile(absolutePath, 'utf8')
  const snapshot = JSON.parse(raw)
  if (!Array.isArray(snapshot.firestoreDocuments)) {
    throw new Error('Snapshot inválido: firestoreDocuments deve ser um array.')
  }
  return {
    ...snapshot,
    metadata: {
      ...snapshot.metadata,
      source: snapshot.metadata?.source || `snapshot:${absolutePath}`,
    },
  }
}
