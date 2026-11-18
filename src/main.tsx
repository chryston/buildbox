import { createRoot } from 'react-dom/client'
import './index.css'

// The app opens its database before it has anything to render, so it mounts itself. The import
// is a dynamic one: the app is then a lazy chunk, and the shell `scripts/check-size-budget.mjs`
// measures stays to the entry and the stylesheet (#20 §12, #35).
const root = createRoot(document.getElementById('root')!)

void import('./app/projectsV2').then(({ mountProjectsV2 }) => mountProjectsV2(root))
