import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { IS_MOCK_MODE } from '../firebase/mockMode'

const STORAGE_KEY = 'ebd:communication-settings'
const SETTINGS_COLLECTION = 'ebdSystemSettings'
const SETTINGS_DOC_ID = 'communication'

export const DEFAULT_COMMUNICATION_SETTINGS = {
  ebdGroupLink: import.meta.env.VITE_EBD_GROUP_LINK || '',
  groupName: 'Grupo da EBD',
  lessonEndTime: import.meta.env.VITE_EBD_LESSON_END_TIME || '19:20',
}

function readLocalSettings() {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return DEFAULT_COMMUNICATION_SETTINGS

  try {
    return {
      ...DEFAULT_COMMUNICATION_SETTINGS,
      ...JSON.parse(raw),
    }
  } catch {
    return DEFAULT_COMMUNICATION_SETTINGS
  }
}

function writeLocalSettings(payload) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
}

export async function getCommunicationSettings() {
  if (IS_MOCK_MODE || !db) {
    return readLocalSettings()
  }

  const snap = await getDoc(doc(db, SETTINGS_COLLECTION, SETTINGS_DOC_ID))
  if (!snap.exists()) {
    return DEFAULT_COMMUNICATION_SETTINGS
  }

  return {
    ...DEFAULT_COMMUNICATION_SETTINGS,
    ...snap.data(),
  }
}

export async function saveCommunicationSettings(payload = {}) {
  const nextSettings = {
    ...DEFAULT_COMMUNICATION_SETTINGS,
    ...payload,
  }

  if (IS_MOCK_MODE || !db) {
    writeLocalSettings(nextSettings)
    return nextSettings
  }

  await setDoc(doc(db, SETTINGS_COLLECTION, SETTINGS_DOC_ID), {
    ...nextSettings,
    updatedAt: serverTimestamp(),
  }, { merge: true })

  return nextSettings
}
