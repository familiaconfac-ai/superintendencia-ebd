self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const targetUrl = event.notification?.data?.url || '/comunicacao'

  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    })

    const focusedClient = clientsList.find((client) => 'focus' in client)
    if (focusedClient) {
      await focusedClient.focus()
      if ('navigate' in focusedClient) {
        await focusedClient.navigate(targetUrl)
      }
      return
    }

    if (self.clients.openWindow) {
      await self.clients.openWindow(targetUrl)
    }
  })())
})

self.addEventListener('push', (event) => {
  if (!event.data) return

  let payload = {}
  try {
    payload = event.data.json()
  } catch {
    payload = { body: event.data.text() }
  }

  const title = payload.title || 'Painel de Controle de Aula'
  const options = {
    body: payload.body || 'Novo alerta da EBD.',
    icon: payload.icon || '/icon-192.png',
    badge: payload.badge || '/favicon.png',
    vibrate: payload.vibrate || [250, 120, 250],
    tag: payload.tag || 'ebd-push-notification',
    requireInteraction: payload.requireInteraction ?? true,
    data: {
      url: payload.url || '/comunicacao',
    },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})
