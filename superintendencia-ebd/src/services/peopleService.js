import { listEbdDocuments, saveEbdDocument, softToggleEbdDocument, removeEbdDocument } from './ebdDataService'

const BUCKET = 'people'

export function listPeople(uid) {
  return listEbdDocuments(uid, BUCKET).then((people) => {
    if (typeof window !== 'undefined' && window.location && window.location.href && window.location.href.includes('helton')) {
      // eslint-disable-next-line no-console
      console.log('[DIAG_HELTON][PEOPLE] listPeople:', people)
    }
    return people
  })
}

export function savePerson(uid, payload, id = null) {
  return saveEbdDocument(uid, BUCKET, payload, id)
}

export function togglePersonStatus(uid, id, active) {
  return softToggleEbdDocument(uid, BUCKET, id, active)
}

export function removePerson(uid, id) {
  return removeEbdDocument(uid, BUCKET, id)
}
