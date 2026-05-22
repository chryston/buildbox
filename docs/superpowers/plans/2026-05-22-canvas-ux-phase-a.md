# Canvas UX Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Maximise the canvas area by relocating the cut list into the sidebar, add zoom +/− and fit-all buttons, and keep dimension labels at a constant 14px on screen regardless of zoom.

**Architecture:** All changes are localised to the canvas and sidebar layers — no store changes, no data model changes. A new `fitAll.ts` utility exports `ZOOM_MIN`, `ZOOM_MAX`, and `computeFitAll()`. A new `ZoomControls` component floats over the canvas bottom-right. `DimensionLabels` gains a `zoom` prop and counter-scales font size and icon transforms.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 3, Vitest + React Testing Library

**Working directory:** `/home/chryston/docker/copilot/repos/worktrees/buildbox-main-canvas-ux`

**Run tests:** `npm test -- --run`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/utils/fitAll.ts` | **Create** | `ZOOM_MIN`, `ZOOM_MAX` constants; `computeFitAll()` pure function |
| `src/utils/fitAll.test.ts` | **Create** | Unit tests for fit-all function |
| `src/components/CabinetCanvas/ZoomControls.tsx` | **Create** | Stateless zoom overlay (−, +, ⊡ buttons) |
| `src/components/CabinetCanvas/ZoomControls.test.tsx` | **Create** | Component tests for ZoomControls |
| `src/components/CabinetCanvas/CabinetCanvas.tsx` | **Modify** | Wire ZoomControls, update onWheel clamp, pass zoom to DimensionLabels (**A3 depends on A2**: DimensionLabels must have `zoom` prop before CabinetCanvas wires it) |
| `src/components/CabinetCanvas/DimensionLabels.tsx` | **Modify** | Add `zoom` prop; `fontSize = 14 / zoom`; scale offsets and lock icon |
| `src/components/Sidebar/Sidebar.tsx` | **Modify** | Add `cutList` prop; render `CutListPanel` in `<details>` at bottom |
| `src/App.tsx` | **Modify** | Remove right panel div; pass `cutList` to `Sidebar`; remove `CutListPanel` import |
| `src/integration/cabinetFlow.test.tsx` | **Modify** | Add integration test for cut list in sidebar + zoom controls |

---

## Task A1: `fitAll.ts` Utility + `ZoomControls` Component

**Files:**
- Create: `src/utils/fitAll.ts`
- Create: `src/utils/fitAll.test.ts`
- Create: `src/components/CabinetCanvas/ZoomControls.tsx`
- Create: `src/components/CabinetCanvas/ZoomControls.test.tsx`

### Step 1: Write failing tests for `fitAll.ts`

- [ ] Create `src/utils/fitAll.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { computeFitAll, ZOOM_MAX, ZOOM_MIN } from './fitAll'

describe('computeFitAll', () => {
  it('returns zoom=1, panX=0, panY=0 — SVG viewBox already frames the cabinet', () => {
    expect(computeFitAll()).toEqual({ zoom: 1, panX: 0, panY: 0 })
  })
})

describe('zoom constants', () => {
  it('ZOOM_MIN is 0.05', () => expect(ZOOM_MIN).toBe(0.05))
  it('ZOOM_MAX is 10', () => expect(ZOOM_MAX).toBe(10))
})
```

### Step 2: Run to verify it fails

- [ ] Run: `npm test -- --run src/utils/fitAll.test.ts`
- Expected: FAIL — `fitAll` module not found

### Step 3: Implement `fitAll.ts`

- [ ] Create `src/utils/fitAll.ts`:

```ts
export const ZOOM_MIN = 0.05
export const ZOOM_MAX = 10

export function computeFitAll(): { zoom: number; panX: number; panY: number } {
  // The SVG viewBox already frames the full cabinet at zoom=1, pan=(0,0).
  // Fit-all simply resets the user-controlled zoom/pan overlay transform.
  return { zoom: 1, panX: 0, panY: 0 }
}
```

### Step 4: Run to verify `fitAll` tests pass

- [ ] Run: `npm test -- --run src/utils/fitAll.test.ts`
- Expected: 3 tests PASS

### Step 5: Write failing tests for `ZoomControls`

- [ ] Create `src/components/CabinetCanvas/ZoomControls.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ZOOM_MAX, ZOOM_MIN } from '../../utils/fitAll'
import ZoomControls from './ZoomControls'

describe('ZoomControls', () => {
  it('calls onZoomIn when + clicked', async () => {
    const onZoomIn = vi.fn()
    render(<ZoomControls zoom={1} onZoomIn={onZoomIn} onZoomOut={vi.fn()} onFitAll={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /zoom in/i }))
    expect(onZoomIn).toHaveBeenCalledOnce()
  })

  it('calls onZoomOut when − clicked', async () => {
    const onZoomOut = vi.fn()
    render(<ZoomControls zoom={1} onZoomIn={vi.fn()} onZoomOut={onZoomOut} onFitAll={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /zoom out/i }))
    expect(onZoomOut).toHaveBeenCalledOnce()
  })

  it('calls onFitAll when ⊡ clicked', async () => {
    const onFitAll = vi.fn()
    render(<ZoomControls zoom={1} onZoomIn={vi.fn()} onZoomOut={vi.fn()} onFitAll={onFitAll} />)
    await userEvent.click(screen.getByRole('button', { name: /fit to screen/i }))
    expect(onFitAll).toHaveBeenCalledOnce()
  })

  it('disables + button at ZOOM_MAX', () => {
    render(<ZoomControls zoom={ZOOM_MAX} onZoomIn={vi.fn()} onZoomOut={vi.fn()} onFitAll={vi.fn()} />)
    expect(screen.getByRole('button', { name: /zoom in/i })).toBeDisabled()
  })

  it('disables − button at ZOOM_MIN', () => {
    render(<ZoomControls zoom={ZOOM_MIN} onZoomIn={vi.fn()} onZoomOut={vi.fn()} onFitAll={vi.fn()} />)
    expect(screen.getByRole('button', { name: /zoom out/i })).toBeDisabled()
  })
})
```

### Step 6: Run to verify ZoomControls tests fail

- [ ] Run: `npm test -- --run src/components/CabinetCanvas/ZoomControls.test.tsx`
- Expected: FAIL — `ZoomControls` not found

### Step 7: Implement `ZoomControls.tsx`

- [ ] Create `src/components/CabinetCanvas/ZoomControls.tsx`:

```tsx
import { ZOOM_MAX, ZOOM_MIN } from '../../utils/fitAll'

interface Props {
  zoom: number
  onZoomIn: () => void
  onZoomOut: () => void
  onFitAll: () => void
}

export default function ZoomControls({ zoom, onZoomIn, onZoomOut, onFitAll }: Props) {
  return (
    <div className="absolute bottom-4 right-4 z-10 flex gap-1">
      <button
        type="button"
        aria-label="Zoom out"
        disabled={zoom <= ZOOM_MIN}
        onClick={onZoomOut}
        className="flex h-8 w-8 items-center justify-center rounded bg-panel text-white shadow hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
      >
        −
      </button>
      <button
        type="button"
        aria-label="Zoom in"
        disabled={zoom >= ZOOM_MAX}
        onClick={onZoomIn}
        className="flex h-8 w-8 items-center justify-center rounded bg-panel text-white shadow hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
      >
        +
      </button>
      <button
        type="button"
        aria-label="Fit to screen"
        onClick={onFitAll}
        className="flex h-8 w-8 items-center justify-center rounded bg-panel text-white shadow hover:bg-white/10"
      >
        ⊡
      </button>
    </div>
  )
}
```

### Step 8: Run all A1 tests

- [ ] Run: `npm test -- --run src/utils/fitAll.test.ts src/components/CabinetCanvas/ZoomControls.test.tsx`
- Expected: 8 tests PASS

### Step 9: Run full suite to check no regressions

- [ ] Run: `npm test -- --run`
- Expected: all existing tests still PASS

### Step 10: Commit

- [ ] Run:
```bash
git add src/utils/fitAll.ts src/utils/fitAll.test.ts \
        src/components/CabinetCanvas/ZoomControls.tsx \
        src/components/CabinetCanvas/ZoomControls.test.tsx
git commit -m "feat(canvas-ux): add fitAll utility and ZoomControls component

- ZOOM_MIN=0.05, ZOOM_MAX=10 exported from fitAll.ts
- computeFitAll() returns {zoom:1, panX:0, panY:0}
- ZoomControls: −/+/⊡ buttons, disabled at limits, aria-labels
- 8 tests passing"
```

---

## Task A2: `DimensionLabels` — constant 14px font

**Files:**
- Modify: `src/components/CabinetCanvas/DimensionLabels.tsx`

### Step 1: Write failing tests for DimensionLabels font scaling

- [ ] Open `src/components/CabinetCanvas/DimensionLabels.tsx` and check the existing test file location:

```bash
ls src/components/CabinetCanvas/
```

If no `DimensionLabels.test.tsx` exists, create it. Otherwise append to it.

- [ ] Create/append `src/components/CabinetCanvas/DimensionLabels.test.tsx`:

```tsx
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { LayoutVoid } from '../../types'
import DimensionLabels from './DimensionLabels'

function makeVoid(id: string): LayoutVoid {
  return {
    nodeId: id, x: 0, y: 0, w: 200, h: 100,
    parentSplitAxis: 'horizontal',
    elementType: 'void',
    material: 'oak',
    accessories: [],
  }
}

describe('DimensionLabels font scaling', () => {
  it('applies fontSize=28 at zoom=0.5 (14/0.5)', () => {
    const { container } = render(
      <svg>
        <DimensionLabels
          voids={[makeVoid('v1')]}
          unit="mm"
          onCommitSize={() => {}}
          zoom={0.5}
        />
      </svg>
    )
    const texts = container.querySelectorAll('text')
    for (const t of texts) {
      expect(Number(t.getAttribute('font-size'))).toBeCloseTo(28, 5)
    }
  })

  it('applies fontSize=14 at zoom=1.0', () => {
    const { container } = render(
      <svg>
        <DimensionLabels
          voids={[makeVoid('v1')]}
          unit="mm"
          onCommitSize={() => {}}
          zoom={1}
        />
      </svg>
    )
    const texts = container.querySelectorAll('text')
    for (const t of texts) {
      expect(Number(t.getAttribute('font-size'))).toBeCloseTo(14, 5)
    }
  })

  it('applies fontSize=7 at zoom=2.0 (14/2)', () => {
    const { container } = render(
      <svg>
        <DimensionLabels
          voids={[makeVoid('v1')]}
          unit="mm"
          onCommitSize={() => {}}
          zoom={2}
        />
      </svg>
    )
    const texts = container.querySelectorAll('text')
    for (const t of texts) {
      expect(Number(t.getAttribute('font-size'))).toBeCloseTo(7, 5)
    }
  })
})
```

### Step 2: Run to verify tests fail

- [ ] Run: `npm test -- --run src/components/CabinetCanvas/DimensionLabels.test.tsx`
- Expected: FAIL — `zoom` prop doesn't exist yet / font-size is `11`

### Step 3: Update `DimensionLabels.tsx`

- [ ] Replace `src/components/CabinetCanvas/DimensionLabels.tsx` with:

```tsx
import { useState } from 'react'
import { formatDisplay } from '../../engine/unitConversion'
import type { LayoutVoid, Unit } from '../../types'
import DimensionEditor from '../DimensionEditor/DimensionEditor'

interface Props {
  voids: LayoutVoid[]
  unit: Unit
  onCommitSize: (nodeId: string, mm: number, axis: 'w' | 'h') => void
  onUnlockNode?: (nodeId: string) => void
  lockedNodeIds?: string[]
  zoom: number
}

interface Editing {
  nodeId: string
  axis: 'w' | 'h'
  currentMm: number
  anchor: { x: number; y: number; width: number; height: number }
}

export default function DimensionLabels(props: Props) {
  const {
    voids,
    unit,
    onCommitSize,
    onUnlockNode,
    lockedNodeIds = [],
    zoom,
  } = props
  const [editing, setEditing] = useState<Editing | null>(null)

  const fontSize = 14 / zoom

  function openEditor(v: LayoutVoid, axis: 'w' | 'h', labelEl: SVGTextElement) {
    const rect = labelEl.getBoundingClientRect()
    setEditing({
      nodeId: v.nodeId,
      axis,
      currentMm: axis === 'w' ? v.w : v.h,
      anchor: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
    })
  }

  return (
    <g data-layer="dimension-labels">
      {voids.map((v) => {
        const canEditH = v.parentSplitAxis === 'horizontal'
        const canEditW = v.parentSplitAxis === 'vertical'

        return (
          <g key={v.nodeId}>
            <text
              data-testid={`dim-label-${v.nodeId}-w`}
              x={v.x + v.w / 2}
              y={v.y + fontSize + 2}
              textAnchor="middle"
              fontSize={fontSize}
              fill="rgba(255,255,255,0.7)"
              cursor={canEditW ? 'pointer' : 'default'}
              onClick={canEditW ? (e) => openEditor(v, 'w', e.currentTarget) : undefined}
            >
              {formatDisplay(v.w, unit)}
            </text>

            <text
              data-testid={`dim-label-${v.nodeId}-h`}
              x={v.x + fontSize + 2}
              y={v.y + v.h / 2}
              textAnchor="middle"
              fontSize={fontSize}
              fill="rgba(255,255,255,0.7)"
              transform={`rotate(-90, ${v.x + fontSize + 2}, ${v.y + v.h / 2})`}
              cursor={canEditH ? 'pointer' : 'default'}
              onClick={canEditH ? (e) => openEditor(v, 'h', e.currentTarget) : undefined}
            >
              {formatDisplay(v.h, unit)}
            </text>

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
                <rect
                  x={2}
                  y={7}
                  width={8}
                  height={7}
                  rx={1.5}
                  fill="rgba(251,191,36,0.15)"
                  stroke="#fbbf24"
                  strokeWidth={1.5}
                />
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
}
```

### Step 4: Run all tests

- [ ] Run: `npm test -- --run`
- Expected: all tests PASS including the 3 new DimensionLabels font tests

### Step 5: Commit

- [ ] Run:
```bash
git add src/components/CabinetCanvas/DimensionLabels.tsx \
        src/components/CabinetCanvas/DimensionLabels.test.tsx
git commit -m "feat(canvas-ux): DimensionLabels constant 14px font via counter-scaling

- zoom prop added to DimensionLabels
- fontSize = 14 / zoom (28 SVG units at zoom=0.5 → 14px on screen)
- label offsets scale with fontSize (v.y + fontSize + 2)
- lock icon uses scale(1/zoom) to remain constant screen size
- 3 font-scaling tests added"
```

---

## Task A3: Wire `CabinetCanvas`

**Files:**
- Modify: `src/components/CabinetCanvas/CabinetCanvas.tsx`

### Step 1: Read the current CabinetCanvas

- [ ] Read `src/components/CabinetCanvas/CabinetCanvas.tsx` (shown above in context)

### Step 2: Update `CabinetCanvas.tsx`

- [ ] Apply all changes to `src/components/CabinetCanvas/CabinetCanvas.tsx`:

```tsx
import { useCallback, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useStore } from '../../store/store'
import type { Design, LayoutResult } from '../../types'
import { computeFitAll, ZOOM_MAX, ZOOM_MIN } from '../../utils/fitAll'
import CanvasLayers from './CanvasLayers'
import DragHandles from './DragHandles'
import DimensionLabels from './DimensionLabels'
import ZoomControls from './ZoomControls'

interface Props {
  design: Design
  layout: LayoutResult
  svgRef: RefObject<SVGSVGElement | null>
  overConstrainedIds: string[]
  onUnlockNode: (nodeId: string) => void
}

const PADDING = 40

export default function CabinetCanvas({ design, layout, svgRef, overConstrainedIds, onUnlockNode }: Props) {
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const isPanning = useRef(false)
  const lastPan = useRef({ x: 0, y: 0 })
  const selectedId = useStore((s) => s.selectedId)
  const setSelectedId = useStore((s) => s.setSelectedId)
  const storeSetNodeSize = useStore((s) => s.setNodeSize)
  const snapGrid = useStore((s) => s.snapGrid)

  const { width: cW, height: cH } = design.globalSettings
  const viewBox = `${-PADDING} ${-PADDING} ${cW + 2 * PADDING} ${cH + 2 * PADDING}`

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * (e.deltaY < 0 ? 1.1 : 0.9))))
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 1 && !e.altKey) return
    isPanning.current = true
    lastPan.current = { x: e.clientX, y: e.clientY }
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPanning.current) return
    const dx = e.clientX - lastPan.current.x
    const dy = e.clientY - lastPan.current.y
    lastPan.current = { x: e.clientX, y: e.clientY }
    setPan((p) => ({ x: p.x + dx, y: p.y + dy }))
  }, [])

  const onPointerUp = useCallback(() => {
    isPanning.current = false
  }, [])

  const onPointerCancel = useCallback(() => {
    isPanning.current = false
  }, [])

  const handleZoomIn = useCallback(() => {
    setZoom((z) => Math.min(ZOOM_MAX, z * 1.25))
  }, [])

  const handleZoomOut = useCallback(() => {
    setZoom((z) => Math.max(ZOOM_MIN, z * 0.8))
  }, [])

  const handleFitAll = useCallback(() => {
    const { zoom: z, panX, panY } = computeFitAll()
    setZoom(z)
    setPan({ x: panX, y: panY })
  }, [])

  function handleCommitSize(nodeId: string, mm: number, _axis: 'w' | 'h') {
    storeSetNodeSize(nodeId, mm)
  }

  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-surface">
      <svg
        ref={svgRef}
        data-testid="cabinet-canvas"
        viewBox={viewBox}
        className="h-full w-full"
        style={{ touchAction: 'none' }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <g transform={`matrix(${zoom},0,0,${zoom},${pan.x},${pan.y})`}>
          <CanvasLayers
            panels={layout.panels}
            voids={layout.voids}
            dividers={layout.dividers}
            selectedId={selectedId}
            onSelectVoid={setSelectedId}
            onSelectDivider={setSelectedId}
          />
          <DimensionLabels
            voids={layout.voids}
            unit={design.globalSettings.unit}
            onCommitSize={handleCommitSize}
            lockedNodeIds={overConstrainedIds}
            onUnlockNode={onUnlockNode}
            zoom={zoom}
          />
          <DragHandles
            dividers={layout.dividers}
            snapGrid={snapGrid}
            svgRef={svgRef}
            zoom={zoom}
          />
        </g>
      </svg>
      <ZoomControls
        zoom={zoom}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onFitAll={handleFitAll}
      />
    </div>
  )
}
```

### Step 3: Run full test suite

- [ ] Run: `npm test -- --run`
- Expected: all tests PASS

### Step 4: Commit

- [ ] Run:
```bash
git add src/components/CabinetCanvas/CabinetCanvas.tsx
git commit -m "feat(canvas-ux): wire ZoomControls and fit-all into CabinetCanvas

- Import ZoomControls, computeFitAll, ZOOM_MIN, ZOOM_MAX
- handleZoomIn/Out/FitAll handlers with clamped setZoom
- onWheel clamp updated from [0.2,5] to [ZOOM_MIN, ZOOM_MAX]
- ZoomControls rendered as absolute overlay bottom-right
- zoom prop passed to DimensionLabels (A2 already added the prop)"
```

---

## Task A4: Cut List Relocation + Integration Test

**Files:**
- Modify: `src/components/Sidebar/Sidebar.tsx`
- Modify: `src/App.tsx`
- Modify: `src/integration/cabinetFlow.test.tsx`

### Step 1: Write the failing integration test

- [ ] Open `src/integration/cabinetFlow.test.tsx` and append a new `it` block inside the existing `describe`:

```tsx
it('shows cut list in sidebar, removes right panel, and fit-all resets zoom', async () => {
  const user = userEvent.setup()
  render(<App />)

  // Cut list lives inside the sidebar <aside>, not in a standalone right panel
  const aside = screen.getByRole('complementary')
  expect(within(aside).getByText(/cut list/i)).toBeInTheDocument()

  // Zoom controls are rendered on the canvas
  const zoomInBtn = screen.getByRole('button', { name: /zoom in/i })
  const zoomOutBtn = screen.getByRole('button', { name: /zoom out/i })
  const fitAllBtn = screen.getByRole('button', { name: /fit to screen/i })
  expect(zoomInBtn).toBeInTheDocument()
  expect(zoomOutBtn).toBeInTheDocument()
  expect(fitAllBtn).toBeInTheDocument()

  // Saturate zoom to ZOOM_MAX so fit-all has real signal
  for (let i = 0; i < 25; i++) await user.click(zoomInBtn)
  expect(zoomInBtn).toBeDisabled()

  // Fit-all resets zoom to 1 — zoom-in re-enables
  await user.click(fitAllBtn)
  expect(zoomInBtn).toBeEnabled()
})
```

### Step 2: Run to verify test fails

- [ ] Run: `npm test -- --run src/integration/cabinetFlow.test.tsx`
- Expected: FAIL — cut list details not found, zoom buttons not found

### Step 3: Update `Sidebar.tsx`

- [ ] In `src/components/Sidebar/Sidebar.tsx`:
  - Add `import CutListPanel from '../CutListPanel/CutListPanel'`
  - Add `import type { CutListEntry } from '../../types'` to the existing type imports
  - Add `cutList: CutListEntry[]` to the `Props` interface
  - Add `cutList` to the destructured props
  - Append this section at the bottom of `<aside>`, after the Accessories section:

```tsx
      <details className="border-t border-white/10">
        <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white/40">
          Cut List ({cutList.length} parts)
        </summary>
        <div className="max-h-64 overflow-y-auto">
          <CutListPanel entries={cutList} />
        </div>
      </details>
```

### Step 4: Update `App.tsx`

- [ ] In `src/App.tsx`:
  - Remove the `import CutListPanel from './components/CutListPanel/CutListPanel'` line
  - Pass `cutList={cutList}` to `<Sidebar>`
  - Remove the entire right panel div:
    ```tsx
    // DELETE this block:
    <div className="flex w-72 flex-col overflow-y-auto border-l border-white/10 bg-panel">
      <details open className="p-2">
        <summary className="cursor-pointer select-none text-sm font-semibold text-white/60">
          Cut List ({cutList.length} parts)
        </summary>
        <CutListPanel entries={cutList} />
      </details>
    </div>
    ```

### Step 5: Run all tests

- [ ] Run: `npm test -- --run`
- Expected: all tests PASS including the new integration test

> **Note on existing integration test:** The existing test queries `screen.getByRole('table')` to find the cut list table. After relocation, the `<table>` is still in the DOM (inside the sidebar's `<details>`), so the existing test keeps passing without any changes.

### Step 6: Commit

- [ ] Run:
```bash
git add src/components/Sidebar/Sidebar.tsx src/App.tsx \
        src/integration/cabinetFlow.test.tsx
git commit -m "feat(canvas-ux): relocate cut list into sidebar, remove right panel

- Sidebar gains cutList prop; renders CutListPanel in <details> at bottom
- max-h-64 overflow-y-auto inner wrapper caps expanded height at 256px
- App.tsx: remove w-72 right panel div and CutListPanel import
- Integration test: verifies cut list in sidebar, zoom controls present"
```

---

## Final Verification

After all four tasks are complete:

- [ ] Run: `npm test -- --run`
- Expected: all tests PASS (≥ 104 tests: 92 existing + 8 new from A1 + 3 new from A2 (DimensionLabels) + 1 new from A4 = 104 total)
- [ ] Check TypeScript: `npx tsc --noEmit`
- Expected: no errors
