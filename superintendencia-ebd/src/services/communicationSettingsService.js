import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { IS_MOCK_MODE } from '../firebase/mockMode'

const STORAGE_KEY = 'ebd:communication-settings'
const SETTINGS_COLLECTION = 'ebdSystemSettings'
const SETTINGS_DOC_ID = 'communication'
export const COMMUNICATION_SETTINGS_EVENT = 'ebd:communication-settings-updated'

export const DEFAULT_COMMUNICATION_SETTINGS = {
  ebdGroupLink: import.meta.env.VITE_EBD_GROUP_LINK || 'https://chat.whatsapp.com/CaeYIcvlP6pA4HOlU7ZJ0x?mode=gi_t',
  groupName: 'Grupo da EBD',
  lessonWeekday: Number(import.meta.env.VITE_EBD_LESSON_WEEKDAY || 0),
  lessonStartTime: import.meta.env.VITE_EBD_LESSON_START_TIME || '18:30',
  lessonDurationMinutes: 50,
  warningLeadMinutes: 10,
  checkInLeadMinutes: 30,
}

function mergeWithDefaults(payload = {}) {
  return {
    ...DEFAULT_COMMUNICATION_SETTINGS,
    ...payload,
  }
}

function readLocalSettings() {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return DEFAULT_COMMUNICATION_SETTINGS

  try {
    return mergeWithDefaults(JSON.parse(raw))
  } catch {
    return DEFAULT_COMMUNICATION_SETTINGS
  }
}

function writeLocalSettings(payload) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
}

function broadcastCommunicationSettings(payload) {
  window.dispatchEvent(new CustomEvent(COMMUNICATION_SETTINGS_EVENT, {
    detail: payload,
  }))
}

export async function getCommunicationSettings() {
  if (IS_MOCK_MODE || !db) {
    return readLocalSettings()
  }

  const snap = await getDoc(doc(db, SETTINGS_COLLECTION, SETTINGS_DOC_ID))
  if (!snap.exists()) {
    return DEFAULT_COMMUNICATION_SETTINGS
  }

  return mergeWithDefaults(snap.data())
}

export async function saveCommunicationSettings(payload = {}) {
  const nextSettings = mergeWithDefaults(payload)

  if (IS_MOCK_MODE || !db) {
    writeLocalSettings(nextSettings)
    broadcastCommunicationSettings(nextSettings)
    return nextSettings
  }

  await setDoc(doc(db, SETTINGS_COLLECTION, SETTINGS_DOC_ID), {
    ...nextSettings,
    updatedAt: serverTimestamp(),
  }, { merge: true })

  broadcastCommunicationSettings(nextSettings)
  return nextSettings
}
