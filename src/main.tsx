import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary.tsx'
import { registerAppShell } from './utils/appShell'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

// アプリ本体を圏外でも起動できるようにする（Exploration Mode Stage 1）。開発サーバーでは使わない
if (import.meta.env.PROD) registerAppShell()
