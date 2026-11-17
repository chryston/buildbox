import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import RecoveryScreen from './components/RecoveryScreen/RecoveryScreen'
import { getStoredStateFailure } from './store/guardedStorage'

// Importing App builds the store, and building the store is what reads localStorage: by
// the time this body runs, rehydration is over. Unreadable data means App never mounts —
// its own store hooks would render against defaults the user did not save (#40 §3).
const storedStateFailure = getStoredStateFailure()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {storedStateFailure ? <RecoveryScreen failure={storedStateFailure} /> : <App />}
  </StrictMode>,
)
