# Feature Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix shelf-width editability, redesign the locking system, move material to cabinet-level, add space labels, magnetic cross-divider snap, even-spacing button, and fix dimension font size.

**Architecture:** The layout engine gains `heightControlNodeId`/`widthControlNodeId`/`columnRootId` on `LayoutVoid` to eliminate tree-walking from the mutation layer. `columnRootId` is the topmost h-split ancestor in a void's vertical scope (used for "Even Space"). `pinNode`/`unpinNode` replace the broken `setLocked`+`setNodeSize` pair; `setNodeSize` no longer sets `locked`. `distributeEvenly` computes `splitRatio` values using a clean recursive formula and sets ratios at each h-split level without locking side-effects. `isPinned` is computed inline in `DimensionLabels` (not stored on `LayoutVoid`).

**Tech Stack:** React 19, TypeScript, Zustand (immer + zundo), Vitest + Testing Library, Tailwind CSS.

---

## File Map

| File | What changes |
|------|-------------|
| `src/types/index.ts` | `GlobalSettings.defaultMaterial→material`; `LayoutVoid` +5 fields; `CabinetNode` -`material` +`spaceLabel` |
| `src/engine/layoutEngine.ts` | Compute control node IDs + `columnRootId` + `spaceLabel`; `defaultMaterial→material` with runtime fallback; `buildOuterPanels` signature update |
| `src/engine/treeMutations.ts` | `setNodeSize` no longer sets `locked`; add `pinNode`, `unpinNode`, `setNodeLabel`, `distributeEvenly` (splitRatio-based); remove `setMaterial`, `setLocked`; clear `spaceLabel` on split |
| `src/engine/cutList.ts` | `defaultMaterial→material` |
| `src/store/store.ts` | `defaultMaterial→material` everywhere; persist `version:2` migration; add `pinNode`, `unpinNode`, `setNodeLabel`, `distributeEvenly`, `setCabinetMaterial`; remove `setMaterial`, `setLocked` |
| `src/components/CabinetCanvas/DimensionLabels.tsx` | Use `v.heightControlNodeId`/`widthControlNodeId` for editability; add `spaceLabel` overlay; font `Math.max(12/zoom,8)` |
| `src/components/CabinetCanvas/DragHandles.tsx` | Export `snapToAlignment`; cache `alignmentYs` at `pointerDown` in parent-relative coords |
| `src/components/CabinetCanvas/CabinetCanvas.tsx` | `handleCommitSize` looks up control node from `unitLayout` voids; wire `onCommitLabel` |
| `src/components/Sidebar/Sidebar.tsx` | Material swatch at top (global); `selectedVoid` prop; "Even Space" button; `onSetCabinetMaterial`, `onDistributeEvenly` |
| `src/App.tsx` | Replace `setLocked`/`setMaterial`; add `pinNode`, `setCabinetMaterial`, `distributeEvenly`; derive `selectedVoid` + `evenH`; update `onToggleLock` |
| `src/integration/cabinetFlow.test.tsx` | Add `describe('Feature improvements E2E')` |
| Test fixtures (17 files) | `defaultMaterial→material` |

---

## Task 1: Update Type Definitions

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Update `GlobalSettings`, `CabinetNode`, and `LayoutVoid`**

```ts
// In src/types/index.ts — replace the relevant interfaces:

export interface GlobalSettings {
  unit: Unit
  height: number
  width: number
  depth: number
  thickness: number
  backThickness: number
  toeKick: ToeKick | null
  material: CabinetMaterialId  // was defaultMaterial
}

export interface CabinetNode {
  id: string
  splitAxis?: SplitAxis
  splitRatio?: number
  children?: [CabinetNode, CabinetNode]
  fixedSize?: number
  locked?: boolean
  // material removed — now a cabinet-level GlobalSettings field
  spaceLabel?: string            // NEW: user-defined label for this void space
  elementType?: ElementType
  drawerConfig?: DrawerConfig
  dividers?: Divider[]
  accessories?: Accessory[]
}

export interface LayoutVoid {
  nodeId: string
  x: number; y: number; w: number; h: number
  parentSplitAxis?: SplitAxis
  elementType: ElementType
  drawerConfig?: DrawerConfig
  material: CabinetMaterialId
  accessories: Accessory[]
  // New fields for editability and features:
  heightControlNodeId?: string   // direct child of nearest h-split ancestor (used by handleCommitSize)
  widthControlNodeId?: string    // direct child of nearest v-split ancestor
  columnRootId?: string          // topmost h-split ancestor in current v-scope (used by distributeEvenly)
  spaceLabel?: string            // forwarded from CabinetNode.spaceLabel
  // Note: isPinned is derived inline as `node.locked && node.fixedSize != null` — not stored here
}
```

- [ ] **Step 2: Verify TypeScript catches all usages** (do not fix yet — later tasks handle each file)

```bash
cd /path/to/worktree && npx tsc --noEmit 2>&1 | grep "defaultMaterial\|material\|spaceLabel" | head -30
```

Expected: many errors referencing `defaultMaterial` — those get fixed in subsequent tasks.

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(types): add control node IDs, spaceLabel to LayoutVoid; material rename; remove CabinetNode.material; remove isPinned (computed inline)"
```

---

## Task 2: Update treeMutations

**Files:**
- Modify: `src/engine/treeMutations.ts`
- Modify: `src/engine/treeMutations.test.ts`

- [ ] **Step 1: Write failing tests**

In `src/engine/treeMutations.test.ts`, add after the existing tests:

```ts
describe('pinNode / unpinNode', () => {
  it('pinNode sets both fixedSize and locked', () => {
    const root: CabinetNode = { id: 'root', splitAxis: 'horizontal', splitRatio: 0.5,
      children: [{ id: 'a', elementType: 'void' }, { id: 'b', elementType: 'void' }] }
    const next = pinNode(root, 'a', 300)
    expect(findNode(next, 'a')).toMatchObject({ fixedSize: 300, locked: true })
  })

  it('unpinNode clears both fixedSize and locked', () => {
    const root: CabinetNode = { id: 'root', splitAxis: 'horizontal', splitRatio: 0.5,
      children: [{ id: 'a', elementType: 'void', fixedSize: 300, locked: true }, { id: 'b', elementType: 'void' }] }
    const next = unpinNode(root, 'a')
    const a = findNode(next, 'a')
    expect(a?.locked).toBeFalsy()
    expect(a?.fixedSize).toBeUndefined()
  })
})

describe('setNodeSize (no lock side-effect)', () => {
  it('sets fixedSize but does NOT set locked', () => {
    const root: CabinetNode = { id: 'root', splitAxis: 'horizontal', splitRatio: 0.5,
      children: [{ id: 'a', elementType: 'void' }, { id: 'b', elementType: 'void' }] }
    const next = setNodeSize(root, 'a', 200)
    const a = findNode(next, 'a')
    expect(a?.fixedSize).toBe(200)
    expect(a?.locked).toBeFalsy()
  })
})

describe('setNodeLabel', () => {
  it('sets spaceLabel on the target node', () => {
    const root: CabinetNode = { id: 'root', splitAxis: 'horizontal', splitRatio: 0.5,
      children: [{ id: 'a', elementType: 'void' }, { id: 'b', elementType: 'void' }] }
    const next = setNodeLabel(root, 'a', 'Pots')
    expect(findNode(next, 'a')?.spaceLabel).toBe('Pots')
  })

  it('clears label when empty string passed', () => {
    const root: CabinetNode = { id: 'root', splitAxis: 'horizontal', splitRatio: 0.5,
      children: [{ id: 'a', elementType: 'void', spaceLabel: 'Pots' }, { id: 'b', elementType: 'void' }] }
    const next = setNodeLabel(root, 'a', '')
    expect(findNode(next, 'a')?.spaceLabel).toBeUndefined()
  })
})

describe('splitNode clears spaceLabel and fixedSize/locked', () => {
  it('clears spaceLabel when a labeled void is split', () => {
    const root: CabinetNode = { id: 'root', elementType: 'void', spaceLabel: 'Books' }
    const next = addShelf(root, 'root')
    expect(next.spaceLabel).toBeUndefined()
  })

  it('clears fixedSize and locked when a pinned void is split (prevents constraint leakage)', () => {
    const root: CabinetNode = { id: 'root', elementType: 'void', fixedSize: 300, locked: true }
    const next = addShelf(root, 'root')
    expect(next.fixedSize).toBeUndefined()
    expect(next.locked).toBe(false)
  })
})

describe('distributeEvenly', () => {
  // tree: root(h) → [a(leaf,fixedSize=400,locked), b(h) → [c(leaf), d(leaf,fixedSize=100)]]
  // a, c, d are the h-split chain leaves. thickness=18.
  // e = mean([400, currentC, 100])... but we pass evenH directly.
  it('sets equal splitRatios so all column leaves get the same rendered height', () => {
    const root: CabinetNode = {
      id: 'root', splitAxis: 'horizontal',
      children: [
        { id: 'a', elementType: 'void', fixedSize: 400, locked: true },
        { id: 'b', splitAxis: 'horizontal',
          children: [
            { id: 'c', elementType: 'void' },
            { id: 'd', elementType: 'void', fixedSize: 100 },
          ]
        }
      ]
    }
    const thickness = 18
    const evenH = 300
    const next = distributeEvenly(root, 'root', evenH, thickness)
    // a: fixedSize cleared, locked cleared; root.splitRatio set for correct ratio
    expect(findNode(next, 'a')).toMatchObject({ fixedSize: undefined, locked: false })
    expect(findNode(next, 'd')).toMatchObject({ fixedSize: undefined, locked: false })
    // subtreeH formula: subtreeH(a)=300, subtreeH(b)=300+18+300=618, available=918
    expect(next.splitRatio).toBeCloseTo(300 / 918, 5)
    // b's splitRatio: subtreeH(c)=300, subtreeH(d)=300, available=600 → 0.5
    expect(findNode(next, 'b')?.splitRatio).toBeCloseTo(0.5, 5)
  })

  it('does not touch nodes under vertical splits', () => {
    const root: CabinetNode = {
      id: 'root', splitAxis: 'horizontal',
      children: [
        { id: 'a', elementType: 'void' },
        { id: 'b', splitAxis: 'vertical',
          children: [
            { id: 'c', elementType: 'void', fixedSize: 999, locked: true },
            { id: 'd', elementType: 'void', fixedSize: 999 },
          ]
        }
      ]
    }
    const next = distributeEvenly(root, 'root', 300, 18)
    // b is v-split, treated as single leaf; its children are NOT touched
    expect(findNode(next, 'c')?.fixedSize).toBe(999)
    expect(findNode(next, 'd')?.fixedSize).toBe(999)
    expect(findNode(next, 'c')?.locked).toBe(true)  // unchanged
  })
})
```

- [ ] **Step 2: Delete old `setLocked`/`setMaterial`/`unlockNode` tests from treeMutations.test.ts**

The existing test file imports and tests `setLocked`, `setMaterial`, and `unlockNode`. These will be deleted in Step 3. Before adding new tests, remove the old ones to prevent compile errors:

```bash
# Check what tests reference the removed functions:
grep -n "setLocked\|setMaterial\|unlockNode" src/engine/treeMutations.test.ts
```

Open `src/engine/treeMutations.test.ts` and delete:
- The import line for `setLocked`, `setMaterial`, `unlockNode`
- Any `describe` / `it` blocks that call these functions

- [ ] **Step 3: Run tests to confirm they fail**

```bash
cd worktree && node_modules/.bin/vitest run src/engine/treeMutations.test.ts 2>&1 | tail -15
```

Expected: failures referencing `pinNode`, `setNodeLabel`, `distributeEvenly` not defined.

- [ ] **Step 3: Update `src/engine/treeMutations.ts`**

```ts
// Changes to treeMutations.ts:

// 1. setNodeSize: remove locked side-effect
export function setNodeSize(root: CabinetNode, targetId: string, size: number): CabinetNode {
  return mapNode(root, (node) =>
    node.id === targetId ? { ...node, fixedSize: size } : node,
  )
}

// 2. Remove setLocked export entirely (replace with pinNode/unpinNode below)
// (delete the setLocked function)

// 3. Remove setMaterial export entirely (material is now cabinet-level only)
// (delete the setMaterial function)

// 4. pinNode: sets both fixedSize and locked (the explicit "freeze" action)
export function pinNode(root: CabinetNode, targetId: string, sizeMm: number): CabinetNode {
  return mapNode(root, (node) =>
    node.id === targetId ? { ...node, fixedSize: sizeMm, locked: true } : node,
  )
}

// 5. unpinNode: clears both fixedSize and locked
export function unpinNode(root: CabinetNode, targetId: string): CabinetNode {
  return mapNode(root, (node) =>
    node.id === targetId ? { ...node, locked: false, fixedSize: undefined } : node,
  )
}
// Note: keep unlockNode as an alias for unpinNode for backward compat in store:
// export { unpinNode as unlockNode }
// OR just update store to call unpinNode directly.

// 6. setNodeLabel
export function setNodeLabel(root: CabinetNode, targetId: string, label: string): CabinetNode {
  return mapNode(root, (node) =>
    node.id === targetId
      ? { ...node, spaceLabel: label.trim() || undefined }
      : node,
  )
}

// 7. distributeEvenly: set splitRatio at each h-split level for equal leaf heights.
// Uses a single recursive helper: subtreeH computes the height for a given subtree
// when all its column leaves have height evenH.
export function distributeEvenly(
  root: CabinetNode,
  columnRootId: string,
  evenH: number,
  thickness: number,
): CabinetNode {
  return mapNode(root, (node) => {
    if (node.id !== columnRootId) return node
    return setColumnSplitRatios(node, evenH, thickness)
  })
}

/** Height of this subtree when all column leaves are evenH tall (separated by thickness dividers). */
function subtreeH(node: CabinetNode, evenH: number, t: number): number {
  if (!node.splitAxis || node.splitAxis === 'vertical') return evenH
  return subtreeH(node.children![0], evenH, t) + t + subtreeH(node.children![1], evenH, t)
}

/** Recursively set splitRatio for even distribution; clear fixedSize/locked. */
function setColumnSplitRatios(node: CabinetNode, evenH: number, thickness: number): CabinetNode {
  const cleared: CabinetNode = { ...node, fixedSize: undefined, locked: false }

  if (!node.splitAxis || node.splitAxis === 'vertical') {
    // Leaf or v-split subtree: clear lock/fixedSize only, don't recurse into v-split children
    return cleared
  }

  const [childA, childB] = node.children!
  const leftH = subtreeH(childA, evenH, thickness)
  const rightH = subtreeH(childB, evenH, thickness)
  const available = leftH + rightH

  return {
    ...cleared,
    splitRatio: available > 0 ? leftH / available : 0.5,
    children: [
      setColumnSplitRatios(childA, evenH, thickness),
      setColumnSplitRatios(childB, evenH, thickness),
    ],
  }
}

// 8. splitNode: clear spaceLabel AND fixedSize/locked on the target node when splitting.
// Clearing fixedSize/locked prevents a pinned void's constraints from leaking to the new
// parent node and corrupting its grandparent's layout calculation.
// In the existing splitNode function, add to the return object:
// { ...node, splitAxis: axis, spaceLabel: undefined, fixedSize: undefined, locked: false, children: [...] }
```

For `splitNode`, the existing function body:
```ts
found = true
return {
  ...node,
  splitAxis: axis,
  spaceLabel: undefined,       // clear label — it no longer belongs to this void
  fixedSize: undefined,        // clear pin — this node is now a split parent, not a leaf
  locked: false,               // same
  children: [
    { id: nanoid(8), elementType: 'void' as ElementType },
    { id: nanoid(8), elementType: 'void' as ElementType },
  ],
}
```

Also update the import at the top of `treeMutations.ts` — remove `MaterialId` from the import since `setMaterial` is removed:
```ts
import type {
  CabinetNode,
  DrawerConfig,
  ElementType,
  SplitAxis,
} from '../types'
```

- [ ] **Step 4: Run tests**

```bash
cd worktree && node_modules/.bin/vitest run src/engine/treeMutations.test.ts 2>&1 | tail -10
```

Expected: All treeMutations tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/engine/treeMutations.ts src/engine/treeMutations.test.ts
git commit -m "feat(treeMutations): pinNode/unpinNode, setNodeLabel, distributeEvenly; setNodeSize no longer locks; remove setMaterial/setLocked; clear spaceLabel on split"
```

---

## Task 3: Update layoutEngine

**Files:**
- Modify: `src/engine/layoutEngine.ts`
- Modify: `src/engine/layoutEngine.test.ts`

- [ ] **Step 1: Write failing tests for new LayoutVoid fields**

In `src/engine/layoutEngine.test.ts`, add:

```ts
describe('LayoutVoid control node IDs', () => {
  it('root void has no control node IDs', () => {
    const settings = makeSettings()
    const root: CabinetNode = { id: 'root', elementType: 'void' }
    const layout = computeUnitLayout(settings, root)
    const v = layout.voids[0]
    expect(v.heightControlNodeId).toBeUndefined()
    expect(v.widthControlNodeId).toBeUndefined()
    expect(v.columnRootId).toBeUndefined()
    // isPinned is not on LayoutVoid — derived inline in DimensionLabels
  })

  it('direct child of h-split has heightControlNodeId=self and columnRootId=parent', () => {
    const settings = makeSettings()
    const root: CabinetNode = {
      id: 'root', splitAxis: 'horizontal', splitRatio: 0.5,
      children: [{ id: 'a', elementType: 'void' }, { id: 'b', elementType: 'void' }],
    }
    const layout = computeUnitLayout(settings, root)
    const va = layout.voids.find(v => v.nodeId === 'a')!
    expect(va.heightControlNodeId).toBe('a')
    expect(va.columnRootId).toBe('root')
    expect(va.widthControlNodeId).toBeUndefined()
  })

  it('grandchild through v-split: heightControlNodeId=v-split child, columnRootId=undefined', () => {
    // root(h) -> [a(leaf), b(v) -> [c(leaf), d(leaf)]]
    // Entering a v-split resets columnRootId — voids inside v-splits cannot use Even Space
    const settings = makeSettings()
    const root: CabinetNode = {
      id: 'root', splitAxis: 'horizontal', splitRatio: 0.5,
      children: [
        { id: 'a', elementType: 'void' },
        { id: 'b', splitAxis: 'vertical', splitRatio: 0.5,
          children: [{ id: 'c', elementType: 'void' }, { id: 'd', elementType: 'void' }] }
      ]
    }
    const layout = computeUnitLayout(settings, root)
    const vc = layout.voids.find(v => v.nodeId === 'c')!
    // c's height is controlled by b (b is the direct child of root h-split)
    expect(vc.heightControlNodeId).toBe('b')
    // v-split resets the column scope — c is inside a vertical subdivision
    expect(vc.columnRootId).toBeUndefined()
    // c's width is controlled by c itself (c is a direct child of b v-split)
    expect(vc.widthControlNodeId).toBe('c')
  })

  it('nested h-split: columnRootId stays the outermost h-split in the v-scope', () => {
    // root(h) -> [a(leaf), b(h) -> [c(leaf), d(leaf)]]
    const settings = makeSettings()
    const root: CabinetNode = {
      id: 'root', splitAxis: 'horizontal', splitRatio: 0.5,
      children: [
        { id: 'a', elementType: 'void' },
        { id: 'b', splitAxis: 'horizontal', splitRatio: 0.5,
          children: [{ id: 'c', elementType: 'void' }, { id: 'd', elementType: 'void' }] }
      ]
    }
    const layout = computeUnitLayout(settings, root)
    // all three leaves share columnRootId='root' (topmost h-split)
    expect(layout.voids.find(v => v.nodeId === 'a')?.columnRootId).toBe('root')
    expect(layout.voids.find(v => v.nodeId === 'c')?.columnRootId).toBe('root')
    expect(layout.voids.find(v => v.nodeId === 'd')?.columnRootId).toBe('root')
  })

  it('spaceLabel forwarded from CabinetNode', () => {
    const settings = makeSettings()
    const root: CabinetNode = { id: 'root', elementType: 'void', spaceLabel: 'Books' }
    const layout = computeUnitLayout(settings, root)
    expect(layout.voids[0].spaceLabel).toBe('Books')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
node_modules/.bin/vitest run src/engine/layoutEngine.test.ts 2>&1 | tail -10
```

- [ ] **Step 3: Update `layoutEngine.ts`**

Change the `layoutNode` function signature to accept ancestor-tracking parameters and update `buildOuterPanels`:

```ts
// 1. Replace gs.defaultMaterial with gs.material everywhere in the file.
//    Add runtime fallback for old localStorage data:
//    const mat = gs.material ?? (gs as any).defaultMaterial ?? 'oak'
//    Use `mat` in place of `gs.defaultMaterial`.

// 2. In buildOuterPanels, change the parameter type:
function buildOuterPanels(gs: {
  width: number
  height: number
  thickness: number
  material: CabinetMaterialId   // was defaultMaterial
}): LayoutPanel[] {
  // replace gs.defaultMaterial → gs.material in all 4 panels
}

// 3. In computeUnitLayout, update to:
const mat = settings.material ?? (settings as any).defaultMaterial ?? 'oak'
// Pass mat to buildOuterPanels and to layoutNode as inheritedMaterial.
// Also pass to the toe-kick panel.

// 4. Update layoutNode signature to track ancestor control node IDs:
function layoutNode(
  node: CabinetNode,
  x: number,
  y: number,
  w: number,
  h: number,
  inheritedMaterial: CabinetMaterialId,
  parentSplitAxis: SplitAxis | undefined,
  // Ancestor tracking (undefined for root void):
  hControlNodeId: string | undefined,   // direct child of nearest h-split ancestor
  columnRootId: string | undefined,     // topmost h-split in current v-scope
  vControlNodeId: string | undefined,   // direct child of nearest v-split ancestor
): void {
  const material = inheritedMaterial  // no per-node override

  if (!node.splitAxis || !node.children) {
    voids.push({
      nodeId: node.id,
      x, y, w, h,
      parentSplitAxis,
      elementType: node.elementType ?? 'void',
      drawerConfig: node.drawerConfig,
      material,
      accessories: node.accessories ?? [],
      heightControlNodeId: hControlNodeId,
      widthControlNodeId: vControlNodeId,
      columnRootId,
      spaceLabel: node.spaceLabel,
      // isPinned not stored on LayoutVoid — DimensionLabels derives it inline
    })
    return
  }

  const axis = node.splitAxis
  const available = axis === 'horizontal' ? h - thickness : w - thickness
  const [childA, childB] = node.children
  const [sizeA, sizeB, overConstrained] = distributeTwo(childA, childB, available, node)

  // ... (overConstrained handling unchanged) ...

  const dividerConfig = node.dividers?.[0]
  const dividerMaterial = dividerConfig?.materialId ?? material

  if (axis === 'horizontal') {
    // h-split: children get hControlNodeId=themselves; columnRootId stays or becomes node.id
    const newColumnRootId = columnRootId ?? node.id
    layoutNode(childA, x, y, w, sizeA, material, axis,
      childA.id, newColumnRootId, vControlNodeId)

    const dividerY = y + sizeA
    // ... dividers.push(...) unchanged ...

    layoutNode(childB, x, dividerY + thickness, w, sizeB, material, axis,
      childB.id, newColumnRootId, vControlNodeId)
    return
  }

  // axis === 'vertical': each child enters a new v-scope → columnRootId resets to undefined
  layoutNode(childA, x, y, sizeA, h, material, axis,
    hControlNodeId, undefined,    // new v-scope: columnRootId resets
    childA.id)                    // vControlNodeId=childA

  const dividerX = x + sizeA
  // ... dividers.push(...) unchanged ...

  layoutNode(childB, dividerX + thickness, y, sizeB, h, material, axis,
    hControlNodeId, undefined,    // new v-scope: columnRootId resets
    childB.id)                    // vControlNodeId=childB
}

// Initial call from computeUnitLayout — pass undefined for all ancestor IDs:
layoutNode(root, innerX, innerY, innerW, innerH, mat, undefined,
  undefined, undefined, undefined)
```

Also remove `node.material ?? inheritedMaterial` — the layout engine no longer reads per-node material (it was removed from `CabinetNode`):
```ts
const material = inheritedMaterial  // single line replaces the old per-node fallback
```

- [ ] **Step 4: Run all tests**

```bash
node_modules/.bin/vitest run src/engine/ 2>&1 | tail -10
```

Expected: All engine tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/engine/layoutEngine.ts src/engine/layoutEngine.test.ts
git commit -m "feat(layoutEngine): emit heightControlNodeId, widthControlNodeId, columnRootId, spaceLabel on LayoutVoid; material rename with runtime fallback"
```

---

## Task 4: Update cutList + all test fixtures

**Files:**
- Modify: `src/engine/cutList.ts`
- Modify: `src/engine/cutList.test.ts`
- Modify: 17 files total (12 test files + 5 source files) — mass rename via `sed`

- [ ] **Step 1: Update `cutList.ts`**

Replace all `gs.defaultMaterial` with `gs.material ?? (gs as any).defaultMaterial ?? 'oak'`:

```ts
// In computeCutListForUnit, change the lines that read gs.defaultMaterial:
const settings = unit.settings
const mat = settings.material ?? (settings as any).defaultMaterial ?? 'oak'

// Then use mat in place of gs.defaultMaterial for all raw.push() calls:
raw.push({ label: 'Side panel', qty: 2, width: gs.height, height: gs.depth, depth: t, material: mat })
raw.push({ label: 'Top panel', qty: 1, width: gs.width - 2 * t, height: gs.depth, depth: t, material: mat })
raw.push({ label: 'Bottom panel', qty: 1, width: gs.width - 2 * t, height: gs.depth, depth: t, material: mat })
raw.push({ label: 'Back panel', qty: 1, ... material: mat, ... })
// etc.
```

- [ ] **Step 2: Mass rename `defaultMaterial → material` in all test fixtures**

```bash
# Run from the worktree root
grep -rl "defaultMaterial" src/ --include="*.ts" --include="*.tsx" | xargs sed -i 's/defaultMaterial/material/g'
```

This renames the field in:
- `src/engine/layoutEngine.test.ts`
- `src/engine/treeMutations.test.ts`
- `src/engine/cutList.test.ts`
- `src/components/CabinetCanvas/CabinetCanvas.test.tsx`
- `src/components/CabinetCanvas/DragHandles.test.tsx`
- `src/components/Toolbar/Toolbar.test.tsx`
- `src/components/Toolbar/ExportModal.test.tsx`
- `src/components/Toolbar/ImportModal.test.tsx`
- `src/components/Sidebar/UnitSelector.test.tsx`
- `src/store/store.test.ts`
- `src/types/index.test.ts`
- `src/integration/cabinetFlow.test.tsx`
- `src/utils/workspaceIO.test.ts`
- `src/App.tsx` (line 26: `defaultMaterial: 'oak'` in the default settings object — also renamed)
- `src/store/store.ts` (lines 72, 173: `defaultMaterial: 'oak'` in defaults — also renamed)

- [ ] **Step 3: Run all tests**

```bash
node_modules/.bin/vitest run 2>&1 | tail -10
```

Expected: All 156 tests pass (or similar count — TypeScript errors in components not yet updated are fine since vitest doesn't type-check unless configured to).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(cutList): material rename; mass-rename defaultMaterial→material in all fixtures and defaults"
```

---

## Task 5: Update Store

**Files:**
- Modify: `src/store/store.ts`

- [ ] **Step 1: Update store imports and interface**

Replace the import line:
```ts
// Remove setLocked, setMaterial, unlockNode from treeMutations imports
// Add pinNode, unpinNode, setNodeLabel, distributeEvenly
import {
  addShelf, addDivider, deleteBoard as deleteBoardFn,
  setNodeSize, pinNode as treePinNode, unpinNode as treeUnpinNode,
  setSplitRatio, setNodeLabel as treeMutSetNodeLabel,
  distributeEvenly as treeMutDistributeEvenly,
  setElementType as treeMutSetElementType,
  setDrawerConfig as treeMutSetDrawerConfig,
} from '../engine/treeMutations'
```

Update `StoreState` interface — replace `setMaterial`, `setLocked`, `unlockNode` with:
```ts
// Remove:
//   setMaterial: (nodeId: string, material: MaterialId) => void
//   setLocked: (nodeId: string, locked: boolean) => void
//   unlockNode: (nodeId: string) => void

// Add:
  pinNode: (nodeId: string, sizeMm: number) => void
  unpinNode: (nodeId: string) => void
  setCabinetMaterial: (material: CabinetMaterialId) => void
  setNodeLabel: (nodeId: string, label: string) => void
  distributeEvenly: (columnRootId: string, evenH: number) => void
  // Note: setVoidDimension is NOT in the store — CabinetCanvas handles control-node
  //       lookup inline from the already-computed unitLayout, then calls setNodeSize.
```

Check where `UIState` is defined:
```bash
grep -n "UIState" src/types/index.ts src/store/store.ts
```

- [ ] **Step 2: Update store implementation**

```ts
// In the immer set() implementation, replace setMaterial/setLocked/unlockNode with:

pinNode: (nodeId, sizeMm) => set(s => {
  mutateActiveUnit(s, u => ({ ...u, root: treePinNode(u.root, nodeId, sizeMm) }))
}),

unpinNode: (nodeId) => set(s => {
  mutateActiveUnit(s, u => ({ ...u, root: treeUnpinNode(u.root, nodeId) }))
}),

setCabinetMaterial: (material) => set(s => {
  mutateActiveUnit(s, u => ({ ...u, settings: { ...u.settings, material } }))
}),

setNodeLabel: (nodeId, label) => set(s => {
  mutateActiveUnit(s, u => ({ ...u, root: treeMutSetNodeLabel(u.root, nodeId, label) }))
}),

distributeEvenly: (columnRootId, evenH) => set(s => {
  mutateActiveUnit(s, u => ({
    ...u, root: treeMutDistributeEvenly(u.root, columnRootId, evenH, u.settings.thickness),
  }))
}),

// Remove setNodeSize's old store wrapper (was incorrectly locking) — keep it but fix:
setNodeSize: (nodeId, sizeMm) => set(s => {
  mutateActiveUnit(s, u => ({ ...u, root: setNodeSize(u.root, nodeId, sizeMm) }))
}),
```

- [ ] **Step 3: Bump persist version and add migration**

```ts
// In the persist config:
{
  name: 'buildbox-store',
  partialize: partializeProjectState,
  version: 2,   // bumped from 1
  migrate: (persisted: unknown, fromVersion: number) => {
    if (fromVersion === 0) {
      // ... existing v0→v1 migration unchanged ...
    }
    if (fromVersion === 1) {
      // v1→v2: rename defaultMaterial → material in GlobalSettings
      const state = persisted as { projects: Array<{ units: Array<{ settings: Record<string, unknown> }> }> }
      for (const project of state.projects ?? []) {
        for (const unit of project.units ?? []) {
          if ('defaultMaterial' in unit.settings) {
            unit.settings.material = unit.settings.defaultMaterial
            delete unit.settings.defaultMaterial
          }
        }
      }
    }
    return persisted
  },
}
```

- [ ] **Step 4: Commit**

```bash
git add src/store/store.ts
git commit -m "feat(store): pinNode/unpinNode/setCabinetMaterial/setNodeLabel/distributeEvenly; persist v2 migration"
```

---

## Task 6: Update DimensionLabels

**Files:**
- Modify: `src/components/CabinetCanvas/DimensionLabels.tsx`
- Modify: `src/components/CabinetCanvas/DimensionLabels.test.tsx`

- [ ] **Step 1: Write failing tests**

In `DimensionLabels.test.tsx`, add:

```tsx
describe('editability using control node IDs', () => {
  function makeVoid(overrides: Partial<LayoutVoid> = {}): LayoutVoid {
    return {
      nodeId: 'v1', x: 50, y: 50, w: 200, h: 200,
      elementType: 'void', material: 'oak', accessories: [],
      ...overrides,
    }
  }
  // Note: isPinned is not a LayoutVoid field — it's derived from the CabinetNode passed as prop.
  // DimensionLabels receives selectedNode to compute isPinned inline.

  it('width label is clickable when widthControlNodeId is set', () => {
    const onCommit = vi.fn()
    render(<DimensionLabels voids={[makeVoid({ widthControlNodeId: 'v1' })]}
      unit="mm" onCommitSize={onCommit} zoom={1} />)
    const label = screen.getByTestId('dim-label-v1-w')
    expect(label).toHaveAttribute('cursor', 'pointer')
  })

  it('width label shows lock icon when widthControlNodeId is absent', () => {
    render(<DimensionLabels voids={[makeVoid()]} unit="mm" onCommitSize={vi.fn()} zoom={1} />)
    expect(screen.getByTestId('lock-icon-v1-w')).toBeInTheDocument()
  })

  it('pinned void shows lock icons on both labels (via selectedNode prop)', () => {
    const pinnedNode = { id: 'v1', elementType: 'void' as const, locked: true, fixedSize: 200 }
    render(<DimensionLabels
      voids={[makeVoid({ heightControlNodeId: 'v1', widthControlNodeId: 'v1' })]}
      selectedNode={pinnedNode}
      unit="mm" onCommitSize={vi.fn()} zoom={1} />)
    expect(screen.getByTestId('lock-icon-v1-h')).toBeInTheDocument()
    expect(screen.getByTestId('lock-icon-v1-w')).toBeInTheDocument()
  })
})

describe('spaceLabel overlay', () => {
  it('renders spaceLabel text when set', () => {
    const v: LayoutVoid = {
      nodeId: 'v1', x: 50, y: 50, w: 200, h: 200,
      elementType: 'void', material: 'oak', accessories: [],
      spaceLabel: 'Pots',
    }
    render(<DimensionLabels voids={[v]} unit="mm" onCommitSize={vi.fn()} zoom={1} />)
    expect(screen.getByTestId('space-label-v1')).toHaveTextContent('Pots')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
node_modules/.bin/vitest run src/components/CabinetCanvas/DimensionLabels.test.tsx 2>&1 | tail -10
```

- [ ] **Step 3: Update `DimensionLabels.tsx`**

```tsx
// Key changes:

// 1. Font fix
const fontSize = Math.max(12 / zoom, 8)

// 2. Editability from control node IDs; isPinned computed inline (not a LayoutVoid field)
const isPinned = selectedNode?.locked === true && selectedNode?.fixedSize != null
// (selectedNode comes from the store or is passed as a prop; see App.tsx wiring)
const canEditH = !!v.heightControlNodeId && !isPinned
const canEditW = !!v.widthControlNodeId && !isPinned

// 3. Lock icon for both W and H when isPinned or no control node
{(!canEditW) && (
  <g data-testid={`lock-icon-${v.nodeId}-w`} ...>
    <LockIcon color="#9ca3af" />
  </g>
)}
{(!canEditH) && (
  <g data-testid={`lock-icon-${v.nodeId}-h`} ...>
    <LockIcon color="#9ca3af" />
  </g>
)}

// 4. spaceLabel overlay — rendered as SVG text below dimension labels
{v.spaceLabel && (
  <text
    data-testid={`space-label-${v.nodeId}`}
    x={v.x + v.w / 2}
    y={v.y + v.h / 2}
    textAnchor="middle"
    dominantBaseline="middle"
    fontSize={Math.max(10 / zoom, 6)}
    fill="#6b7280"
    style={{ pointerEvents: 'none', userSelect: 'none' }}
  >
    {v.spaceLabel.length > 20 ? v.spaceLabel.slice(0, 20) + '…' : v.spaceLabel}
  </text>
)}

// 5. spaceLabel click-to-edit — clicking the label area opens a DOM overlay
// (same anchor pattern as the existing DimensionEditor)
// Add an invisible rect over the void center for label editing:
<rect
  x={v.x + v.w / 4}
  y={v.y + v.h / 4}
  width={v.w / 2}
  height={v.h / 2}
  fill="transparent"
  style={{ cursor: 'text' }}
  onClick={(e) => {
    const rect = (e.currentTarget as SVGRectElement).getBoundingClientRect()
    setLabelEditing({ nodeId: v.nodeId, anchor: { x: rect.left, y: rect.top, width: rect.width, height: rect.height } })
  }}
/>
```

Add a `labelEditing` state and a DOM overlay (rendered outside SVG via a portal or absolute div):

```tsx
// Add to state:
const [labelEditing, setLabelEditing] = useState<{ nodeId: string; anchor: DOMRect } | null>(null)

// After the SVG return, render the label editor portal:
// (DimensionEditor already uses this pattern — follow it)
{labelEditing && (
  <DimensionEditor   // or a simpler inline <input> absolute-positioned
    // ...positioned at labelEditing.anchor
    // onCommit: calls onCommitLabel(labelEditing.nodeId, value)
    // onClose: setLabelEditing(null)
  />
)}
```

Update `Props` to add `onCommitLabel?: (nodeId: string, label: string) => void`.

- [ ] **Step 4: Run tests**

```bash
node_modules/.bin/vitest run src/components/CabinetCanvas/DimensionLabels.test.tsx 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add src/components/CabinetCanvas/DimensionLabels.tsx src/components/CabinetCanvas/DimensionLabels.test.tsx
git commit -m "feat(DimensionLabels): use heightControlNodeId/widthControlNodeId; spaceLabel overlay; lock icons; font Math.max(12/zoom,8)"
```

---

## Task 7: Update DragHandles

**Files:**
- Modify: `src/components/CabinetCanvas/DragHandles.tsx`
- Modify: `src/components/CabinetCanvas/DragHandles.test.tsx`

- [ ] **Step 1: Write failing tests for `snapToAlignment`**

In `src/components/CabinetCanvas/DragHandles.test.tsx`, add:

```ts
import { snapToAlignment } from './DragHandles'

describe('snapToAlignment', () => {
  it('snaps to nearest candidate within threshold', () => {
    expect(snapToAlignment(198, [200, 400], 20)).toBe(200)
  })

  it('does not snap when outside threshold', () => {
    expect(snapToAlignment(175, [200, 400], 20)).toBe(175)
  })

  it('returns y unchanged when candidates is empty', () => {
    expect(snapToAlignment(100, [], 20)).toBe(100)
  })

  it('snaps to closest of multiple candidates', () => {
    expect(snapToAlignment(199, [200, 195], 20)).toBe(200)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
node_modules/.bin/vitest run src/components/CabinetCanvas/DragHandles.test.tsx 2>&1 | tail -10
```

- [ ] **Step 3: Update `DragHandles.tsx`**

```tsx
// 1. Export snapToAlignment as a named pure function (for testing):
export function snapToAlignment(y: number, candidates: number[], threshold: number): number {
  if (candidates.length === 0) return y
  const nearest = candidates.reduce((best, c) =>
    Math.abs(c - y) < Math.abs(best - y) ? c : best)
  return Math.abs(nearest - y) <= threshold ? nearest : y
}

// 2. Props interface — no new props needed (allDividers is just dividers):
interface Props {
  dividers: LayoutDivider[]
  // Note: allDividers NOT added — magnetic snap uses the same unit's existing dividers prop.
  snapGrid: number
  svgRef: React.RefObject<SVGSVGElement | null>
  zoom: number
}

// 3. In onPointerDown, cache alignmentYs in parent-relative coordinates (excluding the dragged divider):
const alignmentYs = useRef<number[]>([])

function onPointerDown(e: React.PointerEvent<SVGRectElement>, divider: LayoutDivider) {
  // ... existing setup that computes originSizeA ...
  // originSizeA = initial size of the region ABOVE the dragged divider (relative to its parent top)
  // divider.y = absolute cabinet-y of the divider's top edge
  // parentStartY = divider.y - originSizeA  (absolute y where the parent void begins)
  const parentStartY = divider.y - originSizeA

  // Cache alignment y-values converted to parent-relative mm (same coordinate space as candidateMm):
  alignmentYs.current = dividers   // uses the component's existing dividers prop
    .filter(d => d.axis === 'horizontal' && d.nodeId !== divider.nodeId)
    .map(d => d.y + d.h / 2 - parentStartY)   // convert absolute → parent-relative
    .filter(y => y > 0)                         // only positions above parent's top are valid
  dragging.current = { ... }
}

// 4. In onPointerMove, apply magnetic snap after grid snap:
function onPointerMove(e: React.PointerEvent<SVGRectElement>) {
  if (!dragging.current) return
  // ... existing delta computation ...
  
  let candidateMm = snap(rawMm)  // grid snap first (candidateMm is parent-relative sizeA)
  if (dragging.current.axis === 'horizontal') {
    // alignmentYs are already in parent-relative coordinates — same space as candidateMm
    candidateMm = snapToAlignment(candidateMm, alignmentYs.current, 20)
  }
  // ... rest of move logic using candidateMm ...
}
```

- [ ] **Step 4: Run tests**

```bash
node_modules/.bin/vitest run src/components/CabinetCanvas/ 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add src/components/CabinetCanvas/DragHandles.tsx src/components/CabinetCanvas/DragHandles.test.tsx
git commit -m "feat(DragHandles): export snapToAlignment; magnetic cross-divider snap; cache alignmentYs at pointerDown"
```

---

## Task 8: Update Sidebar

**Files:**
- Modify: `src/components/Sidebar/Sidebar.tsx`
- Modify: `src/components/Sidebar/Sidebar.test.tsx` (if it exists, or create it)

- [ ] **Step 1: Write failing test for "Even Space" button**

```tsx
// In Sidebar.test.tsx or a relevant test file:
import { render, screen } from '@testing-library/react'
import Sidebar from './Sidebar'
import type { LayoutVoid } from '../../types'

const mockVoid: LayoutVoid = {
  nodeId: 'v1', x: 0, y: 0, w: 200, h: 200,
  elementType: 'void', material: 'oak', accessories: [],
  heightControlNodeId: 'v1',
  columnRootId: 'parent',
}

it('shows Even Space button when selectedVoid has columnRootId and evenH is provided', () => {
  render(
    <Sidebar
      selectedId="v1"
      selectedNode={{ id: 'v1', elementType: 'void' }}
      selectedVoid={mockVoid}
      evenH={200}
      onAddShelf={vi.fn()} onAddDivider={vi.fn()} onDelete={vi.fn()}
      onToggleLock={vi.fn()} onSetCabinetMaterial={vi.fn()} onDistributeEvenly={vi.fn()}
      onSetElementType={vi.fn()} onSetDrawerConfig={vi.fn()}
      onAddAccessory={vi.fn()} onRemoveAccessory={vi.fn()}
      currentMaterial="oak"
    />
  )
  expect(screen.getByRole('button', { name: /even space/i })).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to confirm it fails**

- [ ] **Step 3: Update `Sidebar.tsx`**

Key changes to `Props` interface:
```tsx
interface Props {
  // ... keep existing props ...
  selectedVoid: LayoutVoid | null         // NEW
  evenH: number | null                    // NEW: mean column leaf height (for Even Space button)
  onSetCabinetMaterial: (mat: CabinetMaterialId) => void  // replaces onSetMaterial
  onDistributeEvenly: (columnRootId: string, evenH: number) => void  // NEW
  currentMaterial: CabinetMaterialId     // NEW: active unit's current material
  // Remove: onSetMaterial: (id: string, mat: MaterialId) => void
}
```

Move material swatch to the top of the sidebar (before the Add Shelf/Divider buttons). Change the swatch `onClick` to call `onSetCabinetMaterial(key)` instead of `onSetMaterial(selectedId, key)`. Use `currentMaterial` (not `selectedNode?.material`) for the active highlight.

Add the "Even Space" button:
```tsx
{selectedVoid?.columnRootId && evenH !== null && (
  <button
    onClick={() => onDistributeEvenly(selectedVoid.columnRootId!, evenH!)}
    className="w-full text-left px-3 py-1.5 text-sm bg-panel hover:bg-gray-100 rounded"
  >
    Even Space
  </button>
)}
```

App.tsx computes and passes `evenH` as a single number (the mean of column leaf heights). This keeps the interface clean — Sidebar needs just the computed value, not the raw array:
```tsx
interface Props {
  // ...
  evenH: number | null  // mean of column leaf heights; null if no column selected
}
```

- [ ] **Step 4: Run tests**

```bash
node_modules/.bin/vitest run src/components/Sidebar/ 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add src/components/Sidebar/
git commit -m "feat(Sidebar): global material swatch; Even Space button; selectedVoid prop; onSetCabinetMaterial"
```

---

## Task 9: Update CabinetCanvas + App.tsx

**Files:**
- Modify: `src/components/CabinetCanvas/CabinetCanvas.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Update `CabinetCanvas.tsx`**

Fix `handleCommitSize` to look up control node IDs from the already-computed `unitLayout`:

```tsx
// CabinetCanvas already has unitLayout (it renders it).
// No need for a new store action — read the control node ID directly.

function handleCommitSize(voidId: string, mm: number, axis: 'w' | 'h') {
  const void_ = voids.find(v => v.nodeId === voidId)
  const controlId = axis === 'h'
    ? void_?.heightControlNodeId
    : void_?.widthControlNodeId
  if (controlId) storeSetNodeSize(controlId, mm)
  // setNodeSize does NOT set locked — editing via canvas label is NOT a pin
}
```

Pass `dividers` to `DragHandles` (no change needed — it already has `dividers`):
```tsx
<DragHandles
  dividers={unitLayout.dividers}
  snapGrid={snapGrid}
  svgRef={svgRef}
  zoom={zoom}
/>
```

Pass `onCommitLabel` to `DimensionLabels`:
```tsx
<DimensionLabels
  voids={unitLayout.voids}
  unit={unitLayout.unit}
  onCommitSize={handleCommitSize}
  onCommitLabel={storeSetNodeLabel}
  zoom={zoom}
/>
```

- [ ] **Step 2: Update `App.tsx`**

```tsx
// Replace store bindings:
// Remove: storeLocked, storeUnlockNode, storeMaterial
// Add:
const storePinNode = useStore((state) => state.pinNode)
const storeUnpinNode = useStore((state) => state.unpinNode)
const storeSetCabinetMaterial = useStore((state) => state.setCabinetMaterial)
const storeSetNodeLabel = useStore((state) => state.setNodeLabel)
const storeDistributeEvenly = useStore((state) => state.distributeEvenly)

// Derive selectedVoid from sceneLayout:
const selectedVoid = useMemo(
  () => sceneLayout?.units.flatMap(u => u.voids).find(v => v.nodeId === selectedId) ?? null,
  [sceneLayout, selectedId],
)

// Compute evenH for Even Space: mean of column leaf heights in selected void's column.
// These are the voids that share the same columnRootId (all direct column leaves).
const evenH = useMemo(() => {
  if (!selectedVoid?.columnRootId || !sceneLayout) return null
  const colRootId = selectedVoid.columnRootId
  const colLeaves = sceneLayout.units
    .flatMap(u => u.voids)
    .filter(v => v.columnRootId === colRootId)
  if (colLeaves.length === 0) return null
  return colLeaves.reduce((s, v) => s + v.h, 0) / colLeaves.length
}, [selectedVoid, sceneLayout])

// Update onToggleLock:
onToggleLock={(voidId) => {
  if (selectedNode?.locked && selectedNode?.fixedSize != null) {
    storeUnpinNode(voidId)
  } else if (selectedVoid) {
    const sizeMm = selectedVoid.parentSplitAxis === 'vertical'
      ? selectedVoid.w
      : selectedVoid.h
    storePinNode(voidId, sizeMm)
  }
}}

// Pass new props to Sidebar:
onSetCabinetMaterial={storeSetCabinetMaterial}
onDistributeEvenly={(columnRootId, evenH) => storeDistributeEvenly(columnRootId, evenH)}
selectedVoid={selectedVoid}
currentMaterial={activeUnit?.settings.material ?? 'oak'}
evenH={evenH}
```

- [ ] **Step 3: Run full test suite**

```bash
node_modules/.bin/vitest run 2>&1 | tail -10
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/CabinetCanvas/CabinetCanvas.tsx src/App.tsx
git commit -m "feat(CabinetCanvas/App): handleCommitSize via control node IDs; pinNode/unpinNode in onToggleLock; selectedVoid + evenH derivation"
```

---

## Task 10: End-to-End Integration Test

**Files:**
- Modify: `src/integration/cabinetFlow.test.tsx`

- [ ] **Step 1: Write the E2E test**

Append to `src/integration/cabinetFlow.test.tsx`:

```tsx
describe('Feature improvements E2E', () => {
  beforeEach(() => resetStore())

  it('shelf width becomes editable after adding a divider', async () => {
    const { addShelf, addDivider, getState } = useStore.getState()
    // Start with root void, add a shelf → 2 voids stacked
    addShelf(getState().projects[0].units[0].root.id)
    const layout1 = computeSceneLayout(
      getState().projects[0].units, getState().activeUnitId,
    )
    const topVoid = layout1.units[0].voids[0]
    // Before divider: widthControlNodeId undefined
    expect(topVoid.widthControlNodeId).toBeUndefined()

    // Add a divider to topVoid
    addDivider(topVoid.nodeId)
    const layout2 = computeSceneLayout(
      getState().projects[0].units, getState().activeUnitId,
    )
    const innerLeft = layout2.units[0].voids.find(v => v.widthControlNodeId !== undefined)
    expect(innerLeft).toBeDefined()
    expect(innerLeft!.widthControlNodeId).toBeDefined()
  })

  it('canvas label edit resizes without locking (setNodeSize not setLocked)', () => {
    const { addShelf, setNodeSize, getState } = useStore.getState()
    const rootId = getState().projects[0].units[0].root.id
    addShelf(rootId)
    const layout1 = computeSceneLayout(
      getState().projects[0].units, getState().activeUnitId,
    )
    const topVoid = layout1.units[0].voids[0]

    // Simulate what handleCommitSize does: read heightControlNodeId from layout, call setNodeSize
    const controlId = topVoid.heightControlNodeId ?? topVoid.nodeId
    setNodeSize(controlId, 200)

    const newUnit = getState().projects[0].units.find(u => u.id === getState().activeUnitId)!
    const controlNode = newUnit.root.id === controlId ? newUnit.root
      : newUnit.root.children?.find(c => c.id === controlId)
    expect(controlNode?.fixedSize).toBe(200)
    expect(controlNode?.locked).not.toBe(true)  // setNodeSize does NOT lock

    const layout2 = computeSceneLayout(
      getState().projects[0].units, getState().activeUnitId,
    )
    expect(layout2.units[0].voids.find(v => v.nodeId === topVoid.nodeId)!.h).toBe(200)
  })

  it('pinned void size unchanged when sibling is resized', () => {
    const { addShelf, pinNode, setNodeSize, getState } = useStore.getState()
    const rootId = getState().projects[0].units[0].root.id
    addShelf(rootId)
    const layout1 = computeSceneLayout(
      getState().projects[0].units, getState().activeUnitId,
    )
    const topVoid = layout1.units[0].voids[0]
    const bottomVoid = layout1.units[0].voids[1]
    const originalTopH = topVoid.h

    // Pin the top void
    pinNode(topVoid.nodeId, topVoid.h)

    // Resize bottom (should not affect pinned top)
    setNodeSize(bottomVoid.heightControlNodeId ?? bottomVoid.nodeId, 100)
    const layout2 = computeSceneLayout(
      getState().projects[0].units, getState().activeUnitId,
    )
    const newTopH = layout2.units[0].voids.find(v => v.nodeId === topVoid.nodeId)!.h
    expect(newTopH).toBe(originalTopH)
  })

  it('setCabinetMaterial changes all void materials', () => {
    const { setCabinetMaterial, getState } = useStore.getState()
    setCabinetMaterial('walnut')
    const layout = computeSceneLayout(
      getState().projects[0].units, getState().activeUnitId,
    )
    layout.units[0].voids.forEach(v => expect(v.material).toBe('walnut'))
    layout.units[0].panels.forEach(p => expect(p.material).toBe('walnut'))
  })

  it('setNodeLabel sets spaceLabel visible in layout', () => {
    const { setNodeLabel, getState } = useStore.getState()
    const rootId = getState().projects[0].units[0].root.id
    setNodeLabel(rootId, 'Storage')
    const layout = computeSceneLayout(
      getState().projects[0].units, getState().activeUnitId,
    )
    expect(layout.units[0].voids[0].spaceLabel).toBe('Storage')
  })

  it('distributeEvenly gives all column voids equal height', () => {
    const { addShelf, distributeEvenly, getState } = useStore.getState()
    const rootId = getState().projects[0].units[0].root.id
    addShelf(rootId)

    const layout1 = computeSceneLayout(
      getState().projects[0].units, getState().activeUnitId,
    )
    // Add second shelf to create 3 voids
    const bottomVoid = layout1.units[0].voids[1]
    addShelf(bottomVoid.nodeId)

    const layout2 = computeSceneLayout(
      getState().projects[0].units, getState().activeUnitId,
    )
    const voids = layout2.units[0].voids
    expect(voids).toHaveLength(3)
    const evenH = voids.reduce((s, v) => s + v.h, 0) / 3
    const columnRootId = voids[0].columnRootId!

    distributeEvenly(columnRootId, evenH)

    const layout3 = computeSceneLayout(
      getState().projects[0].units, getState().activeUnitId,
    )
    const finalVoids = layout3.units[0].voids
    const heights = finalVoids.map(v => Math.round(v.h))
    // All three heights should be approximately equal
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(2)
  })
})
```

- [ ] **Step 2: Run the integration test**

```bash
node_modules/.bin/vitest run src/integration/cabinetFlow.test.tsx 2>&1 | tail -15
```

Expected: All new tests pass.

- [ ] **Step 3: Run full test suite**

```bash
node_modules/.bin/vitest run 2>&1 | tail -10
```

Expected: All tests pass (≥ 166 tests, 27+ test files).

- [ ] **Step 4: Commit**

```bash
git add src/integration/cabinetFlow.test.tsx
git commit -m "test(e2e): Feature improvements integration — editability, pinning, material, labels, distributeEvenly"
```

---

## Post-Implementation Checklist

- [ ] `node_modules/.bin/vitest run` — all tests green
- [ ] Manual browser check: shelf width label is now clickable after adding a divider
- [ ] Manual browser check: locking a void freezes its dimension labels
- [ ] Manual browser check: material swatch at top of sidebar changes all wood colour
- [ ] Manual browser check: space label appears centred in voids
- [ ] Manual browser check: dragging a shelf near another shelf's Y position snaps to it
- [ ] Manual browser check: "Even Space" button appears when a void in a column is selected
- [ ] Push branch: `git push origin feature-improvements`
