import {
  UnionFind,
  groupBy,
  legacyRef,
  makeAudit,
  makeLegacy,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  safeId,
  stableHash,
  unique,
} from './utils.mjs'

function getAuthUid(candidate) {
  const data = candidate.data || {}
  return String(data.authUid || data.uid || data.teacherAuthUid || data.userUid || '').trim()
}

function isStrongIdentityConflict(left, right) {
  const leftName = normalizeName(left.data.fullName || left.data.name)
  const rightName = normalizeName(right.data.fullName || right.data.name)
  const leftBirth = left.data.birthDate || ''
  const rightBirth = right.data.birthDate || ''
  const leftPhone = normalizePhone(left.data.phone)
  const rightPhone = normalizePhone(right.data.phone)
  const namesConflict = leftName && rightName && leftName !== rightName
  const birthConflict = leftBirth && rightBirth && leftBirth !== rightBirth
  const phoneConflict = leftPhone && rightPhone && leftPhone !== rightPhone
  return Boolean(namesConflict && (birthConflict || phoneConflict))
}

function classifyPair(left, right) {
  const leftUid = getAuthUid(left)
  const rightUid = getAuthUid(right)
  const leftEmail = normalizeEmail(left.data.email)
  const rightEmail = normalizeEmail(right.data.email)
  const leftName = normalizeName(left.data.fullName || left.data.name)
  const rightName = normalizeName(right.data.fullName || right.data.name)
  const leftPhone = normalizePhone(left.data.phone)
  const rightPhone = normalizePhone(right.data.phone)
  const leftBirth = left.data.birthDate || ''
  const rightBirth = right.data.birthDate || ''

  if (leftUid && rightUid && leftUid === rightUid) {
    if (isStrongIdentityConflict(left, right)) {
      return { confidence: 'ambiguous', reason: 'Mesmo authUid com dados pessoais incompatíveis.' }
    }
    return { confidence: 'safe', reason: 'Mesmo authUid explícito.' }
  }

  const linked = (
    left.ownerUid === right.ownerUid
    && (
      left.data.linkedTeacherId === right.id
      || right.data.linkedTeacherId === left.id
    )
  )
  if (linked) return { confidence: 'safe', reason: 'linkedTeacherId explícito no mesmo proprietário legado.' }

  if (
    left.ownerUid === right.ownerUid
    && left.id === right.id
    && left.kind !== right.kind
    && !isStrongIdentityConflict(left, right)
  ) {
    return { confidence: 'safe', reason: 'Mesmo ID em people/teachers no mesmo proprietário.' }
  }

  if (leftEmail && leftEmail === rightEmail) {
    if (leftName && leftName === rightName && !isStrongIdentityConflict(left, right)) {
      return { confidence: 'safe', reason: 'Mesmo e-mail e mesmo nome normalizados.' }
    }
    return {
      confidence: 'probable',
      reason: leftName && rightName
        ? 'Mesmo e-mail, mas nomes diferentes.'
        : 'Mesmo e-mail com nome ausente em pelo menos um registro.',
    }
  }

  if (leftName && leftName === rightName && leftPhone && leftPhone === rightPhone) {
    return { confidence: 'probable', reason: 'Mesmo nome e telefone normalizados.' }
  }

  if (leftName && leftName === rightName && leftBirth && leftBirth === rightBirth) {
    return { confidence: 'probable', reason: 'Mesmo nome e data de nascimento.' }
  }

  if (leftName && leftName === rightName && left.kind !== right.kind) {
    return { confidence: 'ambiguous', reason: 'Nome igual sem outro identificador seguro.' }
  }

  return null
}

function pickCanonicalField(records, field, fallback = '') {
  const people = records.filter((item) => item.kind === 'people')
  const teachers = records.filter((item) => item.kind === 'teachers')
  const ordered = [...people, ...teachers]
  const values = ordered.map((item) => item.data?.[field]).filter((value) => value !== undefined && value !== null && value !== '')
  return values[0] ?? fallback
}

function buildCanonicalPerson(group, context, targetId, reviewReasons = []) {
  const fullName = pickCanonicalField(group, 'fullName', pickCanonicalField(group, 'name', `Pessoa legada ${targetId}`))
  const email = normalizeEmail(pickCanonicalField(group, 'email')) || null
  const phone = String(pickCanonicalField(group, 'phone') || '').trim() || null
  const birthDate = pickCanonicalField(group, 'birthDate') || null
  const churchStatus = pickCanonicalField(group, 'churchStatus', 'unknown')
  const sourceActive = pickCanonicalField(group.filter((item) => item.kind === 'people'), 'active', true)
  const status = sourceActive === false ? 'inactive' : 'active'
  const notes = unique(group.map((item) => String(item.data?.notes || '').trim())).join('\n')
  const incomplete = !fullName || (!email && !phone && !birthDate)

  return {
    fullName,
    normalizedName: normalizeName(fullName),
    email,
    normalizedEmail: email,
    phone,
    normalizedPhone: normalizePhone(phone) || null,
    birthDate,
    churchStatus: ['member', 'attendee', 'visitor'].includes(churchStatus) ? churchStatus : 'unknown',
    status,
    notes,
    dataQuality: reviewReasons.length ? 'ambiguous' : incomplete ? 'incomplete' : 'complete',
    ...makeAudit(context.runId, context.runAt, group.find((item) => item.kind === 'people')?.data || group[0]?.data),
    legacy: makeLegacy(context.runId, group.map(legacyRef), {
      requiresReview: reviewReasons.length > 0,
      reviewReasons,
      unmapped: {
        teacherActiveValues: unique(group.filter((item) => item.kind === 'teachers').map((item) => item.data?.active)),
        legacyRoles: unique(group.flatMap((item) => Array.isArray(item.data?.roles) ? item.data.roles : [])),
      },
    }),
  }
}

export function reconcilePeople(people, teachers, context) {
  const candidates = [...people, ...teachers]
  const union = new UnionFind(candidates.length)
  const matches = { safe: [], probable: [], ambiguous: [] }

  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
      const classification = classifyPair(candidates[leftIndex], candidates[rightIndex])
      if (!classification) continue
      const entry = {
        leftPath: candidates[leftIndex].path,
        rightPath: candidates[rightIndex].path,
        reason: classification.reason,
      }
      matches[classification.confidence].push(entry)
      if (classification.confidence === 'safe') union.union(leftIndex, rightIndex)
    }
  }

  const emailGroups = groupBy(candidates.filter((item) => normalizeEmail(item.data.email)), (item) => normalizeEmail(item.data.email))
  Object.entries(emailGroups).forEach(([email, records]) => {
    const names = unique(records.map((item) => normalizeName(item.data.fullName || item.data.name)))
    if (records.length > 1 && names.length > 1) {
      matches.ambiguous.push({
        type: 'shared-email',
        email,
        paths: records.map((item) => item.path),
        reason: 'E-mail compartilhado por registros com nomes diferentes.',
      })
    }
  })

  const groups = union.groups().map((indexes) => indexes.map((index) => candidates[index]))
  const usedIds = new Set()
  const documents = []
  const sourceToPersonId = new Map()
  const keyToPersonIds = new Map()

  groups.forEach((group) => {
    const preferred = group.find((item) => item.kind === 'people') || group[0]
    let personId = safeId(preferred.id, preferred.path)
    if (usedIds.has(personId)) personId = `${personId}-${stableHash(group.map((item) => item.path), 8)}`
    usedIds.add(personId)

    const groupPaths = new Set(group.map((item) => item.path))
    const ambiguousReasons = matches.ambiguous
      .filter((item) => item.leftPath ? groupPaths.has(item.leftPath) || groupPaths.has(item.rightPath) : item.paths?.some((path) => groupPaths.has(path)))
      .map((item) => item.reason)
    const probableReasons = matches.probable
      .filter((item) => groupPaths.has(item.leftPath) || groupPaths.has(item.rightPath))
      .map((item) => item.reason)
    const reviewReasons = unique([...ambiguousReasons, ...probableReasons])
    const confidence = ambiguousReasons.length ? 'ambiguous' : probableReasons.length ? 'probable' : 'safe'

    const data = buildCanonicalPerson(group, context, personId, reviewReasons)
    const path = `churches/${context.churchId}/people/${personId}`
    documents.push({ path, type: 'person', data, sourcePaths: group.map((item) => item.path), confidence })

    group.forEach((item) => {
      sourceToPersonId.set(item.path, personId)
      const keys = [
        `${item.ownerUid}:id:${item.id}`,
        getAuthUid(item) ? `auth:${getAuthUid(item)}` : '',
        normalizeEmail(item.data.email) ? `email:${normalizeEmail(item.data.email)}` : '',
      ].filter(Boolean)
      keys.forEach((key) => {
        if (!keyToPersonIds.has(key)) keyToPersonIds.set(key, new Set())
        keyToPersonIds.get(key).add(personId)
      })
    })
  })

  const duplicateNames = Object.entries(groupBy(documents, (item) => item.data.normalizedName))
    .filter(([name, items]) => name && items.length > 1)
    .map(([normalizedName, items]) => ({ normalizedName, personIds: items.map((item) => item.path.split('/').at(-1)) }))

  return {
    candidates,
    documents,
    matches,
    sourceToPersonId,
    keyToPersonIds,
    duplicateNames,
    resolve({ ownerUid = '', legacyId = '', authUid = '', email = '' }) {
      const keys = [
        ownerUid && legacyId ? `${ownerUid}:id:${legacyId}` : '',
        authUid ? `auth:${authUid}` : '',
        normalizeEmail(email) ? `email:${normalizeEmail(email)}` : '',
      ].filter(Boolean)
      for (const key of keys) {
        const ids = [...(keyToPersonIds.get(key) || [])]
        if (ids.length === 1) return { personId: ids[0], confidence: key.startsWith('email:') ? 'probable' : 'safe', key }
        if (ids.length > 1) return { personId: null, confidence: 'ambiguous', key, candidates: ids }
      }
      return { personId: null, confidence: 'unmatched', key: '' }
    },
  }
}
