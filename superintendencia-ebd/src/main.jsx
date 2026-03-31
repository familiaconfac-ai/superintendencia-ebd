import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .getRegistrations()
      .then(async (registrations) => {
        await Promise.all(registrations.map((registration) => registration.unregister()))
        if ('caches' in window) {
          const cacheKeys = await window.caches.keys()
          await Promise.all(cacheKeys.map((key) => window.caches.delete(key)))
        }
      })
      .catch((err) => console.warn('[SW] Limpeza falhou:', err))
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
