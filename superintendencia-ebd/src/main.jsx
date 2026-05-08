import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

const APP_BUILD_VERSION = '2026-05-08-audio-mp3-reset-3'
const APP_BUILD_VERSION_KEY = 'ebd:app-build-version'

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const currentVersion = localStorage.getItem(APP_BUILD_VERSION_KEY)

    if (currentVersion !== APP_BUILD_VERSION) {
      localStorage.setItem(APP_BUILD_VERSION_KEY, APP_BUILD_VERSION)
      navigator.serviceWorker.getRegistrations()
        .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
        .then(() => {
          console.log('[APP BUILD] Service workers antigos removidos para atualizar audio/mp3.')
          window.location.reload()
        })
        .catch((err) => console.warn('[SW] Limpeza falhou:', err))
      return
    }

    navigator.serviceWorker
      .register('/service-worker.js')
      .catch((err) => console.warn('[SW] Registro falhou:', err))
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
