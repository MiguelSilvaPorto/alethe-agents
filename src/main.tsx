import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { recordFrontendError } from './lib/tauri'
import './styles/reset.css'
import './styles/theme.css'

// Captura global de erros não tratados (sync + promessas rejeitadas) que o
// ErrorBoundary não pega (ex.: callbacks de eventos de PTY). Throttle pra um
// loop de erro não floodar o disco. Fire-and-forget — recordFrontendError nunca lança.
let lastErrorAt = 0
let lastErrorKey = ''
function captureGlobalError(message: string, stack: string | null, kind: string) {
  const now = Date.now()
  const key = `${kind}:${message}`
  if (key === lastErrorKey && now - lastErrorAt < 2000) return
  lastErrorKey = key
  lastErrorAt = now
  void recordFrontendError(message, stack, kind)
}

window.addEventListener('error', (event) => {
  captureGlobalError(
    event.message || String(event.error ?? 'unknown error'),
    (event.error as Error | undefined)?.stack ?? null,
    'window.error',
  )
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason as { message?: string; stack?: string } | undefined
  captureGlobalError(
    reason?.message ?? String(event.reason),
    reason?.stack ?? null,
    'unhandledrejection',
  )
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
