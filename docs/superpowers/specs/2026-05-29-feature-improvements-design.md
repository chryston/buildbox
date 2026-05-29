# Feature Improvements Design Spec

**Date:** 2026-05-29  
**Branch:** `feature-improvements` (built on `polish-features`)  
**Scope:** 6 features to improve the cabinet configurator's locking system, material UX, text labels, drag snapping, and dimension font consistency.

---

## 1. Fix Shelf Width Editability + Locking System Redesign

### Problem

`DimensionLabels` computes `canEditH` and `canEditW` by checking only the immediate parent's `splitAxis` (`parentSplitAxis`). A void whose width is controlled by a vertical-split ancestor two or more levels up always shows `canEditW = false` — making shelf widths uneditable.

### Root Fix

Move editability calculation from `DimensionLabels` into `layoutEngine.ts`, where the full tree is available. The engine sets two new fields on `LayoutVoid`:

- `canEditH: boolean` — true if any ancestor uses `splitAxis: 'horizontal'`
- `canEditW: boolean` — true if any ancestor uses `splitAxis: 'vertical'`

The root void (no ancestors) has both `false`.

### Locking Semantics (Hard Lock — User choice A)

A locked node (`CabinetNode.locked === true`) has all four sides frozen:

- Dimension labels show lock icon and `cursor: not-allowed` (existing T2 visuals).
- Editing is blocked for locked voids.
- When any sibling is resized, locked siblings are skipped; the full delta is absorbed by unlocked siblings only.
- If **all** siblings are locked, the edit is rejected and no change occurs.

### Data Flow for Editing a Void Dimension

```
User clicks H label → DimensionEditor opens → commits newMm
  → store.setVoidDimension(voidId, 'h', newMm)
    → treeMutations.setVoidDimension(root, voidId, 'h', newMm):
      1. Walk up from voidId to find nearest ancestor P with splitAxis === 'horizontal'
      2. Find P's direct child C that is an ancestor of (or equals) voidId
         (vertical-only splits between V and P do not change height, so C.h == V.h)
      3. Call setNodeSize(C.id, newMm) → locks C with fixedSize = newMm
      4. P's other direct child D absorbs the delta (if D is not locked)
         (if D is locked → no-op, edit rejected)
```

For width editing: same algorithm but walk to nearest ancestor with `splitAxis === 'vertical'`.

`setVoidDimension` replaces the existing `setNodeSize` call wired from `DimensionLabels` via `onCommitSize`. The store exposes `setVoidDimension(voidId, axis, mm)` instead of the raw `setNodeSize`.

---

## 2. Material: Per Cabinet Unit (Global Colour)

### Current State

`CabinetNode.material` allows per-node colour. `GlobalSettings.defaultMaterial` is the fallback.

### New Behaviour

Remove per-node material override. The single material for all pieces in a cabinet comes from `GlobalSettings.defaultMaterial` (renamed to `material` for clarity).

Changes:
- Remove `material?: CabinetMaterialId` from `CabinetNode`.
- Rename `GlobalSettings.defaultMaterial` → `GlobalSettings.material`.
- Remove `setMaterial(nodeId, …)` store action; replace with `setCabinetMaterial(unitId, materialId)` that sets `settings.material`.
- Layout engine passes `settings.material` uniformly to all panels and voids (no per-node override).
- Sidebar: material swatch section moves to the top of global settings; no per-node material picker.
- Cut list: all pieces share the cabinet's material.

---

## 3. Text Labels for Cabinet Spaces (Centre Overlay)

### Behaviour

Each leaf void can optionally carry a user-defined text label (e.g. "Pots", "Books").

- `label?: string` added to `CabinetNode`.
- `label?: string` added to `LayoutVoid` (forwarded from the node by layout engine).
- Canvas renders a small `<text>` element centred horizontally and vertically inside the void, below any dimension labels.
- Clicking the label text (or the label area when label is empty, shown as a faint "+") opens an inline input (`<foreignObject>` containing `<input>`).
- Editing commits on `Enter` or blur.
- Empty string removes the label.
- Store action: `setNodeLabel(nodeId: string, label: string)`.
- Labels are included in export/import (they live on `CabinetNode`).

### Visual Spec

- Font: `10 / zoom` px, `fill: #6b7280` (text-muted colour).
- Positioned at `(void.x + void.w/2, void.y + void.h/2)` with `textAnchor="middle"` and `dominantBaseline="middle"`.
- Truncated at 20 characters to prevent overflow.

---

## 4. Cross-Divider Magnetic Snap

### Behaviour

When dragging a **horizontal** handle, collect the Y-positions of all other horizontal dividers in the same cabinet unit. If the current drag position is within a `magneticSnapThreshold` (20mm) of any collected Y-position, snap to it.

This allows shelves in adjacent columns to align visually.

### Implementation

In `DragHandles.tsx`:

1. Accept `allDividers: LayoutDivider[]` prop (the full list including other units/columns).
2. On drag move, call `snapToAlignment(candidateY, alignmentYs, threshold)`:
   ```ts
   function snapToAlignment(y: number, candidates: number[], threshold: number): number {
     const nearest = candidates.reduce((best, c) =>
       Math.abs(c - y) < Math.abs(best - y) ? c : best, Infinity)
     return Math.abs(nearest - y) <= threshold ? nearest : y
   }
   ```
3. Apply `snapToAlignment` **after** the regular `snap()` (grid snap), so grid snap takes priority.
4. `alignmentYs` = all other horizontal divider `y + h/2` positions within the same cabinet unit.

No visual guide line is shown (magnetic snapping only — user choice B was not a guide, B was magnetic; guide = A).

---

## 5. Even Spacing Button

### Behaviour

When a leaf void is selected inside a column (parent chain contains horizontal splits), show an **"Even Space"** button in the sidebar.

Clicking it distributes all sibling leaf voids in the same horizontal-split chain evenly.

### Algorithm — `distributeEvenly(rootNodeId: string)`

Traverse the subtree rooted at `rootNodeId`. Collect only the horizontal-split chain (ignore vertical splits below). For a chain of `n` leaf heights, set each `splitRatio` so all leaves have equal height.

For a binary tree of depth `d` producing `n = 2^d` leaves:
- At each level, `splitRatio = 0.5` gives equal sizes (all leaves equal if symmetric).

For an asymmetric chain (nodes added one at a time):
- Collect all leaf heights in the column.
- Compute `evenHeight = totalColumnHeight / leafCount`.
- Call `setNodeSize(leafId, evenHeight)` for each leaf except the last (last absorbs rounding).

Store action: `distributeEvenly(parentNodeId: string)`.

Sidebar shows the button only when the selected void has at least one sibling in the same column (i.e., its parent is a horizontal-split node).

---

## 6. Dimension Font Size Fix

`fontSize = 14 / zoom` → `fontSize = 12 / zoom` in `DimensionLabels.tsx`.

This ensures labels remain readable at all zoom levels without being oversized.

---

## Testing Strategy

### Unit Tests

| Test | Location |
|------|----------|
| `canEditH/canEditW` correct for root, shallow, deep voids | `layoutEngine.test.ts` |
| Hard lock: delta absorbed by unlocked sibling only | `treeMutations.test.ts` |
| Hard lock: all siblings locked → no-op | `treeMutations.test.ts` |
| `setCabinetMaterial` sets `settings.material`, not node material | `store.test.ts` (or mutations test) |
| `setNodeLabel` persists on node, forwarded in layout | `treeMutations.test.ts` + `layoutEngine.test.ts` |
| `snapToAlignment` snaps within threshold, ignores outside | `DragHandles.test.ts` (pure fn) |
| `distributeEvenly` sets equal heights on a 3-leaf chain | `treeMutations.test.ts` |

### Component Tests

| Test | Location |
|------|----------|
| Width label is clickable when `canEditW = true` | `DimensionLabels.test.tsx` |
| Width label shows lock icon when `canEditW = false` | `DimensionLabels.test.tsx` |
| Label text renders; click opens inline editor | `DimensionLabels.test.tsx` (or new LabelOverlay test) |
| "Even Space" button visible when void has sibling in column | `Sidebar.test.tsx` |

### End-to-End Integration Test

`cabinetFlow.test.tsx` — new `describe('Feature improvements E2E')`:

1. Add two shelves to create three voids.
2. Add a divider to a void → confirm the inner void's width dimension label is now editable (clickable).
3. Lock a void → confirm its H label shows lock icon and is not clickable.
4. Resize adjacent void → confirm locked void does not change size.
5. Change cabinet material → confirm all voids render with new material.
6. Add a text label to a void → confirm label renders on canvas.
7. Click "Even Space" → confirm all voids in column have equal height.

---

## File Change Summary

| File | Change |
|------|--------|
| `src/types/index.ts` | `LayoutVoid` +`canEditH/canEditW/label`; `CabinetNode` -`material` +`label`; `GlobalSettings` `defaultMaterial`→`material` |
| `src/engine/layoutEngine.ts` | Compute `canEditH/canEditW` during tree walk; forward `label`; use `settings.material` only |
| `src/engine/treeMutations.ts` | Add `setVoidDimension`, `setNodeLabel`, `distributeEvenly`; remove `setMaterial` per-node |
| `src/store/store.ts` | Replace `setMaterial` with `setCabinetMaterial`; add `setNodeLabel`, `distributeEvenly` |
| `src/components/CabinetCanvas/DimensionLabels.tsx` | Use `v.canEditH/v.canEditW`; add label overlay; font `12/zoom` |
| `src/components/CabinetCanvas/DragHandles.tsx` | Add `snapToAlignment`; accept `allDividers` prop |
| `src/components/CabinetCanvas/CabinetCanvas.tsx` | Pass `allDividers` to DragHandles |
| `src/components/Sidebar/Sidebar.tsx` | Move material swatch to top; add "Even Space" button; remove per-node material picker |
| `src/integration/cabinetFlow.test.tsx` | Add `describe('Feature improvements E2E')` |
