# Phase B: Multi-Unit Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow multiple `CabinetUnit` objects on a single canvas — stacked, side-by-side, and L-shaped arrangements — with aggregated cut list tagged by unit.

**Architecture:** Replace the single `Design.root + globalSettings` with `Design.units: CabinetUnit[]`. The layout engine is extended with `computeSceneLayout(units, activeUnitId)` that returns an enriched `SceneLayout` (all display fields in one place, no domain objects in the canvas). Active unit selection lives in non-persisted `UIState.activeUnitId`. A Zustand persist migration covers v0→v1 (the existing store has no version, which Zustand treats as implicit v0).

**Tech Stack:** React 19, TypeScript, Zustand + immer + zundo + persist, Tailwind CSS, Vitest + React Testing Library

**Working directory:** `/home/chryston/docker/copilot/repos/worktrees/buildbox-fixes-export-phase-bc`

---

## Task 1: Update Types

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Write failing tests that import new types**

```ts
// src/types/index.test.ts  (new file)
import type { CabinetUnit, CabinetSceneUnit, Design, SceneLayout, UnitLayoutResult, UIState, CutListEntry } from './index'

it('CabinetUnit has id, label, type, settings, root, x, y', () => {
  const unit: CabinetSceneUnit = {
    type: 'cabinet',
    id: 'u1',
    label: 'Base',
    settings: { unit: 'mm', height: 800, width: 600, depth: 500, thickness: 18, backThickness: 6, toeKick: null, defaultMaterial: 'oak' },
    root: { id: 'r1', elementType: 'void' },
    x: 0,
    y: 0,
  }
  expect(unit.type).toBe('cabinet')
})

it('Design has units array and no root/globalSettings', () => {
  const d: Design = { id: 'd1', name: 'Test', units: [] }
  expect(d.units).toEqual([])
})

it('UIState has activeUnitId', () => {
  const ui: UIState = { selectedId: null, snapGrid: 5, activeUnitId: null }
  expect(ui.activeUnitId).toBeNull()
})

it('CutListEntry has unitId and unitLabel', () => {
  const e: CutListEntry = {
    label: 'Side panel', qty: 2, width: 800, height: 500, depth: 18,
    material: 'oak', unitId: 'u1', unitLabel: 'Base Left',
  }
  expect(e.unitLabel).toBe('Base Left')
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/chryston/docker/copilot/repos/worktrees/buildbox-fixes-export-phase-bc
npx vitest run src/types/index.test.ts
```
Expected: Compilation errors (types don't exist yet)

- [ ] **Step 3: Replace `src/types/index.ts` with the updated types**

```ts
export type Unit = 'mm' | 'cm' | 'in'
export type SplitAxis = 'horizontal' | 'vertical'
export type CabinetMaterialId = 'oak' | 'walnut' | 'white' | 'birch' | 'mdf'
export type MaterialId = CabinetMaterialId  // alias kept for existing engine compatibility
export type ElementType = 'void' | 'drawer' | 'hanging-space' | 'microwave'
export type SlideType = 'side-mount' | 'undermount'
export type AccessoryType = 'door' | 'drawer-front' | 'pull' | 'hinge'
export type UnitType = 'cabinet' | 'countertop'

export interface ToeKick {
  height: number
  setback: number
}

export interface DrawerConfig {
  slideType: SlideType
  reveal: number
}

export interface GlobalSettings {
  unit: Unit
  height: number
  width: number
  depth: number
  thickness: number
  backThickness: number
  toeKick: ToeKick | null
  defaultMaterial: CabinetMaterialId
}

export interface Accessory {
  id: string
  type: AccessoryType
  label?: string
}

export interface Divider {
  id: string
  materialId: CabinetMaterialId
}

export interface CabinetNode {
  id: string
  splitAxis?: SplitAxis
  splitRatio?: number
  children?: [CabinetNode, CabinetNode]
  fixedSize?: number
  locked?: boolean
  material?: CabinetMaterialId
  elementType?: ElementType
  drawerConfig?: DrawerConfig
  dividers?: Divider[]
  accessories?: Accessory[]
}

// --- Unit types ---

interface UnitBase {
  id: string
  label: string
  x: number  // canvas offset in mm from scene origin (left edge)
  y: number  // canvas offset in mm from scene origin (top edge)
}

export interface CabinetSceneUnit extends UnitBase {
  type: 'cabinet'
  settings: GlobalSettings
  root: CabinetNode
}

// Phase C will add CountertopSceneUnit; forward-compat: CabinetUnit is currently only CabinetSceneUnit
export type CabinetUnit = CabinetSceneUnit

export interface Design {
  id: string
  name: string
  units: CabinetUnit[]  // ≥ 1
}

// --- Layout types ---

export interface LayoutPanel {
  id: string
  role: 'top' | 'bottom' | 'left' | 'right' | 'shelf' | 'divider' | 'toe-kick-board'
  x: number; y: number; w: number; h: number
  material: CabinetMaterialId
}

export interface LayoutVoid {
  nodeId: string
  x: number; y: number; w: number; h: number
  parentSplitAxis?: SplitAxis
  elementType: ElementType
  drawerConfig?: DrawerConfig
  material: CabinetMaterialId
  accessories: Accessory[]
}

export interface LayoutDivider {
  nodeId: string
  parentId: string
  childAId: string
  childBId: string
  x: number; y: number; w: number; h: number
  axis: SplitAxis
  material: CabinetMaterialId
  dividerId?: string
  childABounds: { x: number; y: number; w: number; h: number }
  childBBounds: { x: number; y: number; w: number; h: number }
}

// Enriched per-unit layout — canvas only needs this, never touches CabinetUnit
export interface UnitLayoutResult {
  kind: 'cabinet'
  unitId: string
  label: string        // copy of CabinetUnit.label
  isActive: boolean    // true when this unit is the active unit
  x: number            // copy of CabinetUnit.x
  y: number            // copy of CabinetUnit.y
  w: number            // == settings.width
  h: number            // == settings.height
  unit: Unit           // for DimensionLabels formatting
  panels: LayoutPanel[]
  voids: LayoutVoid[]
  dividers: LayoutDivider[]
  overConstrainedIds: string[]
}

export interface SceneLayout {
  units: UnitLayoutResult[]
  boundingBox: { x: number; y: number; w: number; h: number }
}

// Kept for backward-compat with existing tests that call computeLayout(design)
export interface LayoutResult {
  panels: LayoutPanel[]
  voids: LayoutVoid[]
  dividers: LayoutDivider[]
  overConstrainedIds: string[]
}

// --- Cut-list types ---

export interface CutListEntry {
  label: string
  qty: number
  width: number
  height: number
  depth: number
  material: CabinetMaterialId
  unitId: string      // which CabinetUnit this came from
  unitLabel: string   // human-readable, e.g. "Base Left"
  notes?: string
}

// --- Store slice shapes ---

export interface UIState {
  selectedId: string | null
  snapGrid: number
  activeUnitId: string | null  // not persisted, not in temporal history
}
```

- [ ] **Step 4: Run tests to verify type tests pass and existing tests still compile**

```bash
cd /home/chryston/docker/copilot/repos/worktrees/buildbox-fixes-export-phase-bc
npx vitest run src/types/index.test.ts
```
Expected: 4 tests pass. Also check: `npx tsc --noEmit` — expect errors in files that use the old `Design` shape; these will be fixed in subsequent tasks.

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/types/index.test.ts
git commit -m "feat(types): CabinetUnit, Design.units, SceneLayout, UIState.activeUnitId, CutListEntry provenance"
```

---

## Task 2: Update Layout Engine

**Files:**
- Modify: `src/engine/layoutEngine.ts`
- Modify: `src/engine/layoutEngine.test.ts`

Depends on: Task 1

> **⚠️ Existing test helpers:** After Task 1, the existing tests in `layoutEngine.test.ts` that construct `Design` objects with `{ root, globalSettings }` will fail to compile. Update those helpers at the top of the file to the new shape:
> ```ts
> function makeDesign(root: CabinetNode, settingsOverride?: Partial<GlobalSettings>): Design {
>   const unitId = 'u1'
>   return {
>     id: 'd1', name: 'Test',
>     units: [{
>       type: 'cabinet', id: unitId, label: 'Unit 1', x: 0, y: 0,
>       settings: { unit: 'mm', height: 800, width: 600, depth: 500, thickness: 18, backThickness: 6, toeKick: null, defaultMaterial: 'oak', ...settingsOverride },
>       root,
>     }],
>   }
> }
> ```
> Do this update at the start of Step 1, before writing new tests.

- [ ] **Step 1: Write failing tests for `computeSceneLayout`**

Add to `src/engine/layoutEngine.test.ts`:

```ts
import { computeSceneLayout, computeLayout } from './layoutEngine'
import type { CabinetSceneUnit, GlobalSettings, CabinetNode } from '../types'

function makeUnit(id: string, label: string, x: number, overrides: Partial<GlobalSettings> = {}): CabinetSceneUnit {
  return {
    type: 'cabinet',
    id,
    label,
    x,
    y: 0,
    settings: {
      unit: 'mm', height: 800, width: 600, depth: 500,
      thickness: 18, backThickness: 6, toeKick: null, defaultMaterial: 'oak',
      ...overrides,
    },
    root: { id: `${id}-root`, elementType: 'void' },
  }
}

describe('computeSceneLayout', () => {
  it('single unit produces one UnitLayoutResult with kind cabinet', () => {
    const unit = makeUnit('u1', 'Base', 0)
    const scene = computeSceneLayout([unit], 'u1')
    expect(scene.units).toHaveLength(1)
    expect(scene.units[0].kind).toBe('cabinet')
    expect(scene.units[0].unitId).toBe('u1')
    expect(scene.units[0].isActive).toBe(true)
  })

  it('two units both appear in SceneLayout', () => {
    const u1 = makeUnit('u1', 'Base Left', 0)
    const u2 = makeUnit('u2', 'Base Right', 700)
    const scene = computeSceneLayout([u1, u2], 'u1')
    expect(scene.units).toHaveLength(2)
    expect(scene.units[1].x).toBe(700)
    expect(scene.units[1].isActive).toBe(false)
  })

  it('bounding box encompasses both units', () => {
    const u1 = makeUnit('u1', 'L', 0, { width: 600, height: 800 })
    const u2 = makeUnit('u2', 'R', 700, { width: 500, height: 900 })
    const scene = computeSceneLayout([u1, u2], null)
    expect(scene.boundingBox.x).toBe(0)
    expect(scene.boundingBox.y).toBe(0)
    expect(scene.boundingBox.w).toBe(1200)   // 700 + 500
    expect(scene.boundingBox.h).toBe(900)    // max height
  })

  it('UnitLayoutResult.panels are in unit-local coordinates', () => {
    const unit = makeUnit('u1', 'Base', 50)  // offset x=50
    const scene = computeSceneLayout([unit], 'u1')
    const result = scene.units[0]
    // left panel should start at x=0 in unit-local coords (not 50)
    const leftPanel = result.panels.find(p => p.role === 'left')!
    expect(leftPanel.x).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/chryston/docker/copilot/repos/worktrees/buildbox-fixes-export-phase-bc
npx vitest run src/engine/layoutEngine.test.ts
```
Expected: FAIL — `computeSceneLayout` not exported

- [ ] **Step 3: Refactor `layoutEngine.ts` — rename internals, add `computeSceneLayout`**

Replace the top of `layoutEngine.ts` (keep all the inner functions `buildOuterPanels`, `layoutNode`, `distributeTwo` etc. unchanged):

```ts
import type {
  CabinetNode,
  CabinetSceneUnit,
  CabinetUnit,
  Design,
  GlobalSettings,
  LayoutDivider,
  LayoutPanel,
  LayoutResult,
  LayoutVoid,
  CabinetMaterialId,
  SceneLayout,
  SplitAxis,
  UnitLayoutResult,
} from '../types'

const MIN_SECTION_SIZE = 50

// Core per-unit layout. Panel/void/divider coords are relative to unit origin (0,0).
// Return type is LayoutResult directly (Omit<T,K>&{K:T} is identical to T — no need for the complex form).
export function computeUnitLayout(settings: GlobalSettings, root: CabinetNode): LayoutResult {
  // ... move body of existing computeLayout here, replacing design.globalSettings with settings, design.root with root
}

export function computeSceneLayout(
  units: CabinetUnit[],
  activeUnitId: string | null,
): SceneLayout {
  // NOTE: rename lambda param to `cabinetUnit` to avoid shadowing the `unit: Unit` property
  // being set inside the returned object literal.
  const unitResults: UnitLayoutResult[] = units.map(cabinetUnit => {
    const inner = computeUnitLayout(cabinetUnit.settings, cabinetUnit.root)
    return {
      kind: 'cabinet',
      unitId: cabinetUnit.id,
      label: cabinetUnit.label,
      isActive: cabinetUnit.id === activeUnitId,
      x: cabinetUnit.x,
      y: cabinetUnit.y,
      w: cabinetUnit.settings.width,
      h: cabinetUnit.settings.height,
      unit: cabinetUnit.settings.unit,   // 'unit' here is the Unit enum ('mm'|'cm'|'in')
      ...inner,
    }
  })

  const boundingBox = computeBoundingBox(units)

  return { units: unitResults, boundingBox }
}

function computeBoundingBox(units: CabinetUnit[]): SceneLayout['boundingBox'] {
  if (units.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const u of units) {
    minX = Math.min(minX, u.x)
    minY = Math.min(minY, u.y)
    maxX = Math.max(maxX, u.x + u.settings.width)
    maxY = Math.max(maxY, u.y + u.settings.height)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

// Backward-compat shim for tests and existing callers
export function computeLayout(design: Design): LayoutResult {
  if (design.units.length === 0) return { panels: [], voids: [], dividers: [], overConstrainedIds: [] }
  const first = design.units[0] as CabinetSceneUnit
  return computeUnitLayout(first.settings, first.root)
}
```

> **Important:** The body of `computeUnitLayout` is the *same* as the old `computeLayout` body — just swap `design.globalSettings` → `settings` and `design.root` → `root`. Do not change `buildOuterPanels`, `layoutNode`, `distributeTwo`, or any inner functions.

- [ ] **Step 4: Run tests**

```bash
cd /home/chryston/docker/copilot/repos/worktrees/buildbox-fixes-export-phase-bc
npx vitest run src/engine/layoutEngine.test.ts
```
Expected: All new tests pass + all existing layout tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/engine/layoutEngine.ts src/engine/layoutEngine.test.ts
git commit -m "feat(engine): computeSceneLayout with enriched UnitLayoutResult; computeUnitLayout extracted"
```

---

## Task 3: Update Cut List Engine

**Files:**
- Modify: `src/engine/cutList.ts`
- Modify: `src/engine/cutList.test.ts`

Depends on: Task 1

- [ ] **Step 1: Write failing tests**

Add to `src/engine/cutList.test.ts`:

```ts
import { computeCutListForUnits } from './cutList'
import type { CabinetSceneUnit } from '../types'

function makeUnit(id: string, label: string, widthOverride?: number): CabinetSceneUnit {
  return {
    type: 'cabinet', id, label, x: 0, y: 0,
    settings: {
      unit: 'mm', height: 800, width: widthOverride ?? 600, depth: 500,
      thickness: 18, backThickness: 6, toeKick: null, defaultMaterial: 'oak',
    },
    root: { id: `${id}-root`, elementType: 'void' },
  }
}

describe('computeCutListForUnits', () => {
  it('tags every entry with unitId and unitLabel', () => {
    const unit = makeUnit('u1', 'Base Left')
    const entries = computeCutListForUnits([unit])
    expect(entries.every(e => e.unitId === 'u1')).toBe(true)
    expect(entries.every(e => e.unitLabel === 'Base Left')).toBe(true)
  })

  it('two units produce entries for each unit', () => {
    const u1 = makeUnit('u1', 'Left', 600)
    const u2 = makeUnit('u2', 'Right', 900)
    const entries = computeCutListForUnits([u1, u2])
    const u1Entries = entries.filter(e => e.unitId === 'u1')
    const u2Entries = entries.filter(e => e.unitId === 'u2')
    expect(u1Entries.length).toBeGreaterThan(0)
    expect(u2Entries.length).toBeGreaterThan(0)
    // Side panels for u2 are wider than u1 — they are distinct, not merged
    const u1Side = u1Entries.find(e => e.label === 'Side panel')!
    const u2Side = u2Entries.find(e => e.label === 'Side panel')!
    expect(u2Side.width).toBe(900)  // u2 height = 800, width = 900? No — side panel width = cabinet height
    // Actually side panel uses gs.height; both use 800 — but unitId distinguishes them
    expect(u1Side.unitId).toBe('u1')
    expect(u2Side.unitId).toBe('u2')
  })

  it('identical cabinets still produce separate entries with distinct unitIds', () => {
    const u1 = makeUnit('u1', 'A', 600)
    const u2 = makeUnit('u2', 'B', 600)
    const entries = computeCutListForUnits([u1, u2])
    expect(new Set(entries.map(e => e.unitId)).size).toBe(2)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/engine/cutList.test.ts
```
Expected: FAIL — `computeCutListForUnits` not exported

- [ ] **Step 3: Add `computeCutListForUnits` to `cutList.ts`**

At the bottom of `src/engine/cutList.ts`, add:

```ts
import type { CabinetUnit, CabinetSceneUnit } from '../types'
import { computeUnitLayout } from './layoutEngine'

// IMPORTANT: use the type discriminant, NOT `as CabinetSceneUnit`. This makes Phase C
// extension safe — TypeScript will error if a CountertopSceneUnit is passed without handling.
export function computeCutListForUnits(units: CabinetUnit[]): CutListEntry[] {
  return units.flatMap(unit => {
    if (unit.type === 'cabinet') return computeCutListForUnit(unit)
    return []  // Phase C: add countertop handling here
  })
}

function computeCutListForUnit(unit: CabinetSceneUnit): CutListEntry[] {
  // Temporarily build a Design-like object to reuse the existing logic,
  // then tag every entry with unitId/unitLabel.
  // We call the internal helpers directly to avoid going through the old Design path.
  const gs = unit.settings
  const t = gs.thickness
  const layout = computeUnitLayout(gs, unit.root)
  const raw: Omit<CutListEntry, 'unitId' | 'unitLabel'>[] = []

  raw.push({ label: 'Side panel', qty: 2, width: gs.height, height: gs.depth, depth: t, material: gs.defaultMaterial })
  raw.push({ label: 'Top panel', qty: 1, width: gs.width - 2 * t, height: gs.depth, depth: t, material: gs.defaultMaterial })
  raw.push({ label: 'Bottom panel', qty: 1, width: gs.width - 2 * t, height: gs.depth, depth: t, material: gs.defaultMaterial })
  const backT = gs.backThickness ?? 6
  raw.push({ label: 'Back panel', qty: 1, width: gs.width - 2 * t, height: gs.height - 2 * t, depth: backT, material: gs.defaultMaterial, notes: `${backT}mm ply back` })

  if (gs.toeKick) {
    raw.push({
      label: 'Toe-kick board', qty: 1,
      width: gs.width - 2 * gs.toeKick.setback,
      height: gs.toeKick.height, depth: t,
      material: gs.defaultMaterial,
    })
  }

  for (const divider of layout.dividers) {
    const isHorizontal = divider.axis === 'horizontal'
    raw.push({
      label: isHorizontal ? 'Shelf' : 'Divider',
      qty: 1,
      width: isHorizontal ? gs.width - 2 * t : gs.height - 2 * t,
      height: gs.depth - (gs.backThickness ?? 6),
      depth: t,
      material: divider.material,
    })
  }

  for (const v of layout.voids) {
    if (v.elementType === 'drawer') {
      const drawerH = v.h - (v.drawerConfig?.reveal ?? 4) * 2
      const drawerW = v.w - 2
      const DRAWER_BOX_TOP_CLEARANCE_MM = 12
      const boxH = drawerH - DRAWER_BOX_TOP_CLEARANCE_MM
      raw.push({ label: 'Drawer box', qty: 1, width: drawerW, height: boxH, depth: gs.depth - t - (gs.backThickness ?? 6) - 25, material: v.material })
    }
  }

  return raw.map(entry => ({ ...entry, unitId: unit.id, unitLabel: unit.label }))
}
```

Also update the existing `computeCutList(design: Design)` shim at the top of the file to call `computeCutListForUnits`:

```ts
// Backward-compat shim
export function computeCutList(design: Design): CutListEntry[] {
  return computeCutListForUnits(design.units)
}
```

Note: This will require adjusting the import at the top of `cutList.ts` since it currently imports `computeLayout` which no longer takes a `Design`. Update to import `computeUnitLayout` instead.

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/engine/cutList.test.ts
```
Expected: All new tests pass + all existing cut list tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/engine/cutList.ts src/engine/cutList.test.ts
git commit -m "feat(engine): computeCutListForUnits with unitId/unitLabel tagging per unit"
```

---

## Task 4: Update Store

**Files:**
- Modify: `src/store/store.ts`

Depends on: Tasks 1, 2

- [ ] **Step 1: Write failing store tests**

Add to `src/store/store.test.ts` (or create it):

```ts
import { act, renderHook } from '@testing-library/react'
import { useStore } from './store'

beforeEach(() => {
  // Reset store to a clean state between tests
  useStore.setState({
    projects: [{
      id: 'proj1',
      name: 'Test',
      units: [{
        type: 'cabinet', id: 'u1', label: 'Unit 1', x: 0, y: 0,
        settings: { unit: 'mm', height: 800, width: 600, depth: 500, thickness: 18, backThickness: 6, toeKick: null, defaultMaterial: 'oak' },
        root: { id: 'r1', elementType: 'void' },
      }],
    }],
    activeProjectId: 'proj1',
    selectedId: null,
    snapGrid: 5,
    activeUnitId: 'u1',
  })
})

describe('addUnit', () => {
  it('appends a new unit and sets it as activeUnitId', () => {
    const { result } = renderHook(() => useStore())
    act(() => result.current.addUnit())
    const project = result.current.projects.find(p => p.id === 'proj1')!
    expect(project.units).toHaveLength(2)
    expect(result.current.activeUnitId).toBe(project.units[1].id)
  })

  it('new unit is positioned at x = first unit width + gap', () => {
    const { result } = renderHook(() => useStore())
    act(() => result.current.addUnit())
    const project = result.current.projects.find(p => p.id === 'proj1')!
    expect(project.units[1].x).toBeGreaterThan(600)  // 600 + some gap
  })
})

describe('removeUnit', () => {
  it('cannot remove the last unit', () => {
    const { result } = renderHook(() => useStore())
    act(() => result.current.removeUnit('u1'))
    expect(result.current.projects.find(p => p.id === 'proj1')!.units).toHaveLength(1)
  })

  it('switches activeUnitId before removing active unit', () => {
    const { result } = renderHook(() => useStore())
    act(() => result.current.addUnit())
    const units = result.current.projects.find(p => p.id === 'proj1')!.units
    const secondId = units[1].id
    act(() => result.current.setActiveUnit(secondId))
    act(() => result.current.removeUnit(secondId))
    expect(result.current.activeUnitId).toBe('u1')
  })
})

describe('updateUnitSettings', () => {
  it('patches the correct unit settings', () => {
    const { result } = renderHook(() => useStore())
    act(() => result.current.updateUnitSettings('u1', { height: 1000 }))
    const unit = result.current.projects.find(p => p.id === 'proj1')!.units[0]
    expect(unit.settings.height).toBe(1000)
  })
})

describe('tree mutations route to active unit', () => {
  it('addShelf mutates activeUnit root', () => {
    const { result } = renderHook(() => useStore())
    const voidId = result.current.projects.find(p => p.id === 'proj1')!.units[0].root.id
    act(() => result.current.addShelf(voidId))
    const root = result.current.projects.find(p => p.id === 'proj1')!.units[0].root
    expect(root.splitAxis).toBe('horizontal')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/store/store.test.ts
```
Expected: Errors about missing `activeUnitId`, `addUnit`, `removeUnit`, `updateUnitSettings`

- [ ] **Step 3: Update `store.ts`**

Key changes (full diff, not exhaustive — adapt carefully to preserve existing functionality):

**a) Add `activeUnitId` to `StoreState` and initial state:**

```ts
// In StoreState interface, add after snapGrid:
activeUnitId: string | null

// New actions (setUnitPosition is deferred until drag-to-reorder is implemented):
addUnit: () => void
removeUnit: (unitId: string) => void
setActiveUnit: (unitId: string) => void
renameUnit: (unitId: string, label: string) => void
updateUnitSettings: (unitId: string, patch: Partial<GlobalSettings>) => void
```

**b) Update `defaultDesign()`:**

```ts
function defaultDesign(): Design {
  const unitId = nanoid(8)
  return {
    id: nanoid(),
    name: 'Cabinet 1',
    units: [{
      type: 'cabinet',
      id: unitId,
      label: 'Unit 1',
      settings: {
        unit: 'mm', height: 800, width: 600, depth: 500,
        thickness: 18, backThickness: 6, toeKick: null, defaultMaterial: 'oak',
      },
      root: { id: nanoid(8), elementType: 'void' },
      x: 0,
      y: 0,
    }],
  }
}
```

**c) Replace `activeDesign` and `mutateRoot` helpers:**

```ts
function activeDesign(state: PersistedState & { activeUnitId: string | null }): Design | undefined {
  return state.projects.find(p => p.id === state.activeProjectId)
}

function findActiveUnit(state: PersistedState & { activeUnitId: string | null }) {
  return activeDesign(state)?.units.find(u => u.id === state.activeUnitId) ?? null
}

function mutateActiveUnit(
  state: PersistedState & { activeUnitId: string | null },
  fn: (unit: CabinetSceneUnit) => CabinetSceneUnit
): void {
  const proj = activeDesign(state)
  if (!proj) return
  const idx = proj.units.findIndex(u => u.id === state.activeUnitId)
  if (idx === -1) return
  proj.units[idx] = fn(proj.units[idx] as CabinetSceneUnit)
}
```

**d) Update `updateSettings` to `updateUnitSettings`** and add a shim `updateSettings` that operates on the active unit:

```ts
updateSettings: (patch) => set(s => {
  const unit = findActiveUnit(s)
  if (unit) Object.assign(unit.settings, patch)
}),

updateUnitSettings: (unitId, patch) => set(s => {
  const proj = activeDesign(s)
  if (!proj) return
  const unit = proj.units.find(u => u.id === unitId)
  if (unit) Object.assign(unit.settings, patch)
}),
```

**e) Update all tree mutation actions** to use `mutateActiveUnit`:

```ts
addShelf: (nodeId) => set(s => {
  mutateActiveUnit(s, u => ({ ...u, root: addShelf(u.root, nodeId) }))
}),
// ... same pattern for addDivider, deleteBoard, setNodeSize, unlockNode, setLocked, setMaterial, etc.
```

**f) Add new unit actions:**

```ts
addUnit: () => set(s => {
  const proj = activeDesign(s)
  if (!proj) return
  const rightmost = proj.units.reduce((max, u) => Math.max(max, u.x + u.settings.width), 0)
  const newUnitId = nanoid(8)
  const newUnit: CabinetSceneUnit = {
    type: 'cabinet',
    id: newUnitId,
    label: `Unit ${proj.units.length + 1}`,
    settings: { ...proj.units[0].settings },  // copy active unit's settings as default
    root: { id: nanoid(8), elementType: 'void' },
    x: rightmost + 20,  // 20mm gap
    y: 0,
  }
  proj.units.push(newUnit)
  s.activeUnitId = newUnitId
}),

removeUnit: (unitId) => set(s => {
  const proj = activeDesign(s)
  if (!proj || proj.units.length <= 1) return
  // Switch active unit FIRST before splicing
  if (s.activeUnitId === unitId) {
    const remaining = proj.units.filter(u => u.id !== unitId)
    s.activeUnitId = remaining[0]?.id ?? null
  }
  proj.units = proj.units.filter(u => u.id !== unitId)
}),

setActiveUnit: (unitId) => set(s => {
  s.activeUnitId = unitId
}),

renameUnit: (unitId, label) => set(s => {
  const proj = activeDesign(s)
  const unit = proj?.units.find(u => u.id === unitId)
  if (unit) unit.label = label
}),

setUnitPosition: (unitId, x, y) => set(s => {
  const proj = activeDesign(s)
  const unit = proj?.units.find(u => u.id === unitId)
  if (unit) { unit.x = x; unit.y = y }
}),
```

**g) Update `importWorkspace` to handle new Design shape**

**h) Add `activeUnitId` to initial state in `create(...)`:**

```ts
activeUnitId: _initialDesign.units[0]?.id ?? null,
```

Note: `activeUnitId` is NOT included in `partializeProjectState` — it stays transient.

**i) Add `version: 1` and `migrate` to the `persist` config:**

```ts
{
  name: 'buildbox-store',
  version: 1,
  migrate: (persisted: unknown, fromVersion: number) => {
    if (fromVersion === 0) {
      const old = persisted as {
        projects: Array<{
          id: string; name: string
          root: CabinetNode; globalSettings: GlobalSettings
        }>
        activeProjectId: string | null
      }
      return {
        projects: old.projects.map(d => ({
          id: d.id,
          name: d.name,
          units: [{
            type: 'cabinet' as const,
            id: nanoid(8),
            label: 'Unit 1',
            settings: d.globalSettings,
            root: d.root,
            x: 0,
            y: 0,
          }],
        })),
        activeProjectId: old.activeProjectId,
      }
    }
    return persisted
  },
  partialize: partializeProjectState,
}
```

**j) After the store is created, on migration, clear temporal history:**

This is tricky with Zustand — the `onRehydrateStorage` callback is the right place:

```ts
// After persist config, add onRehydrateStorage:
onRehydrateStorage: () => (state, error) => {
  if (!error && state) {
    // Clear undo history after hydration — old snapshots have pre-migration shape
    useStore.temporal.getState().clear()
  }
}
```

- [ ] **Step 4: Run all tests**

```bash
npx vitest run src/store/store.test.ts
```
Expected: All new tests pass. Full suite: `npx vitest run` — expect existing tests to pass; any that use old `Design.root`/`globalSettings` directly will need updating (addressed in Tasks 6 and 7).

- [ ] **Step 5: Commit**

```bash
git add src/store/store.ts src/store/store.test.ts
git commit -m "feat(store): multi-unit actions, activeUnitId in UIState, v0→v1 migration"
```

---

## Task 5: Create UnitSelector Component

**Files:**
- Create: `src/components/Sidebar/UnitSelector.tsx`
- Create: `src/components/Sidebar/UnitSelector.test.tsx`

Depends on: Task 1 (types only)

- [ ] **Step 1: Write failing tests**

```tsx
// src/components/Sidebar/UnitSelector.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import UnitSelector from './UnitSelector'
import type { CabinetSceneUnit } from '../../types'

const baseSettings = { unit: 'mm' as const, height: 800, width: 600, depth: 500, thickness: 18, backThickness: 6, toeKick: null, defaultMaterial: 'oak' as const }

function makeUnit(id: string, label: string): CabinetSceneUnit {
  return { type: 'cabinet', id, label, x: 0, y: 0, settings: baseSettings, root: { id: `r-${id}`, elementType: 'void' } }
}

const noop = () => {}

describe('UnitSelector', () => {
  it('renders all unit labels', () => {
    const units = [makeUnit('u1', 'Base Left'), makeUnit('u2', 'Upper')]
    render(<UnitSelector units={units} activeUnitId="u1" onSelect={noop} onAdd={noop} onRemove={noop} onRename={noop} />)
    expect(screen.getByText('Base Left')).toBeInTheDocument()
    expect(screen.getByText('Upper')).toBeInTheDocument()
  })

  it('clicking a unit fires onSelect with its id', async () => {
    const user = userEvent.setup()
    const units = [makeUnit('u1', 'Base'), makeUnit('u2', 'Upper')]
    const onSelect = vi.fn()
    render(<UnitSelector units={units} activeUnitId="u1" onSelect={onSelect} onAdd={noop} onRemove={noop} onRename={noop} />)
    await user.click(screen.getByText('Upper'))
    expect(onSelect).toHaveBeenCalledWith('u2')
  })

  it('"Add unit" button fires onAdd', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    render(<UnitSelector units={[makeUnit('u1', 'Base')]} activeUnitId="u1" onSelect={noop} onAdd={onAdd} onRemove={noop} onRename={noop} />)
    await user.click(screen.getByRole('button', { name: /add unit/i }))
    expect(onAdd).toHaveBeenCalled()
  })

  it('"Remove" button hidden when only 1 unit', () => {
    render(<UnitSelector units={[makeUnit('u1', 'Base')]} activeUnitId="u1" onSelect={noop} onAdd={noop} onRemove={noop} onRename={noop} />)
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument()
  })

  it('"Remove" button visible and fires onRemove when ≥ 2 units', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    const units = [makeUnit('u1', 'Base'), makeUnit('u2', 'Upper')]
    render(<UnitSelector units={units} activeUnitId="u1" onSelect={noop} onAdd={noop} onRemove={onRemove} onRename={noop} />)
    await user.click(screen.getAllByRole('button', { name: /remove/i })[0])
    expect(onRemove).toHaveBeenCalledWith('u1')
  })

  it('rename field fires onRename on blur', async () => {
    const user = userEvent.setup()
    const onRename = vi.fn()
    render(<UnitSelector units={[makeUnit('u1', 'Base')]} activeUnitId="u1" onSelect={noop} onAdd={noop} onRemove={noop} onRename={onRename} />)
    const input = screen.getByDisplayValue('Base')
    await user.clear(input)
    await user.type(input, 'New Name')
    await user.tab()
    expect(onRename).toHaveBeenCalledWith('u1', 'New Name')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/components/Sidebar/UnitSelector.test.tsx
```
Expected: FAIL — component doesn't exist

- [ ] **Step 3: Create `UnitSelector.tsx`**

```tsx
import { useState } from 'react'
import type { CabinetUnit } from '../../types'

interface Props {
  units: CabinetUnit[]
  activeUnitId: string | null
  onSelect: (unitId: string) => void
  onAdd: () => void
  onRemove: (unitId: string) => void
  onRename: (unitId: string, label: string) => void
}

export default function UnitSelector({ units, activeUnitId, onSelect, onAdd, onRemove, onRename }: Props) {
  const [editLabels, setEditLabels] = useState<Record<string, string>>({})

  function labelFor(unitId: string, fallback: string) {
    return editLabels[unitId] ?? fallback
  }

  function handleBlur(unitId: string, original: string) {
    const current = editLabels[unitId]
    if (current !== undefined && current !== original) {
      onRename(unitId, current)
    }
    setEditLabels(prev => { const n = { ...prev }; delete n[unitId]; return n })
  }

  return (
    <div className="flex flex-col gap-1 p-2 border-b border-border">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Units</span>
        <button
          onClick={onAdd}
          aria-label="Add unit"
          className="text-xs px-2 py-0.5 rounded bg-accent text-white hover:bg-accent/80"
        >
          + Add unit
        </button>
      </div>
      {units.map(unit => (
        <div
          key={unit.id}
          className={`flex items-center gap-1 rounded px-1 py-0.5 cursor-pointer ${unit.id === activeUnitId ? 'bg-accent/20 ring-1 ring-accent' : 'hover:bg-surface-elevated'}`}
          onClick={() => onSelect(unit.id)}
        >
          <input
            className="flex-1 bg-transparent text-sm text-text outline-none"
            value={labelFor(unit.id, unit.label)}
            onClick={e => e.stopPropagation()}
            onChange={e => setEditLabels(prev => ({ ...prev, [unit.id]: e.target.value }))}
            onBlur={() => handleBlur(unit.id, unit.label)}
          />
          {units.length >= 2 && (
            <button
              aria-label={`Remove ${unit.label}`}
              onClick={e => { e.stopPropagation(); onRemove(unit.id) }}
              className="text-xs text-red-400 hover:text-red-600 px-1"
            >
              ✕
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/components/Sidebar/UnitSelector.test.tsx
```
Expected: All 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/Sidebar/UnitSelector.tsx src/components/Sidebar/UnitSelector.test.tsx
git commit -m "feat(ui): UnitSelector component with add/remove/rename/select"
```

---

## Task 6: Update CabinetCanvas

**Files:**
- Modify: `src/components/CabinetCanvas/CabinetCanvas.tsx`
- Modify: `src/components/CabinetCanvas/CabinetCanvas.test.tsx` (if exists)

Depends on: Tasks 1, 2

- [ ] **Step 1: Write failing test for multi-unit rendering**

```tsx
// Add to existing CabinetCanvas test file, or create one:
// src/components/CabinetCanvas/CabinetCanvas.test.tsx
import { render, screen } from '@testing-library/react'
import CabinetCanvas from './CabinetCanvas'
import type { SceneLayout } from '../../types'
import { createRef } from 'react'

function makeSceneLayout(unitCount: number): SceneLayout {
  const units = Array.from({ length: unitCount }, (_, i) => ({
    kind: 'cabinet' as const,
    unitId: `u${i + 1}`,
    label: `Unit ${i + 1}`,
    isActive: i === 0,
    x: i * 700,
    y: 0,
    w: 600,
    h: 800,
    unit: 'mm' as const,
    panels: [],
    voids: [],
    dividers: [],
    overConstrainedIds: [],
  }))
  return {
    units,
    boundingBox: { x: 0, y: 0, w: unitCount * 700, h: 800 },
  }
}

it('renders one <g> group per unit', () => {
  const sceneLayout = makeSceneLayout(2)
  render(
    <svg>
      <CabinetCanvas
        sceneLayout={sceneLayout}
        svgRef={createRef()}
        onUnlockNode={() => {}}
        onUnitClick={() => {}}
      />
    </svg>
  )
  const groups = document.querySelectorAll('[data-unit-id]')
  expect(groups).toHaveLength(2)
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/components/CabinetCanvas/CabinetCanvas.test.tsx
```

- [ ] **Step 3: Update `CabinetCanvas.tsx`**

Replace the props interface and rendering logic:

```tsx
import { useCallback, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useStore } from '../../store/store'
import type { SceneLayout, UnitLayoutResult } from '../../types'
import CanvasLayers from './CanvasLayers'
import DragHandles from './DragHandles'
import DimensionLabels from './DimensionLabels'
import ZoomControls, { ZOOM_MAX, ZOOM_MIN } from './ZoomControls'

interface Props {
  sceneLayout: SceneLayout
  svgRef: RefObject<SVGSVGElement | null>
  onUnlockNode: (nodeId: string) => void
  onUnitClick: (unitId: string) => void
}

const PADDING = 40

export default function CabinetCanvas({ sceneLayout, svgRef, onUnlockNode, onUnitClick }: Props) {
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const isPanning = useRef(false)
  const lastPan = useRef({ x: 0, y: 0 })
  const selectedId = useStore((s) => s.selectedId)
  const setSelectedId = useStore((s) => s.setSelectedId)
  const storeSetNodeSize = useStore((s) => s.setNodeSize)
  const snapGrid = useStore((s) => s.snapGrid)

  const { boundingBox: bb } = sceneLayout
  const viewBox = `${bb.x - PADDING} ${bb.y - PADDING} ${bb.w + 2 * PADDING} ${bb.h + 2 * PADDING}`

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * (e.deltaY < 0 ? 1.25 : 0.8))))
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

  const onPointerUp = useCallback(() => { isPanning.current = false }, [])
  const onPointerCancel = useCallback(() => { isPanning.current = false }, [])

  const handleZoomIn = useCallback(() => setZoom((z) => Math.min(ZOOM_MAX, z * 1.25)), [])
  const handleZoomOut = useCallback(() => setZoom((z) => Math.max(ZOOM_MIN, z * 0.8)), [])
  const handleFitAll = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }) }, [])

  function handleCommitSize(nodeId: string, mm: number) {
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
          {sceneLayout.units.map(result => (
            <g
              key={result.unitId}
              data-unit-id={result.unitId}
              transform={`translate(${result.x}, ${result.y})`}
              onClick={() => onUnitClick(result.unitId)}
            >
              <CanvasLayers
                panels={result.panels}
                voids={result.voids}
                dividers={result.dividers}
                selectedId={selectedId}
                onSelectVoid={setSelectedId}
                onSelectDivider={setSelectedId}
              />
              <DimensionLabels
                voids={result.voids}
                unit={result.unit}
                onCommitSize={handleCommitSize}
                lockedNodeIds={result.overConstrainedIds}
                onUnlockNode={onUnlockNode}
                zoom={zoom}
              />
              <DragHandles
                dividers={result.dividers}
                snapGrid={snapGrid}
                svgRef={svgRef}
                zoom={zoom}
              />
              {result.isActive && (
                <rect
                  x={-2}
                  y={-2}
                  width={result.w + 4}
                  height={result.h + 4}
                  fill="none"
                  stroke="var(--color-accent)"
                  strokeWidth={2 / zoom}
                  strokeDasharray={`${6 / zoom} ${3 / zoom}`}
                  pointerEvents="none"
                />
              )}
            </g>
          ))}
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

Note: Remove the old `overConstrainedIds` prop — it's now embedded in each `UnitLayoutResult`.

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/components/CabinetCanvas/
```
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/CabinetCanvas/CabinetCanvas.tsx src/components/CabinetCanvas/CabinetCanvas.test.tsx
git commit -m "feat(canvas): SceneLayout-only props, per-unit <g> groups, active unit frame"
```

---

## Task 7: Update Sidebar and App

**Files:**
- Modify: `src/components/Sidebar/Sidebar.tsx`
- Modify: `src/App.tsx`

Depends on: Tasks 4, 5, 6

- [ ] **Step 1: Update `Sidebar.tsx` to include UnitSelector and unit-grouped cut list**

The sidebar receives `units`, `activeUnitId`, and unit management callbacks in addition to the existing props:

```tsx
// Updated Props interface (add to existing):
interface Props {
  // ... existing props ...
  units: CabinetUnit[]
  activeUnitId: string | null
  onAddUnit: () => void
  onRemoveUnit: (unitId: string) => void
  onSelectUnit: (unitId: string) => void
  onRenameUnit: (unitId: string, label: string) => void
}
```

Add `UnitSelector` above the existing Actions section. For the cut list `<details>`, group entries by `unitLabel`:

```tsx
import UnitSelector from './UnitSelector'

// In the cut list section, replace the flat map with:
const grouped = cutList.reduce<Record<string, CutListEntry[]>>((acc, e) => {
  if (!acc[e.unitLabel]) acc[e.unitLabel] = []
  acc[e.unitLabel].push(e)
  return acc
}, {})

// Render:
{Object.entries(grouped).map(([unitLabel, entries]) => (
  <div key={unitLabel}>
    <p className="text-xs font-semibold text-text-secondary mt-2 mb-1">{unitLabel}</p>
    {entries.map((e, i) => (
      <div key={i} className="text-xs ...">
        {e.label} {e.qty > 1 ? `× ${e.qty}` : ''} — {e.width}×{e.height}×{e.depth}mm ({e.material})
      </div>
    ))}
  </div>
))}
```

- [ ] **Step 2: Update `App.tsx`**

Key changes:

```tsx
// Replace:
const activeDesign = projects.find(...) ?? projects[0]
const layout = useMemo(() => computeLayout(activeDesign), [activeDesign])
const overConstrainedIds = layout?.overConstrainedIds ?? []

// With:
import { computeSceneLayout } from './engine/layoutEngine'
import { computeCutListForUnits } from './engine/cutList'

const activeUnitId = useStore((s) => s.activeUnitId)
const addUnit = useStore((s) => s.addUnit)
const removeUnit = useStore((s) => s.removeUnit)
const setActiveUnit = useStore((s) => s.setActiveUnit)
const renameUnit = useStore((s) => s.renameUnit)
const updateUnitSettings = useStore((s) => s.updateUnitSettings)

const activeProject = projects.find(p => p.id === activeProjectId) ?? projects[0]
const activeUnit = activeProject?.units.find(u => u.id === activeUnitId) ?? activeProject?.units[0]

const sceneLayout = useMemo(
  () => (activeProject ? computeSceneLayout(activeProject.units, activeUnitId) : null),
  [activeProject, activeUnitId]
)

const cutList = useMemo(
  () => (activeProject ? computeCutListForUnits(activeProject.units) : []),
  [activeProject]
)

// Update CabinetCanvas call:
{sceneLayout && (
  <CabinetCanvas
    sceneLayout={sceneLayout}
    svgRef={svgRef}
    onUnlockNode={storeUnlockNode}
    onUnitClick={setActiveUnit}
  />
)}

// Update Toolbar to use activeUnit.settings:
<Toolbar
  settings={activeUnit?.settings ?? defaultSettings}
  onSettingsChange={(patch) => activeUnitId && updateUnitSettings(activeUnitId, patch)}
  ...
/>

// Update Sidebar:
<Sidebar
  units={activeProject?.units ?? []}
  activeUnitId={activeUnitId}
  onAddUnit={addUnit}
  onRemoveUnit={removeUnit}
  onSelectUnit={setActiveUnit}
  onRenameUnit={renameUnit}
  cutList={cutList}
  ...
/>
```

- [ ] **Step 3: Run full test suite**

```bash
cd /home/chryston/docker/copilot/repos/worktrees/buildbox-fixes-export-phase-bc
npx vitest run
```
Expected: All tests pass (some existing tests may need minor updates to use the new types; fix them now).

- [ ] **Step 4: Commit**

```bash
git add src/components/Sidebar/Sidebar.tsx src/App.tsx
git commit -m "feat(app): wire multi-unit canvas — UnitSelector in sidebar, unit-grouped cut list"
```

---

## Task 8: End-to-End Integration Test

**Files:**
- Modify: `src/integration/cabinetFlow.test.tsx`

Depends on: Task 7

- [ ] **Step 1: Add the Phase B integration test**

Add this test block to `src/integration/cabinetFlow.test.tsx`:

```tsx
describe('Phase B: multi-unit canvas', () => {
  it('user adds a second unit, adds a shelf, and sees cut list entries from both units', async () => {
    const user = userEvent.setup()
    render(<App />)

    // Initial state: 1 unit "Unit 1" in sidebar
    expect(screen.getByDisplayValue('Unit 1')).toBeInTheDocument()

    // Add a second unit
    await user.click(screen.getByRole('button', { name: /add unit/i }))

    // Unit 2 should appear in sidebar
    expect(screen.getByDisplayValue('Unit 2')).toBeInTheDocument()

    // Click Unit 2 to select it
    await user.click(screen.getByDisplayValue('Unit 2'))

    // Canvas should now show 2 unit groups
    const canvas = document.querySelector('[data-testid="cabinet-canvas"]')!
    expect(canvas.querySelectorAll('[data-unit-id]')).toHaveLength(2)

    // Open cut list (in sidebar details)
    const cutListSummary = screen.getByText(/cut list/i)
    await user.click(cutListSummary)

    // Both unit sections should appear in cut list
    expect(screen.getByText('Unit 1')).toBeInTheDocument()
    expect(screen.getByText('Unit 2')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the integration test**

```bash
npx vitest run src/integration/cabinetFlow.test.tsx
```
Expected: All integration tests pass.

- [ ] **Step 3: Run the full test suite one final time**

```bash
npx vitest run
```
Expected: All tests pass. Note the count.

- [ ] **Step 4: Commit**

```bash
git add src/integration/cabinetFlow.test.tsx
git commit -m "test(integration): Phase B multi-unit E2E — add unit, select, cut list from both units"
```

---

## Parallelization Notes

After Task 1 is committed, Tasks 2, 3, and 5 can be executed in **parallel** (they only depend on types):
- **Wave 1 (parallel):** T2 (engine) + T3 (cut list) + T5 (UnitSelector)
- **Wave 2 (sequential):** T4 (store) → T6 (canvas) → T7 (App+Sidebar) → T8 (integration)

T4 depends on T2 being done (to import `computeSceneLayout` for the App memoization — but T4 itself only needs types + helpers). T6 depends on T2 (for `SceneLayout` type in props). T7 depends on T4+T5+T6.
