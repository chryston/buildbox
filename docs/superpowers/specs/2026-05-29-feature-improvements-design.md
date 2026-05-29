# Feature Improvements Design Spec

**Date:** 2026-05-29  
**Branch:** `feature-improvements` (built on `polish-features`)  
**Scope:** 6 features to improve the cabinet configurator's locking system, material UX, text labels, drag snapping, and dimension font consistency.

---

## 1. Fix Shelf Width Editability + Locking System Redesign

### Problem

`DimensionLabels` computes `canEditH` and `canEditW` by checking only the immediate parent's `splitAxis` (`parentSplitAxis`). A void whose width is controlled by a vertical-split ancestor two or more levels up always shows `canEditW = false` — making shelf widths uneditable.

A separate bug: `setLocked` in `treeMutations.ts` sets only `locked: true` without `fixedSize`. The layout engine (`distributeTwo`) only treats a node as locked when **both** `locked === true AND fixedSize != null`, so the existing lock toggle has no effect on sizing.

### Root Fix — Emit control node IDs from layout engine

Instead of walking ancestors in the mutation layer, extend `LayoutVoid` with:

```ts
heightControlNodeId?: string  // direct child of nearest h-split ancestor containing this void
widthControlNodeId?: string   // direct child of nearest v-split ancestor containing this void
```

The layout engine computes these during `layoutNode` traversal, where full ancestor context is available. They are `undefined` for the root void (whose dimensions come from GlobalSettings, not editable via canvas labels — intentional).

`canEditH = !!v.heightControlNodeId`  
`canEditW = !!v.widthControlNodeId`

### Locking Semantics — `pinNode` / `unpinNode`

Replace the ambiguous `setLocked` + `setNodeSize` pair with two clear operations:

- `pinNode(root, id, sizeMm)` — sets `fixedSize = sizeMm` AND `locked = true`. Both fields set together so `distributeTwo` recognises the lock.
- `unpinNode(root, id)` — clears both `fixedSize` and `locked`.

The Sidebar "lock" toggle calls `pinNode(id, currentRenderedSize)` or `unpinNode(id)`.

**Hard lock behaviour:**
- Pinned node → dimension labels show lock icon and `cursor: not-allowed` (existing T2 visuals).
- Editing is blocked for pinned voids.
- When a sibling is resized, pinned siblings are skipped; delta is absorbed by unpinned siblings only.
- If all siblings are pinned, the edit is a no-op.

### Editing a Void Dimension (D1: editing ≠ pinning)

Editing a dimension via the canvas label sets `fixedSize` but does **NOT** set `locked`. This means adjacent voids can still resize the edited void later. Only the explicit "pin" action (lock icon click) sets `locked = true`.

```
User clicks H label → DimensionEditor opens → commits newMm
  → store.setVoidDimension(voidId, 'h', newMm)
    → read heightControlNodeId from current layout (store has last SceneLayout)
    → if undefined → no-op (root void)
    → treeMutations.setNodeSize(root, heightControlNodeId, newMm)
       (sets fixedSize = newMm, locked stays unchanged)
    → distributeTwo recalculates: sibling absorbs delta (unless sibling is pinned)
```

For width: same but using `widthControlNodeId`.

`CabinetCanvas.tsx` must wire `onCommitSize` through `store.setVoidDimension(voidId, axis, mm)` — the current call site passes axis as `_axis` and ignores it, which this change fixes.

---

## 2. Material: Per Cabinet Unit (Global Colour)

### Current State

`CabinetNode.material` allows per-node colour override. `GlobalSettings.defaultMaterial` is the cabinet-level fallback.

### New Behaviour

Remove per-node material override. The single material for all panels in a cabinet comes from `GlobalSettings.material` (renamed from `defaultMaterial`).

Changes:
- Remove `material?: CabinetMaterialId` from `CabinetNode`.
- Rename `GlobalSettings.defaultMaterial` → `GlobalSettings.material` in the type and all usages (store.ts lines 72, 173; layoutEngine.ts ~6 sites; all test fixtures).
- Remove `setMaterial(nodeId, …)` store action; add `setCabinetMaterial(materialId)` (operates on active unit via `mutateActiveUnit`, consistent with all other store actions).
- Layout engine uses `settings.material` uniformly — no per-node override path.
- Sidebar: material swatch section at top of global settings; per-node material picker removed.

**Note:** `Divider.materialId` (per-divider colour set via the `Divider` type) is out of scope — left unchanged.

### Persistence Migration

Bump Zustand persist `version: 1 → 2`. Add migration branch:

```ts
// version 1 → 2: rename defaultMaterial → material
if (fromVersion === 1) {
  for (const project of state.projects) {
    for (const unit of project.units) {
      unit.settings.material = (unit.settings as any).defaultMaterial ?? 'oak'
      delete (unit.settings as any).defaultMaterial
    }
  }
}
```

Additionally, add a runtime guard in layout engine: `gs.material ?? (gs as any).defaultMaterial ?? 'oak'` to handle any designs that bypass migration.

---

## 3. Text Labels for Cabinet Spaces (Centre Overlay)

### Behaviour

Each leaf void can optionally carry a user-defined text label (e.g. "Pots", "Books").

- `spaceLabel?: string` added to `CabinetNode` (named `spaceLabel` to avoid collision with `CabinetUnit.label`).
- `spaceLabel?: string` added to `LayoutVoid` (forwarded from the node by layout engine).
- Canvas renders a small `<text>` centred in the void; below any dimension labels.
- Clicking the label text (or a faint `+` placeholder when empty) triggers an edit popup — implemented as a **DOM overlay** (same `getBoundingClientRect` + absolute-position pattern as `DimensionEditor`, not `<foreignObject>` which breaks under SVG zoom/pan transforms).
- Editing commits on `Enter` or blur; empty string removes the label.
- Store action: `setNodeLabel(nodeId: string, label: string)`.
- Labels persist via export/import (live on `CabinetNode.spaceLabel`).
- When a node is split (shelf or divider added), `spaceLabel` is cleared on the parent to avoid orphaned labels on internal nodes.

### Visual Spec

- Font: `Math.max(10 / zoom, 6)` px, `fill: #6b7280`.
- Positioned at `(void.x + void.w/2, void.y + void.h/2)` with `textAnchor="middle"` and `dominantBaseline="middle"`.
- Display: JS slice to 20 chars + `…` suffix if longer.

---

## 4. Cross-Divider Magnetic Snap

### Behaviour

When dragging a **horizontal** handle, collect Y-positions of all **other** horizontal dividers in the same cabinet unit (excluding the divider currently being dragged). If the candidate drag position is within `magneticSnapThreshold` (20mm) of any collected position, snap to it.

This allows shelves in adjacent columns to align visually.

### Implementation

In `DragHandles.tsx`:

1. Accept `allDividers: LayoutDivider[]` prop (full list for the active unit).
2. On `pointerDown`, compute and cache `alignmentYs`: all horizontal divider midpoints in the unit **excluding** `dragging.current.dividerId`.
3. On `pointerMove`, apply snapping in two stages:
   - Stage 1: regular grid snap `snap(mm)` — coarse alignment.
   - Stage 2: `snapToAlignment(snapped, alignmentYs, 20)` — magnetic override if within threshold.

```ts
export function snapToAlignment(y: number, candidates: number[], threshold: number): number {
  if (candidates.length === 0) return y
  const nearest = candidates.reduce((best, c) =>
    Math.abs(c - y) < Math.abs(best - y) ? c : best)
  return Math.abs(nearest - y) <= threshold ? nearest : y
}
```

`snapToAlignment` is exported as a pure function for unit testing. The `alignmentYs` array is computed once at `pointerDown` for performance (not re-evaluated on every move event).

---

## 5. Even Spacing Button

### Behaviour

When a leaf void is selected and has a horizontal-split ancestor (meaning it is part of a column), show an **"Even Space"** button in the sidebar.

Clicking it distributes all leaf voids in the nearest horizontal-split column evenly by resetting `splitRatio` values — no locking side-effects.

### Algorithm — `distributeEvenly(columnRootId: string, root: CabinetNode)`

The column root is the nearest horizontal-split ancestor of the selected void.

1. Collect all leaf IDs in `columnRootId`'s subtree that are reachable through horizontal splits only (stop recursion at vertical splits).
2. Let `n` = leaf count. Set `splitRatio` at each level to give equal leaf size:
   - Walk the horizontal-split chain. At each node with children `[A, B]` where A is a leaf: `splitRatio = 1/remainingLeaves`.
   - Where A is a sub-chain: `splitRatio = A_leafCount / n`.
3. Clear `fixedSize` and `locked` on all nodes in the traversed chain (so they remain elastic).

This correctly handles divider thickness implicitly — `splitRatio` operates on the already-thickness-reduced available space inside `distributeTwo`.

Store action: `distributeEvenly(columnRootId: string)`.

**Sidebar trigger:** The "Even Space" button appears when the selected void's nearest horizontal-split ancestor exists (i.e., `heightControlNodeId` is set on the void's layout). The `columnRootId` is the parent of `heightControlNodeId`.

---

## 6. Dimension Font Size Fix

`fontSize = 14 / zoom` → `fontSize = Math.max(12 / zoom, 8)` in `DimensionLabels.tsx`.

The clamp prevents labels from becoming unreadably small at high zoom.

---

## Testing Strategy

### Unit Tests

| Test | Location |
|------|----------|
| `heightControlNodeId`/`widthControlNodeId` correct for root, shallow, deep voids | `layoutEngine.test.ts` |
| `pinNode` sets both `fixedSize` and `locked`; `unpinNode` clears both | `treeMutations.test.ts` |
| `setVoidDimension` (height): delta absorbed by unpinned sibling; pinned sibling unchanged | `treeMutations.test.ts` + store integration |
| All siblings pinned → `setVoidDimension` is no-op | `treeMutations.test.ts` |
| `setCabinetMaterial` sets `settings.material` on active unit | `treeMutations.test.ts` |
| `setNodeLabel` sets `spaceLabel` on node; forwarded in `LayoutVoid` | `treeMutations.test.ts` + `layoutEngine.test.ts` |
| `snapToAlignment` snaps within threshold; no-op outside; excludes empty list | `DragHandles.test.ts` (pure fn export) |
| `distributeEvenly` on a 3-leaf asymmetric chain → equal `splitRatio` per level | `treeMutations.test.ts` |

### Component Tests

| Test | Location |
|------|----------|
| Width label clickable when `widthControlNodeId` set | `DimensionLabels.test.tsx` |
| Width label shows lock icon when `widthControlNodeId` absent | `DimensionLabels.test.tsx` |
| `spaceLabel` text renders; click opens label editor overlay | `DimensionLabels.test.tsx` |
| "Even Space" button visible when void is in a column | `Sidebar.test.tsx` |

### End-to-End Integration Test

`cabinetFlow.test.tsx` — new `describe('Feature improvements E2E')`:

1. Add two shelves to create three voids; confirm all three have `heightControlNodeId` set.
2. Add a divider to a void → confirm the inner void now has `widthControlNodeId` set (width label editable).
3. Pin (lock) a void via store action → confirm its H label has `cursor: not-allowed`.
4. Resize the adjacent void via `store.setVoidDimension` → confirm locked void size unchanged.
5. Change cabinet material via `store.setCabinetMaterial` → confirm all layout voids reflect new material.
6. Set a `spaceLabel` on a void via `store.setNodeLabel` → confirm label text appears in canvas.
7. Call `store.distributeEvenly` → confirm all voids in column have equal height from layout.

---

## File Change Summary

| File | Change |
|------|--------|
| `src/types/index.ts` | `LayoutVoid` +`heightControlNodeId/widthControlNodeId/spaceLabel`; `CabinetNode` -`material` +`spaceLabel`; `GlobalSettings` `defaultMaterial`→`material` |
| `src/engine/layoutEngine.ts` | Compute `heightControlNodeId/widthControlNodeId` during tree walk; forward `spaceLabel`; use `settings.material` only with runtime fallback; update `buildOuterPanels` |
| `src/engine/treeMutations.ts` | Add `pinNode`, `unpinNode`, `setNodeLabel`, `distributeEvenly`; remove `setMaterial`; clear `spaceLabel` when splitting |
| `src/store/store.ts` | Replace `setMaterial` with `setCabinetMaterial`; add `setNodeLabel`, `distributeEvenly`, `setVoidDimension`; bump persist to `version: 2` with migration |
| `src/components/CabinetCanvas/CabinetCanvas.tsx` | Wire `onCommitSize` → `store.setVoidDimension(voidId, axis, mm)` (was dropping axis); pass `allDividers` to DragHandles |
| `src/components/CabinetCanvas/DimensionLabels.tsx` | Use `v.heightControlNodeId/widthControlNodeId`; add `spaceLabel` overlay; font `Math.max(12/zoom, 8)` |
| `src/components/CabinetCanvas/DragHandles.tsx` | Export `snapToAlignment`; accept `allDividers`; cache `alignmentYs` at `pointerDown` |
| `src/components/Sidebar/Sidebar.tsx` | Move material swatch to top; add "Even Space" button; replace `setMaterial` with `setCabinetMaterial`; Sidebar lock toggle uses `pinNode`/`unpinNode` |
| `src/integration/cabinetFlow.test.tsx` | Add `describe('Feature improvements E2E')` |
| Test fixtures (11 files) | Rename `defaultMaterial` → `material` in all fixture `GlobalSettings` |
