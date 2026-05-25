# BuildBox — Phase C: Kitchen Countertop Mode Design Spec

**Date:** 2026-05-23 (rev 2 — post adversarial review)
**Branch:** `phase-bc` (based on `fixes-export`; depends on Phase B)
**Scope:** Extend the multi-unit canvas with a countertop unit type, plus placeable kitchen elements (sink, hob) that are resizable and positioned on the countertop. Hood is deferred to a future phase.

---

## 1. Problem Statement

After Phase B, the canvas shows multiple cabinets. A kitchen also needs:

1. A **countertop** — a horizontal stone/material slab sitting on top of base cabinets.
2. **Built-in elements** on the countertop: sink, hob (cooktop).
3. **Cabinet-integrated elements**: built-in microwave (occupies a void in a cabinet).
4. All elements must be **resizable** and **repositionable** on the canvas.

**Out of scope (deferred):** Hood extractor — it is wall-mounted above, not on, the countertop. It requires a separate coordinate system and is deferred to a future `WallElement` phase.

---

## 2. Goals

- Add `countertop` as a new unit type via a proper discriminated union (`CabinetSceneUnit | CountertopSceneUnit`).
- Countertop renders as a flat rectangle in front-elevation view (a horizontal band showing slab thickness).
- Allow placing `CountertopElement` items (sink, hob) on the countertop, each with a position and size.
- Elements are bounded to the countertop slab (clamped, not rejected).
- Microwave is a special `ElementType` on a `CabinetNode` void (shown as labelled void, no shelves inside).
- Cut list includes countertop slab dimensions with structured cutout data.

---

## 3. Out of Scope (Phase C)

- Hood extractor (wall-mounted — deferred to WallElement phase).
- 3D view or perspective rendering.
- Plumbing/electrical routing.
- Multiple countertop materials per countertop (single material per countertop unit).
- Cabinet doors/drawers.
- Pricing or material cost calculation.

---

## 4. Data Model

### 4.1 `CabinetUnit` becomes a discriminated union

The single `CabinetUnit` struct is replaced by a tagged union. This prevents illegal states (e.g., a `root` field on a countertop that is semantically meaningless).

```ts
export type UnitType = 'cabinet' | 'countertop'

interface UnitBase {
  id: string
  label: string
  x: number
  y: number
}

export interface CabinetSceneUnit extends UnitBase {
  type: 'cabinet'
  settings: GlobalSettings    // height, width, depth, thickness, etc.
  root: CabinetNode
}

export interface CountertopSceneUnit extends UnitBase {
  type: 'countertop'
  settings: CountertopSettings
  elements: CountertopElement[]  // non-optional; empty array by default
}

export type CabinetUnit = CabinetSceneUnit | CountertopSceneUnit
```

TypeScript narrowing works everywhere via `unit.type === 'cabinet'` / `'countertop'`.

### 4.2 New Type: `CountertopSettings`

Dedicated settings type for countertops — no repurposing of `GlobalSettings` field names:

```ts
export interface CountertopSettings {
  worktopWidth: number        // mm — total width of the slab
  worktopDepth: number        // mm — front-to-back depth (e.g. 600mm)
  slabThickness: number       // mm — slab thickness (e.g. 20–40mm)
  material: CountertopMaterialId
}

export type CountertopMaterialId = 'granite' | 'marble' | 'quartz'
```

### 4.3 New Type: `CountertopElement`

```ts
export type CountertopElementType = 'sink' | 'hob'

export interface CountertopElement {
  id: string
  type: CountertopElementType
  label: string               // user-editable, e.g. "1.5 Bowl Sink"
  x: number                   // mm offset from countertop left edge (clamped ≥ 0)
  y: number                   // mm offset from countertop front edge (clamped ≥ 0)
  width: number               // mm (clamped: x + width ≤ worktopWidth)
  depth: number               // mm (clamped: y + depth ≤ worktopDepth)
}
```

**Bounds invariant:** All four clamp conditions are enforced in the store action and layout engine. Elements that would exceed the slab are silently clamped to fit.

### 4.4 Updated `ElementType`

```ts
export type ElementType = 'void' | 'drawer' | 'hanging-space' | 'microwave'
```

A `CabinetNode` with `elementType === 'microwave'` renders with a "Microwave" label and is excluded from further subdivision. It appears in the cut list as its own void entry.

### 4.5 Updated Material Types

```ts
// Existing cabinet materials unchanged
export type CabinetMaterialId = 'oak' | 'walnut' | 'white' | 'birch' | 'mdf'

// Countertop-specific materials
export type CountertopMaterialId = 'granite' | 'marble' | 'quartz'
```

These are separate union types — `GlobalSettings.defaultMaterial` remains `CabinetMaterialId`, preventing accidental mixing.

### 4.6 Updated `CutListEntry` (structural cutouts)

```ts
export interface CutListEntry {
  label: string
  qty: number
  width: number
  height: number
  depth: number
  unitId: string              // from Phase B
  unitLabel: string           // from Phase B
  material: CabinetMaterialId | CountertopMaterialId
  cutouts?: Array<{           // structured — replaces free-form notes string
    type: CountertopElementType
    label: string
    width: number
    depth: number
  }>
}
```

---

## 5. Architecture

### 5.1 Discriminated `AnyUnitLayout`

The layout output union uses a `kind` discriminant so TypeScript narrowing works at compile time:

```ts
export interface UnitLayoutResult {
  kind: 'cabinet'             // discriminant
  unitId: string
  label: string
  isActive: boolean
  x: number; y: number; w: number; h: number
  panels: LayoutPanel[]
  voids: LayoutVoid[]
  dividers: LayoutDivider[]
  overConstrainedIds: string[]
}

export interface CountertopLayout {
  kind: 'countertop'          // discriminant
  unitId: string
  label: string
  isActive: boolean
  x: number; y: number; w: number; h: number
  slabRect: { x: number; y: number; w: number; h: number }
  elements: CountertopElementLayout[]
}

export interface CountertopElementLayout {
  element: CountertopElement
  // x, y are relative to countertop origin (same as element.x, element.y)
  // canvas applies translate(countertop.x, countertop.y) so no conversion needed here
}

export type AnyUnitLayout = UnitLayoutResult | CountertopLayout

export interface SceneLayout {
  units: AnyUnitLayout[]
  boundingBox: { x: number; y: number; w: number; h: number }
}
```

### 5.2 Engine: `computeSceneLayout` extension

`computeSceneLayout` branches on `unit.type`:
- `'cabinet'` → existing `computeUnitLayout(unit.settings, unit.root)`
- `'countertop'` → new `computeCountertopLayout(unit)` which derives `slabRect` from `settings` and wraps `elements` as `CountertopElementLayout[]`

### 5.3 Canvas: `CabinetCanvas`

`CabinetCanvas` branches on `result.kind` when rendering each unit:

```tsx
sceneLayout.units.map(result => (
  <g key={result.unitId} transform={`translate(${result.x}, ${result.y})`}>
    {result.kind === 'cabinet'
      ? <CabinetUnitGroup layout={result} zoom={zoom} onUnlockNode={...} />
      : <CountertopLayer layout={result} zoom={zoom} selectedElementId={selectedElementId}
          onSelectElement={...} onMoveElement={...} onResizeElement={...} />
    }
    {result.isActive && <ActiveUnitFrame w={result.w} h={result.h} />}
  </g>
))
```

### 5.4 `CountertopLayer` — coordinate contract

`CountertopLayer` renders elements in **unit-local coordinates** (mm relative to countertop origin). The parent `<g translate(x, y)>` handles the scene-level offset.

Drag/resize callbacks fire **mm-relative-to-countertop** coordinates — the layer converts from SVG/canvas pixels to mm before invoking the callback:

```
mm_x = (canvasPx_x - panX) / (zoom * SVG_SCALE) - countertop.x
```

`onMoveElement(elementId, mmX, mmY)` and `onResizeElement(elementId, mmWidth, mmDepth)` receive pre-converted mm values. The store clamps on write.

### 5.5 Sidebar: Countertop Panel

When `activeUnit.type === 'countertop'`, sidebar shows `CountertopPanel` instead of cabinet Actions:

- "Add sink" / "Add hob" buttons — each appends a default-sized centred element
- List of existing elements with remove button
- Width/depth mm inputs for the selected element
- Material selector (granite / marble / quartz)
- Unit position inputs (x, y in mm from canvas origin)

### 5.6 `addUnit` gains optional `type` parameter

```ts
addUnit: (type?: UnitType) => void
// default: 'cabinet'; passing 'countertop' initializes a CountertopSceneUnit
```

### 5.7 Store Actions (new for Phase C)

```ts
addCountertopElement: (unitId: string, type: CountertopElementType) => void
  // default size: sink 600×500, hob 600×520 (mm)
  // default position: x = (worktopWidth - width) / 2, y = (worktopDepth - depth) / 2
  // clamped to slab bounds

removeCountertopElement: (unitId: string, elementId: string) => void

updateCountertopElement: (unitId: string, elementId: string, patch: Partial<CountertopElement>) => void
  // applies patch then clamps x/y/width/depth to slab bounds
```

---

## 6. Component Interfaces

### `CountertopLayer` props (new)
```ts
interface Props {
  layout: CountertopLayout
  selectedElementId: string | null
  zoom: number
  onSelectElement: (elementId: string | null) => void
  onMoveElement: (elementId: string, mmX: number, mmY: number) => void
  onResizeElement: (elementId: string, mmWidth: number, mmDepth: number) => void
}
```

### `CountertopPanel` props (new)
```ts
interface Props {
  unit: CountertopSceneUnit
  selectedElementId: string | null
  onAddElement: (type: CountertopElementType) => void
  onRemoveElement: (elementId: string) => void
  onUpdateElement: (elementId: string, patch: Partial<CountertopElement>) => void
}
```

---

## 7. Data Flow

```
App
 ├─ units[] includes CountertopSceneUnit
 ├─ Sidebar
 UnitSelector (Phase B) — "Add unit" shows type picker (cabinet | countertop) │   ├
 │   └─ if activeUnit.type === 'cabinet'    → Actions (Phase B)
 │      if activeUnit.type === 'countertop' → CountertopPanel
 └─ CabinetCanvas(sceneLayout)
       └─ per result:
            result.kind === 'cabinet'    → CabinetUnitGroup
            result.kind === 'countertop' → CountertopLayer
               └─ slabRect + element rects (dashed) + resize handles on selected
```

---

## 8. New & Changed Files

| File | Action | Notes |
|------|--------|-------|
| `src/types/index.ts` | **Modify** | `CabinetSceneUnit`, `CountertopSceneUnit`, `CabinetUnit` union; `CountertopSettings`; `CountertopElement`; `CountertopMaterialId`; `CabinetMaterialId`; `UnitLayoutResult` gains `kind: 'cabinet'`; `CountertopLayout` with `kind: 'countertop'`; `AnyUnitLayout`; `CutListEntry` gains `cutouts?[]` |
| `src/engine/layoutEngine.ts` | **Modify** | `computeSceneLayout` branches on `unit.type`; add `computeCountertopLayout` |
| `src/engine/layoutEngine.test.ts` | **Modify** | Countertop layout: slab dims; element clamping |
| `src/engine/cutList.ts` | **Modify** | Handle `CountertopSceneUnit`; produce slab entry with `cutouts[]` |
| `src/engine/cutList.test.ts` | **Modify** | Countertop cut list; sink cutout in structured `cutouts[]` |
| `src/store/store.ts` | **Modify** | `addUnit(type?)`; `addCountertopElement`; `removeCountertopElement`; `updateCountertopElement` (with clamping) |
| `src/components/CabinetCanvas/CountertopLayer.tsx` | **Create** | Slab rect + element rects + resize/drag handles; px→mm conversion |
| `src/components/CabinetCanvas/CountertopLayer.test.tsx` | **Create** | Render, select, move (stub), resize (stub) |
| `src/components/CabinetCanvas/CabinetCanvas.tsx` | **Modify** | Branch `result.kind`; render `CountertopLayer` |
| `src/components/Sidebar/CountertopPanel.tsx` | **Create** | Add/remove/edit elements |
| `src/components/Sidebar/CountertopPanel.test.tsx` | **Create** | Panel tests |
| `src/components/Sidebar/Sidebar.tsx` | **Modify** | Render `CountertopPanel` when active unit is countertop |
| `src/integration/cabinetFlow.test.tsx` | **Modify** | E2E: add countertop unit, add hob, verify cut list has structured entry |

---

## 9. Tests & Success Criteria

### Engine
- `computeSceneLayout` with `CountertopSceneUnit` produces `CountertopLayout` with `kind: 'countertop'`
- `computeCountertopLayout` slab dimensions match `settings.worktopWidth × settings.worktopDepth`
- Element placement out-of-bounds is clamped (no throw): element at `x=9999` → clamped to `x = worktopWidth - element.width`
- Cut list for countertop: `width=worktopWidth`, `height=worktopDepth`, `depth=slabThickness`
- Cut list `cutouts[]` contains one entry per sink/hob element

### `CountertopLayer` component
- Renders slab rectangle with correct data-testid
- Renders each element with its label
- Clicking element fires `onSelectElement(elementId)`
- Selected element has resize handle elements visible

### `CountertopPanel` component
- "Add sink" fires `onAddElement('sink')`
- "Add hob" fires `onAddElement('hob')`
- "Remove" on an element fires `onRemoveElement(elementId)`
- Width input change fires `onUpdateElement(elementId, { width: newValue })`

### Integration (E2E)
```
1. render(<App />)
2. Click "Add unit" → select type "countertop"
3. Expect countertop slab visible on canvas (kind === 'countertop' group rendered)
4. Click "Add hob" in CountertopPanel
5. Hob rectangle appears on countertop slab
6. Cut list in sidebar shows countertop entry with cutouts[0].type === 'hob'
```

---

## 10. Dependency on Phase B

Phase C **requires** Phase B's multi-unit data model (`CabinetUnit` union, `SceneLayout`, `computeSceneLayout`). Phase C cannot be implemented without Phase B being complete.

The `CabinetUnit` type introduced in Phase B is replaced here with the discriminated union. Phase B implementation should use a forward-compatible `type?: UnitType` field even if only `'cabinet'` is used, to ease the Phase C migration.

---

## 11. Non-Goals / Explicitly Excluded

- Hood extractor (wall-mounted, deferred to future `WallElement` phase)
- Countertop element snapping to cabinet edges
- Dimensioned cutout drawings for sink/hob
- Upstand / splashback as separate elements
