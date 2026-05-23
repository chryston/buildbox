# BuildBox — Phase B: Multi-Unit Canvas Design Spec

**Date:** 2026-05-23 (rev 2 — post adversarial review)
**Branch:** `phase-bc` (based on `fixes-export`)
**Scope:** Allow multiple cabinet units on a single canvas — bottom + upper cabinets, side-by-side cabinets of different heights, and L-shaped arrangements.

---

## 1. Problem Statement

BuildBox currently models one cabinet per project. Real kitchens require:

1. **Stacked layout:** Base cabinet + upper cabinet sitting above it on the same canvas.
2. **Side-by-side layout:** Multiple cabinets of different heights placed along a wall (e.g., fridge surround + standard units + tall pantry).
3. **L-shaped arrangement:** Two runs of cabinets meeting at a corner (two rectangular units placed at right angles).
4. **Unified cut list:** All units aggregated into a single cut list, grouped by unit.

---

## 2. Goals

- Support multiple `CabinetUnit` objects within a single `Design`, each with its own dimensions, material settings, and cabinet tree.
- Render all units on the same SVG canvas, each offset by its `(x, y)` canvas position.
- Allow users to add/remove/rename units and select which unit is being edited.
- Keep per-unit globalSettings (height/width/depth/thickness can differ between units).
- Aggregate cut list across all units, tagging each entry with `unitId`/`unitLabel`.
- Migrate existing single-cabinet projects transparently (backward compatible, v0→v1).
- Fit-all zoom works across the full multi-unit bounding box.

---

## 3. Out of Scope (Phase B)

- Kitchen countertop mode (Phase C).
- Auto-snapping units together (user positions manually by setting x/y offsets).
- 3D view.
- Collision detection between overlapping units.
- Named joint types (corner unit, blind corner, etc.) — two plain units placed adjacently is sufficient.

---

## 4. Data Model

### 4.1 New Type: `CabinetUnit`

```ts
export interface CabinetUnit {
  id: string
  label: string               // user-visible name, e.g. "Base Left", "Upper"
  settings: GlobalSettings    // per-unit dimensions + materials
  root: CabinetNode
  x: number                   // canvas offset in mm (left edge from origin)
  y: number                   // canvas offset in mm (top edge from origin)
}
```

### 4.2 Updated `Design`

```ts
export interface Design {
  id: string
  name: string
  units: CabinetUnit[]        // ≥ 1 unit
  // activeUnitId removed — lives in UIState (non-persisted)
}
```

The existing `root` and `globalSettings` fields are removed. A **migration function** converts old designs on load.

### 4.3 Updated `UIState`

```ts
export interface UIState {
  selectedId: string | null   // existing: selected board/void for actions
  snapGrid: number            // existing
  activeUnitId: string | null // NEW — which unit the sidebar/toolbar edits; excluded from persist + temporal
}
```

`activeUnitId` is transient view state — not saved to localStorage, not part of undo history, not exported in workspace files. On project switch, default to `units[0].id`.

### 4.4 Updated `UnitLayoutResult` (enriched for canvas)

The layout engine enriches `UnitLayoutResult` with all display-only fields the canvas needs, so `CabinetCanvas` never touches domain objects:

```ts
export interface UnitLayoutResult {
  unitId: string
  label: string               // copy of CabinetUnit.label for canvas display
  isActive: boolean           // true when unitId === UIState.activeUnitId
  x: number                   // copy of CabinetUnit.x (mm from canvas origin)
  y: number                   // copy of CabinetUnit.y (mm from canvas origin)
  w: number                   // == CabinetUnit.settings.width
  h: number                   // == CabinetUnit.settings.height
  panels: LayoutPanel[]       // coordinates relative to unit origin (0,0)
  voids: LayoutVoid[]
  dividers: LayoutDivider[]
  overConstrainedIds: string[]
}

export interface SceneLayout {
  units: UnitLayoutResult[]
  boundingBox: { x: number; y: number; w: number; h: number }
}
```

Panel coordinates are **unit-local** (relative to unit origin 0,0). The canvas applies `translate(unit.x, unit.y)` via the `<g>` element. There is no `offsetX/offsetY` field — the canvas reads `result.x` / `result.y` which are a plain copy of `CabinetUnit.x/y`, populated at layout time.

### 4.5 Updated `CutListEntry`

```ts
export interface CutListEntry {
  label: string
  qty: number
  width: number
  height: number
  depth: number
  material: MaterialId
  unitId: string              // NEW — which CabinetUnit this came from
  unitLabel: string           // NEW — human-readable, e.g. "Base Left"
  notes?: string
}
```

Cut list is grouped by `unitId` in the UI. Fabricators can identify which panels belong to which cabinet.

### 4.6 Migration (v0 → v1)

The existing `persist` store has **no `version` field** — Zustand treats this as implicit version `0`. We introduce `version: 1` with a migrator that covers `0 → 1`:

```ts
// store.ts persist config
{
  name: 'buildbox-store',
  version: 1,
  migrate: (persisted: unknown, fromVersion: number) => {
    if (fromVersion === 0) {
      const old = persisted as {
        projects: Array<{ id: string; name: string; root: CabinetNode; globalSettings: GlobalSettings }>
        activeProjectId: string | null
      }
      return {
        projects: old.projects.map(d => ({
          id: d.id,
          name: d.name,
          units: [{
            id: nanoid(),
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

After migration, **clear the temporal (undo) history** — old snapshots hold the pre-migration `Design` shape and would crash if restored:

```ts
// after migration in store initialization
useStore.temporal.getState().clear()
```

---

## 5. Architecture

### 5.1 Engine: `computeSceneLayout`

New function in `layoutEngine.ts`:

```ts
export function computeSceneLayout(
  units: CabinetUnit[],
  activeUnitId: string | null
): SceneLayout
```

For each unit, calls `computeUnitLayout(unit.settings, unit.root)` (renamed from current `computeLayout`) and wraps result in `UnitLayoutResult` with `label`, `isActive`, `x`, `y`, `w`, `h` fields populated from the unit. Panel coordinates remain unit-local.

Bounding box is computed purely from `units[]` geometry: `min(unit.x)`, `max(unit.x + unit.settings.width)`, etc. — no layout pass needed for the bbox.

`computeCutList` is updated to accept `CabinetUnit[]`, iterating each unit and calling `computeUnitLayout(unit.settings, unit.root)` directly. Each entry is tagged with `unitId` and `unitLabel`.

### 5.2 Canvas: `CabinetCanvas`

`CabinetCanvas` receives only `sceneLayout: SceneLayout` — no `CabinetUnit[]` prop. The SVG `viewBox` is derived from `sceneLayout.boundingBox` (plus padding). Each unit is rendered in its own `<g transform="translate(result.x, result.y)">`:

```tsx
sceneLayout.units.map(result => (
  <g key={result.unitId} transform={`translate(${result.x}, ${result.y})`}>
    <CanvasLayers layout={result} />
    <DimensionLabels layout={result} zoom={zoom} />
    <DragHandles layout={result} />
    {result.isActive && <rect className="active-unit-frame" ... />}
  </g>
))
```

### 5.3 Sidebar: Unit Selector

The sidebar gains a **unit switcher** above the existing Actions section:

- Displays all units as a list with name.
- Click selects the active unit → sidebar shows that unit's settings.
- "Add unit" button appends a new default unit positioned at `x = max(unit.x + unit.settings.width) + gap`.
- "Remove unit" button (only shown when ≥ 2 units) removes the active unit; must **switch `activeUnitId` to `units[0].id` first** before splicing to avoid stale state.
- Each unit has an inline rename field.

### 5.4 Toolbar

The Toolbar shows settings for `activeUnit.settings` (not a shared `GlobalSettings`). `onSettingsChange` patch applies to the active unit via `updateUnitSettings(activeUnitId)`.

### 5.5 Store Actions

```ts
// New actions
addUnit: () => void                                  // appends at x = rightmost existing + gap; sets activeUnitId
removeUnit: (unitId: string) => void                 // switches activeUnitId first; fails fast if last unit
setActiveUnit: (unitId: string) => void
renameUnit: (unitId: string, label: string) => void
setUnitPosition: (unitId: string, x: number, y: number) => void
updateUnitSettings: (unitId: string, patch: Partial<GlobalSettings>) => void

// Existing actions — now route to units.find(u => u.id === activeUnitId).root
// Guard pattern: const unit = findActiveUnit(state); if (!unit) return;
addShelf, addDivider, deleteBoard, setNodeSize, setNodeMaterial, ...
```

All tree-mutation actions guard against stale `activeUnitId`:

```ts
const findActiveUnit = (state: State) =>
  state.projects
    .find(p => p.id === state.activeProjectId)
    ?.units.find(u => u.id === state.uiState.activeUnitId) ?? null
```

---

## 6. Component Interfaces

### `CabinetCanvas` props (updated — no CabinetUnit[] dependency)
```ts
interface Props {
  sceneLayout: SceneLayout
  svgRef: RefObject<SVGSVGElement | null>
  onUnlockNode: (nodeId: string) => void
  onUnitClick: (unitId: string) => void
}
```

### `UnitSelector` props (new)
```ts
interface Props {
  units: CabinetUnit[]
  activeUnitId: string | null
  onSelect: (unitId: string) => void
  onAdd: () => void
  onRemove: (unitId: string) => void
  onRename: (unitId: string, label: string) => void
}
```

---

## 7. Data Flow

```
App
 ├─ useStore → projects, activeProjectId, uiState.activeUnitId
 ├─ activeUnit = activeProject.units.find(u => u.id === uiState.activeUnitId)
 ├─ sceneLayout = useMemo(() => computeSceneLayout(activeProject.units, uiState.activeUnitId), [...])
 ├─ Toolbar(settings=activeUnit.settings, onSettingsChange=updateUnitSettings(activeUnitId))
 ├─ Sidebar
 │   └─ UnitSelector(units, activeUnitId, onAdd, onRemove, onSelect, onRename)
 │   └─ Actions (operates on activeUnit.root via addShelf/addDivider/...)
 │   └─ CutListPanel(cutList grouped by unitLabel)
 └─ CabinetCanvas(sceneLayout, onUnitClick=setActiveUnit)
       └─ SVG viewBox = sceneLayout.boundingBox + padding
       └─ per result: <g transform="translate(result.x, result.y)">
            CanvasLayers / DimensionLabels / DragHandles
            active unit gets highlight frame
```

---

## 8. New & Changed Files

| File | Action | Notes |
|------|--------|-------|
| `src/types/index.ts` | **Modify** | Add `CabinetUnit`, enriched `UnitLayoutResult`, `SceneLayout`; update `Design` (remove `root`/`globalSettings`); add `unitId`/`unitLabel` to `CutListEntry`; add `activeUnitId` to `UIState` |
| `src/engine/layoutEngine.ts` | **Modify** | `computeSceneLayout(units, activeUnitId)`; rename `computeLayout` → `computeUnitLayout(settings, root)` |
| `src/engine/layoutEngine.test.ts` | **Modify** | Multi-unit layout tests; bounding box test |
| `src/engine/cutList.ts` | **Modify** | Accept `CabinetUnit[]`; tag entries with `unitId`/`unitLabel`; call `computeUnitLayout` per unit |
| `src/engine/cutList.test.ts` | **Modify** | Multi-unit cut list test with unit provenance assertions |
| `src/store/store.ts` | **Modify** | New actions; `persist` `version: 1` + `migrate` covering v0→v1; clear temporal history after migration; `activeUnitId` in `UIState` |
| `src/components/CabinetCanvas/CabinetCanvas.tsx` | **Modify** | SceneLayout-only input; per-unit `<g translate>` groups; `onUnitClick` |
| `src/components/Sidebar/UnitSelector.tsx` | **Create** | Unit list + add/remove/rename |
| `src/components/Sidebar/UnitSelector.test.tsx` | **Create** | Unit selector tests |
| `src/components/Sidebar/Sidebar.tsx` | **Modify** | Add UnitSelector above Actions; cut list grouped by unit |
| `src/App.tsx` | **Modify** | Derive `activeUnit`; pass `sceneLayout` to canvas; `updateUnitSettings` |
| `src/integration/cabinetFlow.test.tsx` | **Modify** | E2E: add unit, add shelf to second unit, verify cut list has entries from both units |

---

## 9. Tests & Success Criteria

### Engine
- `computeSceneLayout([unitA, unitB], activeId)` boundingBox encompasses both units
- `UnitLayoutResult` for unitA has `isActive=true` when `activeId === unitA.id`
- `computeCutList([unitA, unitB])` returns entries tagged with correct `unitId`/`unitLabel`
- Entries from unit A and unit B are distinguishable even when they have identical dimensions

### Store
- `removeUnit(activeId)` switches `activeUnitId` to remaining unit before splicing
- `addUnit()` positions new unit at `x = max existing right edge + gap`; sets `activeUnitId` to new unit
- Tree mutations with stale `activeUnitId` are no-ops (no crash)

### `UnitSelector` component
- Renders all unit labels
- Clicking a unit fires `onSelect(unitId)`
- "Add unit" button fires `onAdd()`
- "Remove unit" hidden when only 1 unit; shown when ≥ 2
- Rename field fires `onRename(unitId, newLabel)` on blur

### Integration (E2E)
```
1. render(<App />)
2. Expect 1 unit "Unit 1" in sidebar
3. Click "Add unit" → expect "Unit 2" in sidebar
4. Click "Unit 2" → toolbar shows Unit 2's settings (different instance)
5. Add shelf to Unit 2
6. Cut list shows entries grouped under "Unit 1" AND "Unit 2" headers
7. Canvas renders 2 cabinet outlines side by side
```

---

## 10. Non-Goals / Explicitly Excluded

- Drag-to-reposition units on canvas (user sets x/y via sidebar inputs for now)
- Visual gap/alignment guides between units
- Unit-level undo (undo operates at project level, history cleared on migration)
