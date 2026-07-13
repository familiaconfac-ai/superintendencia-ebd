import { readFile } from 'node:fs/promises'

import { LEGACY_COLLECTIONS, sanitizeForJson } from '../utils.mjs'

async function loadAdminSdk() {
  try {
    const [appModule, firestoreModule, authModule] = await Promise.all([
      import('firebase-admin/app'),
      import('firebase-admin/firestore'),
      import('firebase-admin/auth'),
    ])
    return { ...appModule, ...firestoreModule, ...authModule }
  } catch (error) {
    throw new Error(`O modo Firebase requer a dependência opcional firebase-admin. Instale-a somente quando a leitura real for autorizada. Detalhe: ${error.message}`)
  }
}

async function readCredential(serviceAccountPath, sdk) {
  if (!serviceAccountPath) return sdk.applicationDefault()
  const serviceAccount = JSON.parse(await readFile(serviceAccountPath, 'utf8'))
  return sdk.cert(serviceAccount)
}

async function listAllAuthUsers(auth) {
  const users = []
  let pageToken
  do {
    const page = await auth.listUsers(1000, pageToken)
    users.push(...page.users.map((user) => sanitizeForJson(user.toJSON())))
    pageToken = page.pageToken
  } while (pageToken)
  return users
}

async function collectQuerySnapshot(snapshot, destination) {
  snapshot.docs.forEach((item) => {
    destination.set(item.ref.path, { path: item.ref.path, data: sanitizeForJson(item.data()) })
  })
}

export async function readFirebaseSnapshot(options = {}) {
  if (options.confirmRealRead !== true) {
    throw new Error('Leitura real bloqueada. Use --source firebase --confirm-real-read somente após nova autorização explícita.')
  }

  const sdk = await loadAdminSdk()
  const credential = await readCredential(options.serviceAccount, sdk)
  const app = sdk.getApps().length
    ? sdk.getApps()[0]
    : sdk.initializeApp({ credential, ...(options.projectId ? { projectId: options.projectId } : {}) })
  const db = sdk.getFirestore(app)
  const auth = sdk.getAuth(app)
  const documents = new Map()

  const usersSnapshot = await db.collection('users').get()
  await collectQuerySnapshot(usersSnapshot, documents)
  const authUsers = await listAllAuthUsers(auth)
  const userUids = new Set([...usersSnapshot.docs.map((item) => item.id), ...authUsers.map((item) => item.uid)])

  for (const collectionId of Object.keys(LEGACY_COLLECTIONS)) {
    await collectQuerySnapshot(await db.collectionGroup(collectionId).get(), documents)
  }

  for (const uid of userUids) {
    const collections = await db.doc(`users/${uid}`).listCollections()
    for (const collection of collections.filter((item) => item.id.startsWith('ebd_'))) {
      await collectQuerySnapshot(await collection.get(), documents)
    }
  }

  await collectQuerySnapshot(await db.collection('ebdSystemSettings').get(), documents)

  return {
    metadata: {
      source: 'firebase-admin-readonly',
      projectId: app.options.projectId || options.projectId || null,
      exportedAt: new Date().toISOString(),
    },
    authUsersIncluded: true,
    authUsers,
    firestoreDocuments: [...documents.values()],
  }
}
