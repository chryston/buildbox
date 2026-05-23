# Phase C: Kitchen Countertop Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `countertop` unit type with sink/hob placement on a slab, microwave void type in cabinets, and structured cut list output for countertop slabs.

**Architecture:** Extend the Phase B `CabinetUnit` discriminated union with `CountertopSceneUnit`. The layout engine branches on `unit.type` — countertops get `computeCountertopLayout`. Canvas branches on `result.kind`. `CountertopLayer` renders the slab and draggable/resizable elements. Cut list emits structured `cutouts[]`.

**Tech Stack:** React 19, TypeScript, Zustand + immer, Tailwind CSS, Vitest + RTL

**Working directory:** `/home/chryston/docker/copilot/repos/worktrees/buildbox-fixes-export-phase-bc`

**Prerequisite:** Phase B must be fully complete before starting Phase C.

---

## Task C1: Extend Types for Phase C

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Write failing type tests**

```ts
// Add to src/types/index.test.ts
import type { CountertopSceneUnit, CountertopSettings, CountertopElement, CabinetUnit, CountertopLayout, AnyUnitLayout, CutListEntry } from './index'

it('CountertopSceneUnit has type countertop, settings, elements', () => {
  const unit: CountertopSceneUnit = {
    type: 'countertop', id: 'ct1', label: 'Worktop', x: 0, y: 0,
    settings: { worktopWidth: 1200, worktopDepth: 600, slabThickness: 20, material: 'granite' },
    elements: [],
  }
  expect(unit.type).toBe('countertop')
})

it('CabinetUnit union covers both cabinet and countertop', () => {
  const units: CabinetUnit[] = [
    { type: 'cabinet', id: 'c1', label: 'Base', x: 0, y: 0,
      settings: { unit: 'mm', height: 800, width: 600, depth: 500, thickness: 18, backThickness: 6, toeKick: null, defaultMaterial: 'oak' },
      root: { id: 'r1', elementType: 'void' } },
    { type: 'countertop', id: 'ct1', label: 'Top', x: 0, y: -20,
      settings: { worktopWidth: 600, worktopDepth: 600, slabThickness: 20, material: 'quartz' },
      elements: [] },
  ]
  expect(units[1].type).toBe('countertop')
})

it('CountertopLayout has kind countertop', () => {
  const layout: CountertopLayout = {
    kind: 'countertop', unitId: 'ct1', label: 'Top', isActive: false,
    x: 0, y: 0, w: 1200, h: 20,
    slabRect: { x: 0, y: 0, w: 1200, h: 600 },
    elements: [],
  }
  expect(layout.kind).toBe('countertop')
})

it('AnyUnitLayout is narrowable by kind', () => {
  const layout: AnyUnitLayout = {
    kind: 'countertop', unitId: 'ct1', label: 'Top', isActive: false,
    x: 0, y: 0, w: 1200, h: 20,
    slabRect: { x: 0, y: 0, w: 1200, h: 600 },
    elements: [],
  }
  if (layout.kind === 'countertop') {
    expect(layout.slabRect).toBeDefined()
  }
})

it('CutListEntry has optional cutouts array', () => {
  const e: CutListEntry = {
    label: 'Countertop (granite)', qty: 1, width: 1200, height: 600, depth: 20,
    material: 'granite', unitId: 'ct1', unitLabel: 'Worktop',
    cutouts: [{ type: 'sink', label: 'Sink', width: 600, depth: 500 }],
  }
  expect(e.cutouts![0].type).toBe('sink')
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/chryston/docker/copilot/repos/worktrees/buildbox-fixes-export-phase-bc
npx vitest run src/types/index.test.ts
```
Expected: Compilation errors (new types don't exist)

- [ ] **Step 3: Update `src/types/index.ts` — add Phase C types**

Add these to `types/index.ts` (after the existing Phase B types):

```ts
// --- Phase C: Countertop types ---

export type CountertopMaterialId = 'granite' | 'marble' | 'quartz'

export interface CountertopSettings {
  worktopWidth: number     // mm — total width of slab
  worktopDepth: number     // mm — front-to-back depth (e.g. 600)
  slabThickness: number    // mm — slab thickness (e.g. 20–40)
  material: CountertopMaterialId
}

export type CountertopElementType = 'sink' | 'hob'

export interface CountertopElement {
  id: string
  type: CountertopElementType
  label: string            // user-editable, e.g. "1.5 Bowl Sink"
  x: number                // mm offset from countertop left edge (clamped ≥ 0)
  y: number                // mm offset from countertop front edge (clamped ≥ 0)
  width: number            // mm (clamped: x + width ≤ worktopWidth)
  depth: number            // mm (clamped: y + depth ≤ worktopDepth)
}

export interface CountertopSceneUnit {
  type: 'countertop'
  id: string
  label: string
  x: number
  y: number
  settings: CountertopSettings
  elements: CountertopElement[]
}

// Extend CabinetUnit to be a true discriminated union (Phase B had only CabinetSceneUnit)
export type CabinetUnit = CabinetSceneUnit | CountertopSceneUnit

export interface CountertopElementLayout {
  element: CountertopElement
  // x, y are relative to countertop origin (same as element.x, element.y)
  // The parent <g translate(ct.x, ct.y)> handles scene-level offset
}

export interface CountertopLayout {
  kind: 'countertop'
  unitId: string
  label: string
  isActive: boolean
  x: number; y: number
  w: number; h: number
  slabRect: { x: number; y: number; w: number; h: number }  // in unit-local coords
  unit: 'mm'              // countertops always in mm for now
  elements: CountertopElementLayout[]
}

// Replace the Phase B UnitLayoutResult-only union:
export type AnyUnitLayout = UnitLayoutResult | CountertopLayout

export interface SceneLayout {
  units: AnyUnitLayout[]
  boundingBox: { x: number; y: number; w: number; h: number }
}
```

Also update `ElementType` to add `'microwave'` and update `CutListEntry.cutouts`:

```ts
export type ElementType = 'void' | 'drawer' | 'hanging-space' | 'microwave'

export interface CutListEntry {
  label: string
  qty: number
  width: number
  height: number
  depth: number
  material: CabinetMaterialId | CountertopMaterialId
  unitId: string
  unitLabel: string
  cutouts?: Array<{
    type: CountertopElementType
    label: string
    width: number
    depth: number
  }>
  notes?: string
}
```

Note: `SceneLayout` is now re-defined to use `AnyUnitLayout` instead of `UnitLayoutResult[]`. Update the Phase B `SceneLayout` definition in types to match. The `UnitLayoutResult` still has `kind: 'cabinet'` to form the discriminated union.

- [ ] **Step 4: Run all type tests**

```bash
npx vitest run src/types/index.test.ts
```
Expected: All pass (both Phase B and C type tests). Then check `npx tsc --noEmit` — fix any TypeScript errors from the `CabinetUnit` union change.

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/types/index.test.ts
git commit -m "feat(types): Phase C — CountertopSceneUnit, CountertopSettings, CountertopElement, AnyUnitLayout"
```

---

## Task C2: Extend Layout Engine for Countertop

**Files:**
- Modify: `src/engine/layoutEngine.ts`
- Modify: `src/engine/layoutEngine.test.ts`

Depends on: Task C1

- [ ] **Step 1: Write failing tests**

```ts
// Add to src/engine/layoutEngine.test.ts
import type { CountertopSceneUnit } from '../types'

function makeCountertopUnit(id: string, label: string, x = 0, y = 0): CountertopSceneUnit {
  return {
    type: 'countertop', id, label, x, y,
    settings: { worktopWidth: 1200, worktopDepth: 600, slabThickness: 20, material: 'granite' },
    elements: [
      { id: 'e1', type: 'sink', label: 'Sink', x: 300, y: 50, width: 600, depth: 500 },
    ],
  }
}

describe('computeSceneLayout with countertop unit', () => {
  it('produces CountertopLayout with kind countertop', () => {
    const ct = makeCountertopUnit('ct1', 'Worktop')
    const scene = computeSceneLayout([ct], 'ct1')
    expect(scene.units[0].kind).toBe('countertop')
  })

  it('slabRect dimensions match settings', () => {
    const ct = makeCountertopUnit('ct1', 'Worktop')
    const scene = computeSceneLayout([ct], 'ct1')
    const layout = scene.units[0] as import('../types').CountertopLayout
    expect(layout.slabRect.w).toBe(1200)
    expect(layout.slabRect.h).toBe(600)
  })

  it('elements appear in CountertopLayout', () => {
    const ct = makeCountertopUnit('ct1', 'Worktop')
    const scene = computeSceneLayout([ct], 'ct1')
    const layout = scene.units[0] as import('../types').CountertopLayout
    expect(layout.elements).toHaveLength(1)
    expect(layout.elements[0].element.type).toBe('sink')
  })

  it('mixed cabinet + countertop produces bounding box covering both', () => {
    const cabinet = makeUnit('c1', 'Base', 0)  // width=600, height=800
    const ct = makeCountertopUnit('ct1', 'Top', 0, -20)  // y=-20 (sits on top)
    const scene = computeSceneLayout([cabinet, ct], 'c1')
    expect(scene.units).toHaveLength(2)
    expect(scene.boundingBox.y).toBe(-20)       // countertop starts above
    expect(scene.boundingBox.h).toBeGreaterThan(800)
  })

  it('out-of-bounds element is clamped in CountertopLayout', () => {
    // Element at x=9999 should be clamped to worktopWidth - element.width = 1200 - 600 = 600
    const ct: CountertopSceneUnit = {
      type: 'countertop', id: 'ct1', label: 'Top', x: 0, y: 0,
      settings: { worktopWidth: 1200, worktopDepth: 600, slabThickness: 20, material: 'granite' },
      elements: [{ id: 'e1', type: 'hob', label: 'Hob', x: 9999, y: 0, width: 600, depth: 520 }],
    }
    const scene = computeSceneLayout([ct], 'ct1')
    const layout = scene.units[0] as import('../types').CountertopLayout
    expect(layout.elements[0].element.x).toBe(600)  // clamped
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/engine/layoutEngine.test.ts
```
Expected: FAIL — `computeSceneLayout` doesn't handle countertop units yet

- [ ] **Step 3: Add `computeCountertopLayout` and branch in `computeSceneLayout`**

Add this function to `layoutEngine.ts`:

```ts
import type { ..., CountertopSceneUnit, CountertopLayout, CountertopElementLayout, AnyUnitLayout } from '../types'

function clampElement(el: CountertopElement, settings: CountertopSettings): CountertopElement {
  const x = Math.max(0, Math.min(el.x, settings.worktopWidth - el.width))
  const y = Math.max(0, Math.min(el.y, settings.worktopDepth - el.depth))
  const width = Math.min(el.width, settings.worktopWidth)
  const depth = Math.min(el.depth, settings.worktopDepth)
  return { ...el, x, y, width, depth }
}

function computeCountertopLayout(unit: CountertopSceneUnit, activeUnitId: string | null): CountertopLayout {
  const { settings } = unit
  const slabRect = { x: 0, y: 0, w: settings.worktopWidth, h: settings.worktopDepth }
  const elements: CountertopElementLayout[] = unit.elements.map(el => ({
    element: clampElement(el, settings),
  }))
  return {
    kind: 'countertop',
    unitId: unit.id,
    label: unit.label,
    isActive: unit.id === activeUnitId,
    x: unit.x,
    y: unit.y,
    w: settings.worktopWidth,
    h: settings.slabThickness,  // elevation height = slab thickness
    unit: 'mm',
    slabRect,
    elements,
  }
}
```

Update `computeSceneLayout` to branch on `unit.type`:

```ts
export function computeSceneLayout(units: CabinetUnit[], activeUnitId: string | null): SceneLayout {
  const unitResults: AnyUnitLayout[] = units.map(unit => {
    if (unit.type === 'countertop') {
      return computeCountertopLayout(unit, activeUnitId)
    }
    const inner = computeUnitLayout(unit.settings, unit.root)
    return {
      kind: 'cabinet' as const,
      unitId: unit.id,
      label: unit.label,
      isActive: unit.id === activeUnitId,
      x: unit.x,
      y: unit.y,
      w: unit.settings.width,
      h: unit.settings.height,
      unit: unit.settings.unit,
      ...inner,
    }
  })

  const boundingBox = computeBoundingBoxFromLayouts(unitResults)
  return { units: unitResults, boundingBox }
}

function computeBoundingBoxFromLayouts(layouts: AnyUnitLayout[]): SceneLayout['boundingBox'] {
  if (layouts.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const l of layouts) {
    minX = Math.min(minX, l.x)
    minY = Math.min(minY, l.y)
    maxX = Math.max(maxX, l.x + l.w)
    maxY = Math.max(maxY, l.y + l.h)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}
```

(Replace the old `computeBoundingBox` that took `CabinetUnit[]` with this layout-based version.)

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/engine/layoutEngine.test.ts
```
Expected: All new + existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/engine/layoutEngine.ts src/engine/layoutEngine.test.ts
git commit -m "feat(engine): computeCountertopLayout with element clamping; AnyUnitLayout branch"
```

---

## Task C3: Extend Cut List for Countertop

**Files:**
- Modify: `src/engine/cutList.ts`
- Modify: `src/engine/cutList.test.ts`

Depends on: Task C1

- [ ] **Step 1: Write failing tests**

```ts
// Add to src/engine/cutList.test.ts
import type { CountertopSceneUnit } from '../types'

function makeCountertopUnit(id: string, label: string): CountertopSceneUnit {
  return {
    type: 'countertop', id, label, x: 0, y: 0,
    settings: { worktopWidth: 1200, worktopDepth: 600, slabThickness: 20, material: 'granite' },
    elements: [
      { id: 'e1', type: 'sink', label: 'Kitchen Sink', x: 300, y: 50, width: 600, depth: 500 },
      { id: 'e2', type: 'hob', label: '4-Burner Hob', x: 900, y: 50, width: 600, depth: 520 },
    ],
  }
}

describe('computeCutListForUnits with countertop', () => {
  it('produces one slab entry per countertop unit', () => {
    const ct = makeCountertopUnit('ct1', 'Worktop')
    const entries = computeCutListForUnits([ct])
    const slab = entries.find(e => e.label.includes('Countertop'))
    expect(slab).toBeDefined()
    expect(slab!.qty).toBe(1)
  })

  it('slab entry has correct dimensions', () => {
    const ct = makeCountertopUnit('ct1', 'Worktop')
    const entries = computeCutListForUnits([ct])
    const slab = entries.find(e => e.label.includes('Countertop'))!
    expect(slab.width).toBe(1200)   // worktopWidth
    expect(slab.height).toBe(600)   // worktopDepth
    expect(slab.depth).toBe(20)     // slabThickness
  })

  it('slab entry cutouts contain all sink and hob elements', () => {
    const ct = makeCountertopUnit('ct1', 'Worktop')
    const entries = computeCutListForUnits([ct])
    const slab = entries.find(e => e.label.includes('Countertop'))!
    expect(slab.cutouts).toHaveLength(2)
    expect(slab.cutouts![0].type).toBe('sink')
    expect(slab.cutouts![1].type).toBe('hob')
  })

  it('mixed cabinet + countertop: both produce cut list entries', () => {
    const cabinet: import('../types').CabinetSceneUnit = {
      type: 'cabinet', id: 'c1', label: 'Base', x: 0, y: 0,
      settings: { unit: 'mm', height: 800, width: 600, depth: 500, thickness: 18, backThickness: 6, toeKick: null, defaultMaterial: 'oak' },
      root: { id: 'r1', elementType: 'void' },
    }
    const ct = makeCountertopUnit('ct1', 'Worktop')
    const entries = computeCutListForUnits([cabinet, ct])
    const cabinetEntries = entries.filter(e => e.unitId === 'c1')
    const ctEntries = entries.filter(e => e.unitId === 'ct1')
    expect(cabinetEntries.length).toBeGreaterThan(0)
    expect(ctEntries.length).toBe(1)  // one slab entry
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/engine/cutList.test.ts
```
Expected: FAIL — countertop not handled in `computeCutListForUnits`

- [ ] **Step 3: Update `computeCutListForUnits` to handle countertop units**

In `cutList.ts`, update the `computeCutListForUnits` function:

```ts
export function computeCutListForUnits(units: CabinetUnit[]): CutListEntry[] {
  return units.flatMap(unit => {
    if (unit.type === 'countertop') return computeCountertopCutList(unit)
    return computeCutListForUnit(unit as CabinetSceneUnit)
  })
}

function computeCountertopCutList(unit: CountertopSceneUnit): CutListEntry[] {
  const { settings } = unit
  const cutouts = unit.elements.map(el => ({
    type: el.type,
    label: el.label,
    width: el.width,
    depth: el.depth,
  }))
  return [{
    label: `Countertop (${settings.material})`,
    qty: 1,
    width: settings.worktopWidth,
    height: settings.worktopDepth,
    depth: settings.slabThickness,
    material: settings.material,
    unitId: unit.id,
    unitLabel: unit.label,
    cutouts: cutouts.length > 0 ? cutouts : undefined,
  }]
}
```

Add necessary imports at top of file:
```ts
import type { CutListEntry, Design, CabinetUnit, CabinetSceneUnit, CountertopSceneUnit } from '../types'
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/engine/cutList.test.ts
```
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/engine/cutList.ts src/engine/cutList.test.ts
git commit -m "feat(engine): countertop slab cut list entry with structured cutouts[]"
```

---

## Task C4: Store — Countertop Unit Actions

**Files:**
- Modify: `src/store/store.ts`
- Modify: `src/store/store.test.ts`

Depends on: Task C1

- [ ] **Step 1: Write failing tests**

```ts
// Add to src/store/store.test.ts
describe('addUnit with type countertop', () => {
  it('creates a CountertopSceneUnit when type=countertop', () => {
    const { result } = renderHook(() => useStore())
    act(() => result.current.addUnit('countertop'))
    const project = result.current.projects.find(p => p.id === 'proj1')!
    const ctUnit = project.units[project.units.length - 1]
    expect(ctUnit.type).toBe('countertop')
  })
})

describe('addCountertopElement', () => {
  beforeEach(() => {
    // Set up a project with a countertop unit
    useStore.setState({
      projects: [{
        id: 'proj1', name: 'Test',
        units: [{
          type: 'countertop', id: 'ct1', label: 'Worktop', x: 0, y: 0,
          settings: { worktopWidth: 1200, worktopDepth: 600, slabThickness: 20, material: 'granite' },
          elements: [],
        }],
      }],
      activeProjectId: 'proj1',
      selectedId: null,
      snapGrid: 5,
      activeUnitId: 'ct1',
    })
  })

  it('appends a sink element with default centred position', () => {
    const { result } = renderHook(() => useStore())
    act(() => result.current.addCountertopElement('ct1', 'sink'))
    const proj = result.current.projects.find(p => p.id === 'proj1')!
    const ct = proj.units[0] as import('../types').CountertopSceneUnit
    expect(ct.elements).toHaveLength(1)
    expect(ct.elements[0].type).toBe('sink')
  })

  it('appended element is within slab bounds', () => {
    const { result } = renderHook(() => useStore())
    act(() => result.current.addCountertopElement('ct1', 'hob'))
    const ct = result.current.projects[0].units[0] as import('../types').CountertopSceneUnit
    const el = ct.elements[0]
    expect(el.x + el.width).toBeLessThanOrEqual(1200)
    expect(el.y + el.depth).toBeLessThanOrEqual(600)
  })
})

describe('updateCountertopElement', () => {
  it('clamps element to slab bounds on update', () => {
    useStore.setState({
      projects: [{
        id: 'proj1', name: 'Test',
        units: [{
          type: 'countertop', id: 'ct1', label: 'Top', x: 0, y: 0,
          settings: { worktopWidth: 1200, worktopDepth: 600, slabThickness: 20, material: 'granite' },
          elements: [{ id: 'e1', type: 'sink', label: 'Sink', x: 100, y: 50, width: 600, depth: 500 }],
        }],
      }],
      activeProjectId: 'proj1', selectedId: null, snapGrid: 5, activeUnitId: 'ct1',
    })
    const { result } = renderHook(() => useStore())
    act(() => result.current.updateCountertopElement('ct1', 'e1', { x: 9999 }))
    const ct = result.current.projects[0].units[0] as import('../types').CountertopSceneUnit
    expect(ct.elements[0].x).toBe(600)  // clamped: 1200 - 600 = 600
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/store/store.test.ts
```
Expected: Errors on `addUnit('countertop')`, `addCountertopElement`, `updateCountertopElement`

- [ ] **Step 3: Update `store.ts`**

Add new types import:
```ts
import type { ..., CountertopSceneUnit, CountertopSettings, CountertopElement, CountertopElementType } from '../types'
```

Update `addUnit` to accept optional `type`:

```ts
addUnit: (type: UnitType = 'cabinet') => set(s => {
  const proj = activeDesign(s)
  if (!proj) return
  const rightmost = proj.units.reduce((max, u) => {
    const w = u.type === 'cabinet' ? u.settings.width : u.settings.worktopWidth
    return Math.max(max, u.x + w)
  }, 0)
  const newUnitId = nanoid(8)
  if (type === 'countertop') {
    const newUnit: CountertopSceneUnit = {
      type: 'countertop',
      id: newUnitId,
      label: `Worktop ${proj.units.filter(u => u.type === 'countertop').length + 1}`,
      x: rightmost + 20,
      y: 0,
      settings: { worktopWidth: 600, worktopDepth: 600, slabThickness: 20, material: 'granite' },
      elements: [],
    }
    proj.units.push(newUnit)
  } else {
    const activeUnit = proj.units.find(u => u.id === s.activeUnitId)
    const baseSettings = activeUnit?.type === 'cabinet' ? activeUnit.settings : undefined
    const newUnit: CabinetSceneUnit = {
      type: 'cabinet',
      id: newUnitId,
      label: `Unit ${proj.units.filter(u => u.type === 'cabinet').length + 1}`,
      settings: baseSettings ?? { unit: 'mm', height: 800, width: 600, depth: 500, thickness: 18, backThickness: 6, toeKick: null, defaultMaterial: 'oak' },
      root: { id: nanoid(8), elementType: 'void' },
      x: rightmost + 20,
      y: 0,
    }
    proj.units.push(newUnit)
  }
  s.activeUnitId = newUnitId
}),
```

Add clamp helper and new actions:

```ts
function clampCountertopElement(el: CountertopElement, settings: CountertopSettings): CountertopElement {
  const x = Math.max(0, Math.min(el.x, settings.worktopWidth - el.width))
  const y = Math.max(0, Math.min(el.y, settings.worktopDepth - el.depth))
  const width = Math.min(el.width, settings.worktopWidth)
  const depth = Math.min(el.depth, settings.worktopDepth)
  return { ...el, x, y, width, depth }
}

// Default element sizes (mm)
const DEFAULT_ELEMENT_SIZE: Record<CountertopElementType, { width: number; depth: number }> = {
  sink: { width: 600, depth: 500 },
  hob: { width: 600, depth: 520 },
}

addCountertopElement: (unitId, type) => set(s => {
  const proj = activeDesign(s)
  const unit = proj?.units.find(u => u.id === unitId)
  if (!unit || unit.type !== 'countertop') return
  const { worktopWidth, worktopDepth } = unit.settings
  const size = DEFAULT_ELEMENT_SIZE[type]
  const el: CountertopElement = {
    id: nanoid(8),
    type,
    label: type === 'sink' ? 'Sink' : 'Hob',
    x: Math.max(0, (worktopWidth - size.width) / 2),
    y: Math.max(0, (worktopDepth - size.depth) / 2),
    ...size,
  }
  unit.elements.push(clampCountertopElement(el, unit.settings))
}),

removeCountertopElement: (unitId, elementId) => set(s => {
  const proj = activeDesign(s)
  const unit = proj?.units.find(u => u.id === unitId)
  if (!unit || unit.type !== 'countertop') return
  unit.elements = unit.elements.filter(e => e.id !== elementId)
}),

updateCountertopElement: (unitId, elementId, patch) => set(s => {
  const proj = activeDesign(s)
  const unit = proj?.units.find(u => u.id === unitId)
  if (!unit || unit.type !== 'countertop') return
  const idx = unit.elements.findIndex(e => e.id === elementId)
  if (idx === -1) return
  const updated = { ...unit.elements[idx], ...patch }
  unit.elements[idx] = clampCountertopElement(updated, unit.settings)
}),
```

Also update `StoreState` interface and `UnitType` import:
```ts
addUnit: (type?: UnitType) => void
addCountertopElement: (unitId: string, type: CountertopElementType) => void
removeCountertopElement: (unitId: string, elementId: string) => void
updateCountertopElement: (unitId: string, elementId: string, patch: Partial<CountertopElement>) => void
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/store/store.test.ts
```
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/store/store.ts src/store/store.test.ts
git commit -m "feat(store): addUnit(type), addCountertopElement, removeCountertopElement, updateCountertopElement with clamping"
```

---

## Task C5: Create CountertopLayer Component

**Files:**
- Create: `src/components/CabinetCanvas/CountertopLayer.tsx`
- Create: `src/components/CabinetCanvas/CountertopLayer.test.tsx`

Depends on: Task C1 (types)

- [ ] **Step 1: Write failing tests**

```tsx
// src/components/CabinetCanvas/CountertopLayer.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CountertopLayer from './CountertopLayer'
import type { CountertopLayout } from '../../types'

function makeLayout(elementCount = 0): CountertopLayout {
  return {
    kind: 'countertop', unitId: 'ct1', label: 'Worktop', isActive: false,
    x: 0, y: 0, w: 1200, h: 20,
    unit: 'mm',
    slabRect: { x: 0, y: 0, w: 1200, h: 600 },
    elements: Array.from({ length: elementCount }, (_, i) => ({
      element: { id: `e${i}`, type: i === 0 ? 'sink' as const : 'hob' as const, label: i === 0 ? 'Sink' : 'Hob', x: i * 400, y: 50, width: 300, depth: 250 },
    })),
  }
}

const noop = () => {}

describe('CountertopLayer', () => {
  it('renders slab rectangle', () => {
    render(<svg><CountertopLayer layout={makeLayout()} selectedElementId={null} zoom={1} onSelectElement={noop} onMoveElement={noop} onResizeElement={noop} /></svg>)
    expect(document.querySelector('[data-testid="countertop-slab"]')).toBeInTheDocument()
  })

  it('renders element labels', () => {
    render(<svg><CountertopLayer layout={makeLayout(2)} selectedElementId={null} zoom={1} onSelectElement={noop} onMoveElement={noop} onResizeElement={noop} /></svg>)
    expect(screen.getByText('Sink')).toBeInTheDocument()
    expect(screen.getByText('Hob')).toBeInTheDocument()
  })

  it('clicking an element fires onSelectElement with its id', async () => {
    const user = userEvent.setup()
    const onSelectElement = vi.fn()
    render(<svg><CountertopLayer layout={makeLayout(1)} selectedElementId={null} zoom={1} onSelectElement={onSelectElement} onMoveElement={noop} onResizeElement={noop} /></svg>)
    await user.click(screen.getByText('Sink'))
    expect(onSelectElement).toHaveBeenCalledWith('e0')
  })

  it('selected element shows resize handle', () => {
    render(<svg><CountertopLayer layout={makeLayout(1)} selectedElementId="e0" zoom={1} onSelectElement={noop} onMoveElement={noop} onResizeElement={noop} /></svg>)
    expect(document.querySelector('[data-testid="resize-handle"]')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/components/CabinetCanvas/CountertopLayer.test.tsx
```
Expected: FAIL — component doesn't exist

- [ ] **Step 3: Create `CountertopLayer.tsx`**

```tsx
import type { CountertopLayout } from '../../types'

const MATERIAL_COLORS: Record<string, string> = {
  granite: '#9e9e9e',
  marble: '#f5f5f5',
  quartz: '#e0d0c0',
}

interface Props {
  layout: CountertopLayout
  selectedElementId: string | null
  zoom: number
  onSelectElement: (elementId: string | null) => void
  onMoveElement: (elementId: string, mmX: number, mmY: number) => void
  onResizeElement: (elementId: string, mmWidth: number, mmDepth: number) => void
}

export default function CountertopLayer({
  layout, selectedElementId, zoom, onSelectElement, onMoveElement, onResizeElement,
}: Props) {
  const { slabRect, elements } = layout
  const slabColor = MATERIAL_COLORS[layout.unit] ?? '#ccc'  // layout.unit isn't material — use a default
  // Note: material color comes from unit settings, but CountertopLayout doesn't carry settings.
  // For now use a neutral stone color; Phase C enhancement: add materialId to CountertopLayout.
  const SLAB_COLOR = '#b0a898'

  return (
    <g data-unit-id={layout.unitId}>
      {/* Slab rectangle */}
      <rect
        data-testid="countertop-slab"
        x={slabRect.x}
        y={slabRect.y}
        width={slabRect.w}
        height={slabRect.h}
        fill={SLAB_COLOR}
        stroke="#6b5e4e"
        strokeWidth={1.5 / zoom}
        onClick={() => onSelectElement(null)}
      />

      {/* Elements */}
      {elements.map(({ element: el }) => (
        <g
          key={el.id}
          onClick={e => { e.stopPropagation(); onSelectElement(el.id) }}
          style={{ cursor: 'pointer' }}
        >
          <rect
            x={el.x}
            y={el.y}
            width={el.width}
            height={el.depth}
            fill="white"
            fillOpacity={0.6}
            stroke={selectedElementId === el.id ? 'var(--color-accent)' : '#555'}
            strokeWidth={1.5 / zoom}
            strokeDasharray={`${4 / zoom} ${2 / zoom}`}
          />
          <text
            x={el.x + el.width / 2}
            y={el.y + el.depth / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={14 / zoom}
            fill="#333"
            pointerEvents="none"
          >
            {el.label}
          </text>
          {selectedElementId === el.id && (
            <ResizeHandle
              el={el}
              zoom={zoom}
              onResizeElement={onResizeElement}
            />
          )}
        </g>
      ))}
    </g>
  )
}

interface ResizeHandleProps {
  el: { id: string; x: number; y: number; width: number; depth: number }
  zoom: number
  onResizeElement: (elementId: string, mmWidth: number, mmDepth: number) => void
}

function ResizeHandle({ el, zoom }: ResizeHandleProps) {
  const size = 8 / zoom
  return (
    <rect
      data-testid="resize-handle"
      x={el.x + el.width - size / 2}
      y={el.y + el.depth - size / 2}
      width={size}
      height={size}
      fill="var(--color-accent)"
      stroke="white"
      strokeWidth={1 / zoom}
      style={{ cursor: 'se-resize' }}
    />
  )
}
```

Note on drag/resize: Full drag interaction using SVG pointer events follows the same pattern as `DragHandles.tsx` in the codebase. Implement pointer capture + move events on `ResizeHandle` calling `onResizeElement` on pointer-up. The test stubs this — actual drag is tested manually.

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/components/CabinetCanvas/CountertopLayer.test.tsx
```
Expected: All 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/CabinetCanvas/CountertopLayer.tsx src/components/CabinetCanvas/CountertopLayer.test.tsx
git commit -m "feat(canvas): CountertopLayer — slab, elements, resize handle"
```

---

## Task C6: Create CountertopPanel and Update Sidebar

**Files:**
- Create: `src/components/Sidebar/CountertopPanel.tsx`
- Create: `src/components/Sidebar/CountertopPanel.test.tsx`
- Modify: `src/components/Sidebar/Sidebar.tsx`

Depends on: Task C1

- [ ] **Step 1: Write failing tests**

```tsx
// src/components/Sidebar/CountertopPanel.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CountertopPanel from './CountertopPanel'
import type { CountertopSceneUnit } from '../../types'

const baseUnit: CountertopSceneUnit = {
  type: 'countertop', id: 'ct1', label: 'Worktop', x: 0, y: 0,
  settings: { worktopWidth: 1200, worktopDepth: 600, slabThickness: 20, material: 'granite' },
  elements: [
    { id: 'e1', type: 'sink', label: 'Sink', x: 100, y: 50, width: 600, depth: 500 },
  ],
}

const noop = () => {}

describe('CountertopPanel', () => {
  it('"Add sink" fires onAddElement with sink', async () => {
    const user = userEvent.setup()
    const onAddElement = vi.fn()
    render(<CountertopPanel unit={baseUnit} selectedElementId={null} onAddElement={onAddElement} onRemoveElement={noop} onUpdateElement={noop} />)
    await user.click(screen.getByRole('button', { name: /add sink/i }))
    expect(onAddElement).toHaveBeenCalledWith('sink')
  })

  it('"Add hob" fires onAddElement with hob', async () => {
    const user = userEvent.setup()
    const onAddElement = vi.fn()
    render(<CountertopPanel unit={baseUnit} selectedElementId={null} onAddElement={onAddElement} onRemoveElement={noop} onUpdateElement={noop} />)
    await user.click(screen.getByRole('button', { name: /add hob/i }))
    expect(onAddElement).toHaveBeenCalledWith('hob')
  })

  it('remove button fires onRemoveElement', async () => {
    const user = userEvent.setup()
    const onRemoveElement = vi.fn()
    render(<CountertopPanel unit={baseUnit} selectedElementId={null} onAddElement={noop} onRemoveElement={onRemoveElement} onUpdateElement={noop} />)
    await user.click(screen.getByRole('button', { name: /remove/i }))
    expect(onRemoveElement).toHaveBeenCalledWith('e1')
  })

  it('width input change fires onUpdateElement', async () => {
    const user = userEvent.setup()
    const onUpdateElement = vi.fn()
    render(<CountertopPanel unit={baseUnit} selectedElementId="e1" onAddElement={noop} onRemoveElement={noop} onUpdateElement={onUpdateElement} />)
    const widthInput = screen.getByLabelText(/width/i)
    await user.clear(widthInput)
    await user.type(widthInput, '700')
    await user.tab()
    expect(onUpdateElement).toHaveBeenCalledWith('e1', expect.objectContaining({ width: 700 }))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/components/Sidebar/CountertopPanel.test.tsx
```
Expected: FAIL — component doesn't exist

- [ ] **Step 3: Create `CountertopPanel.tsx`**

```tsx
import type { CountertopElement, CountertopElementType, CountertopSceneUnit } from '../../types'

interface Props {
  unit: CountertopSceneUnit
  selectedElementId: string | null
  onAddElement: (type: CountertopElementType) => void
  onRemoveElement: (elementId: string) => void
  onUpdateElement: (elementId: string, patch: Partial<CountertopElement>) => void
}

export default function CountertopPanel({ unit, selectedElementId, onAddElement, onRemoveElement, onUpdateElement }: Props) {
  const selectedEl = unit.elements.find(e => e.id === selectedElementId)

  return (
    <div className="flex flex-col gap-2 p-2">
      <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Countertop Elements</p>

      <div className="flex gap-1">
        <button
          aria-label="Add sink"
          onClick={() => onAddElement('sink')}
          className="flex-1 text-xs px-2 py-1 rounded bg-surface-elevated hover:bg-border text-text"
        >
          + Add sink
        </button>
        <button
          aria-label="Add hob"
          onClick={() => onAddElement('hob')}
          className="flex-1 text-xs px-2 py-1 rounded bg-surface-elevated hover:bg-border text-text"
        >
          + Add hob
        </button>
      </div>

      {unit.elements.length > 0 && (
        <div className="flex flex-col gap-1 mt-1">
          {unit.elements.map(el => (
            <div
              key={el.id}
              className={`flex items-center gap-1 text-xs rounded px-1 py-0.5 ${el.id === selectedElementId ? 'bg-accent/20' : 'bg-surface-elevated'}`}
            >
              <span className="flex-1 truncate">{el.label} ({el.type})</span>
              <button
                aria-label={`Remove ${el.label}`}
                onClick={() => onRemoveElement(el.id)}
                className="text-red-400 hover:text-red-600 px-1"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {selectedEl && (
        <div className="flex flex-col gap-1 mt-2 border-t border-border pt-2">
          <p className="text-xs text-text-secondary">Edit: {selectedEl.label}</p>
          <label className="text-xs text-text-secondary">
            Width (mm)
            <input
              aria-label="width"
              type="number"
              className="ml-1 w-20 bg-surface border border-border rounded px-1 text-text text-xs"
              defaultValue={selectedEl.width}
              onBlur={e => {
                const v = parseFloat(e.target.value)
                if (!isNaN(v)) onUpdateElement(selectedEl.id, { width: v })
              }}
            />
          </label>
          <label className="text-xs text-text-secondary">
            Depth (mm)
            <input
              aria-label="depth"
              type="number"
              className="ml-1 w-20 bg-surface border border-border rounded px-1 text-text text-xs"
              defaultValue={selectedEl.depth}
              onBlur={e => {
                const v = parseFloat(e.target.value)
                if (!isNaN(v)) onUpdateElement(selectedEl.id, { depth: v })
              }}
            />
          </label>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Update `Sidebar.tsx` to show `CountertopPanel` when active unit is countertop**

In `Sidebar.tsx`, add a branch in the actions section:

```tsx
import CountertopPanel from './CountertopPanel'
import type { CountertopSceneUnit, CountertopElement, CountertopElementType } from '../../types'

// Add to Props:
interface Props {
  // ... existing props ...
  onAddCountertopElement?: (unitId: string, type: CountertopElementType) => void
  onRemoveCountertopElement?: (unitId: string, elementId: string) => void
  onUpdateCountertopElement?: (unitId: string, elementId: string, patch: Partial<CountertopElement>) => void
}

// In the render, replace the existing actions section with a conditional:
{activeUnit?.type === 'countertop'
  ? (
    <CountertopPanel
      unit={activeUnit as CountertopSceneUnit}
      selectedElementId={selectedId}
      onAddElement={type => onAddCountertopElement?.(activeUnit.id, type)}
      onRemoveElement={id => onRemoveCountertopElement?.(activeUnit.id, id)}
      onUpdateElement={(id, patch) => onUpdateCountertopElement?.(activeUnit.id, id, patch)}
    />
  )
  : (
    // existing Actions section (addShelf, addDivider, material, etc.)
    <ActionsSection ... />
  )
}
```

(The sidebar already receives `activeUnit` via `units` + `activeUnitId` — derive it: `const activeUnit = units.find(u => u.id === activeUnitId)`)

- [ ] **Step 5: Run tests**

```bash
npx vitest run src/components/Sidebar/
```
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/Sidebar/CountertopPanel.tsx src/components/Sidebar/CountertopPanel.test.tsx src/components/Sidebar/Sidebar.tsx
git commit -m "feat(ui): CountertopPanel with add/remove/edit elements; Sidebar branches on unit type"
```

---

## Task C7: Wire CabinetCanvas + App for Phase C

**Files:**
- Modify: `src/components/CabinetCanvas/CabinetCanvas.tsx`
- Modify: `src/App.tsx`

Depends on: Tasks C2, C5

- [ ] **Step 1: Update `CabinetCanvas.tsx` to render `CountertopLayer`**

```tsx
import CountertopLayer from './CountertopLayer'
import type { AnyUnitLayout, CountertopLayout, UnitLayoutResult } from '../../types'

// In the per-unit render:
{sceneLayout.units.map(result => (
  <g
    key={result.unitId}
    data-unit-id={result.unitId}
    transform={`translate(${result.x}, ${result.y})`}
    onClick={() => onUnitClick(result.unitId)}
  >
    {result.kind === 'cabinet'
      ? <>
          <CanvasLayers panels={result.panels} voids={result.voids} dividers={result.dividers} selectedId={selectedId} onSelectVoid={setSelectedId} onSelectDivider={setSelectedId} />
          <DimensionLabels voids={result.voids} unit={result.unit} onCommitSize={handleCommitSize} lockedNodeIds={result.overConstrainedIds} onUnlockNode={onUnlockNode} zoom={zoom} />
          <DragHandles dividers={result.dividers} snapGrid={snapGrid} svgRef={svgRef} zoom={zoom} />
        </>
      : <CountertopLayer
          layout={result as CountertopLayout}
          selectedElementId={selectedId}
          zoom={zoom}
          onSelectElement={setSelectedId}
          onMoveElement={handleMoveElement}
          onResizeElement={handleResizeElement}
        />
    }
    {result.isActive && <ActiveUnitFrame w={result.w} h={result.h} zoom={zoom} />}
  </g>
))}
```

Add `handleMoveElement` and `handleResizeElement` callbacks in the component (they call store actions passed via props or directly):

```tsx
// Add to Props:
onMoveElement?: (elementId: string, mmX: number, mmY: number) => void
onResizeElement?: (elementId: string, mmWidth: number, mmDepth: number) => void

// Extract ActiveUnitFrame to a small sub-component for cleanliness:
function ActiveUnitFrame({ w, h, zoom }: { w: number; h: number; zoom: number }) {
  return (
    <rect x={-2} y={-2} width={w + 4} height={h + 4}
      fill="none" stroke="var(--color-accent)"
      strokeWidth={2 / zoom} strokeDasharray={`${6 / zoom} ${3 / zoom}`}
      pointerEvents="none"
    />
  )
}
```

- [ ] **Step 2: Update `App.tsx`**

Wire countertop actions from store to Sidebar and CabinetCanvas:

```tsx
const addCountertopElement = useStore(s => s.addCountertopElement)
const removeCountertopElement = useStore(s => s.removeCountertopElement)
const updateCountertopElement = useStore(s => s.updateCountertopElement)

// Pass to Sidebar:
<Sidebar
  // ... existing props ...
  onAddCountertopElement={addCountertopElement}
  onRemoveCountertopElement={removeCountertopElement}
  onUpdateCountertopElement={updateCountertopElement}
/>

// Pass to CabinetCanvas:
<CabinetCanvas
  sceneLayout={sceneLayout}
  svgRef={svgRef}
  onUnlockNode={storeUnlockNode}
  onUnitClick={setActiveUnit}
  onMoveElement={(elId, x, y) => {
    const ct = activeUnit?.type === 'countertop' ? activeUnit : null
    if (ct) updateCountertopElement(ct.id, elId, { x, y })
  }}
  onResizeElement={(elId, w, d) => {
    const ct = activeUnit?.type === 'countertop' ? activeUnit : null
    if (ct) updateCountertopElement(ct.id, elId, { width: w, depth: d })
  }}
/>
```

Also update the "Add unit" button in the sidebar to prompt for unit type (cabinet or countertop). A simple approach: make `UnitSelector.onAdd` accept a type, and show a small dropdown or two buttons.

- [ ] **Step 3: Run full test suite**

```bash
npx vitest run
```
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/CabinetCanvas/CabinetCanvas.tsx src/App.tsx
git commit -m "feat: Phase C wiring — CabinetCanvas renders CountertopLayer, App wires countertop actions"
```

---

## Task C8: Phase C Integration Test

**Files:**
- Modify: `src/integration/cabinetFlow.test.tsx`

Depends on: Task C7

- [ ] **Step 1: Add Phase C integration test**

```tsx
describe('Phase C: countertop mode', () => {
  it('user adds countertop unit, adds hob, sees cut list entry with cutouts', async () => {
    const user = userEvent.setup()
    render(<App />)

    // Open "Add unit" and select countertop type
    // (Implementation: if UnitSelector shows two buttons "Cabinet" / "Countertop")
    await user.click(screen.getByRole('button', { name: /add unit/i }))
    await user.click(screen.getByRole('button', { name: /countertop/i }))

    // Canvas should show a countertop slab
    expect(document.querySelector('[data-testid="countertop-slab"]')).toBeInTheDocument()

    // CountertopPanel should appear in sidebar
    await user.click(screen.getByRole('button', { name: /add hob/i }))

    // Hob element renders on canvas
    expect(screen.getByText(/hob/i)).toBeInTheDocument()

    // Open cut list
    const cutListSummary = screen.getByText(/cut list/i)
    await user.click(cutListSummary)

    // Cut list shows countertop entry
    expect(screen.getByText(/countertop/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run integration tests**

```bash
npx vitest run src/integration/cabinetFlow.test.tsx
```
Expected: All integration tests (Phase B + C) pass.

- [ ] **Step 3: Full test suite**

```bash
npx vitest run
```
Expected: All tests pass. Record the test count.

- [ ] **Step 4: Commit**

```bash
git add src/integration/cabinetFlow.test.tsx
git commit -m "test(integration): Phase C countertop E2E — add countertop unit, add hob, cut list"
```

---

## Parallelization Notes (Phase C)

After Task C1 (types), tasks C2, C3, C4, C5 can run **in parallel**:

- **Wave 1 (parallel):** C2 (engine) + C3 (cut list) + C4 (store) + C5 (CountertopLayer)
- **Wave 2 (sequential):** C6 (CountertopPanel + Sidebar) → C7 (CabinetCanvas + App) → C8 (integration)

Phase C tasks C2+C5 can proceed immediately after C1 since they only need types. C3+C4 similarly.
