import { listEbdDocuments, saveEbdDocument, removeEbdDocument } from './ebdDataService'

const BUCKET = 'attendanceRegisters'

export function listAttendanceRegisters(uid) {
  return listEbdDocuments(uid, BUCKET)
}

export function saveAttendanceRegister(uid, payload, id = null) {
  return saveEbdDocument(uid, BUCKET, payload, id)
}

export function removeAttendanceRegister(uid, id) {
  return removeEbdDocument(uid, BUCKET, id)
}
