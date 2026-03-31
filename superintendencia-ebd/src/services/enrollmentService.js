import { listEbdDocuments, saveEbdDocument } from './ebdDataService'

const BUCKET = 'enrollments'

export function listEnrollments(uid) {
  return listEbdDocuments(uid, BUCKET)
}


// Garante compatibilidade e campos obrigatórios
export function saveEnrollment(uid, payload, id = null) {
  const {
    personId,
    classId,
    status = 'active',
    inactivationReason = '',
    activationHistory = [],
    ...rest
  } = payload
  // Compatibilidade: se vier de dados antigos, tenta migrar
  const enrollment = {
    personId,
    classId,
    status: status === 'inactive' ? 'inactive' : 'active',
    inactivationReason,
    activationHistory: Array.isArray(activationHistory) ? activationHistory : [],
    ...rest
  }
  return saveEbdDocument(uid, BUCKET, enrollment, id)
}
