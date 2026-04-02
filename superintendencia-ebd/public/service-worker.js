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
