import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

async function clearLegacyAppCaches() {
  if (typeof window === 'undefined') return

  if ('serviceWorker' in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(registrations.map((registration) => registration.unregister()))
    } catch (error) {
      console.warn('Nao foi possivel remover service workers antigos.', error)
    }
  }

  if ('caches' in window) {
    try {
      const cacheKeys = await window.caches.keys()
      await Promise.all(cacheKeys.map((cacheKey) => window.caches.delete(cacheKey)))
    } catch (error) {
      console.warn('Nao foi possivel limpar caches antigos.', error)
    }
  }
}

void clearLegacyAppCaches()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
