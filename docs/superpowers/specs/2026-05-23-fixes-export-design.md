# BuildBox — Fixes & Export/Import Design Spec

**Date:** 2026-05-23
**Branch:** `fixes-export` (based on `canvas-ux`)
**Scope:** Three independent improvements shipped together: GitHub Pages deployment fix, zoom button relocation, and workspace export/import.

---

## 1. Problem Statement

Three independent issues identified after Phase A:

1. **GitHub Pages is blank.** The CI workflow uploads the raw repository root (`path: '.'`) with no build step, so GitHub Pages serves the dev `index.html` which references `/src/main.tsx` — a file that only exists in the Node dev server context. Additionally, Vite needs `base: '/buildbox/'` set for correct asset paths on the GitHub Pages subpath.

2. **Zoom buttons are bottom-right.** Phase A placed the ZoomControls overlay at `absolute bottom-4 right-4`. The preferred position is top-left of the canvas.

3. **No workspace persistence across devices.** Users cannot save and reload their designs outside the browser, nor share designs with others.

---

## 2. Goals

- Fix GitHub Pages so the built app is served correctly at `https://chryston.github.io/buildbox/`.
- Move zoom buttons to the top-left of the canvas.
- Allow users to export their workspace (all projects or active project) to a `.buildbox.json` file and re-import it later (with replace or merge options).

---

## 3. Out of Scope

- Phase B (multi-unit canvas, L-shaped cabinets).
- Phase C (kitchen countertop mode).
- Cloud storage or account-based sync.
- Auto-save to file (export is manual/on-demand only).
- Export to other formats (PDF, DXF, CSV).

---

## 4. Architecture

### 4.1 GitHub Pages Fix

**Files changed:** `.github/workflows/static.yml`, `vite.config.ts`

The current workflow has no build step and deploys the repository root. Replace it with a proper build-then-deploy workflow:

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

`vite.config.ts` gains `base: '/buildbox/'` so all asset URLs resolve correctly under the subpath:

```ts
export default defineConfig({
  base: '/buildbox/',
  plugins: [react()],
  test: { ... }
})
```

---

### 4.2 Zoom Button Relocation

**File changed:** `src/components/CabinetCanvas/ZoomControls.tsx`

Change the positioning class from `absolute bottom-4 right-4` to `absolute top-4 left-4`. No logic, props, or test changes required.

---

### 4.3 Export/Import Workspace

#### 4.3.1 File Format

Exported files use the `.buildbox.json` extension. Format:

```json
{
  "version": 1,
  "exportedAt": "2026-05-23T06:00:00.000Z",
  "projects": [ ...Design[] ],
  "activeProjectId": "abc123"
}
```

`version` enables forward-compatible migration if the schema changes in future.

#### 4.3.2 New Module: `src/utils/workspaceIO.ts`

Two pure functions — no React, no store dependency:

```ts
export function exportWorkspace(projects: Design[], activeProjectId: string | null): string
// Returns JSON string ready for download.

export function importWorkspace(json: string): { version: number; projects: Design[]; activeProjectId: string | null }
// Parses and validates. Throws WorkspaceImportError on invalid input.

export class WorkspaceImportError extends Error {}
```

#### 4.3.3 Store Action: `importWorkspace`

Added to the Zustand store:

```ts
importWorkspace: (incoming: Design[], mode: 'replace' | 'merge') => void
```

- **replace**: Clears `projects`, sets to `incoming`, sets `activeProjectId` to first incoming project.
- **merge**: Appends `incoming` (re-generating IDs with `nanoid()` to avoid collisions if re-importing the same file). Keeps current `activeProjectId`.

#### 4.3.4 UI: Toolbar Buttons

Two new icon buttons added to `src/components/Toolbar/Toolbar.tsx` (or equivalent):

- **Export** button (↓ icon): Opens an `ExportModal` — a small Tailwind-styled overlay with two options: "Active project" / "All projects". On selection, calls `exportWorkspace()` and triggers `<a download>` programmatically.
- **Import** button (↑ icon): Triggers a hidden `<input type="file" accept=".buildbox.json">`. On file selected, reads file, parses JSON, opens `ImportModal` with two options: "Replace workspace" / "Merge projects". On confirmation, calls `store.importWorkspace()`.

#### 4.3.5 New Components

| Component | File | Responsibility |
|-----------|------|----------------|
| `ExportModal` | `src/components/Toolbar/ExportModal.tsx` | Choose active/all, trigger download |
| `ImportModal` | `src/components/Toolbar/ImportModal.tsx` | Choose replace/merge, confirm import |

Both are small, focused modal components with no state beyond the user's choice.

#### 4.3.6 Error Handling

- Invalid JSON or missing required fields (`version`, `projects`) → `WorkspaceImportError` thrown → `ImportModal` shows inline error: *"Invalid file — could not import workspace."*
- File read error (browser API) → Same inline error message.

---

## 5. Component Interfaces

### `ExportModal` props
```ts
interface ExportModalProps {
  projects: Design[]
  activeProjectId: string | null
  onClose: () => void
}
```

### `ImportModal` props
```ts
interface ImportModalProps {
  incoming: { projects: Design[]; activeProjectId: string | null }
  onConfirm: (mode: 'replace' | 'merge') => void
  onClose: () => void
  error?: string
}
```

---

## 6. Data Flow

```
Toolbar
  ├─ Export button → ExportModal
  │     └─ exportWorkspace(projects, activeId) → download .buildbox.json
  └─ Import button → <input file> → read file
        └─ importWorkspace(json) → ImportModal
              └─ store.importWorkspace(projects, mode)
```

---

## 7. New & Changed Files

| File | Action |
|------|--------|
| `.github/workflows/static.yml` | **Replace** — add build step, deploy `./dist` |
| `vite.config.ts` | **Modify** — add `base: '/buildbox/'` |
| `src/components/CabinetCanvas/ZoomControls.tsx` | **Modify** — `top-4 left-4` |
| `src/utils/workspaceIO.ts` | **Create** — `exportWorkspace`, `importWorkspace`, `WorkspaceImportError` |
| `src/store/store.ts` | **Modify** — add `importWorkspace` action |
| `src/components/Toolbar/ExportModal.tsx` | **Create** — export choice modal |
| `src/components/Toolbar/ImportModal.tsx` | **Create** — import confirmation modal |
| `src/components/Toolbar/Toolbar.tsx` | **Modify** — add Export/Import buttons |

---

## 8. Tests & Success Criteria

### Unit tests (`workspaceIO.test.ts`)
- `exportWorkspace` serializes all projects with correct `version: 1` and `exportedAt`
- `exportWorkspace` with single project serializes only that project
- `importWorkspace` round-trips: export then import returns identical `projects` array
- `importWorkspace` throws `WorkspaceImportError` on empty string
- `importWorkspace` throws `WorkspaceImportError` on JSON missing `projects` field
- `importWorkspace` throws `WorkspaceImportError` on JSON with `projects` not an array

### Store tests
- `importWorkspace('replace')` replaces all projects and sets activeProjectId to first
- `importWorkspace('merge')` appends projects; existing projects untouched; IDs re-generated (no duplicates)

### Component tests (`ExportModal.test.tsx`, `ImportModal.test.tsx`)
- ExportModal: clicking "Active project" triggers `exportWorkspace` with one project
- ExportModal: clicking "All projects" triggers `exportWorkspace` with all projects
- ImportModal: clicking "Replace workspace" calls `onConfirm('replace')`
- ImportModal: clicking "Merge projects" calls `onConfirm('merge')`
- ImportModal: renders error message when `error` prop provided

### Integration test (extend `cabinetFlow.test.tsx`)
- User exports active project → imports it back with "merge" → project count increases by 1

### Visual verification (manual)
- GitHub Pages URL `https://chryston.github.io/buildbox/` loads the app (not blank)
- Zoom buttons appear at top-left of canvas
- Export downloads a valid `.buildbox.json` file
- Import with replace clears and replaces projects
- Import with merge adds projects without removing existing ones

---

## 9. Non-Goals / Explicitly Excluded

- Keyboard shortcuts for export/import
- Undo/redo across import (import is a deliberate bulk operation; undo history is cleared)
- Validation of imported Design tree structure beyond top-level shape check
- Auto-migration of older file versions (version 1 only for now)
