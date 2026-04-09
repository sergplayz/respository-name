import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { installDevLogCapture } from './devLog'
import './index.css'
import App from './App.tsx'

installDevLogCapture()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
