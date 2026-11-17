import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import RecoveryScreen from './components/RecoveryScreen/RecoveryScreen'
import { StoreBindingsProvider } from './ui/legacy/StoreBindingsProvider'
import { getStoredStateFailure } from './store/guardedStorage'

// Importing App builds the store, and building the store is what reads localStorage: by
// the time this body runs, rehydration is over. Unreadable data means App never mounts —
// its own store hooks would render against defaults the user did not save (#40 §3).
const storedStateFailure = getStoredStateFailure()

const root = createRoot(document.getElementById('root')!)

// The flag is read exactly once, here, and never inside a component (#49). Comparing the
// build-time constant in the condition itself is what lets a flag-off build drop the whole
// preview graph — and with it the string `scripts/check-flag-free.mjs` scans `dist/` for.
if (import.meta.env.VITE_FF_PROJECTS_V2 === 'true') {
  // The preview app opens IndexedDB before it has anything to render, so it mounts itself.
  void import('./app/projectsV2').then(({ mountProjectsV2 }) => mountProjectsV2(root))
} else {
  root.render(
    <StrictMode>
      {storedStateFailure
        ? <RecoveryScreen failure={storedStateFailure} />
        : <StoreBindingsProvider><App /></StoreBindingsProvider>}
    </StrictMode>,
  )
}
