# Fixes & Export/Import Implementation Plan

**Spec:** `docs/superpowers/specs/2026-05-23-fixes-export-design.md`
**Branch:** `fixes-export`
**Working directory:** `/home/chryston/docker/copilot/repos/worktrees/buildbox-canvas-ux-fixes-export`
**Run tests:** `npm test -- --run`

## Task ordering

```
Task 1 (GitHub Pages + zoom relocation)  ─┐
                                           ├─ independent, run in parallel
Task 2 (workspaceIO + store action)       ─┘
Task 3 (Export/Import UI + integration)  ─ depends on Task 2
```

---

## Task 1: GitHub Pages fix + zoom button relocation

**Files:**
- Modify: `.github/workflows/static.yml`
- Modify: `vite.config.ts`
- Modify: `src/components/CabinetCanvas/ZoomControls.tsx`

### Step 1: Fix `.github/workflows/static.yml`

Replace the entire file with a build-then-deploy workflow:

```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: ["main"]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: "pages"
  cancel-in-progress: false

jobs:
  build-and-deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: './dist'
      - id: deployment
        uses: actions/deploy-pages@v5
```

### Step 2: Fix `vite.config.ts`

Add `base: '/buildbox/'`:

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/buildbox/',
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
```

### Step 3: Relocate zoom buttons in `ZoomControls.tsx`

Change `absolute bottom-4 right-4` to `absolute top-4 left-4`. One character change, no logic impact.

### Step 4: Run tests

```bash
npm test -- --run
```

Expected: all tests pass (no regressions).

### Step 5: Run build to verify vite config

```bash
npm run build
```

Expected: build succeeds, `dist/` produced with `base=/buildbox/` paths in `dist/index.html`.

### Step 6: Commit

```bash
git add .github/workflows/static.yml vite.config.ts \
        src/components/CabinetCanvas/ZoomControls.tsx
git commit -m "fix: GitHub Pages build workflow, vite base path, zoom buttons top-left

- static.yml: add npm ci + npm run build, deploy ./dist (not repo root)
- vite.config.ts: base '/buildbox/' for correct asset paths on Pages subpath
- ZoomControls: reposition overlay from bottom-right to top-left

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 2: workspaceIO utility + store action

**Files:**
- Create: `src/utils/workspaceIO.ts`
- Create: `src/utils/workspaceIO.test.ts`
- Modify: `src/store/store.ts`

### Step 1: Write failing tests in `src/utils/workspaceIO.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { exportWorkspace, importWorkspace, WorkspaceImportError } from './workspaceIO'
import type { Design } from '../types'

function makeDesign(overrides: Partial<Design> = {}): Design {
  return {
    id: 'test-id',
    name: 'Test Cabinet',
    globalSettings: {
      unit: 'mm', height: 800, width: 600, depth: 500,
      thickness: 18, backThickness: 6, toeKick: null, defaultMaterial: 'oak',
    },
    root: { id: 'root', elementType: 'void', accessories: [] },
    ...overrides,
  }
}

describe('exportWorkspace', () => {
  it('serializes projects with version 1 and exportedAt', () => {
    const json = exportWorkspace([makeDesign()], 'test-id')
    const parsed = JSON.parse(json)
    expect(parsed.version).toBe(1)
    expect(parsed.exportedAt).toBeTruthy()
    expect(parsed.projects).toHaveLength(1)
    expect(parsed.activeProjectId).toBe('test-id')
  })

  it('serializes multiple projects', () => {
    const json = exportWorkspace([makeDesign({ id: 'a' }), makeDesign({ id: 'b' })], 'a')
    const parsed = JSON.parse(json)
    expect(parsed.projects).toHaveLength(2)
  })
})

describe('importWorkspace', () => {
  it('round-trips: export then import returns same projects', () => {
    const projects = [makeDesign()]
    const json = exportWorkspace(projects, 'test-id')
    const result = importWorkspace(json)
    expect(result.projects).toEqual(projects)
    expect(result.activeProjectId).toBe('test-id')
  })

  it('throws WorkspaceImportError on empty string', () => {
    expect(() => importWorkspace('')).toThrow(WorkspaceImportError)
  })

  it('throws WorkspaceImportError on missing projects field', () => {
    expect(() => importWorkspace(JSON.stringify({ version: 1 }))).toThrow(WorkspaceImportError)
  })

  it('throws WorkspaceImportError when projects is not an array', () => {
    expect(() => importWorkspace(JSON.stringify({ version: 1, projects: 'bad' }))).toThrow(WorkspaceImportError)
  })
})
```

### Step 2: Run to verify tests fail

```bash
npm test -- --run src/utils/workspaceIO.test.ts
```

Expected: FAIL — `workspaceIO` not found.

### Step 3: Implement `src/utils/workspaceIO.ts`

```ts
import type { Design } from '../types'

export interface WorkspaceFile {
  version: number
  exportedAt: string
  projects: Design[]
  activeProjectId: string | null
}

export class WorkspaceImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkspaceImportError'
  }
}

export function exportWorkspace(projects: Design[], activeProjectId: string | null): string {
  const file: WorkspaceFile = {
    version: 1,
    exportedAt: new Date().toISOString(),
    projects,
    activeProjectId,
  }
  return JSON.stringify(file, null, 2)
}

export function importWorkspace(json: string): WorkspaceFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new WorkspaceImportError('Invalid JSON')
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new WorkspaceImportError('Expected an object')
  }
  const file = parsed as Record<string, unknown>
  if (!Array.isArray(file.projects)) {
    throw new WorkspaceImportError('Missing or invalid "projects" field')
  }
  return {
    version: typeof file.version === 'number' ? file.version : 1,
    exportedAt: typeof file.exportedAt === 'string' ? file.exportedAt : '',
    projects: file.projects as Design[],
    activeProjectId: typeof file.activeProjectId === 'string' ? file.activeProjectId : null,
  }
}
```

### Step 4: Add `importWorkspace` to the store

In `src/store/store.ts`:

1. Add `importWorkspace` to the `StoreState` interface:
   ```ts
   importWorkspace: (incoming: Design[], mode: 'replace' | 'merge') => void
   ```

2. Implement the action (add after `removeAccessory`):
   ```ts
   importWorkspace: (incoming, mode) => {
     if (mode === 'replace') {
       set((s) => {
         s.projects = incoming
         s.activeProjectId = incoming[0]?.id ?? null
       })
       // Clear undo history
       useStore.temporal.getState().clear()
     } else {
       set((s) => {
         // Re-generate IDs to avoid collisions
         const remapped = incoming.map((p) => ({ ...p, id: nanoid() }))
         s.projects.push(...remapped)
       })
     }
   },
   ```

### Step 5: Run all tests

```bash
npm test -- --run
```

Expected: all tests pass (including new workspaceIO tests).

### Step 6: Commit

```bash
git add src/utils/workspaceIO.ts src/utils/workspaceIO.test.ts src/store/store.ts
git commit -m "feat(export): workspaceIO utility and importWorkspace store action

- exportWorkspace: serializes projects[] to versioned JSON
- importWorkspace: parses and validates; throws WorkspaceImportError on bad input
- store.importWorkspace: replace (clears history) or merge (re-generates IDs)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 3: Export/Import UI + integration test

**Files:**
- Create: `src/components/Toolbar/ExportModal.tsx`
- Create: `src/components/Toolbar/ImportModal.tsx`
- Create: `src/components/Toolbar/ExportModal.test.tsx`
- Create: `src/components/Toolbar/ImportModal.test.tsx`
- Modify: `src/components/Toolbar/Toolbar.tsx`
- Modify: `src/App.tsx`
- Modify: `src/integration/cabinetFlow.test.tsx`

### Step 1: Write failing component tests

**`src/components/Toolbar/ExportModal.test.tsx`:**

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import ExportModal from './ExportModal'

const mockProjects = [
  { id: 'p1', name: 'Cabinet 1', globalSettings: {} as any, root: { id: 'r1', elementType: 'void' as const, accessories: [] } },
  { id: 'p2', name: 'Cabinet 2', globalSettings: {} as any, root: { id: 'r2', elementType: 'void' as const, accessories: [] } },
]

describe('ExportModal', () => {
  it('renders export options', () => {
    render(<ExportModal projects={mockProjects} activeProjectId="p1" onClose={vi.fn()} />)
    expect(screen.getByText(/active project/i)).toBeInTheDocument()
    expect(screen.getByText(/all projects/i)).toBeInTheDocument()
  })

  it('calls onClose when cancelled', async () => {
    const onClose = vi.fn()
    render(<ExportModal projects={mockProjects} activeProjectId="p1" onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
```

**`src/components/Toolbar/ImportModal.test.tsx`:**

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import ImportModal from './ImportModal'

const mockIncoming = {
  projects: [{ id: 'p1', name: 'Imported', globalSettings: {} as any, root: { id: 'r1', elementType: 'void' as const, accessories: [] } }],
  activeProjectId: 'p1',
}

describe('ImportModal', () => {
  it('renders replace and merge options', () => {
    render(<ImportModal incoming={mockIncoming} onConfirm={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /replace workspace/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /merge projects/i })).toBeInTheDocument()
  })

  it('calls onConfirm with replace when Replace clicked', async () => {
    const onConfirm = vi.fn()
    render(<ImportModal incoming={mockIncoming} onConfirm={onConfirm} onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /replace workspace/i }))
    expect(onConfirm).toHaveBeenCalledWith('replace')
  })

  it('calls onConfirm with merge when Merge clicked', async () => {
    const onConfirm = vi.fn()
    render(<ImportModal incoming={mockIncoming} onConfirm={onConfirm} onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /merge projects/i }))
    expect(onConfirm).toHaveBeenCalledWith('merge')
  })

  it('displays error message when error prop provided', () => {
    render(<ImportModal incoming={mockIncoming} onConfirm={vi.fn()} onClose={vi.fn()} error="Invalid file" />)
    expect(screen.getByText(/invalid file/i)).toBeInTheDocument()
  })

  it('calls onClose when cancelled', async () => {
    const onClose = vi.fn()
    render(<ImportModal incoming={mockIncoming} onConfirm={onClose} onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
```

### Step 2: Run to verify tests fail

```bash
npm test -- --run src/components/Toolbar/ExportModal.test.tsx src/components/Toolbar/ImportModal.test.tsx
```

Expected: FAIL — components not found.

### Step 3: Implement `ExportModal.tsx`

```tsx
import type { Design } from '../../types'
import { exportWorkspace } from '../../utils/workspaceIO'

interface Props {
  projects: Design[]
  activeProjectId: string | null
  onClose: () => void
}

function triggerDownload(json: string, filename: string) {
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function ExportModal({ projects, activeProjectId, onClose }: Props) {
  function handleExportActive() {
    const active = projects.find((p) => p.id === activeProjectId)
    if (!active) return
    const json = exportWorkspace([active], activeProjectId)
    triggerDownload(json, `${active.name.replace(/\s+/g, '-').toLowerCase()}.buildbox.json`)
    onClose()
  }

  function handleExportAll() {
    const json = exportWorkspace(projects, activeProjectId)
    triggerDownload(json, 'buildbox-workspace.buildbox.json')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-72 rounded-lg bg-panel p-4 shadow-xl">
        <h2 className="mb-3 text-sm font-semibold text-white">Export Workspace</h2>
        <div className="flex flex-col gap-2">
          <button
            onClick={handleExportActive}
            className="rounded bg-accent px-3 py-2 text-sm text-white hover:bg-accent/80"
          >
            Active project
          </button>
          <button
            onClick={handleExportAll}
            className="rounded bg-accent px-3 py-2 text-sm text-white hover:bg-accent/80"
          >
            All projects
          </button>
          <button
            onClick={onClose}
            className="rounded border border-white/20 px-3 py-2 text-sm text-white/60 hover:text-white"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
```

### Step 4: Implement `ImportModal.tsx`

```tsx
import type { Design } from '../../types'

interface Props {
  incoming: { projects: Design[]; activeProjectId: string | null }
  onConfirm: (mode: 'replace' | 'merge') => void
  onClose: () => void
  error?: string
}

export default function ImportModal({ incoming, onConfirm, onClose, error }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-80 rounded-lg bg-panel p-4 shadow-xl">
        <h2 className="mb-1 text-sm font-semibold text-white">Import Workspace</h2>
        <p className="mb-3 text-xs text-white/60">
          {incoming.projects.length} project{incoming.projects.length !== 1 ? 's' : ''} found
        </p>
        {error && <p className="mb-3 text-xs text-red-400">{error}</p>}
        <div className="flex flex-col gap-2">
          <button
            onClick={() => onConfirm('replace')}
            className="rounded bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-500"
          >
            Replace workspace
          </button>
          <button
            onClick={() => onConfirm('merge')}
            className="rounded bg-accent px-3 py-2 text-sm text-white hover:bg-accent/80"
          >
            Merge projects
          </button>
          <button
            onClick={onClose}
            className="rounded border border-white/20 px-3 py-2 text-sm text-white/60 hover:text-white"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
```

### Step 5: Update `Toolbar.tsx`

Add `onImport` and `onImportWorkspace` props and the Export/Import buttons.

Add to Props interface:
```ts
onImportWorkspace?: (incoming: { projects: Design[]; activeProjectId: string | null }, mode: 'replace' | 'merge') => void
projects?: Design[]
activeProjectId?: string | null
```

Add imports:
```ts
import { useState, useRef } from 'react'
import type { Design } from '../../types'
import ExportModal from './ExportModal'
import ImportModal from './ImportModal'
import { importWorkspace, WorkspaceImportError } from '../../utils/workspaceIO'
```

Inside the component, add state and handlers:
```tsx
const [showExport, setShowExport] = useState(false)
const [importState, setImportState] = useState<{ incoming: { projects: Design[]; activeProjectId: string | null }; error?: string } | null>(null)
const fileInputRef = useRef<HTMLInputElement>(null)

function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
  const file = e.target.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = (ev) => {
    try {
      const result = importWorkspace(ev.target?.result as string)
      setImportState({ incoming: { projects: result.projects, activeProjectId: result.activeProjectId } })
    } catch (err) {
      setImportState({ incoming: { projects: [], activeProjectId: null }, error: 'Invalid file — could not import workspace.' })
    }
  }
  reader.readAsText(file)
  // Reset file input so same file can be re-selected
  e.target.value = ''
}
```

Add buttons in the toolbar (before or after Export SVG):
```tsx
<button onClick={() => setShowExport(true)} className="rounded border border-white/20 px-3 py-1.5 text-sm text-white/80 hover:text-white" aria-label="Export workspace">
  ↓ Export
</button>
<input ref={fileInputRef} type="file" accept=".buildbox.json" className="hidden" onChange={handleImportFile} />
<button onClick={() => fileInputRef.current?.click()} className="rounded border border-white/20 px-3 py-1.5 text-sm text-white/80 hover:text-white" aria-label="Import workspace">
  ↑ Import
</button>
```

Add modals at end of returned JSX (before closing `</header>`):
```tsx
{showExport && (
  <ExportModal
    projects={props.projects ?? []}
    activeProjectId={props.activeProjectId ?? null}
    onClose={() => setShowExport(false)}
  />
)}
{importState && (
  <ImportModal
    incoming={importState.incoming}
    onConfirm={(mode) => {
      if (importState.incoming.projects.length > 0) {
        props.onImportWorkspace?.(importState.incoming, mode)
      }
      setImportState(null)
    }}
    onClose={() => setImportState(null)}
    error={importState.error}
  />
)}
```

### Step 6: Update `App.tsx`

Add imports:
```ts
import { useStore } from './store/store'
```
(already imported)

Add store action:
```ts
const storeImportWorkspace = useStore((state) => state.importWorkspace)
```

Pass new props to `<Toolbar>`:
```tsx
<Toolbar
  ...existing props...
  projects={projects}
  activeProjectId={activeProjectId}
  onImportWorkspace={(incoming, mode) => storeImportWorkspace(incoming.projects, mode)}
/>
```

### Step 7: Extend integration test in `cabinetFlow.test.tsx`

Add `import { exportWorkspace } from '../utils/workspaceIO'` if not present.

Add new `it` block inside the existing `describe`:

```tsx
it('exports active project and imports it back with merge', async () => {
  const user = userEvent.setup()
  render(<App />)

  const initialProjectCount = useStore.getState().projects.length

  // Export: click the Export button, then "Active project"
  await user.click(screen.getByRole('button', { name: /export workspace/i }))
  expect(screen.getByText(/export workspace/i)).toBeInTheDocument()
  // Simulate file download without checking the actual download (jsdom limitation)
  // Instead verify the modal closes on selection
  await user.click(screen.getByRole('button', { name: /active project/i }))
  expect(screen.queryByText(/export workspace/i)).not.toBeInTheDocument()

  // Import: click Import, pick a pre-built file via direct store call
  const activeDesign = useStore.getState().projects.find(
    (p) => p.id === useStore.getState().activeProjectId
  )!
  useStore.getState().importWorkspace([activeDesign], 'merge')

  expect(useStore.getState().projects.length).toBe(initialProjectCount + 1)
})
```

### Step 8: Run all tests

```bash
npm test -- --run
```

Expected: all tests pass.

### Step 9: Commit

```bash
git add src/components/Toolbar/ExportModal.tsx \
        src/components/Toolbar/ExportModal.test.tsx \
        src/components/Toolbar/ImportModal.tsx \
        src/components/Toolbar/ImportModal.test.tsx \
        src/components/Toolbar/Toolbar.tsx \
        src/App.tsx \
        src/integration/cabinetFlow.test.tsx
git commit -m "feat(export): Export/Import workspace UI in Toolbar

- ExportModal: choose active project or all projects, triggers download
- ImportModal: replace workspace or merge projects
- Toolbar: Export ↓ and Import ↑ buttons; file picker wired up
- App: passes projects/activeProjectId/onImportWorkspace to Toolbar
- Integration test: export modal closes; merge increases project count

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Final Verification

After all three tasks:

```bash
npm test -- --run
npx tsc --noEmit
npm run build
```

Expected:
- All tests pass (≥ 101 + new tests)
- TypeScript clean
- Build succeeds, `dist/index.html` has `base="/buildbox/"` asset paths
