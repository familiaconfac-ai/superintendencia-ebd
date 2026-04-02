import { listEbdDocuments, saveEbdDocument, removeEbdDocument } from './ebdDataService'
import {
  belongsToTeacherRecordByPrimaryFields,
  getAttendanceRegisterLifecycle,
  getUserIdentityTokens,
} from '../utils/accessControl'

const BUCKET = 'attendanceRegisters'

function getRegisterOwnerUid(record, fallbackUid = '') {
  return record?.storageOwnerUid || record?.ownerUid || record?.createdByUid || fallbackUid || ''
}

function buildAuditActor(user, profile) {
  return {
    uid: user?.uid || profile?.uid || '',
    email: (profile?.email || user?.email || '').trim().toLowerCase(),
    name: profile?.displayName || user?.displayName || user?.email || 'Professor da EBD',
    role: profile?.role || '',
  }
}

export function buildAttendanceAuditEntry({ action, user, profile, reason = '', metadata = {} }) {
  return {
    id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    action,
    reason: reason || '',
    actor: buildAuditActor(user, profile),
    metadata,
    createdAt: new Date().toISOString(),
  }
}

export function appendAttendanceAuditTrail(existingTrail = [], entry = null) {
  if (!entry) return existingTrail
  return [...(Array.isArray(existingTrail) ? existingTrail : []), entry].slice(-40)
}

function mergeHistoricalTeacherLinks(existingLinks = [], nextLink = null) {
  const normalized = Array.isArray(existingLinks) ? [...existingLinks] : []
  if (!nextLink) return normalized

  const alreadyExists = normalized.some((item) => (
    (item?.uid && nextLink.uid && item.uid === nextLink.uid)
    || (item?.profileId && nextLink.profileId && item.profileId === nextLink.profileId)
    || (item?.email && nextLink.email && item.email === nextLink.email)
  ))

  if (alreadyExists) return normalized
  return [...normalized, nextLink]
}

function buildHistoricalTeacherLink(user, profile) {
  const identity = getUserIdentityTokens(user, profile)
  return {
    uid: identity.uid,
    profileId: identity.profileId,
    email: identity.email,
    name: profile?.displayName || user?.displayName || identity.email || '',
    linkedAt: new Date().toISOString(),
    source: 'historical-sync',
  }
}

export function listAttendanceRegisters(uid) {
  return listEbdDocuments(uid, BUCKET)
}

export function saveAttendanceRegister(uid, payload, id = null) {
  return saveEbdDocument(uid, BUCKET, payload, id)
}

export function removeAttendanceRegister(uid, id) {
  return removeEbdDocument(uid, BUCKET, id)
}

export async function syncHistoricalTeacherRegisters(uid, user, profile, options = {}) {
  if (!uid) {
    return {
      scannedCount: 0,
      matchedCount: 0,
      linkedCount: 0,
    }
  }

  const registerList = Array.isArray(options.registers)
    ? options.registers
    : await listAttendanceRegisters(uid)

  const identity = getUserIdentityTokens(user, profile)
  const link = buildHistoricalTeacherLink(user, profile)

  if (!identity.uid && !identity.email && identity.names.length === 0) {
    return {
      scannedCount: registerList.length,
      matchedCount: 0,
      linkedCount: 0,
    }
  }

  const matches = registerList.filter((record) => (
    getAttendanceRegisterLifecycle(record).isHistorical
    && belongsToTeacherRecordByPrimaryFields(record, user, profile)
  ))
  let linkedCount = 0

  for (const record of matches) {
    const nextHistoricalLinks = mergeHistoricalTeacherLinks(record.historicalTeacherLinks, link)
    const nextPayload = {
      historicalTeacherLinks: nextHistoricalLinks,
      lastHistoricalSyncAt: new Date().toISOString(),
    }

    if (!record.teacherAuthUid && identity.uid) nextPayload.teacherAuthUid = identity.uid
    if (!record.teacherUid && identity.uid) nextPayload.teacherUid = identity.uid
    if (!record.teacherEmail && identity.email) nextPayload.teacherEmail = identity.email
    if (!record.teacherId && identity.profileId) nextPayload.teacherId = identity.profileId

    const payloadChanged = JSON.stringify(record.historicalTeacherLinks || []) !== JSON.stringify(nextHistoricalLinks)
      || Object.keys(nextPayload).some((key) => key !== 'historicalTeacherLinks' && key !== 'lastHistoricalSyncAt')

    if (!payloadChanged) continue

    nextPayload.auditTrail = appendAttendanceAuditTrail(
      record.auditTrail,
      buildAttendanceAuditEntry({
        action: 'historical-link-sync',
        user,
        profile,
        reason: 'Vinculo historico de professor sincronizado automaticamente.',
        metadata: {
          registerId: record.id,
          className: record.className || '',
        },
      }),
    )

    await saveAttendanceRegister(getRegisterOwnerUid(record, uid), nextPayload, record.id)
    linkedCount += 1
  }

  return {
    scannedCount: registerList.length,
    matchedCount: matches.length,
    linkedCount,
  }
}
