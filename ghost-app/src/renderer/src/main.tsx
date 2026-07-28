import App from './App'
import './assets/main.css'

// import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

createRoot(document.getElementById('root')!).render(
  // <StrictMode>
  <div>
    <App />
  </div>
  // </StrictMode>
)
