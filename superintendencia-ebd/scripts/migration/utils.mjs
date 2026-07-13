import { createHash, randomUUID } from 'node:crypto'

export const LEGACY_COLLECTIONS = Object.freeze({
  ebd_people: 'people',
  ebd_teachers: 'teachers',
  ebd_classes: 'classes',
  ebd_enrollments: 'enrollments',
  ebd_attendanceRegisters: 'registers',
  ebd_lessonSessions: 'sessions',
})

export function normalizeName(value = '') {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

export function normalizeEmail(value = '') {
  return String(value || '').trim().toLowerCase()
}

export function normalizePhone(value = '') {
  return String(value || '').replace(/\D/g, '')
}

export function unique(values = []) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null && value !== ''))]
}

export function asArray(value) {
  return Array.isArray(value) ? value : []
}

export function asIso(value, fallback) {
  if (!value) return fallback
  if (typeof value === 'string') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString()
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  if (typeof value?.toDate === 'function') {
    const parsed = value.toDate()
    return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : fallback
  }
  if (typeof value?._seconds === 'number') return new Date(value._seconds * 1000).toISOString()
  return fallback
}

export function asDate(value, fallback = '') {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const iso = asIso(value, '')
  return iso ? iso.slice(0, 10) : fallback
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function stableHash(value, length = 16) {
  return createHash('sha256').update(stableStringify(value)).digest('hex').slice(0, length)
}

export function safeId(value, fallbackSeed = '') {
  const normalized = String(value || '')
    .trim()
    .replace(/\//g, '-')
    .replace(/[^a-zA-Z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || `legacy-${stableHash(fallbackSeed || randomUUID(), 12)}`
}

export function targetId(prefix, seed) {
  return `${prefix}-${stableHash(seed, 16)}`
}

export function parseLegacyDocument(document) {
  const path = String(document?.path || '').replace(/^\/+|\/+$/g, '')
  const parts = path.split('/').filter(Boolean)
  const data = document?.data && typeof document.data === 'object' ? document.data : {}

  if (parts.length === 2 && parts[0] === 'users') {
    return { kind: 'userProfiles', ownerUid: parts[1], id: parts[1], path, data }
  }

  if (parts.length === 4 && parts[0] === 'users' && LEGACY_COLLECTIONS[parts[2]]) {
    return {
      kind: LEGACY_COLLECTIONS[parts[2]],
      collection: parts[2],
      ownerUid: parts[1],
      id: parts[3],
      path,
      data,
    }
  }

  if (parts.length === 2 && parts[0] === 'ebdSystemSettings') {
    return { kind: 'settings', collection: parts[0], ownerUid: '', id: parts[1], path, data }
  }

  if (parts.length >= 3 && parts[0] === 'users' && parts[2].startsWith('ebd_')) {
    return {
      kind: 'unknownEbd',
      collection: parts[2],
      ownerUid: parts[1],
      id: parts.at(-1),
      path,
      data,
    }
  }

  return { kind: 'other', collection: parts.at(-2) || '', ownerUid: '', id: parts.at(-1) || '', path, data }
}

export function legacyRef(record) {
  return {
    path: record.path,
    sourceCollection: record.collection || record.kind,
    sourceId: record.id,
    ownerUid: record.ownerUid || '',
    documentHash: stableHash(record.data, 64),
  }
}

export function makeAudit(runId, runAt, source = null) {
  const actor = `migration:${runId}`
  const createdAt = asIso(source?.createdAt, runAt)
  const updatedAt = asIso(source?.updatedAt, createdAt)
  return {
    createdAt,
    createdBy: actor,
    updatedAt,
    updatedBy: actor,
    revision: 1,
  }
}

export function makeLegacy(runId, refs, extra = {}) {
  return {
    migrationVersion: 'dry-run-v1',
    migrationRunId: runId,
    sourceRefs: refs,
    requiresReview: Boolean(extra.requiresReview),
    reviewReasons: unique(extra.reviewReasons || []),
    ...(extra.unmapped && Object.keys(extra.unmapped).length ? { unmapped: extra.unmapped } : {}),
  }
}

export class UnionFind {
  constructor(size) {
    this.parent = Array.from({ length: size }, (_, index) => index)
    this.rank = Array(size).fill(0)
  }

  find(value) {
    if (this.parent[value] !== value) this.parent[value] = this.find(this.parent[value])
    return this.parent[value]
  }

  union(left, right) {
    let rootLeft = this.find(left)
    let rootRight = this.find(right)
    if (rootLeft === rootRight) return
    if (this.rank[rootLeft] < this.rank[rootRight]) [rootLeft, rootRight] = [rootRight, rootLeft]
    this.parent[rootRight] = rootLeft
    if (this.rank[rootLeft] === this.rank[rootRight]) this.rank[rootLeft] += 1
  }

  groups() {
    const result = new Map()
    this.parent.forEach((_, index) => {
      const root = this.find(index)
      if (!result.has(root)) result.set(root, [])
      result.get(root).push(index)
    })
    return [...result.values()]
  }
}

export function groupBy(items, keySelector) {
  return items.reduce((groups, item) => {
    const key = keySelector(item)
    if (!groups[key]) groups[key] = []
    groups[key].push(item)
    return groups
  }, {})
}

export function sanitizeForJson(value) {
  if (value === undefined) return undefined
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(sanitizeForJson)
  if (value && typeof value === 'object') {
    if (typeof value.toDate === 'function') return sanitizeForJson(value.toDate())
    if (typeof value.latitude === 'number' && typeof value.longitude === 'number') {
      return { lat: value.latitude, lng: value.longitude }
    }
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, child]) => [key, sanitizeForJson(child)])
        .filter(([, child]) => child !== undefined),
    )
  }
  return value
}
