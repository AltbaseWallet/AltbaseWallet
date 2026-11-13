import { pluginService } from './services/pluginService'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './utils/bufferPolyfill'
import './styles/globals.css'
import App from './app/App.tsx'

const root = createRoot(document.getElementById('root')!)
pluginService.load().then(() => root.render(
  <StrictMode>
    <App />
  </StrictMode>,
)) .catch((error: unknown) => root.render(<main style={{ padding: 32, color: 'white' }}><h1>Altbase Wallet</h1><p>{error instanceof Error ? error.message : 'Module catalog unavailable'}</p><button onClick={() => location.reload()}>Retry</button></main>))
