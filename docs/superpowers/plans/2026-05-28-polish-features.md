# BuildBox Polish Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix fit-to-page vertical clipping, add visual indicators for locked dimension labels, apply a clean-light SaaS theme, and add a Floor Plan module placeholder with toolbar module switcher.

**Architecture:** Four independent UI changes to the existing React/Tailwind SPA. T1 fixes a CSS layout + zoom-reset bug. T2 enhances DimensionLabels.tsx with SVG lock icons. T3 replaces the dark-purple Tailwind palette with a clean-light palette across all components. T4 adds a `FloorPlanPlaceholder` component and wires a `ModuleSwitcher` into `App.tsx`. One E2E integration test covers all new surface-level behaviour.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v3, Vitest + React Testing Library, SVG (inline)

**Worktree:** `/home/chryston/docker/copilot/repos/worktrees/buildbox-main-polish-features` (branch `polish-features`)

---

## File Map

| File | Change |
|------|--------|
| `src/App.tsx` | `min-h-screen` → `h-screen overflow-hidden`; add `activeModule` state; render `ModuleSwitcher` + `FloorPlanPlaceholder` |
| `src/components/CabinetCanvas/CabinetCanvas.tsx` | Fix `handleFitAll`; add explicit `preserveAspectRatio` |
| `src/components/CabinetCanvas/DimensionLabels.tsx` | Add lock icon + opacity for non-editable labels; add hover/underline for editable labels |
| `src/components/CabinetCanvas/ZoomControls.tsx` | Theme colors |
| `src/components/FloorPlanPlaceholder/FloorPlanPlaceholder.tsx` | **Create** — coming-soon panel |
| `src/components/ModuleSwitcher/ModuleSwitcher.tsx` | **Create** — Cabinet / Floor Plan pill toggle |
| `src/components/Toolbar/Toolbar.tsx` | Theme colors |
| `src/components/Toolbar/ExportModal.tsx` | Theme colors |
| `src/components/Toolbar/ImportModal.tsx` | Theme colors |
| `src/components/Toolbar/UndoRedo.tsx` | Theme colors |
| `src/components/ProjectTabs/ProjectTabs.tsx` | Theme colors |
| `src/components/Sidebar/Sidebar.tsx` | Theme colors |
| `src/components/Sidebar/UnitSelector.tsx` | Theme colors |
| `src/components/CutListPanel/CutListPanel.tsx` | Theme colors |
| `src/components/DimensionEditor/DimensionEditor.tsx` | Theme colors |
| `src/components/ErrorBoundary.tsx` | Theme colors |
| `src/components/WarningBanner/WarningBanner.tsx` | Theme colors |
| `tailwind.config.ts` | Replace palette |
| `src/index.css` | Add CSS custom properties for SVG colors |
| `src/integration/cabinetFlow.test.tsx` | Add E2E test for polish features |

---

## Task 1: Fix fit-to-page layout and zoom-reset

**Root cause:** The outer App div uses `min-h-screen flex flex-col`. `min-h-screen` sets `min-height: 100vh` but NOT `height: 100vh`, so `flex-1` children of `<main>` do not stretch to fill the viewport. The CabinetCanvas SVG therefore gets a height based on its content, not the available viewport. Additionally `handleFitAll` should explicitly set `preserveAspectRatio` on the SVG.

**Files:**
- Modify: `src/App.tsx` (line 115 — outer div class)
- Modify: `src/components/CabinetCanvas/CabinetCanvas.tsx` (lines 68–71, 79–89)

- [ ] **Step 1: Write the failing test**

File: `src/components/CabinetCanvas/CabinetCanvas.test.tsx`

```tsx
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import CabinetCanvas from './CabinetCanvas'
import type { SceneLayout } from '../../types'
import { createRef } from 'react'

const mockLayout: SceneLayout = {
  units: [{
    kind: 'cabinet',
    unitId: 'u1',
    label: 'U1',
    unit: 'mm',
    x: 0, y: 0, w: 600, h: 800,
    panels: [], voids: [], dividers: [],
    overConstrainedIds: [],
    isActive: true,
  }],
  boundingBox: { x: 0, y: 0, w: 600, h: 800 },
}

describe('CabinetCanvas fit-to-screen', () => {
  it('SVG has explicit preserveAspectRatio for correct vertical fitting', () => {
    const svgRef = createRef<SVGSVGElement>()
    render(
      <CabinetCanvas
        sceneLayout={mockLayout}
        svgRef={svgRef}
        onUnlockNode={vi.fn()}
        onUnitClick={vi.fn()}
      />
    )
    expect(screen.getByTestId('cabinet-canvas')).toHaveAttribute('preserveAspectRatio', 'xMidYMid meet')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/chryston/docker/copilot/repos/worktrees/buildbox-main-polish-features
npx vitest run src/components/CabinetCanvas/CabinetCanvas.test.tsx
```

Expected: FAIL — `preserveAspectRatio` attribute missing

- [ ] **Step 3: Fix App.tsx outer div — `min-h-screen` → `h-screen overflow-hidden`**

In `src/App.tsx`, line 115, change:
```tsx
// Before
<div className="min-h-screen bg-surface text-white flex flex-col">
// After
<div className="h-screen overflow-hidden bg-surface text-white flex flex-col">
```

- [ ] **Step 4: Add `preserveAspectRatio` to SVG in CabinetCanvas.tsx**

The `handleFitAll` function (lines 68–71) is already correct — it resets `zoom=1, pan=0` which works correctly once `h-screen` fixes the container height. The only change needed is adding the `preserveAspectRatio` attribute to the SVG element so the browser uses the correct `meet` mode:

```tsx
<svg
  ref={svgRef}
  data-testid="cabinet-canvas"
  viewBox={viewBox}
  preserveAspectRatio="xMidYMid meet"
  className="h-full w-full"
  style={{ touchAction: 'none' }}
  onWheel={onWheel}
  onPointerDown={onPointerDown}
  onPointerMove={onPointerMove}
  onPointerUp={onPointerUp}
  onPointerCancel={onPointerCancel}
>
```

**Do not change** the `handleFitAll` implementation — it is already correct.

- [ ] **Step 5: Run test to verify it passes**

```bash
cd /home/chryston/docker/copilot/repos/worktrees/buildbox-main-polish-features
npx vitest run src/components/CabinetCanvas/CabinetCanvas.test.tsx
```

Expected: PASS

- [ ] **Step 6: Run full test suite to confirm no regressions**

```bash
cd /home/chryston/docker/copilot/repos/worktrees/buildbox-main-polish-features
npx vitest run
```

Expected: all tests pass (≥147)

- [ ] **Step 7: Commit**

```bash
cd /home/chryston/docker/copilot/repos/worktrees/buildbox-main-polish-features
git add src/App.tsx src/components/CabinetCanvas/CabinetCanvas.tsx src/components/CabinetCanvas/CabinetCanvas.test.tsx
git commit -m "fix(canvas): h-screen layout + explicit preserveAspectRatio for fit-to-page"
```

---

## Task 2: Visual indicator for locked/non-editable dimension labels

**Design:** Non-editable labels (where `canEditW` or `canEditH` is `false`) render at 40% opacity with a small inline padlock SVG icon. Editable labels render at full opacity with an underline decoration and pointer cursor to signal clickability.

**Files:**
- Modify: `src/components/CabinetCanvas/DimensionLabels.tsx`

- [ ] **Step 1: Write the failing test**

File: `src/components/CabinetCanvas/DimensionLabels.test.tsx` (already exists — add test cases)

Open `src/components/CabinetCanvas/DimensionLabels.test.tsx` and update the imports and add tests:

```tsx
// Update imports — add vi and screen
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { LayoutVoid } from '../../types'
import DimensionLabels from './DimensionLabels'

```tsx
function makeTestVoid(id: string, parentSplitAxis: 'horizontal' | 'vertical'): LayoutVoid {
  return {
    nodeId: id, x: 0, y: 0, w: 200, h: 300,
    parentSplitAxis,
    elementType: 'void',
    material: 'oak',
    accessories: [],
  }
}

it('non-editable width label shows lock icon', () => {
  // parentSplitAxis=horizontal → canEditH=true, canEditW=false
  render(
    <svg>
      <DimensionLabels
        voids={[makeTestVoid('n1', 'horizontal')]}
        unit="mm"
        onCommitSize={vi.fn()}
        zoom={1}
      />
    </svg>
  )
  expect(screen.getByTestId('dim-label-n1-w-lock')).toBeInTheDocument()
  expect(screen.queryByTestId('dim-label-n1-h-lock')).not.toBeInTheDocument()
})

it('editable width label has no lock icon', () => {
  // parentSplitAxis=vertical → canEditW=true, canEditH=false
  render(
    <svg>
      <DimensionLabels
        voids={[makeTestVoid('n2', 'vertical')]}
        unit="mm"
        onCommitSize={vi.fn()}
        zoom={1}
      />
    </svg>
  )
  expect(screen.queryByTestId('dim-label-n2-w-lock')).not.toBeInTheDocument()
  expect(screen.getByTestId('dim-label-n2-h-lock')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/chryston/docker/copilot/repos/worktrees/buildbox-main-polish-features
npx vitest run src/components/CabinetCanvas/DimensionLabels.test.tsx
```

Expected: FAIL — `dim-label-n1-w-lock` not found

- [ ] **Step 3: Update DimensionLabels.tsx**

Replace the `<text>` elements for width and height labels in `src/components/CabinetCanvas/DimensionLabels.tsx`. The key changes:
- Non-editable labels: `opacity={0.4}` + inline `<LockIcon>` SVG group beside the text
- Editable labels: `textDecoration="underline"` + `cursor="pointer"`

Replace the entire return body with:

```tsx
return (
  <g data-layer="dimension-labels">
    {voids.map((v) => {
      const canEditH = v.parentSplitAxis === 'horizontal'
      const canEditW = v.parentSplitAxis === 'vertical'

      return (
        <g key={v.nodeId}>
          {/* Width label — horizontal group, no rotation */}
          <g
            opacity={canEditW ? 1 : 0.4}
            cursor={canEditW ? 'pointer' : 'default'}
            onClick={canEditW ? (e) => {
              const el = e.currentTarget.querySelector('text')
              if (el) openEditor(v, 'w', el as SVGTextElement)
            } : undefined}
          >
            <text
              data-testid={`dim-label-${v.nodeId}-w`}
              x={v.x + v.w / 2}
              y={v.y + fontSize + 2}
              textAnchor="middle"
              fontSize={fontSize}
              fill="var(--color-dim-label)"
              textDecoration={canEditW ? 'underline' : 'none'}
            >
              {formatDisplay(v.w, unit)}
            </text>
            {!canEditW && (
              <g
                data-testid={`dim-label-${v.nodeId}-w-lock`}
                transform={`translate(${v.x + v.w / 2 + fontSize * 1.8}, ${v.y + fontSize + 2 - fontSize * 0.7}) scale(${fontSize / 14})`}
              >
                <path d="M2 5V3.5a2.5 2.5 0 0 1 5 0V5" fill="none" stroke="var(--color-dim-label)" strokeWidth={1.5} />
                <rect x={1} y={5} width={7} height={5} rx={1} fill="none" stroke="var(--color-dim-label)" strokeWidth={1.5} />
              </g>
            )}
          </g>

          {/* Height label — rotation applied only to text, lock icon stays in un-rotated space */}
          <g
            opacity={canEditH ? 1 : 0.4}
            cursor={canEditH ? 'pointer' : 'default'}
            onClick={canEditH ? (e) => {
              const el = e.currentTarget.querySelector('text')
              if (el) openEditor(v, 'h', el as SVGTextElement)
            } : undefined}
          >
            <text
              data-testid={`dim-label-${v.nodeId}-h`}
              x={v.x + fontSize + 2}
              y={v.y + v.h / 2}
              textAnchor="middle"
              fontSize={fontSize}
              fill="var(--color-dim-label)"
              textDecoration={canEditH ? 'underline' : 'none'}
              transform={`rotate(-90, ${v.x + fontSize + 2}, ${v.y + v.h / 2})`}
            >
              {formatDisplay(v.h, unit)}
            </text>
            {!canEditH && (
              <g
                data-testid={`dim-label-${v.nodeId}-h-lock`}
                transform={`translate(${v.x + fontSize + 2 - fontSize * 0.4}, ${v.y + v.h / 2 - fontSize * 2.5}) scale(${fontSize / 14})`}
              >
                <path d="M2 5V3.5a2.5 2.5 0 0 1 5 0V5" fill="none" stroke="var(--color-dim-label)" strokeWidth={1.5} />
                <rect x={1} y={5} width={7} height={5} rx={1} fill="none" stroke="var(--color-dim-label)" strokeWidth={1.5} />
              </g>
            )}
          </g>

          {/* Over-constrained unlock button (existing) */}
          {lockedNodeIds.includes(v.nodeId) && (
            <g
              role="button"
              tabIndex={0}
              transform={`translate(${v.x + v.w - 18 + 6}, ${v.y + 4 + 9.5}) scale(${1 / zoom}) translate(-6, -9.5)`}
              cursor={onUnlockNode ? 'pointer' : 'default'}
              onClick={() => onUnlockNode?.(v.nodeId)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onUnlockNode?.(v.nodeId)
              }}
              aria-label="Unlock section"
            >
              <path d="M3 7V5a3 3 0 1 1 6 0v2" fill="none" stroke="#fbbf24" strokeWidth={1.5} />
              <rect x={2} y={7} width={8} height={7} rx={1.5} fill="rgba(251,191,36,0.15)" stroke="#fbbf24" strokeWidth={1.5} />
            </g>
          )}
        </g>
      )
    })}

    {editing && (
      <DimensionEditor
        anchor={editing.anchor}
        currentMm={editing.currentMm}
        unit={unit}
        onCommit={(mm) => {
          onCommitSize(editing.nodeId, mm, editing.axis)
          setEditing(null)
        }}
        onClose={() => setEditing(null)}
      />
    )}
  </g>
)
```

Note: The height label `rotate` is kept on the `<text>` element only (not on the parent `<g>`). The lock icon for the height label is positioned in un-rotated SVG coordinate space, appearing above the rotated text label.

- [ ] **Step 4: Add `--color-dim-label` CSS variable to `src/index.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --color-dim-label: #374151;
}
```

This variable will be updated in Task 3 as part of the theme.

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /home/chryston/docker/copilot/repos/worktrees/buildbox-main-polish-features
npx vitest run src/components/CabinetCanvas/DimensionLabels.test.tsx
```

Expected: all DimensionLabels tests PASS

- [ ] **Step 6: Run full suite**

```bash
cd /home/chryston/docker/copilot/repos/worktrees/buildbox-main-polish-features
npx vitest run
```

Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
cd /home/chryston/docker/copilot/repos/worktrees/buildbox-main-polish-features
git add src/components/CabinetCanvas/DimensionLabels.tsx src/components/CabinetCanvas/DimensionLabels.test.tsx src/index.css
git commit -m "feat(canvas): locked dimension labels show 40% opacity + lock icon; editable labels underlined"
```

---

## Task 3: Clean Light SaaS Theme

**Design:** Replace the dark-purple palette with a clean-light palette (white surfaces, blue-600 accent, slate text, gray borders). The palette is defined once in `tailwind.config.ts`; all components swap their color classes accordingly. SVG fill colors use CSS custom properties defined in `index.css`.

**New Palette:**

| Token | Old | New |
|-------|-----|-----|
| `surface` | `#1e1e2e` | `#ffffff` |
| `panel` | `#2a2a3e` | `#f8f9fa` |
| `accent` | `#7c3aed` | `#2563eb` |
| `accent-hover` | — | `#1d4ed8` |
| `divider` | — | `#e5e7eb` |
| `text-primary` | — | `#111827` |
| `text-muted` | — | `#6b7280` |

**SVG color variables (index.css):**

| Variable | Value |
|----------|-------|
| `--color-dim-label` | `#374151` (gray-700) |
| `--color-accent` | `#2563eb` |
| `--color-panel` | `#f8f9fa` |

**Files:**
- Modify: `tailwind.config.ts`
- Modify: `src/index.css`
- Modify: `src/App.tsx`
- Modify: `src/components/Toolbar/Toolbar.tsx`
- Modify: `src/components/Toolbar/ExportModal.tsx`
- Modify: `src/components/Toolbar/ImportModal.tsx`
- Modify: `src/components/Toolbar/UndoRedo.tsx`
- Modify: `src/components/ProjectTabs/ProjectTabs.tsx`
- Modify: `src/components/Sidebar/Sidebar.tsx`
- Modify: `src/components/Sidebar/UnitSelector.tsx`
- Modify: `src/components/CutListPanel/CutListPanel.tsx`
- Modify: `src/components/DimensionEditor/DimensionEditor.tsx`
- Modify: `src/components/CabinetCanvas/ZoomControls.tsx`
- Modify: `src/components/CabinetCanvas/CabinetCanvas.tsx`
- Modify: `src/components/ErrorBoundary.tsx`
- Modify: `src/components/WarningBanner/WarningBanner.tsx`

- [ ] **Step 1: No new tests needed — existing tests cover component rendering. Run suite to confirm baseline.**

```bash
cd /home/chryston/docker/copilot/repos/worktrees/buildbox-main-polish-features
npx vitest run
```

Expected: all tests pass

- [ ] **Step 2: Update `tailwind.config.ts`**

```ts
import type { Config } from 'tailwindcss'
import forms from '@tailwindcss/forms'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: '#ffffff',
        panel: '#f8f9fa',
        accent: '#2563eb',
        'accent-hover': '#1d4ed8',
        divider: '#e5e7eb',
        'text-primary': '#111827',
        'text-muted': '#6b7280',
      },
    },
  },
  plugins: [forms],
} satisfies Config
```

- [ ] **Step 3: Update `src/index.css` with CSS custom properties**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --color-dim-label: #374151;
  --color-accent: #2563eb;
  --color-panel: #f8f9fa;
}
```

- [ ] **Step 4: Update `src/App.tsx` color classes**

Replace:
- `bg-surface text-white flex flex-col` → `bg-surface text-text-primary flex flex-col`
- `min-h-screen` → `h-screen overflow-hidden` (done in Task 1)
- `border-white/10 bg-panel` (warning banner wrapper) → `border-divider bg-panel`
- `bg-surface text-white` (loading fallback) → `bg-surface text-text-primary`

Full changes in `src/App.tsx`:
```tsx
// Line ~115 (outer div) — already changed in Task 1:
<div className="h-screen overflow-hidden bg-surface text-text-primary flex flex-col">

// Line ~110 (loading fallback):
return <div className="h-screen bg-surface text-text-primary">BuildBox</div>

// Warning banner (now inside activeModule guard, handled in T4 — see T4 Step 5 for full JSX):
{activeModule === 'cabinet' && overConstrainedIds.length > 0 && (
  <div className="border-b border-divider bg-panel px-4 py-2">
    <WarningBanner overConstrainedIds={overConstrainedIds} />
  </div>
)}

// main element:
<main className="flex flex-1 overflow-hidden min-h-0">
```

- [ ] **Step 5: Update `src/components/Toolbar/Toolbar.tsx` color classes**

Full replacement of class strings:

```tsx
// Header
<header className="flex flex-wrap items-center gap-4 border-b border-divider bg-panel px-4 py-2">

// BuildBox brand
<span className="mr-2 font-bold text-accent">BuildBox</span>

// Unit toggle group
<div className="flex overflow-hidden rounded border border-divider">
{UNITS.map((nextUnit) => (
  <button
    key={nextUnit}
    onClick={() => onSettingsChange({ unit: nextUnit })}
    className={`px-2 py-1 text-sm ${
      settings.unit === nextUnit ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'
    }`}
  >
    {nextUnit}
  </button>
))}
</div>

// NumField label and input:
<label htmlFor={htmlFor} className="flex items-center gap-1 text-sm text-text-muted">
  {label}
  <input
    ...
    className="w-20 rounded border border-divider bg-white px-1 py-0.5 text-right text-text-primary focus:border-accent focus:outline-none"
  />
</label>

// Export workspace button
<button className="rounded border border-divider px-3 py-1.5 text-sm text-text-muted hover:text-text-primary">
  ↓ Export
</button>
// Import workspace button
<button className="rounded border border-divider px-3 py-1.5 text-sm text-text-muted hover:text-text-primary">
  ↑ Import
</button>
// Export SVG button
<button className="rounded bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover">
  Export SVG
</button>
```

- [ ] **Step 6: Update `src/components/Toolbar/UndoRedo.tsx` color classes**

Replace all `text-white`, `text-white/60`, `border-white/20`, `bg-panel` with light-theme equivalents:

```tsx
// Undo button
<button
  ...
  className="flex h-8 w-8 items-center justify-center rounded border border-divider text-text-muted hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
>
// Redo button (same pattern)
```

- [ ] **Step 7: Update `src/components/Toolbar/ExportModal.tsx` and `ImportModal.tsx`**

Common pattern — replace:
- `bg-surface` → `bg-white`
- `bg-panel` → `bg-panel`
- `text-white` → `text-text-primary`
- `text-white/60` → `text-text-muted`
- `border-white/10` → `border-divider`
- `border-white/20` → `border-divider`
- `hover:bg-white/10` → `hover:bg-gray-100`
- `bg-accent` → `bg-accent`
- `rounded` modals get `shadow-xl`

Open each file and apply these replacements throughout.

- [ ] **Step 8: Update `src/components/ProjectTabs/ProjectTabs.tsx`**

```tsx
// Container
<div className="flex items-center gap-1 overflow-x-auto border-b border-divider bg-panel px-2 py-1">

// Tab item
className={`flex items-center gap-1 rounded px-3 py-1 text-sm select-none ${
  project.id === activeId
    ? 'bg-white text-text-primary shadow-sm border border-divider'
    : 'text-text-muted hover:text-text-primary hover:bg-white'
}`}

// Delete × button
<button className="ml-1 text-xs text-text-muted hover:text-red-500">×</button>

// New tab + button
<button className="... text-text-muted hover:text-text-primary">+</button>
```

- [ ] **Step 9: Update `src/components/Sidebar/Sidebar.tsx` and `UnitSelector.tsx`**

Common pattern in sidebar:
- Sidebar outer div: `border-l border-divider bg-panel`
- Section headings: `text-text-primary font-semibold`
- Secondary text: `text-text-muted`
- Buttons: `border-divider text-text-primary hover:bg-gray-100`
- Separator lines: `border-divider`
- Active unit highlight: `bg-accent/10 text-accent border-l-2 border-accent`
- Disabled/muted values: `text-text-muted`

- [ ] **Step 10: Update `src/components/CutListPanel/CutListPanel.tsx`**

```tsx
// "No parts" empty state
<div className="p-4 text-center text-sm text-text-muted">No parts to show</div>

// Heading
<h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">Cut List</h2>

// Table
<table className="w-full border-collapse text-sm text-text-primary">

// Header row
<tr className="border-b border-divider text-xs text-text-muted">

// Data cells — replace text-white/80 → text-text-primary, border-white/10 → border-divider
```

- [ ] **Step 11: Update `src/components/DimensionEditor/DimensionEditor.tsx`**

```tsx
// Container div
className="fixed z-50 rounded-lg border border-divider bg-white p-3 shadow-xl"

// Input
className="w-full rounded border border-divider px-2 py-1 text-sm text-text-primary focus:border-accent focus:outline-none"

// Confirm/cancel buttons — accent + border patterns
```

- [ ] **Step 12: Update `src/components/CabinetCanvas/ZoomControls.tsx`**

```tsx
// All three buttons
className="flex h-8 w-8 items-center justify-center rounded border border-divider bg-white text-text-primary shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
```

- [ ] **Step 13: Update `src/components/CabinetCanvas/CabinetCanvas.tsx`**

Replace:
- Outer div: `bg-surface` stays (now white)
- Active unit stroke: already uses `var(--color-accent)` — no change needed

- [ ] **Step 14: Update `src/components/ErrorBoundary.tsx` and `src/components/WarningBanner/WarningBanner.tsx`**

- ErrorBoundary: `bg-surface text-text-primary`
- WarningBanner: `bg-amber-50 border-amber-200 text-amber-800` (light warning style)

- [ ] **Step 15: Run full test suite**

```bash
cd /home/chryston/docker/copilot/repos/worktrees/buildbox-main-polish-features
npx vitest run
```

Expected: all tests pass

- [ ] **Step 16: Commit**

```bash
cd /home/chryston/docker/copilot/repos/worktrees/buildbox-main-polish-features
git add tailwind.config.ts src/index.css src/App.tsx \
  src/components/Toolbar/ src/components/ProjectTabs/ \
  src/components/Sidebar/ src/components/CutListPanel/ \
  src/components/DimensionEditor/ src/components/CabinetCanvas/ZoomControls.tsx \
  src/components/ErrorBoundary.tsx src/components/WarningBanner/
git commit -m "feat(theme): clean light SaaS theme — white surfaces, blue accent, slate text"
```

---

## Task 4: Floor Plan Module Placeholder

**Design:** A `ModuleSwitcher` component renders two pill buttons ("Cabinet" / "Floor Plan") in the App-level layout below the Toolbar (above the ProjectTabs row). A `FloorPlanPlaceholder` component renders a centered coming-soon panel. `App.tsx` holds `activeModule: 'cabinet' | 'floorplan'` state; when `floorplan` is active the canvas+sidebar are replaced by `FloorPlanPlaceholder`.

**Files:**
- Create: `src/components/ModuleSwitcher/ModuleSwitcher.tsx`
- Create: `src/components/FloorPlanPlaceholder/FloorPlanPlaceholder.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write the failing tests**

File: `src/components/ModuleSwitcher/ModuleSwitcher.test.tsx`

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import ModuleSwitcher from './ModuleSwitcher'

describe('ModuleSwitcher', () => {
  it('renders Cabinet and Floor Plan buttons', () => {
    render(<ModuleSwitcher activeModule="cabinet" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: /cabinet/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /floor plan/i })).toBeInTheDocument()
  })

  it('calls onChange with floorplan when Floor Plan clicked', async () => {
    const onChange = vi.fn()
    render(<ModuleSwitcher activeModule="cabinet" onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: /floor plan/i }))
    expect(onChange).toHaveBeenCalledWith('floorplan')
  })

  it('highlights active module button', () => {
    render(<ModuleSwitcher activeModule="floorplan" onChange={vi.fn()} />)
    const floorBtn = screen.getByRole('button', { name: /floor plan/i })
    expect(floorBtn).toHaveClass('bg-accent')
  })
})
```

File: `src/components/FloorPlanPlaceholder/FloorPlanPlaceholder.test.tsx`

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import FloorPlanPlaceholder from './FloorPlanPlaceholder'

describe('FloorPlanPlaceholder', () => {
  it('shows coming soon message', () => {
    render(<FloorPlanPlaceholder />)
    expect(screen.getByText(/floor plan/i)).toBeInTheDocument()
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/chryston/docker/copilot/repos/worktrees/buildbox-main-polish-features
npx vitest run src/components/ModuleSwitcher/ModuleSwitcher.test.tsx src/components/FloorPlanPlaceholder/FloorPlanPlaceholder.test.tsx
```

Expected: FAIL — modules not found

- [ ] **Step 3: Create `ModuleSwitcher.tsx`**

File: `src/components/ModuleSwitcher/ModuleSwitcher.tsx`

```tsx
type Module = 'cabinet' | 'floorplan'

interface Props {
  activeModule: Module
  onChange: (module: Module) => void
}

export default function ModuleSwitcher({ activeModule, onChange }: Props) {
  return (
    <div className="flex items-center gap-1 border-b border-divider bg-panel px-4 py-1.5">
      <div className="flex overflow-hidden rounded-md border border-divider">
        <button
          type="button"
          onClick={() => onChange('cabinet')}
          className={`px-4 py-1 text-sm font-medium transition-colors ${
            activeModule === 'cabinet'
              ? 'bg-accent text-white'
              : 'bg-white text-text-muted hover:text-text-primary'
          }`}
        >
          Cabinet
        </button>
        <button
          type="button"
          onClick={() => onChange('floorplan')}
          className={`px-4 py-1 text-sm font-medium transition-colors ${
            activeModule === 'floorplan'
              ? 'bg-accent text-white'
              : 'bg-white text-text-muted hover:text-text-primary'
          }`}
        >
          Floor Plan
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Create `FloorPlanPlaceholder.tsx`**

File: `src/components/FloorPlanPlaceholder/FloorPlanPlaceholder.tsx`

```tsx
export default function FloorPlanPlaceholder() {
  return (
    <div className="flex flex-1 items-center justify-center bg-surface">
      <div className="text-center">
        <div className="mb-4 text-6xl">🏠</div>
        <h2 className="mb-2 text-2xl font-semibold text-text-primary">Floor Plan</h2>
        <p className="text-text-muted">Coming Soon</p>
        <p className="mt-2 max-w-xs text-sm text-text-muted">
          Design your room layout and place cabinets in a top-down view. Available in a future update.
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Wire `App.tsx` — add `activeModule` state and conditional rendering**

Add import at the top of `src/App.tsx`:
```tsx
import ModuleSwitcher from './components/ModuleSwitcher/ModuleSwitcher'
import FloorPlanPlaceholder from './components/FloorPlanPlaceholder/FloorPlanPlaceholder'
```

Add state after the existing state declarations:
```tsx
const [activeModule, setActiveModule] = useState<'cabinet' | 'floorplan'>('cabinet')
```

In the JSX, add `ModuleSwitcher` **between `<Toolbar>` and `<ProjectTabs>`** (above ProjectTabs — it's a higher-level navigation concern):
```tsx
<Toolbar ... />
<ModuleSwitcher activeModule={activeModule} onChange={setActiveModule} />
<ProjectTabs ... />
```

Also wrap the over-constrained warning banner and the `<main>` cabinet contents inside an `activeModule === 'cabinet'` guard so floor plan view stays clean:

```tsx
<Toolbar ... />
<ModuleSwitcher activeModule={activeModule} onChange={setActiveModule} />
<ProjectTabs ... />
{activeModule === 'cabinet' && overConstrainedIds.length > 0 && (
  <div className="border-b border-divider bg-panel px-4 py-2">
    <WarningBanner overConstrainedIds={overConstrainedIds} />
  </div>
)}
<main className="flex flex-1 overflow-hidden min-h-0">
  {activeModule === 'floorplan' ? (
    <FloorPlanPlaceholder />
  ) : (
    <>
      {sceneLayout && (
        <CabinetCanvas
          sceneLayout={sceneLayout}
          svgRef={svgRef}
          onUnlockNode={storeUnlockNode}
          onUnitClick={setActiveUnit}
        />
      )}
      <Sidebar
        cutList={cutList}
        units={activeProject?.units ?? []}
        activeUnitId={activeUnitId}
        onAddUnit={addUnit}
        onRemoveUnit={removeUnit}
        onSelectUnit={setActiveUnit}
        onRenameUnit={renameUnit}
        selectedId={selectedId}
        selectedNode={selectedNode}
        onAddShelf={storeAddShelf}
        onAddDivider={storeAddDivider}
        onDelete={storeDeleteBoard}
        onToggleLock={(id) => {
          if (selectedNode?.locked) storeUnlockNode(id)
          else storeLocked(id, true)
        }}
        onSetMaterial={storeMaterial}
        onSetElementType={storeSetElementType}
        onSetDrawerConfig={storeDrawerConfig}
        onAddAccessory={(nodeId, type) => storeAddAccessory(nodeId, { id: crypto.randomUUID(), type })}
        onRemoveAccessory={storeRemoveAccessory}
      />
    </>
  )}
</main>

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd /home/chryston/docker/copilot/repos/worktrees/buildbox-main-polish-features
npx vitest run src/components/ModuleSwitcher/ModuleSwitcher.test.tsx src/components/FloorPlanPlaceholder/FloorPlanPlaceholder.test.tsx
```

Expected: all PASS

- [ ] **Step 7: Run full suite**

```bash
cd /home/chryston/docker/copilot/repos/worktrees/buildbox-main-polish-features
npx vitest run
```

Expected: all tests pass

- [ ] **Step 8: Commit**

```bash
cd /home/chryston/docker/copilot/repos/worktrees/buildbox-main-polish-features
git add src/components/ModuleSwitcher/ src/components/FloorPlanPlaceholder/ src/App.tsx
git commit -m "feat(modules): toolbar module switcher with Floor Plan coming-soon placeholder"
```

---

## Task 5: End-to-End Integration Test

**Purpose:** Verifies that a user can (1) add a shelf in cabinet mode, (2) switch to floor plan — sees placeholder, (3) switch back — cabinet state preserved. Also confirms fit-to-page button and dimension label lock icons render.

**Files:**
- Modify: `src/integration/cabinetFlow.test.tsx`

- [ ] **Step 1: Add integration test**

Append to `src/integration/cabinetFlow.test.tsx`:

```tsx
describe('Polish features E2E', () => {
  beforeEach(resetStore)

  it('user switches to Floor Plan and back, cabinet state preserved', async () => {
    const user = userEvent.setup()
    render(<App />)

    // Add a shelf to the cabinet
    const voids = screen.queryAllByTestId(/^void-/)
    await user.click(voids[0]!)
    await user.click(screen.getByRole('button', { name: /add shelf/i }))

    // Canvas shows the cabinet
    expect(screen.getByTestId('cabinet-canvas')).toBeInTheDocument()

    // Switch to Floor Plan
    await user.click(screen.getByRole('button', { name: /floor plan/i }))
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument()
    expect(screen.queryByTestId('cabinet-canvas')).not.toBeInTheDocument()

    // Switch back to Cabinet — canvas is back and shelf still there
    await user.click(screen.getByRole('button', { name: /cabinet/i }))
    expect(screen.getByTestId('cabinet-canvas')).toBeInTheDocument()
    // Cut list should show shelf entry
    const table = screen.getByRole('table')
    expect(within(table).getByText(/shelf/i)).toBeInTheDocument()
  })

  it('fit to page button is present and SVG has preserveAspectRatio', () => {
    render(<App />)
    expect(screen.getByLabelText('Fit to screen')).toBeInTheDocument()
    expect(screen.getByTestId('cabinet-canvas')).toHaveAttribute('preserveAspectRatio', 'xMidYMid meet')
  })
})
```

Note: `resetStore` and `render(<App />)` use the existing helpers defined earlier in `cabinetFlow.test.tsx`. Verify the `resetStore` function is exported or accessible at the describe level.

- [ ] **Step 2: Run integration tests**

```bash
cd /home/chryston/docker/copilot/repos/worktrees/buildbox-main-polish-features
npx vitest run src/integration/cabinetFlow.test.tsx
```

Expected: PASS (both new tests)

- [ ] **Step 3: Run full suite one final time**

```bash
cd /home/chryston/docker/copilot/repos/worktrees/buildbox-main-polish-features
npx vitest run
```

Expected: all tests pass (≥152)

- [ ] **Step 4: Commit**

```bash
cd /home/chryston/docker/copilot/repos/worktrees/buildbox-main-polish-features
git add src/integration/cabinetFlow.test.tsx
git commit -m "test(e2e): polish features integration — module switcher, fit-to-page, preserved state"
```

---

## Execution Order & Parallelisation

Tasks **T1** and **T2** are independent — safe to run in parallel.  
**T3** depends on T1 (needs `h-screen` layout change in App.tsx settled first) but is otherwise independent of T2.  
**T4** is independent of T1/T2/T3 — safe to run in parallel with T3.  
**T5** depends on T1, T2, T3, T4 all being complete.

Wave 0: T1 + T2 in parallel  
Wave 1: T3 + T4 in parallel  
Wave 2: T5  
