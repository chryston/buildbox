# BuildBox Cabinet Configurator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a web-based interactive 2D cabinet design configurator SPA where users can partition a rectangular cabinet, drag/click-edit dimensions, and export an accurate cut-list.

**Architecture:** Pure-frontend React+Vite+TypeScript SPA. A tree of `CabinetNode` objects (each node either a leaf void or a split with children) drives both the SVG canvas and the cut-list. A pure `computeLayout` engine converts the tree into flat `LayoutItem` arrays; Zustand+Immer manages mutations; zundo wraps the store for undo/redo.

**Tech Stack:** React 18, Vite 5, TypeScript 5, Tailwind CSS 3, Zustand 4 + Immer + zundo, Vitest + React Testing Library, SVG canvas, localStorage persistence.

---

## File Map

```
src/
  types/index.ts                       # All shared TypeScript interfaces
  engine/
    unitConversion.ts                  # toMm / fromMm / formatDisplay
    unitConversion.test.ts
    layoutEngine.ts                    # computeLayout → LayoutResult
    layoutEngine.test.ts
    treeMutations.ts                   # addShelf / addDivider / deleteBoard / setNodeSize / setSplitRatio / unlockNode
    treeMutations.test.ts
    cutList.ts                         # computeCutList → CutListEntry[]
    cutList.test.ts
  store/
    store.ts                           # Zustand store with zundo + persist
  utils/
    exportSVG.ts                       # cloneSvg → stripped SVG → download
  components/
    ProjectTabs/
      ProjectTabs.tsx
      ProjectTabs.test.tsx
    Toolbar/
      Toolbar.tsx
      Toolbar.test.tsx
    CabinetCanvas/
      CabinetCanvas.tsx                # SVG root, zoom/pan, memoised layout
      CanvasLayers.tsx                 # all SVG layers: panels, voids, dividers, accessories
      DimensionLabels.tsx              # SVG text labels (editable axis only)
      DragHandles.tsx                  # pointer-drag handles + snap guides
    DimensionEditor/
      DimensionEditor.tsx              # Portal-based floating input
    Sidebar/
      Sidebar.tsx                      # all sidebar sections inline (no sub-panel files)
    CutListPanel/
      CutListPanel.tsx
    WarningBanner/
      WarningBanner.tsx
  App.tsx
  main.tsx
  test/
    e2e.test.tsx                       # End-to-end integration test
```

---
### Task 1: Project Scaffold

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `tailwind.config.ts`, `postcss.config.js`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css`

- [ ] **Step 1: Scaffold Vite project**

```bash
cd /path/to/worktree   # the implementation worktree (not the spec worktree)
npm create vite@latest . -- --template react-ts
npm install
```

Expected: `node_modules/` populated, `npm run dev` starts dev server.

- [ ] **Step 2: Install dependencies**

```bash
npm install zustand immer zundo
npm install -D tailwindcss postcss autoprefixer @tailwindcss/forms
npm install -D vitest @vitest/ui jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom
npx tailwindcss init -p
```

- [ ] **Step 3: Configure Tailwind**

Replace `tailwind.config.ts`:

```ts
import type { Config } from 'tailwindcss'
import forms from '@tailwindcss/forms'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: '#1e1e2e',
        panel:   '#2a2a3e',
        accent:  '#7c3aed',
      },
    },
  },
  plugins: [forms],
} satisfies Config
```

Replace `src/index.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 4: Configure Vitest**

In `vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
```

Create `src/test/setup.ts`:

```ts
import '@testing-library/jest-dom'
```

- [ ] **Step 5: Minimal App shell**

Replace `src/App.tsx`:

```tsx
export default function App() {
  return <div className="min-h-screen bg-surface text-white">BuildBox</div>
}
```

Replace `src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 6: Smoke test**

```bash
npm run build
```

Expected: build succeeds with no errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: project scaffold – Vite + React + TS + Tailwind + Vitest

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: Types

**Files:**
- Create: `src/types/index.ts`

All dimensions are stored in **millimetres** internally.

- [ ] **Step 1: Write types**

```ts
// src/types/index.ts

export type Unit = 'mm' | 'cm' | 'in'
export type SplitAxis = 'horizontal' | 'vertical'
export type MaterialId = 'oak' | 'walnut' | 'white' | 'birch' | 'mdf'
export type ElementType = 'void' | 'drawer' | 'hanging-space'
export type SlideType = 'side-mount' | 'undermount'
export type AccessoryType = 'hanging-rail'

export interface ToeKick {
  height: number   // mm
  setback: number  // mm
}

export interface DrawerConfig {
  slideType: SlideType
  reveal: number   // mm gap between drawer faces
}

export interface GlobalSettings {
  unit: Unit
  height: number        // mm  external
  width: number         // mm  external
  depth: number         // mm  external
  thickness: number     // mm  material thickness
  backThickness: number // mm  back panel thickness (default 6)
  toeKick: ToeKick | null
  defaultMaterial: MaterialId
}

export interface Accessory {
  id: string          // nanoid()
  type: AccessoryType
  heightFromBottom: number  // mm from bottom of void
}

export interface Divider {
  id: string
  materialId: MaterialId
}

export interface CabinetNode {
  id: string
  splitAxis?: SplitAxis          // undefined → leaf (void)
  splitRatio?: number            // 0–1, default 0.5; used for proportional drag
  children?: [CabinetNode, CabinetNode]  // binary split — TypeScript enforces exactly 2
  fixedSize?: number             // mm; set by user typing
  locked?: boolean               // true → engine never adjusts fixedSize
  material?: MaterialId          // overrides globalSettings.defaultMaterial
  elementType?: ElementType      // leaf annotation (default: 'void')
  drawerConfig?: DrawerConfig    // only when elementType === 'drawer'
  dividers?: Divider[]           // one per binary split, carries its own id and materialId
  // NOTE: accessories?: Accessory[] is added in Task 17 (self-contained accessory task)
}

export interface Design {
  id: string
  name: string
  globalSettings: GlobalSettings
  root: CabinetNode
}

// --- Layout types (output of computeLayout) ---

export interface LayoutPanel {
  id: string
  role: 'top' | 'bottom' | 'left' | 'right' | 'shelf' | 'divider' | 'toe-kick-board'
  x: number; y: number; w: number; h: number   // SVG coords in mm
  material: MaterialId
}

export interface LayoutVoid {
  nodeId: string
  x: number; y: number; w: number; h: number
  parentSplitAxis?: SplitAxis
  elementType: ElementType
  drawerConfig?: DrawerConfig
  material: MaterialId
  accessories: Accessory[]
}

export interface LayoutDivider {
  nodeId: string          // synthesised ID for the divider rect
  childAId: string        // actual CabinetNode ID of child A
  childBId: string        // actual CabinetNode ID of child B
  x: number; y: number; w: number; h: number
  axis: SplitAxis         // which axis this divider cuts
  material: MaterialId
  dividerId?: string      // from CabinetNode.dividers[n].id
}

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
  width: number    // mm
  height: number   // mm
  depth: number    // mm
  material: MaterialId
  notes?: string
}

// --- Store slice shapes ---

export interface UIState {
  selectedId: string | null
  snapGrid: number          // mm; 0 = off
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add shared types (MaterialId, ElementType, splitRatio, backThickness, Divider, Accessory, LayoutDivider childAId/childBId)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: Unit Conversion Engine

**Files:**
- Create: `src/engine/unitConversion.ts`
- Create: `src/engine/unitConversion.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/engine/unitConversion.test.ts
import { describe, it, expect } from 'vitest'
import { toMm, fromMm, formatDisplay } from './unitConversion'

describe('toMm', () => {
  it('converts mm → mm', () => expect(toMm(100, 'mm')).toBe(100))
  it('converts cm → mm', () => expect(toMm(10, 'cm')).toBe(100))
  it('converts in → mm', () => expect(toMm(1, 'in')).toBeCloseTo(25.4))
})

describe('fromMm', () => {
  it('mm → mm', () => expect(fromMm(100, 'mm')).toBe(100))
  it('mm → cm', () => expect(fromMm(100, 'cm')).toBe(10))
  it('mm → in', () => expect(fromMm(25.4, 'in')).toBeCloseTo(1))
})

describe('formatDisplay', () => {
  it('formats mm', () => expect(formatDisplay(100, 'mm')).toBe('100 mm'))
  it('formats cm to 1dp', () => expect(formatDisplay(105, 'cm')).toBe('10.5 cm'))
  it('formats whole inches', () => expect(formatDisplay(25.4, 'in')).toBe('1"'))
  it('formats fractional inches with GCD reduction', () =>
    expect(formatDisplay(38.1, 'in')).toBe('1 1/2"'))
  it('formats fractional inches 7/8', () =>
    expect(formatDisplay(47.625, 'in')).toBe('1 7/8"'))
  it('formats fractional inches 7/16', () =>
    expect(formatDisplay(11.1125, 'in')).toBe('7/16"'))
  it('formats mixed inches', () => expect(formatDisplay(25.4 * 2.25, 'in')).toBe('2 1/4"'))
})
```

- [ ] **Step 2: Run – expect FAIL**

```bash
npx vitest run src/engine/unitConversion.test.ts
```

Expected: `Cannot find module './unitConversion'`

- [ ] **Step 3: Implement**

```ts
// src/engine/unitConversion.ts
import type { Unit } from '../types'

const MM_PER_INCH = 25.4

export function toMm(value: number, unit: Unit): number {
  if (unit === 'cm') return value * 10
  if (unit === 'in') return value * MM_PER_INCH
  return value
}

export function fromMm(mm: number, unit: Unit): number {
  if (unit === 'cm') return mm / 10
  if (unit === 'in') return mm / MM_PER_INCH
  return mm
}

export function formatDisplay(mm: number, unit: Unit): string {
  if (unit === 'mm') return `${Math.round(mm)} mm`
  if (unit === 'cm') return `${(mm / 10).toFixed(1)} cm`
  return formatInches(mm / MM_PER_INCH)
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

function formatInches(inches: number): string {
  const whole = Math.floor(inches)
  const sixteenths = Math.round((inches - whole) * 16)
  if (sixteenths === 0) return `${whole}"`
  if (sixteenths === 16) return `${whole + 1}"`
  const g = gcd(sixteenths, 16)
  const num = sixteenths / g
  const den = 16 / g
  const prefix = whole > 0 ? `${whole} ` : ''
  return `${prefix}${num}/${den}"`
}
```

- [ ] **Step 4: Run – expect PASS**

```bash
npx vitest run src/engine/unitConversion.test.ts
```

Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/engine/unitConversion.ts src/engine/unitConversion.test.ts
git commit -m "feat: unit conversion engine (mm/cm/in, fractional inch display)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---
### Task 4: Layout Engine

**Files:**
- Create: `src/engine/layoutEngine.ts`
- Create: `src/engine/layoutEngine.test.ts`

The engine takes a `Design` and returns a flat `LayoutResult`. It never mutates the tree.

**Distribution rules for `fixedSize` and `locked`:**
- `locked: true` → node always gets exactly `fixedSize` mm
- `fixedSize` set but `locked: false` → node participates in proportional scaling when the cabinet resizes; its effective size scales relative to other such nodes
- No `fixedSize` → free node; gets equal share of remaining space after locked nodes are satisfied
- When sum of locked sizes exceeds available space, all locked nodes are marked as `overConstrained`

- [ ] **Step 1: Write failing tests**

```ts
// src/engine/layoutEngine.test.ts
import { describe, it, expect } from 'vitest'
import { computeLayout } from './layoutEngine'
import type { Design, CabinetNode } from '../types'

function makeDesign(root: CabinetNode): Design {
  return {
    id: 'd1',
    name: 'Test',
    root,
    globalSettings: {
      unit: 'mm', height: 800, width: 600, depth: 500,
      thickness: 18, backThickness: 6, toeKick: null, defaultMaterial: 'oak',
    },
  }
}

describe('computeLayout – bare cabinet (no splits)', () => {
  it('produces 4 outer panels', () => {
    const result = computeLayout(makeDesign({ id: 'root' }))
    const roles = result.panels.map(p => p.role)
    expect(roles).toContain('top')
    expect(roles).toContain('bottom')
    expect(roles).toContain('left')
    expect(roles).toContain('right')
  })

  it('produces 1 void spanning inner dimensions', () => {
    const result = computeLayout(makeDesign({ id: 'root' }))
    expect(result.voids).toHaveLength(1)
    const v = result.voids[0]
    // inner width = 600 - 2*18 = 564; inner height = 800 - 2*18 = 764
    expect(v.w).toBe(564)
    expect(v.h).toBe(764)
  })
})

describe('computeLayout – one shelf', () => {
  const root: CabinetNode = {
    id: 'root',
    splitAxis: 'horizontal',
    children: [
      { id: 'top-void' },
      { id: 'bot-void' },
    ],
  }

  it('produces 2 voids of equal height after accounting for shelf thickness', () => {
    const result = computeLayout(makeDesign(root))
    expect(result.voids).toHaveLength(2)
    // inner height = 764, minus shelf 18mm = 746, split = 373 each
    result.voids.forEach(v => expect(v.h).toBe(373))
  })

  it('produces 1 shelf divider', () => {
    const result = computeLayout(makeDesign(root))
    const shelves = result.dividers.filter(d => d.axis === 'horizontal')
    expect(shelves).toHaveLength(1)
    expect(shelves[0].h).toBe(18)
  })
})

describe('computeLayout – locked void', () => {
  const root: CabinetNode = {
    id: 'root',
    splitAxis: 'horizontal',
    children: [
      { id: 'top-void', fixedSize: 200, locked: true },
      { id: 'bot-void' },
    ],
  }

  it('top void gets exactly 200mm, bottom absorbs the rest', () => {
    const result = computeLayout(makeDesign(root))
    const top = result.voids.find(v => v.nodeId === 'top-void')!
    const bot = result.voids.find(v => v.nodeId === 'bot-void')!
    expect(top.h).toBe(200)
    // 764 - 18 (shelf) - 200 = 546
    expect(bot.h).toBe(546)
  })
})

describe('computeLayout – over-constrained', () => {
  const root: CabinetNode = {
    id: 'root',
    splitAxis: 'horizontal',
    children: [
      { id: 'a', fixedSize: 500, locked: true },
      { id: 'b', fixedSize: 400, locked: true },
    ],
  }

  it('marks both nodes as overConstrained when sizes exceed available space', () => {
    const result = computeLayout(makeDesign(root))
    expect(result.overConstrainedIds).toContain('a')
    expect(result.overConstrainedIds).toContain('b')
  })
})

describe('computeLayout – toe-kick', () => {
  it('subtracts toe-kick height from inner height and adds toe-kick panel', () => {
    const design = makeDesign({ id: 'root' })
    design.globalSettings.toeKick = { height: 100, setback: 20 }
    const result = computeLayout(design)
    const tk = result.panels.find(p => p.role === 'toe-kick-board')
    expect(tk).toBeDefined()
    expect(tk!.h).toBe(100)
    // single void height = 764 - 100 = 664
    expect(result.voids[0].h).toBe(664)
  })
})
```

- [ ] **Step 2: Run – expect FAIL**

```bash
npx vitest run src/engine/layoutEngine.test.ts
```

Expected: `Cannot find module './layoutEngine'`

- [ ] **Step 3: Implement**

```ts
// src/engine/layoutEngine.ts
import type {
  Design, CabinetNode, LayoutResult, LayoutPanel, LayoutVoid,
  LayoutDivider, MaterialId, SplitAxis,
} from '../types'

const MIN_SECTION_SIZE = 50

export function computeLayout(design: Design): LayoutResult {
  const { globalSettings: gs, root } = design
  const t = gs.thickness
  const toeKickHeight = gs.toeKick?.height ?? 0

  const panels: LayoutPanel[] = buildOuterPanels(gs)
  const overConstrainedIds: string[] = []
  const voids: LayoutVoid[] = []
  const dividers: LayoutDivider[] = []

  const innerX = t
  const innerY = t
  const innerW = gs.width - 2 * t
  const innerH = gs.height - 2 * t - toeKickHeight

  if (gs.toeKick) {
    panels.push({
      id: 'toe-kick-board',
      role: 'toe-kick-board',
      x: gs.toeKick.setback,
      y: gs.height - t - toeKickHeight,
      w: gs.width - 2 * gs.toeKick.setback,
      h: toeKickHeight,
      material: gs.defaultMaterial,
    })
  }

  layoutNode(root, innerX, innerY, innerW, innerH, gs.defaultMaterial, undefined)

  return { panels, voids, dividers, overConstrainedIds }

  function layoutNode(
    node: CabinetNode,
    x: number, y: number, w: number, h: number,
    inheritedMaterial: MaterialId,
    parentSplitAxis: SplitAxis | undefined,
  ) {
    const material = node.material ?? inheritedMaterial

    if (!node.splitAxis || !node.children) {
      voids.push({
        nodeId: node.id, x, y, w, h,
        parentSplitAxis,
        elementType: node.elementType ?? 'void',
        drawerConfig: node.drawerConfig,
        material,
        accessories: node.accessories ?? [],
      })
      return
    }

    const axis = node.splitAxis
    const t2 = design.globalSettings.thickness
    const available = axis === 'horizontal' ? h - t2 : w - t2

    const [childA, childB] = node.children
    const [sizeA, sizeB, overConstrained] = distributeTwo(childA, childB, available, node)

    if (overConstrained) {
      overConstrainedIds.push(childA.id, childB.id)
    }

    if (axis === 'horizontal') {
      // childA is top void, then shelf, then childB bottom void
      layoutNode(childA, x, y, w, sizeA, material, axis)
      const shelfY = y + sizeA
      dividers.push({
        nodeId: childA.id + '-shelf',
        childAId: childA.id,
        childBId: childB.id,
        x, y: shelfY, w, h: t2,
        axis,
        material,
      })
      layoutNode(childB, x, shelfY + t2, w, sizeB, material, axis)
    } else {
      // childA is left void, then divider, then childB right void
      layoutNode(childA, x, y, sizeA, h, material, axis)
      const divX = x + sizeA
      dividers.push({
        nodeId: childA.id + '-divider',
        childAId: childA.id,
        childBId: childB.id,
        x: divX, y, w: t2, h,
        axis,
        material,
      })
      layoutNode(childB, divX + t2, y, sizeB, h, material, axis)
    }
  }
}

function distributeTwo(
  a: CabinetNode,
  b: CabinetNode,
  available: number,
  parent?: CabinetNode,
): [number, number, boolean] {
  const lockedA = a.locked && a.fixedSize != null
  const lockedB = b.locked && b.fixedSize != null

  if (lockedA && lockedB) {
    const total = a.fixedSize! + b.fixedSize!
    if (total > available) {
      const scale = available / total
      return [a.fixedSize! * scale, b.fixedSize! * scale, true]
    }
    return [a.fixedSize!, b.fixedSize!, false]
  }

  if (lockedA) {
    const remaining = available - a.fixedSize!
    return [a.fixedSize!, Math.max(remaining, MIN_SECTION_SIZE), false]
  }

  if (lockedB) {
    const remaining = available - b.fixedSize!
    return [Math.max(remaining, MIN_SECTION_SIZE), b.fixedSize!, false]
  }

  // Use splitRatio if parent has one set (from drag)
  if (parent?.splitRatio != null) {
    const sizeA = Math.round(available * parent.splitRatio)
    return [sizeA, available - sizeA, false]
  }

  const half = Math.floor(available / 2)
  return [half, available - half, false]
}

function buildOuterPanels(gs: { width: number; height: number; thickness: number; defaultMaterial: MaterialId }): LayoutPanel[] {
  const t = gs.thickness
  return [
    { id: 'top',    role: 'top',    x: 0,            y: 0,              w: gs.width, h: t,        material: gs.defaultMaterial },
    { id: 'bottom', role: 'bottom', x: 0,            y: gs.height - t,  w: gs.width, h: t,        material: gs.defaultMaterial },
    { id: 'left',   role: 'left',   x: 0,            y: t,              w: t,        h: gs.height - 2 * t, material: gs.defaultMaterial },
    { id: 'right',  role: 'right',  x: gs.width - t, y: t,              w: t,        h: gs.height - 2 * t, material: gs.defaultMaterial },
  ]
}
```

- [ ] **Step 4: Run – expect PASS**

```bash
npx vitest run src/engine/layoutEngine.test.ts
```

Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/engine/layoutEngine.ts src/engine/layoutEngine.test.ts
git commit -m "feat: layout engine – computeLayout with locking, toe-kick, over-constraint

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---
### Task 5: Tree Mutations Engine

**Files:**
- Create: `src/engine/treeMutations.ts`
- Create: `src/engine/treeMutations.test.ts`

All functions return a **new** root `CabinetNode` (immutable). They never mutate in-place.

- [ ] **Step 1: Write failing tests**

```ts
// src/engine/treeMutations.test.ts
import { describe, it, expect } from 'vitest'
import { addShelf, addDivider, deleteBoard, setNodeSize, setSplitRatio, setLocked, setMaterial, unlockNode } from './treeMutations'
import type { CabinetNode } from '../types'

const leaf = (): CabinetNode => ({ id: 'root' })

describe('addShelf', () => {
  it('splits a leaf node horizontally into 2 equal children', () => {
    const next = addShelf(leaf(), 'root')
    expect(next.splitAxis).toBe('horizontal')
    expect(next.children).toHaveLength(2)
    expect(next.children![0].splitAxis).toBeUndefined()
    expect(next.children![1].splitAxis).toBeUndefined()
  })

  it('splits a nested void by id', () => {
    const root: CabinetNode = {
      id: 'root',
      splitAxis: 'horizontal',
      children: [{ id: 'top' }, { id: 'bot' }],
    }
    const next = addShelf(root, 'top')
    expect(next.children![0].splitAxis).toBe('horizontal')
    expect(next.children![0].children).toHaveLength(2)
  })

  it('throws when id not found', () => {
    expect(() => addShelf(leaf(), 'missing')).toThrow()
  })
})

describe('addDivider', () => {
  it('splits a leaf node vertically', () => {
    const next = addDivider(leaf(), 'root')
    expect(next.splitAxis).toBe('vertical')
  })
})

describe('deleteBoard', () => {
  it('returns a fresh void with parent id', () => {
    const root: CabinetNode = {
      id: 'root',
      splitAxis: 'horizontal',
      children: [{ id: 'a' }, { id: 'b' }],
    }
    const next = deleteBoard(root, 'a')
    expect(next.splitAxis).toBeUndefined()
    expect(next.children).toBeUndefined()
    expect(next.elementType).toBe('void')
    expect(next.locked).toBeFalsy()
    expect(next.fixedSize).toBeUndefined()
  })

  it('throws when trying to delete root itself', () => {
    expect(() => deleteBoard(leaf(), 'root')).toThrow()
  })
})

describe('setNodeSize', () => {
  it('sets fixedSize and locked: true on the target node', () => {
    const root: CabinetNode = {
      id: 'root',
      splitAxis: 'horizontal',
      children: [{ id: 'a' }, { id: 'b' }],
    }
    const next = setNodeSize(root, 'a', 200)
    expect(next.children![0].fixedSize).toBe(200)
    expect(next.children![0].locked).toBe(true)
  })
})

describe('unlockNode', () => {
  it('clears locked and fixedSize on the target node', () => {
    const root: CabinetNode = {
      id: 'root',
      splitAxis: 'horizontal',
      children: [{ id: 'a', fixedSize: 200, locked: true }, { id: 'b' }],
    }
    const next = unlockNode(root, 'a')
    expect(next.children![0].locked).toBe(false)
    expect(next.children![0].fixedSize).toBeUndefined()
  })
})

describe('splitNode guards', () => {
  it('throws when splitting a drawer node', () => {
    const root: CabinetNode = { id: 'root', elementType: 'drawer' }
    expect(() => addShelf(root, 'root')).toThrow('Cannot split a drawer void')
  })
})
```

- [ ] **Step 2: Run – expect FAIL**

```bash
npx vitest run src/engine/treeMutations.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/engine/treeMutations.ts
import type { CabinetNode, MaterialId, SplitAxis, ElementType, DrawerConfig } from '../types'
import { nanoid } from 'nanoid'

export function addShelf(root: CabinetNode, targetId: string): CabinetNode {
  return splitNode(root, targetId, 'horizontal')
}

export function deleteBoard(root: CabinetNode, childId: string): CabinetNode {
  if (root.id === childId) throw new Error('Cannot delete root node')
  return mapNode(root, node => {
    if (!node.children) return node
    const hasChild = node.children.some(c => c.id === childId)
    if (!hasChild) return node
    // Collapse the parent back to a fresh void
    return { id: node.id, elementType: 'void' as ElementType }
  })
}

export function setNodeSize(root: CabinetNode, targetId: string, size: number): CabinetNode {
  return mapNode(root, (node) => {
    if (node.id !== targetId) return node
    // Lock this node; unlock its sibling (per spec §4.3)
    return { ...node, fixedSize: size, locked: true }
  })
}

export function unlockNode(root: CabinetNode, targetId: string): CabinetNode {
  return mapNode(root, node =>
    node.id === targetId ? { ...node, locked: false, fixedSize: undefined } : node,
  )
}

export function setLocked(root: CabinetNode, targetId: string, locked: boolean): CabinetNode {
  return mapNode(root, node => node.id === targetId ? { ...node, locked } : node)
}

export function setMaterial(root: CabinetNode, targetId: string, material: MaterialId): CabinetNode {
  return mapNode(root, node => node.id === targetId ? { ...node, material } : node)
}

export function setSplitRatio(root: CabinetNode, nodeId: string, ratio: number): CabinetNode {
  return mapNode(root, node => node.id === nodeId ? { ...node, splitRatio: ratio } : node)
}

export function setElementType(root: CabinetNode, id: string, et: ElementType): CabinetNode {
  return mapNode(root, (n) => n.id === id ? { ...n, elementType: et } : n)
}

export function setDrawerConfig(root: CabinetNode, id: string, cfg: DrawerConfig): CabinetNode {
  return mapNode(root, (n) => n.id === id ? { ...n, drawerConfig: cfg } : n)
}

// --- helpers ---

function mapNode(node: CabinetNode, fn: (n: CabinetNode) => CabinetNode): CabinetNode {
  const mapped = fn(node)
  if (!mapped.children) return mapped
  return { ...mapped, children: mapped.children.map(c => mapNode(c, fn)) }
}

export function findNode(root: CabinetNode, id: string): CabinetNode | null {
  if (root.id === id) return root
  if (!root.children) return null
  for (const child of root.children) {
    const found = findNode(child, id)
    if (found) return found
  }
  return null
}

export const MAX_TREE_DEPTH = 12

function treeDepth(root: CabinetNode, targetId: string, depth = 0): number {
  if (root.id === targetId) return depth
  if (!root.children) return -1
  for (const child of root.children) {
    const d = treeDepth(child, targetId, depth + 1)
    if (d !== -1) return d
  }
  return -1
}

function splitNode(root: CabinetNode, targetId: string, axis: SplitAxis): CabinetNode {
  return mapNode(root, node => {
    if (node.id !== targetId) return node
    if (node.splitAxis) throw new Error(`Node ${targetId} is already split`)
    if (node.elementType === 'drawer') throw new Error('Cannot split a drawer void')
    const depth = treeDepth(root, targetId)
    if (depth >= MAX_TREE_DEPTH) throw new Error('Max tree depth reached')
    return {
      ...node,
      splitAxis: axis,
      children: [
        { id: nanoid(8), elementType: 'void' as ElementType },
        { id: nanoid(8), elementType: 'void' as ElementType },
      ] as [CabinetNode, CabinetNode],
    }
  })
}

// NOTE: addAccessory / removeAccessory are added in Task 17 (self-contained accessory task)
```

Install nanoid:

```bash
npm install nanoid
```

- [ ] **Step 4: Run – expect PASS**

```bash
npx vitest run src/engine/treeMutations.test.ts
```

Expected: all 11 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/engine/treeMutations.ts src/engine/treeMutations.test.ts package.json package-lock.json
git commit -m "feat: tree mutations engine (addShelf/addDivider/deleteBoard/setNodeSize/setSplitRatio/unlockNode/findNode)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 6: Zustand Store

**Files:**
- Create: `src/store/store.ts`

- [ ] **Step 1: Write the store**

```ts
// src/store/store.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { temporal } from 'zundo'
import { nanoid } from 'nanoid'
import type { Design, GlobalSettings, MaterialId, DrawerConfig, UIState, ElementType } from '../types'
import { addShelf, addDivider, deleteBoard, setNodeSize, setLocked, setMaterial, setSplitRatio, unlockNode, setElementType as treeMutSetElementType, setDrawerConfig as treeMutSetDrawerConfig } from '../engine/treeMutations'

interface PersistedState {
  projects: Design[]
  activeProjectId: string | null
}

interface StoreState extends PersistedState, UIState {
  // project management
  createProject: () => void
  deleteProject: (id: string) => void
  renameProject: (id: string, name: string) => void
  setActiveProject: (id: string) => void

  // global settings
  updateSettings: (patch: Partial<GlobalSettings>) => void

  // tree mutations
  addShelf: (nodeId: string) => void
  addDivider: (nodeId: string) => void
  deleteBoard: (nodeId: string) => void
  setNodeSize: (nodeId: string, sizeMm: number) => void
  unlockNode: (nodeId: string) => void
  setLocked: (nodeId: string, locked: boolean) => void
  setMaterial: (nodeId: string, material: MaterialId) => void
  setElementType: (nodeId: string, et: ElementType) => void
  setDrawerConfig: (nodeId: string, config: DrawerConfig) => void
  commitDrag: (parentNodeId: string, ratio: number) => void
  // NOTE: addAccessory / removeAccessory added in Task 17

  // UI (not persisted)
  setSelectedId: (id: string | null) => void
  setSnapGrid: (mm: number) => void
}

function defaultDesign(): Design {
  return {
    id: nanoid(),
    name: 'Cabinet 1',
    root: { id: nanoid(8), elementType: 'void' },
    globalSettings: {
      unit: 'mm',
      height: 800,
      width: 600,
      depth: 500,
      thickness: 18,
      backThickness: 6,
      toeKick: null,
      defaultMaterial: 'oak',
    },
  }
}

function activeDesign(state: PersistedState): Design | undefined {
  return state.projects.find(p => p.id === state.activeProjectId)
}

function mutateRoot(state: PersistedState, fn: (d: Design) => Design): void {
  const idx = state.projects.findIndex(p => p.id === state.activeProjectId)
  if (idx === -1) return
  state.projects[idx] = fn(state.projects[idx])
}

const _initialDesign = defaultDesign()

export const useStore = create<StoreState>()(
  temporal(
    persist(
      immer((set) => ({
        projects: [_initialDesign],
        activeProjectId: _initialDesign.id,

        // UI state (not persisted, not in temporal history)
        selectedId: null,
        snapGrid: 5,

        createProject: () => set(s => {
          const d = defaultDesign()
          d.name = `Cabinet ${s.projects.length + 1}`
          s.projects.push(d)
          s.activeProjectId = d.id
        }),

        deleteProject: (id) => set(s => {
          s.projects = s.projects.filter(p => p.id !== id)
          if (s.activeProjectId === id) {
            s.activeProjectId = s.projects[0]?.id ?? null
          }
        }),

        renameProject: (id, name) => set(s => {
          const p = s.projects.find(p => p.id === id)
          if (p) p.name = name
        }),

        setActiveProject: (id) => set(s => { s.activeProjectId = id }),

        updateSettings: (patch) => set(s => {
          const d = activeDesign(s)
          if (d) Object.assign(d.globalSettings, patch)
        }),

        addShelf: (nodeId) => set(s => {
          mutateRoot(s, d => ({ ...d, root: addShelf(d.root, nodeId) }))
        }),

        addDivider: (nodeId) => set(s => {
          mutateRoot(s, d => ({ ...d, root: addDivider(d.root, nodeId) }))
        }),

        deleteBoard: (nodeId) => set(s => {
          mutateRoot(s, d => ({ ...d, root: deleteBoard(d.root, nodeId) }))
          s.selectedId = null
        }),

        setNodeSize: (nodeId, sizeMm) => set(s => {
          mutateRoot(s, d => ({ ...d, root: setNodeSize(d.root, nodeId, sizeMm) }))
        }),

        unlockNode: (nodeId) => set(s => {
          mutateRoot(s, d => ({ ...d, root: unlockNode(d.root, nodeId) }))
        }),

        setLocked: (nodeId, locked) => set(s => {
          mutateRoot(s, d => ({ ...d, root: setLocked(d.root, nodeId, locked) }))
        }),

        setMaterial: (nodeId, material) => set(s => {
          mutateRoot(s, d => ({ ...d, root: setMaterial(d.root, nodeId, material) }))
        }),

        setElementType: (nodeId, et) => set((s) => {
          mutateRoot(s, (d) => ({ ...d, root: treeMutSetElementType(d.root, nodeId, et) }))
        }),

        setDrawerConfig: (nodeId, config) => set((s) => {
          mutateRoot(s, (d) => ({ ...d, root: treeMutSetDrawerConfig(d.root, nodeId, config) }))
        }),

        // commitDrag: sets splitRatio on the parent node for proportional distribution
        commitDrag: (parentNodeId, ratio) => set(s => {
          mutateRoot(s, d => ({
            ...d,
            root: setSplitRatio(d.root, parentNodeId, ratio),
          }))
        }),

        setSelectedId: (id) => set(s => { s.selectedId = id }),
        setSnapGrid: (mm) => set(s => { s.snapGrid = mm }),

        // NOTE: addAccessory / removeAccessory added in Task 17
      })),
      {
        name: 'buildbox-store',
        partialize: (state) => ({
          projects: state.projects,
          activeProjectId: state.activeProjectId,
        }),
      },
    ),
  ),
)

// Access temporal state: useStore.temporal.getState() or useStore.temporal.subscribe(...)
// Example in components: const { undo, redo } = useStore.temporal.getState()
```

- [ ] **Step 2: Commit**

```bash
git add src/store/store.ts
git commit -m "feat: Zustand store with immer + zundo undo/redo + localStorage persist

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---
### Task 7: App Shell, ProjectTabs, Toolbar

**Files:**
- Modify: `src/App.tsx`
- Create: `src/components/ProjectTabs/ProjectTabs.tsx`
- Create: `src/components/ProjectTabs/ProjectTabs.test.tsx`
- Create: `src/components/Toolbar/Toolbar.tsx`
- Create: `src/components/Toolbar/Toolbar.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// src/components/ProjectTabs/ProjectTabs.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import ProjectTabs from './ProjectTabs'

const projects = [
  { id: 'p1', name: 'Cabinet 1' },
  { id: 'p2', name: 'Cabinet 2' },
]

describe('ProjectTabs', () => {
  it('renders all project names as tabs', () => {
    render(<ProjectTabs projects={projects} activeId="p1" onSelect={vi.fn()} onCreate={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByText('Cabinet 1')).toBeInTheDocument()
    expect(screen.getByText('Cabinet 2')).toBeInTheDocument()
  })

  it('calls onSelect when a tab is clicked', () => {
    const onSelect = vi.fn()
    render(<ProjectTabs projects={projects} activeId="p1" onSelect={onSelect} onCreate={vi.fn()} onDelete={vi.fn()} />)
    fireEvent.click(screen.getByText('Cabinet 2'))
    expect(onSelect).toHaveBeenCalledWith('p2')
  })

  it('calls onCreate when + button is clicked', () => {
    const onCreate = vi.fn()
    render(<ProjectTabs projects={projects} activeId="p1" onSelect={vi.fn()} onCreate={onCreate} onDelete={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /new project/i }))
    expect(onCreate).toHaveBeenCalled()
  })
})
```

```tsx
// src/components/Toolbar/Toolbar.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import Toolbar from './Toolbar'
import type { GlobalSettings } from '../../types'

const settings: GlobalSettings = {
  unit: 'mm', height: 800, width: 600, depth: 500,
  thickness: 18, toeKick: null, defaultMaterial: 'oak',
}

describe('Toolbar', () => {
  it('calls onSettingsChange with new unit when toggle clicked', () => {
    const onChange = vi.fn()
    render(<Toolbar settings={settings} onSettingsChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'cm' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ unit: 'cm' }))
  })
})
```

- [ ] **Step 2: Run – expect FAIL**

```bash
npx vitest run src/components/ProjectTabs/ProjectTabs.test.tsx src/components/Toolbar/Toolbar.test.tsx
```

- [ ] **Step 3: Implement ProjectTabs**

```tsx
// src/components/ProjectTabs/ProjectTabs.tsx
interface Props {
  projects: { id: string; name: string }[]
  activeId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
}

export default function ProjectTabs({ projects, activeId, onSelect, onCreate, onDelete }: Props) {
  return (
    <div className="flex items-center gap-1 px-2 py-1 bg-panel border-b border-white/10 overflow-x-auto">
      {projects.map(p => (
        <div
          key={p.id}
          className={`flex items-center gap-1 px-3 py-1 rounded-t text-sm cursor-pointer select-none
            ${p.id === activeId ? 'bg-surface text-white' : 'text-white/60 hover:text-white'}`}
        >
          <button onClick={() => onSelect(p.id)}>{p.name}</button>
          {projects.length > 1 && (
            <button
              onClick={() => onDelete(p.id)}
              className="ml-1 text-white/40 hover:text-red-400 text-xs"
              aria-label={`Delete ${p.name}`}
            >×</button>
          )}
        </div>
      ))}
      <button
        onClick={onCreate}
        aria-label="New project"
        className="px-2 py-1 text-white/60 hover:text-white text-lg leading-none"
      >+</button>
    </div>
  )
}
```

- [ ] **Step 4: Implement Toolbar**

```tsx
// src/components/Toolbar/Toolbar.tsx
import type { GlobalSettings, Unit } from '../../types'
import type { RefObject } from 'react'
import { fromMm, toMm } from '../../engine/unitConversion'
import { downloadSVG } from '../../utils/exportSVG'

interface Props {
  settings: GlobalSettings
  onSettingsChange: (patch: Partial<GlobalSettings>) => void
  svgRef: RefObject<SVGSVGElement>
  designName: string
}

const UNITS: Unit[] = ['mm', 'cm', 'in']

export default function Toolbar({ settings, onSettingsChange, svgRef, designName }: Props) {
  const u = settings.unit

  function numField(label: string, key: keyof GlobalSettings, htmlFor: string) {
    const displayVal = fromMm(settings[key] as number, u)
    return (
      <label htmlFor={htmlFor} className="flex items-center gap-1 text-sm text-white/80">
        {label}
        <input
          id={htmlFor}
          type="number"
          value={displayVal}
          onChange={e => onSettingsChange({ [key]: toMm(Number(e.target.value), u) })}
          className="w-20 bg-surface border border-white/20 rounded px-1 py-0.5 text-white text-right"
        />
      </label>
    )
  }

  return (
    <header className="flex items-center gap-4 px-4 py-2 bg-panel border-b border-white/10 flex-wrap">
      <span className="font-bold text-accent mr-2">BuildBox</span>

      <div className="flex rounded overflow-hidden border border-white/20">
        {UNITS.map(unit => (
          <button
            key={unit}
            onClick={() => onSettingsChange({ unit })}
            className={`px-2 py-1 text-sm ${settings.unit === unit ? 'bg-accent text-white' : 'text-white/60 hover:text-white'}`}
          >{unit}</button>
        ))}
      </div>

      {numField('Height', 'height', 'tb-height')}
      {numField('Width', 'width', 'tb-width')}
      {numField('Depth', 'depth', 'tb-depth')}
      {numField('Thickness', 'thickness', 'tb-thickness')}

      <button
        onClick={() => downloadSVG(svgRef, designName)}
        className="ml-auto px-3 py-1.5 bg-accent hover:bg-accent/80 text-white text-sm rounded"
      >
        Export SVG
      </button>
    </header>
  )
}
```

- [ ] **Step 5: Wire up App.tsx**

```tsx
// src/App.tsx
import { useStore } from './store/store'
import ProjectTabs from './components/ProjectTabs/ProjectTabs'
import Toolbar from './components/Toolbar/Toolbar'

export default function App() {
  const projects = useStore(s => s.projects)
  const activeProjectId = useStore(s => s.activeProjectId)
  const activeDesign = projects.find(p => p.id === activeProjectId) ?? projects[0]

  const createProject = useStore(s => s.createProject)
  const deleteProject = useStore(s => s.deleteProject)
  const setActiveProject = useStore(s => s.setActiveProject)
  const updateSettings = useStore(s => s.updateSettings)

  return (
    <div className="min-h-screen bg-surface text-white flex flex-col">
      <Toolbar settings={activeDesign.globalSettings} onSettingsChange={updateSettings} />
      <ProjectTabs
        projects={projects}
        activeId={activeProjectId}
        onSelect={setActiveProject}
        onCreate={createProject}
        onDelete={deleteProject}
      />
      <main className="flex flex-1 overflow-hidden">
        <div className="flex-1 flex items-center justify-center text-white/30 text-sm">
          Canvas coming in Task 8
        </div>
      </main>
    </div>
  )
}
```

- [ ] **Step 6: Run – expect PASS**

```bash
npx vitest run src/components/ProjectTabs/ProjectTabs.test.tsx src/components/Toolbar/Toolbar.test.tsx
```

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/components/
git commit -m "feat: App shell with ProjectTabs and Toolbar

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---
### Task 8: CabinetCanvas – SVG Root, Zoom/Pan, PanelLayer

**Files:**
- Create: `src/components/CabinetCanvas/CabinetCanvas.tsx`
- Create: `src/components/CabinetCanvas/PanelLayer.tsx`

The canvas uses a single SVG element. `computeLayout` is memoised and runs only when `root` or `globalSettings` changes.

- [ ] **Step 1a: Create `src/utils/materials.ts`**

Create material constants (needed by PanelLayer and other layers):

```ts
// src/utils/materials.ts
import type { MaterialId } from '../types'

export const MATERIALS: Record<MaterialId, { label: string; fill: string; stroke: string }> = {
  oak:    { label: 'Oak',    fill: '#C8A96E', stroke: '#8B6914' },
  walnut: { label: 'Walnut', fill: '#5C3D1E', stroke: '#3B2410' },
  white:  { label: 'White',  fill: '#F5F5F0', stroke: '#D0CEC8' },
  birch:  { label: 'Birch',  fill: '#E8D5A3', stroke: '#B09050' },
  mdf:    { label: 'MDF',    fill: '#D4C5A9', stroke: '#9E8E72' },
}
```

- [ ] **Step 1b: Run minimal import test**

```ts
// Quick inline test (can be skipped if using TypeScript compiler check):
// import { MATERIALS } from './materials'; expect(Object.keys(MATERIALS)).toContain('oak')
```

Run: `npx tsc --noEmit` to check types compile.

- [ ] **Step 1c: Commit `src/utils/materials.ts` separately**

```bash
git add src/utils/materials.ts
git commit -m "feat: materials constants (MaterialId, MATERIALS)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

- [ ] **Step 1: Implement CanvasLayers**

```tsx
// src/components/CabinetCanvas/CanvasLayers.tsx
import type { LayoutPanel, LayoutVoid, LayoutDivider } from '../../types'
import { MATERIALS } from '../../utils/materials'

interface Props {
  panels: LayoutPanel[]
  voids: LayoutVoid[]
  dividers: LayoutDivider[]
  selectedId: string | null
  onSelectVoid: (id: string) => void
  onSelectDivider: (id: string) => void
}

export default function CanvasLayers({ panels, voids, dividers, selectedId, onSelectVoid, onSelectDivider }: Props) {
  return (
    <>
      {/* Panels (outer frame + divider boards) */}
      <g data-layer="panels">
        {panels.map(p => (
          <rect
            key={p.id}
            x={p.x} y={p.y} width={p.w} height={p.h}
            fill={MATERIALS[p.material].fill}
            stroke={MATERIALS[p.material].stroke}
            strokeWidth={1}
          />
        ))}
      </g>

      {/* Voids */}
      <g data-layer="voids">
        {voids.map(v => (
          <rect
            key={v.nodeId}
            data-testid={`void-${v.nodeId}`}
            x={v.x} y={v.y} width={v.w} height={v.h}
            fill={v.nodeId === selectedId ? 'rgba(124,58,237,0.15)' : 'rgba(255,255,255,0.03)'}
            stroke={v.nodeId === selectedId ? '#7c3aed' : 'transparent'}
            strokeWidth={2}
            cursor="pointer"
            onClick={() => onSelectVoid(v.nodeId)}
          />
        ))}
      </g>

      {/* Dividers (selectable) */}
      <g data-layer="dividers">
        {dividers.map(d => (
          <rect
            key={d.nodeId}
            data-testid={`divider-${d.nodeId}`}
            x={d.x} y={d.y} width={d.w} height={d.h}
            fill={MATERIALS[d.material].fill}
            stroke={d.childAId === selectedId ? '#7c3aed' : MATERIALS[d.material].stroke}
            strokeWidth={d.childAId === selectedId ? 2 : 1}
            cursor="pointer"
            onClick={() => onSelectDivider(d.childAId)}
          />
        ))}
      </g>

      {/* Accessories */}
      <g data-layer="accessories">
        {voids.map(v => (
          <g key={v.nodeId}>
            {v.elementType === 'drawer' && (
              <g>
                <rect
                  x={v.x + 6} y={v.y + 6}
                  width={v.w - 12} height={v.h - 12}
                  fill="none" stroke="#7c3aed" strokeWidth={1.5} rx={2}
                />
                <circle cx={v.x + v.w / 2} cy={v.y + v.h / 2} r={4} fill="#7c3aed" />
              </g>
            )}
            {(v.accessories ?? [])
              .filter((a) => a.type === 'hanging-rail')
              .map((a) => {
                const railY = v.y + v.h - a.heightFromBottom
                return (
                  <line
                    key={a.id}
                    x1={v.x} y1={railY}
                    x2={v.x + v.w} y2={railY}
                    stroke="#666" strokeWidth={3} strokeDasharray="4 2"
                  />
                )
              })}
          </g>
        ))}
      </g>
    </>
  )
}
```

- [ ] **Step 2: Implement CabinetCanvas**

```tsx
// src/components/CabinetCanvas/CabinetCanvas.tsx
import { useMemo, useRef, useState, useCallback } from 'react'
import type { Design } from '../../types'
import { computeLayout } from '../../engine/layoutEngine'
import CanvasLayers from './CanvasLayers'
import { useStore } from '../../store/store'

interface Props { design: Design; svgRef: React.RefObject<SVGSVGElement> }

const PADDING = 40   // px around cabinet in SVG viewport

export default function CabinetCanvas({ design, svgRef }: Props) {
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const isPanning = useRef(false)
  const lastPan = useRef({ x: 0, y: 0 })
  const selectedId = useStore(s => s.selectedId)
  const setSelectedId = useStore(s => s.setSelectedId)

  const layout = useMemo(
    () => computeLayout(design),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [design.root, design.globalSettings],
  )

  const { width: cW, height: cH } = design.globalSettings
  const viewBox = `${-PADDING} ${-PADDING} ${cW + 2 * PADDING} ${cH + 2 * PADDING}`

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    setZoom(z => Math.min(5, Math.max(0.2, z * (e.deltaY < 0 ? 1.1 : 0.9))))
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 1 && !e.altKey) return
    isPanning.current = true
    lastPan.current = { x: e.clientX, y: e.clientY }
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPanning.current) return
    const dx = e.clientX - lastPan.current.x
    const dy = e.clientY - lastPan.current.y
    lastPan.current = { x: e.clientX, y: e.clientY }
    setPan(p => ({ x: p.x + dx, y: p.y + dy }))
  }, [])

  const onPointerUp = useCallback(() => { isPanning.current = false }, [])

  return (
    <div className="flex-1 overflow-hidden bg-surface flex items-center justify-center">
      <svg
        ref={svgRef}
        data-testid="cabinet-canvas"
        viewBox={viewBox}
        className="w-full h-full"
        style={{ touchAction: 'none' }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <g transform={`translate(${pan.x / zoom},${pan.y / zoom}) scale(${zoom})`}>
          <CanvasLayers
            panels={layout.panels}
            voids={layout.voids}
            dividers={layout.dividers}
            selectedId={selectedId}
            onSelectVoid={setSelectedId}
            onSelectDivider={setSelectedId}
          />
        </g>
      </svg>
    </div>
  )
}
```

- [ ] **Step 3: Wire CabinetCanvas into App**

In `src/App.tsx`, replace the placeholder `<main>` content:

```tsx
import CabinetCanvas from './components/CabinetCanvas/CabinetCanvas'
import { useRef } from 'react'

// In App body:
const svgRef = useRef<SVGSVGElement>(null)

// inside <main>:
<main className="flex flex-1 overflow-hidden">
  {activeDesign && <CabinetCanvas design={activeDesign} svgRef={svgRef} />}
</main>
```

- [ ] **Step 4: Visual smoke-check**

```bash
npm run dev
```

Open browser. Should see a cabinet frame rendered as 4 coloured rectangles on a dark background. Scroll to zoom, alt+drag to pan.

- [ ] **Step 5: Commit**

```bash
git add src/components/CabinetCanvas/ src/utils/materials.ts src/App.tsx
git commit -m "feat: CabinetCanvas SVG root with zoom/pan and CanvasLayers (panels, voids, dividers, accessories)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 9: CanvasLayers — Selection, Dividers, Accessories

**Decision D1:** All canvas layer components (`PanelLayer`, `VoidLayer`, `DividerLayer`, `AccessoryLayer`) are merged into the single `CanvasLayers.tsx` file created in Task 8. No separate files are needed.

This task adds `DimensionLabels` to the canvas and wires up selection-driven `DragHandles`.

**No additional step needed** — `CanvasLayers.tsx` already renders panels, voids, dividers, and accessories from `layout` and `selectedId` (implemented in Task 8).

- [ ] **Step 1: Verify CanvasLayers renders all layers**

Confirm `src/components/CabinetCanvas/CanvasLayers.tsx` (created in Task 8) renders:
- `data-layer="panels"` — outer frame rects
- `data-layer="voids"` — clickable void fills with selection highlight
- `data-layer="dividers"` — shelf/divider rects with material fills
- `data-layer="accessories"` — drawer faces + hanging rails (see Task 17 for rail data)

- [ ] **Step 2: Commit**

```bash
git add src/components/CabinetCanvas/
git commit -m "feat: CanvasLayers consolidates panels, voids, dividers, accessories (D1)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---
### Task 10: DimensionLabels + DimensionEditor

**Files:**
- Create: `src/components/CabinetCanvas/DimensionLabels.tsx`
- Create: `src/components/DimensionEditor/DimensionEditor.tsx`
- Create: `src/components/DimensionEditor/DimensionEditor.test.tsx`

Labels live inside the SVG. Clicking one opens a floating HTML input positioned via `getBoundingClientRect()` (React Portal to `document.body`). Only the editable axis for each void is active (determined by `parentSplitAxis`).

- [ ] **Step 1: Write failing tests**

```tsx
// src/components/DimensionEditor/DimensionEditor.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import DimensionEditor from './DimensionEditor'

const anchor = { x: 100, y: 200, width: 60, height: 22 }

describe('DimensionEditor', () => {
  it('renders input with current value', () => {
    render(
      <DimensionEditor
        anchor={anchor}
        currentMm={373}
        unit="mm"
        onCommit={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const input = screen.getByRole('spinbutton') as HTMLInputElement
    expect(input.value).toBe('373')
  })

  it('calls onCommit with new mm value when Enter pressed', () => {
    const onCommit = vi.fn()
    render(
      <DimensionEditor
        anchor={anchor}
        currentMm={373}
        unit="mm"
        onCommit={onCommit}
        onClose={vi.fn()}
      />,
    )
    const input = screen.getByRole('spinbutton')
    fireEvent.change(input, { target: { value: '200' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledWith(200)
  })

  it('calls onClose when Escape pressed', () => {
    const onClose = vi.fn()
    render(
      <DimensionEditor
        anchor={anchor}
        currentMm={373}
        unit="mm"
        onCommit={vi.fn()}
        onClose={onClose}
      />,
    )
    fireEvent.keyDown(screen.getByRole('spinbutton'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run – expect FAIL**

```bash
npx vitest run src/components/DimensionEditor/DimensionEditor.test.tsx
```

- [ ] **Step 3: Implement DimensionEditor**

```tsx
// src/components/DimensionEditor/DimensionEditor.tsx
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { fromMm, toMm } from '../../engine/unitConversion'
import type { Unit } from '../../types'

interface Anchor { x: number; y: number; width: number; height: number }

interface Props {
  anchor: Anchor
  currentMm: number
  unit: Unit
  onCommit: (mm: number) => void
  onClose: () => void
}

export default function DimensionEditor({ anchor, currentMm, unit, onCommit, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(String(Math.round(fromMm(currentMm, unit))))

  useEffect(() => { inputRef.current?.select() }, [])

  function commit() {
    const mm = toMm(Number(value), unit)
    if (!isNaN(mm) && mm > 0) onCommit(mm)
    else onClose()
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); commit() }
    if (e.key === 'Escape') onClose()
  }

  const style: React.CSSProperties = {
    position: 'fixed',
    left: anchor.x,
    top: anchor.y,
    width: Math.max(anchor.width, 80),
    zIndex: 9999,
  }

  return createPortal(
    <div style={style}>
      <input
        ref={inputRef}
        type="number"
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
        className="w-full bg-panel border border-accent rounded px-2 py-1 text-white text-sm text-center"
      />
    </div>,
    document.body,
  )
}
```

- [ ] **Step 4: Implement DimensionLabels**

```tsx
// src/components/CabinetCanvas/DimensionLabels.tsx
import { useState } from 'react'
import type { LayoutVoid } from '../../types'
import type { Unit } from '../../types'
import { formatDisplay } from '../../engine/unitConversion'
import DimensionEditor from '../DimensionEditor/DimensionEditor'

interface Props {
  voids: LayoutVoid[]
  unit: Unit
  svgRef: React.RefObject<SVGSVGElement>
  onCommitSize: (nodeId: string, mm: number, axis: 'w' | 'h') => void
  onUnlockNode?: (nodeId: string) => void
  lockedNodeIds?: string[]
}

interface Editing {
  nodeId: string
  axis: 'w' | 'h'
  currentMm: number
  anchor: { x: number; y: number; width: number; height: number }
}

export default function DimensionLabels({ voids, unit, svgRef, onCommitSize, onUnlockNode, lockedNodeIds = [] }: Props) {
  const [editing, setEditing] = useState<Editing | null>(null)

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
      {voids.map(v => {
        const canEditH = v.parentSplitAxis === 'horizontal'
        const canEditW = v.parentSplitAxis === 'vertical'

        return (
          <g key={v.nodeId}>
            {/* Width label – top edge centre */}
            <text
              x={v.x + v.w / 2} y={v.y + 14}
              textAnchor="middle" fontSize={11} fill="rgba(255,255,255,0.7)"
              cursor={canEditW ? 'pointer' : 'default'}
              onClick={canEditW ? (e) => openEditor(v, 'w', e.currentTarget as SVGTextElement) : undefined}
            >
              {formatDisplay(v.w, unit)}
            </text>

            {/* Height label – left edge centre, rotated */}
            <text
              x={v.x + 12} y={v.y + v.h / 2}
              textAnchor="middle" fontSize={11} fill="rgba(255,255,255,0.7)"
              transform={`rotate(-90, ${v.x + 12}, ${v.y + v.h / 2})`}
              cursor={canEditH ? 'pointer' : 'default'}
              onClick={canEditH ? (e) => openEditor(v, 'h', e.currentTarget as SVGTextElement) : undefined}
            >
              {formatDisplay(v.h, unit)}
            </text>

            {lockedNodeIds.includes(v.nodeId) && (
              <g
                transform={`translate(${v.x + v.w - 18}, ${v.y + 8})`}
                cursor={onUnlockNode ? 'pointer' : 'default'}
                onClick={() => onUnlockNode?.(v.nodeId)}
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
          onCommit={mm => { onCommitSize(editing.nodeId, mm, editing.axis); setEditing(null) }}
          onClose={() => setEditing(null)}
        />
      )}
    </g>
  )
}
```

- [ ] **Step 5: Add DimensionLabels to CabinetCanvas**

```tsx
// In CabinetCanvas.tsx, add:
import DimensionLabels from './DimensionLabels'

const storeSetNodeSize = useStore(s => s.setNodeSize)

function handleCommitSize(nodeId: string, mm: number, axis: 'w' | 'h') {
  // axis tells us whether height or width was edited; store action sets fixedSize + locked on the node
  storeSetNodeSize(nodeId, mm)
}

// Inside the <g transform=...>:
<DimensionLabels
  voids={layout.voids}
  unit={activeDesign.globalSettings.unit}
  svgRef={svgRef}
  onCommitSize={handleCommitSize}
/>
```

Note: `CabinetCanvas` receives `design` as a prop but also reads `useStore` for selected state. This is intentional: layout is derived from `design` prop (memo-safe), while selection and UI state come from the store directly.

- [ ] **Step 6: Run – expect PASS**

```bash
npx vitest run src/components/DimensionEditor/DimensionEditor.test.tsx
```

- [ ] **Step 7: Commit**

```bash
git add src/components/CabinetCanvas/DimensionLabels.tsx src/components/DimensionEditor/
git commit -m "feat: DimensionLabels + DimensionEditor portal for inline dimension editing

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---
### Task 11: DragHandles + SnapGuides

**Files:**
- Create: `src/components/CabinetCanvas/DragHandles.tsx`
- Modify: `src/components/CabinetCanvas/CabinetCanvas.tsx`

Drag handles sit on divider centre-lines. During drag, `useRef` tracks position — no store writes until `pointerup`. On commit, `commitDrag` stores a `splitRatio` on the parent so future layout remains proportional.

- [ ] **Step 1: Implement DragHandles**

```tsx
// src/components/CabinetCanvas/DragHandles.tsx
import { useRef, useCallback } from 'react'
import type { LayoutDivider, LayoutVoid } from '../../types'
import { useStore } from '../../store/store'

interface Props {
  dividers: LayoutDivider[]
  voids: LayoutVoid[]
  snapGrid: number
  svgRef: React.RefObject<SVGSVGElement>
}

export default function DragHandles({ dividers, voids, snapGrid, svgRef }: Props) {
  const commitDrag = useStore(s => s.commitDrag)
  const dragging = useRef<{
    dividerId: string
    axis: 'horizontal' | 'vertical'
    parentNodeId: string
    originClientPos: number
    originSizeA: number
    originSizeB: number
    handle: SVGRectElement
  } | null>(null)

  const svgToMmScale = useCallback((clientDelta: number): number => {
    if (!svgRef.current) return clientDelta
    const svgRect = svgRef.current.getBoundingClientRect()
    const viewBox = svgRef.current.viewBox.baseVal
    const scale = viewBox.width / svgRect.width
    return clientDelta * scale
  }, [svgRef])

  function snap(mm: number): number {
    if (snapGrid <= 0) return mm
    return Math.round(mm / snapGrid) * snapGrid
  }

  function onPointerDown(
    e: React.PointerEvent<SVGRectElement>,
    divider: LayoutDivider,
    adjacentVoid: LayoutVoid,
    mainVoid: LayoutVoid,
  ) {
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    dragging.current = {
      dividerId: divider.nodeId,
      axis: divider.axis,
      parentNodeId: divider.childAId,  // use childAId to find parent later
      originClientPos: divider.axis === 'horizontal' ? e.clientY : e.clientX,
      originSizeA: divider.axis === 'horizontal' ? mainVoid.h : mainVoid.w,
      originSizeB: divider.axis === 'horizontal' ? adjacentVoid.h : adjacentVoid.w,
      handle: e.currentTarget,
    }
  }

  function onPointerMove(e: React.PointerEvent<SVGRectElement>) {
    if (!dragging.current) return
    const { axis, originClientPos, originSizeA, originSizeB, handle } = dragging.current
    const clientDelta = (axis === 'horizontal' ? e.clientY : e.clientX) - originClientPos
    const mmDelta = svgToMmScale(clientDelta)
    const newSizeA = snap(Math.max(50, originSizeA + mmDelta))
    const newSizeB = Math.max(50, originSizeB - mmDelta)

    // Move handle visually without triggering re-render
    if (axis === 'horizontal') {
      handle.setAttribute('y', String(parseFloat(handle.getAttribute('y') ?? '0') + mmDelta))
    } else {
      handle.setAttribute('x', String(parseFloat(handle.getAttribute('x') ?? '0') + mmDelta))
    }
  }

  function onPointerUp(e: React.PointerEvent<SVGRectElement>) {
    if (!dragging.current) return
    const { axis, originClientPos, originSizeA, originSizeB, parentNodeId } = dragging.current
    const clientDelta = (axis === 'horizontal' ? e.clientY : e.clientX) - originClientPos
    const mmDelta = svgToMmScale(clientDelta)
    const finalSizeA = snap(Math.max(50, originSizeA + mmDelta))
    const finalSizeB = Math.max(50, originSizeB - mmDelta)
    const ratio = finalSizeA / (finalSizeA + finalSizeB)
    commitDrag(parentNodeId, ratio)
    dragging.current = null
  }

  return (
    <g data-layer="drag-handles">
      {dividers.map(d => {
        const isHoriz = d.axis === 'horizontal'
        // Find voids by childAId and childBId (actual node IDs from LayoutDivider)
        const mainVoid = voids.find(v => v.nodeId === d.childAId)
        const adjacentVoid = voids.find(v => v.nodeId === d.childBId)
        if (!mainVoid || !adjacentVoid) return null

        const hW = isHoriz ? d.w : 12
        const hH = isHoriz ? 12 : d.h
        const hX = isHoriz ? d.x : d.x + d.w / 2 - 6
        const hY = isHoriz ? d.y + d.h / 2 - 6 : d.y

        return (
          <rect
            key={d.nodeId + '-handle'}
            data-testid={`drag-handle-${d.nodeId}`}
            x={hX} y={hY} width={hW} height={hH}
            fill="rgba(124,58,237,0.3)"
            stroke="#7c3aed"
            strokeWidth={1}
            cursor={isHoriz ? 'ns-resize' : 'ew-resize'}
            rx={3}
            onPointerDown={e => onPointerDown(e, d, adjacentVoid, mainVoid)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />
        )
      })}
    </g>
  )
}
```

SnapGuides are simple SVG lines rendered during drag. Add a `<SnapGuide>` component inline:

```tsx
// At bottom of DragHandles.tsx:
export function SnapGuide({ x, y, axis }: { x: number; y: number; axis: 'horizontal' | 'vertical' }) {
  return axis === 'horizontal'
    ? <line x1={-1000} y1={y} x2={10000} y2={y} stroke="#7c3aed" strokeWidth={0.5} strokeDasharray="4 4" pointerEvents="none" />
    : <line x1={x} y1={-1000} x2={x} y2={10000} stroke="#7c3aed" strokeWidth={0.5} strokeDasharray="4 4" pointerEvents="none" />
}
```

- [ ] **Step 2: Add DragHandles to CabinetCanvas**

```tsx
// In CabinetCanvas.tsx
import DragHandles from './DragHandles'
const snapGrid = useStore(s => s.snapGrid)

// Inside the <g transform=...>, after AccessoryLayer:
<DragHandles
  dividers={layout.dividers}
  voids={layout.voids}
  snapGrid={snapGrid}
  svgRef={svgRef}
/>
```

- [ ] **Step 3: Commit**

```bash
git add src/components/CabinetCanvas/DragHandles.tsx src/components/CabinetCanvas/CabinetCanvas.tsx
git commit -m "feat: drag handles on dividers with snap-to-grid and commitDrag

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---
### Task 12: Sidebar Panels

**Files:**
- Create: `src/components/Sidebar/Sidebar.tsx`
- Create: `src/components/Sidebar/Sidebar.test.tsx`
- Modify: `src/App.tsx`

All sidebar sections (actions, material, element type, drawer config) are inline in a single `Sidebar.tsx` — no sub-panel files.

- [ ] **Step 1: Write failing tests**

```tsx
// src/components/Sidebar/Sidebar.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import Sidebar from './Sidebar'
import type { CabinetNode } from '../../types'

const baseProps = {
  selectedId: 'v1',
  selectedNode: { id: 'v1', elementType: 'void' } as CabinetNode,
  onAddShelf: vi.fn(),
  onAddDivider: vi.fn(),
  onDelete: vi.fn(),
  onToggleLock: vi.fn(),
  onSetMaterial: vi.fn(),
  onSetElementType: vi.fn(),
  onSetDrawerConfig: vi.fn(),
}

describe('Sidebar', () => {
  it('Add Shelf button calls onAddShelf', () => {
    const onAddShelf = vi.fn()
    render(<Sidebar {...baseProps} onAddShelf={onAddShelf} />)
    fireEvent.click(screen.getByRole('button', { name: /add shelf/i }))
    expect(onAddShelf).toHaveBeenCalledWith('v1')
  })

  it('Add Divider button calls onAddDivider', () => {
    const onAddDivider = vi.fn()
    render(<Sidebar {...baseProps} onAddDivider={onAddDivider} />)
    fireEvent.click(screen.getByRole('button', { name: /add divider/i }))
    expect(onAddDivider).toHaveBeenCalledWith('v1')
  })

  it('Delete button is disabled when no selection', () => {
    render(<Sidebar {...baseProps} selectedId={null} selectedNode={null} />)
    expect(screen.getByRole('button', { name: /delete/i })).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run – expect FAIL**

```bash
npx vitest run src/components/Sidebar/Sidebar.test.tsx
```

- [ ] **Step 3: Implement Sidebar**

```tsx
// src/components/Sidebar/Sidebar.tsx
import type { CabinetNode, ElementType, MaterialId, DrawerConfig, SlideType } from '../../types'
import { MATERIALS } from '../../utils/materials'

interface Props {
  selectedId: string | null
  selectedNode: CabinetNode | null
  onAddShelf: (id: string) => void
  onAddDivider: (id: string) => void
  onDelete: (id: string) => void
  onToggleLock: (id: string, locked: boolean) => void
  onSetMaterial: (id: string, mat: MaterialId) => void
  onSetElementType: (id: string, type: ElementType) => void
  onSetDrawerConfig: (id: string, config: DrawerConfig) => void
}

const ELEMENT_TYPES: ElementType[] = ['void', 'drawer', 'hanging-space']
const ELEMENT_TYPE_LABELS: Record<ElementType, string> = {
  void: 'Empty', drawer: 'Drawer', 'hanging-space': 'Hanging Space',
}

function Btn({ label, onClick, disabled = false }: { label: string; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full text-left px-3 py-2 rounded text-sm bg-panel hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
    >{label}</button>
  )
}

export default function Sidebar({
  selectedId, selectedNode, onAddShelf, onAddDivider, onDelete,
  onToggleLock, onSetMaterial, onSetElementType, onSetDrawerConfig,
}: Props) {
  const isVoid = !selectedNode?.splitAxis
  const isLocked = selectedNode?.locked ?? false

  return (
    <aside className="w-60 flex flex-col bg-panel border-l border-white/10 overflow-y-auto">
      {/* Actions */}
      <div className="flex flex-col gap-1 p-3">
        <p className="text-xs text-white/40 uppercase tracking-wide mb-1">Actions</p>
        <Btn label="Add Shelf" disabled={!selectedId || !isVoid} onClick={() => selectedId && onAddShelf(selectedId)} />
        <Btn label="Add Divider" disabled={!selectedId || !isVoid} onClick={() => selectedId && onAddDivider(selectedId)} />
        <Btn label="Delete" disabled={!selectedId} onClick={() => selectedId && onDelete(selectedId)} />
        {selectedId && (
          <Btn
            label={isLocked ? '🔒 Locked – click to unlock' : '🔓 Unlocked – click to lock'}
            onClick={() => selectedId && onToggleLock(selectedId, !isLocked)}
          />
        )}
      </div>

      {/* Material */}
      {selectedId && (
        <div className="p-3 border-t border-white/10">
          <p className="text-xs text-white/40 uppercase tracking-wide mb-2">Material</p>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(MATERIALS) as MaterialId[]).map(key => (
              <button
                key={key}
                title={MATERIALS[key].label}
                onClick={() => onSetMaterial(selectedId, key)}
                className={`w-8 h-8 rounded-full border-2 ${selectedNode?.material === key ? 'border-accent' : 'border-transparent'}`}
                style={{ backgroundColor: MATERIALS[key].fill }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Element Type */}
      {selectedId && (
        <div className="p-3 border-t border-white/10">
          <p className="text-xs text-white/40 uppercase tracking-wide mb-2">Element Type</p>
          <div className="flex flex-col gap-1">
            {ELEMENT_TYPES.map(t => (
              <button
                key={t}
                onClick={() => onSetElementType(selectedId, t)}
                className={`text-left px-3 py-1.5 rounded text-sm ${selectedNode?.elementType === t ? 'bg-accent text-white' : 'bg-panel hover:bg-white/10 text-white/70'}`}
              >{ELEMENT_TYPE_LABELS[t]}</button>
            ))}
          </div>
        </div>
      )}

      {/* Drawer Config */}
      {selectedId && selectedNode?.elementType === 'drawer' && selectedNode.drawerConfig && (
        <div className="p-3 border-t border-white/10">
          <p className="text-xs text-white/40 uppercase tracking-wide mb-2">Drawer Config</p>
          <label className="flex items-center gap-2 text-sm text-white/80 mb-2">
            Slide type
            <select
              value={selectedNode.drawerConfig.slideType}
              onChange={e => onSetDrawerConfig(selectedId, { ...selectedNode.drawerConfig!, slideType: e.target.value as SlideType })}
              className="bg-surface border border-white/20 rounded px-1 py-0.5 text-white text-sm"
            >
              <option value="side-mount">Side-mount</option>
              <option value="undermount">Undermount</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-white/80">
            Reveal (mm)
            <input
              type="number"
              value={selectedNode.drawerConfig.reveal}
              onChange={e => onSetDrawerConfig(selectedId, { ...selectedNode.drawerConfig!, reveal: Number(e.target.value) })}
              className="w-16 bg-surface border border-white/20 rounded px-1 py-0.5 text-white text-sm text-right"
            />
          </label>
        </div>
      )}
    </aside>
  )
}
```

- [ ] **Step 4: Wire Sidebar into App**

```tsx
// src/App.tsx — add Sidebar with selectedNode
import { useMemo } from 'react'
import Sidebar from './components/Sidebar/Sidebar'
import { findNode } from './engine/treeMutations'
import type { ElementType, MaterialId, DrawerConfig } from './types'

// In App component body:
const storeAddShelf = useStore(s => s.addShelf)
const storeAddDivider = useStore(s => s.addDivider)
const storeDeleteBoard = useStore(s => s.deleteBoard)
const storeLocked = useStore(s => s.setLocked)
const storeMaterial = useStore(s => s.setMaterial)
const storeDrawerConfig = useStore(s => s.setDrawerConfig)
const storeSetElementType = useStore(s => s.setElementType)
const selectedId = useStore(s => s.selectedId)

const selectedNode = useMemo(
  () => selectedId && activeDesign ? findNode(activeDesign.root, selectedId) ?? null : null,
  [selectedId, activeDesign],
)

// Inside <main>:
<main className="flex flex-1 overflow-hidden">
  {activeDesign && <CabinetCanvas design={activeDesign} svgRef={svgRef} />}
  <Sidebar
    selectedId={selectedId}
    selectedNode={selectedNode}
    onAddShelf={storeAddShelf}
    onAddDivider={storeAddDivider}
    onDelete={storeDeleteBoard}
    onToggleLock={storeLocked}
    onSetMaterial={storeMaterial}
    onSetElementType={storeSetElementType}
    onSetDrawerConfig={storeDrawerConfig}
  />
</main>
```

- [ ] **Step 5: Run – expect PASS**

```bash
npx vitest run src/components/Sidebar/Sidebar.test.tsx
```

- [ ] **Step 6: Commit**

```bash
git add src/components/Sidebar/ src/App.tsx
git commit -m "feat: Sidebar with all panels merged (actions, material, element type, drawer config)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---
### Task 13: CutList Engine + CutListPanel

**Files:**
- Create: `src/engine/cutList.ts`
- Create: `src/engine/cutList.test.ts`
- Create: `src/components/CutListPanel/CutListPanel.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write failing tests**

```ts
// src/engine/cutList.test.ts
import { describe, it, expect } from 'vitest'
import { computeCutList } from './cutList'
import type { Design } from '../types'

function bareDesign(): Design {
  return {
    id: 'd1', name: 'Test',
    root: { id: 'root' },
    globalSettings: {
      unit: 'mm', height: 800, width: 600, depth: 500,
      thickness: 18, backThickness: 6, toeKick: null, defaultMaterial: 'oak',
    },
  }
}

describe('computeCutList – bare cabinet', () => {
  it('produces 2 side panels, 1 top, 1 bottom', () => {
    const entries = computeCutList(bareDesign())
    const labels = entries.map(e => e.label)
    expect(labels).toContain('Top panel')
    expect(labels).toContain('Bottom panel')
    const sides = entries.filter(e => e.label === 'Side panel')
    expect(sides[0].qty).toBe(2)
  })

  it('side panels are height × depth', () => {
    const entries = computeCutList(bareDesign())
    const side = entries.find(e => e.label === 'Side panel')!
    expect(side.width).toBe(800)
    expect(side.height).toBe(500)
    expect(side.depth).toBe(18)
  })

  it('top/bottom panels are (width - 2×thickness) × depth', () => {
    const entries = computeCutList(bareDesign())
    const top = entries.find(e => e.label === 'Top panel')!
    // width = 600 - 2*18 = 564
    expect(top.width).toBe(564)
    expect(top.height).toBe(500)
  })
})

describe('computeCutList – with shelf', () => {
  it('adds 1 shelf entry', () => {
    const design = bareDesign()
    design.root = {
      id: 'root',
      splitAxis: 'horizontal',
      children: [{ id: 'a' }, { id: 'b' }],
    }
    const entries = computeCutList(design)
    const shelves = entries.filter(e => e.label === 'Shelf')
    expect(shelves[0].qty).toBe(1)
    expect(shelves[0].width).toBe(564)
  })
})

describe('computeCutList – with toe-kick', () => {
  it('adds toe-kick board to cut list', () => {
    const design = bareDesign()
    design.globalSettings.toeKick = { height: 100, setback: 20 }
    const entries = computeCutList(design)
    const tk = entries.find(e => e.label === 'Toe-kick board')
    expect(tk).toBeDefined()
    expect(tk!.width).toBe(600 - 2 * 20)
    expect(tk!.height).toBe(100)
  })
})

describe('computeCutList – drawer box', () => {
  it('adds drawer box dimensions for side-mount drawer', () => {
    const design = bareDesign()
    design.root = {
      id: 'root',
      elementType: 'drawer',
      drawerConfig: { slideType: 'side-mount', reveal: 3 },
    }
    const entries = computeCutList(design)
    const drawerBox = entries.find(e => e.label === 'Drawer box (side-mount)')
    expect(drawerBox).toBeDefined()
  })
})
```

- [ ] **Step 2: Run – expect FAIL**

```bash
npx vitest run src/engine/cutList.test.ts
```

- [ ] **Step 3: Implement cutList engine**

```ts
// src/engine/cutList.ts
import type { Design, CabinetNode, CutListEntry, MaterialId } from '../types'
import { computeLayout } from './layoutEngine'

export function computeCutList(design: Design): CutListEntry[] {
  const gs = design.globalSettings
  const t = gs.thickness
  const layout = computeLayout(design)
  const entries: CutListEntry[] = []

  // Side panels: 2 × (H × D × T)
  entries.push({
    label: 'Side panel', qty: 2,
    width: gs.height, height: gs.depth, depth: t,
    material: gs.defaultMaterial,
  })

  // Top panel: (W - 2T) × D × T
  entries.push({
    label: 'Top panel', qty: 1,
    width: gs.width - 2 * t, height: gs.depth, depth: t,
    material: gs.defaultMaterial,
  })

  // Bottom panel: (W - 2T) × D × T
  entries.push({
    label: 'Bottom panel', qty: 1,
    width: gs.width - 2 * t, height: gs.depth, depth: t,
    material: gs.defaultMaterial,
  })

  // Back panel: (W - 2T) × (H - 2T) × backThickness
  const backThickness = gs.backThickness ?? 6
  entries.push({
    label: 'Back panel', qty: 1,
    width: gs.width - 2 * t,
    height: gs.height - 2 * t,
    depth: backThickness,
    material: gs.defaultMaterial,
    notes: `${backThickness}mm ply back`,
  })

  // Toe-kick board
  if (gs.toeKick) {
    entries.push({
      label: 'Toe-kick board', qty: 1,
      width: gs.width - 2 * gs.toeKick.setback,
      height: gs.toeKick.height,
      depth: t,
      material: gs.defaultMaterial,
    })
  }

  // Shelves (horizontal dividers in layout) — grouped by dimensions
  const shelves = layout.dividers.filter(d => d.axis === 'horizontal')
  const shelfGroups = new Map<string, { qty: number; w: number; mat: MaterialId }>()
  for (const shelf of shelves) {
    const key = `${Math.round(shelf.w)}×${shelf.material}`
    const g = shelfGroups.get(key) ?? { qty: 0, w: shelf.w, mat: shelf.material }
    shelfGroups.set(key, { ...g, qty: g.qty + 1 })
  }
  for (const g of shelfGroups.values()) {
    entries.push({
      label: 'Shelf', qty: g.qty,
      width: g.w, height: gs.depth, depth: t,
      material: g.mat,
    })
  }

  // Vertical dividers
  const vDividers = layout.dividers.filter(d => d.axis === 'vertical')
  if (vDividers.length > 0) {
    entries.push({
      label: 'Divider', qty: vDividers.length,
      width: vDividers[0].h, height: gs.depth, depth: t,
      material: vDividers[0].material,
    })
  }

  // Drawer boxes
  layout.voids.filter(v => v.elementType === 'drawer' && v.drawerConfig).forEach(v => {
    const cfg = v.drawerConfig!
    const sideClearance = cfg.slideType === 'side-mount' ? 25 : 0
    const faceH = v.h - cfg.reveal
    const boxH = faceH - 12
    const boxW = v.w - 2 * sideClearance
    const boxD = gs.depth - t
    entries.push({
      label: `Drawer box (${cfg.slideType})`,
      qty: 1,
      width: boxW, height: boxH, depth: boxD,
      material: v.material,
      notes: `Face: ${v.w}×${faceH}mm`,
    })
  })

  return entries
}
```

- [ ] **Step 4: Run – expect PASS**

```bash
npx vitest run src/engine/cutList.test.ts
```

- [ ] **Step 5: Implement CutListPanel**

```tsx
// src/components/CutListPanel/CutListPanel.tsx
import type { CutListEntry } from '../../types'

interface Props { entries: CutListEntry[] }

export default function CutListPanel({ entries }: Props) {
  return (
    <div className="p-4">
      <h2 className="text-sm font-semibold text-white/60 uppercase tracking-wide mb-3">Cut List</h2>
      <table className="w-full text-sm text-white/80 border-collapse">
        <thead>
          <tr className="text-xs text-white/40 border-b border-white/10">
            <th className="text-left py-1">Part</th>
            <th className="text-right py-1">Qty</th>
            <th className="text-right py-1">W</th>
            <th className="text-right py-1">H</th>
            <th className="text-right py-1">D</th>
            <th className="text-left py-1 pl-2">Notes</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => (
            <tr key={i} className="border-b border-white/5 hover:bg-white/5">
              <td className="py-1">{e.label}</td>
              <td className="text-right py-1">{e.qty}</td>
              <td className="text-right py-1">{Math.round(e.width)}</td>
              <td className="text-right py-1">{Math.round(e.height)}</td>
              <td className="text-right py-1">{Math.round(e.depth)}</td>
              <td className="text-left py-1 pl-2 text-white/40 text-xs">{e.notes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 6: Add CutListPanel to App as collapsible panel**

```tsx
// src/App.tsx — add cut-list sidebar section (uses native <details> — no state needed)
import { computeCutList } from './engine/cutList'
import CutListPanel from './components/CutListPanel/CutListPanel'

// In App body:
const cutList = activeDesign ? computeCutList(activeDesign) : []

// Add below the Sidebar in <main>:
<div className="w-72 border-l border-white/10 bg-panel flex flex-col">
  <details className="border rounded p-2">
    <summary className="cursor-pointer font-semibold text-sm text-white/60">
      Cut List ({cutList.length} parts)
    </summary>
    <CutListPanel entries={cutList} />
  </details>
</div>
```

- [ ] **Step 7: Commit**

```bash
git add src/engine/cutList.ts src/engine/cutList.test.ts src/components/CutListPanel/ src/App.tsx
git commit -m "feat: cut-list engine + CutListPanel

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---
### Task 14: WarningBanner + exportSVG

**Files:**
- Create: `src/components/WarningBanner/WarningBanner.tsx`
- Create: `src/utils/exportSVG.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/Toolbar/Toolbar.tsx` (Export SVG button already inlined in Task 7)

> **Note (Fix 5):** `ExportButton` has no separate directory. The Export SVG button is inlined in `Toolbar.tsx`.
> **Note (Fix 4):** `overConstrainedIds` is derived with `useMemo` in App — no `onLayoutComputed` callback on `CabinetCanvas`.

- [ ] **Step 1: Write failing tests**

```ts
// src/utils/exportSVG.test.ts
import { describe, it, expect } from 'vitest'
import { stripSvgForExport } from './exportSVG'

describe('stripSvgForExport', () => {
  it('removes drag-handle elements', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    g.setAttribute('data-layer', 'drag-handles')
    svg.appendChild(g)
    const clone = stripSvgForExport(svg)
    expect(clone.querySelector('[data-layer="drag-handles"]')).toBeNull()
  })

  it('removes pointer-events attributes', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    rect.setAttribute('pointer-events', 'none')
    svg.appendChild(rect)
    const clone = stripSvgForExport(svg)
    const rects = clone.querySelectorAll('rect')
    expect(rects[0].hasAttribute('pointer-events')).toBe(false)
  })
})
```

- [ ] **Step 2: Run – expect FAIL**

```bash
npx vitest run src/utils/exportSVG.test.ts
```

- [ ] **Step 3: Implement exportSVG**

```ts
// src/utils/exportSVG.ts

export function stripSvgForExport(svg: SVGSVGElement): SVGSVGElement {
  const clone = svg.cloneNode(true) as SVGSVGElement

  // Remove drag handles and snap guides layers
  clone.querySelectorAll('[data-layer="drag-handles"], [data-layer="snap-guides"]').forEach(el => el.remove())

  // Strip interactive attributes
  clone.querySelectorAll('[pointer-events]').forEach(el => el.removeAttribute('pointer-events'))
  clone.querySelectorAll('[cursor]').forEach(el => el.removeAttribute('cursor'))
  clone.querySelectorAll('[data-testid]').forEach(el => el.removeAttribute('data-testid'))

  // Reset transform (remove zoom/pan)
  const topGroup = clone.querySelector('g[transform]')
  topGroup?.removeAttribute('transform')

  return clone
}

import type { RefObject } from 'react'

export function downloadSVG(svgRef: RefObject<SVGSVGElement>, filename: string): void {
  const svg = svgRef.current
  if (!svg) return

  const stripped = stripSvgForExport(svg)
  stripped.setAttribute('xmlns', 'http://www.w3.org/2000/svg')

  const title = document.createElementNS('http://www.w3.org/2000/svg', 'title')
  title.textContent = filename
  stripped.prepend(title)

  const blob = new Blob([stripped.outerHTML], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}.svg`
  a.click()
  URL.revokeObjectURL(url)
}
```

- [ ] **Step 4: Implement WarningBanner**

```tsx
// src/components/WarningBanner/WarningBanner.tsx
import { useState, useEffect } from 'react'

interface Props { overConstrainedIds: string[] }

export default function WarningBanner({ overConstrainedIds }: Props) {
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (overConstrainedIds.length === 0) setDismissed(false)
  }, [overConstrainedIds.length])

  if (dismissed || overConstrainedIds.length === 0) return null

  return (
    <div className="bg-amber-900/60 border-b border-amber-500/40 px-4 py-1.5 text-sm text-amber-300 flex items-center gap-2">
      ⚠ {overConstrainedIds.length} section(s) are over-constrained. Unlock a section to resolve.
      <button
        onClick={() => setDismissed(true)}
        className="ml-auto text-amber-300/60 hover:text-amber-300"
        aria-label="Dismiss warning"
      >×</button>
    </div>
  )
}
```

- [ ] **Step 5: Wire into App**

```tsx
// src/App.tsx
import { useMemo } from 'react'
import WarningBanner from './components/WarningBanner/WarningBanner'
import { computeLayout } from './engine/layoutEngine'

// In App body — derive overConstrainedIds without a callback (Fix 4):
const overConstrainedIds = useMemo(
  () => activeDesign ? computeLayout(activeDesign).overConstrainedIds : [],
  [activeDesign],
)

// Between Toolbar and ProjectTabs:
<WarningBanner overConstrainedIds={overConstrainedIds} />

// svgRef is already defined in Task 12 App wiring; pass to Toolbar:
<Toolbar
  settings={activeDesign.globalSettings}
  onSettingsChange={updateSettings}
  svgRef={svgRef}
  designName={activeDesign?.name ?? 'cabinet'}
/>
```

- [ ] **Step 7: Run – expect PASS**

```bash
npx vitest run src/utils/exportSVG.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add src/components/WarningBanner/ src/utils/exportSVG.ts src/utils/exportSVG.test.ts src/App.tsx src/components/Toolbar/
git commit -m "feat: WarningBanner, SVG export utility, overConstrainedIds via useMemo

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 15: Undo/Redo + README + copilot-instructions.md

**Files:**
- Create: `src/hooks/useUndoRedo.ts`
- Modify: `src/App.tsx`
- Create: `README.md`
- Create: `.github/copilot-instructions.md`

- [ ] **Step 1: Implement useUndoRedo hook**

```ts
// src/hooks/useUndoRedo.ts
import { useEffect } from 'react'
import { useStore } from '../store/store'

export function useUndoRedo() {
  const { undo, redo } = useStore.temporal.getState()

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey
      if (ctrl && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      if (ctrl && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [undo, redo])
}
```

- [ ] **Step 2: Add Delete keyboard shortcut**

```ts
// In useUndoRedo.ts, extend handler:
// Also handle delete of selected board
import { useStore } from '../store/store'

export function useUndoRedo() {
  const { undo, redo } = useStore.temporal.getState()
  const selectedId = useStore(s => s.selectedId)
  const deleteBoard = useStore(s => s.deleteBoard)

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey
      if (ctrl && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      if (ctrl && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo() }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault()
        deleteBoard(selectedId)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [undo, redo, selectedId, deleteBoard])
}
```

- [ ] **Step 3: Call hook in App**

```tsx
// src/App.tsx
import { useUndoRedo } from './hooks/useUndoRedo'

// In App component:
useUndoRedo()
```

- [ ] **Step 4: Write README.md**

```markdown
# BuildBox

> Interactive 2D cabinet configurator — design, partition, and export cut-lists for custom carpentry.

## Features

- **Visual SVG canvas** — front-facing elevation of your cabinet with accurate material thickness
- **Click to edit** — click any dimension label to type an exact value
- **Drag dividers** — grab any shelf or divider and drag to resize with snap-to-grid
- **Material colours** — assign Oak, Walnut, White, Birch, or MDF to any panel
- **Drawer faces & hanging rails** — annotate voids and accessories in the canvas
- **Auto-scaling** — locked sections hold their size; free sections absorb changes
- **Cut list** — every piece of wood with exact width × height × depth
- **SVG export** — clean, printable diagram without UI chrome
- **Undo/redo** — `Ctrl+Z` / `Ctrl+Shift+Z`
- **Multiple projects** — tab-based project management, auto-saved to localStorage

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:5173

## Units

Switch between mm, cm, and inches (fractional 1/16") via the toolbar toggle.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` / `Ctrl+Y` | Redo |
| `Delete` / `Backspace` | Delete selected board |

## Tech Stack

- React 18 + Vite 5 + TypeScript 5
- Tailwind CSS 3
- Zustand + Immer + zundo
- Vitest + React Testing Library

## Testing

```bash
npm test
```
```

- [ ] **Step 5: Write copilot-instructions.md**

```markdown
# BuildBox — Copilot Instructions

## Architecture

Pure-frontend SPA: React 18, Vite 5, TypeScript 5, Tailwind CSS 3.

**State:** Zustand store (`src/store/store.ts`) with Immer for immutable mutations and zundo for undo/redo. Persisted to `localStorage` key `buildbox-store`. Only `{ projects, activeProjectId }` is persisted.

**Data model:** All cabinet designs are a tree of `CabinetNode` (see `src/types/index.ts`). Leaf nodes are voids; branch nodes have `splitAxis` + 2 children.

**Layout engine:** `computeLayout(design)` in `src/engine/layoutEngine.ts` converts the tree into flat `LayoutResult` arrays. It is pure and memoised in `CabinetCanvas`. Never call it from within a store action.

**Canvas:** Single `<svg>` element. Layers in render order inside `CanvasLayers.tsx`: panels → voids → dividers → accessories. Then `DimensionLabels` and `DragHandles` are added on top.

## Strict Rules

1. **Tailwind CSS only** — no custom CSS files, no CSS modules, no inline `style` unless computing SVG coordinates.
2. **Dimensions in mm** — store all values in millimetres. Convert at display layer only via `formatDisplay`.
3. **Never mutate `fixedSize` in the engine** — `computeLayout` reads it; only store actions write it.
4. **Binary splits only** — `addShelf`/`addDivider` always create exactly 2 children.
5. **No store writes during drag** — use `useRef` for drag state; call `commitDrag` only on `pointerup`.
6. **DimensionEditor is a Portal** — never use `foreignObject` inside SVG.
7. **MIN_SECTION_SIZE = 50mm**, **MAX_TREE_DEPTH = 12**.

## Testing Requirements

- Every new math function → unit tests in `src/engine/*.test.ts`
- Every interactive component → RTL tests in a co-located `*.test.tsx`
- Tests must test behaviour, not implementation — use real classes, avoid mocks
- Run `npm test` before every commit
```

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useUndoRedo.ts src/App.tsx README.md .github/copilot-instructions.md
git commit -m "feat: undo/redo keyboard shortcuts, Delete key, README, copilot-instructions

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---
### Task 16: End-to-End Integration Test

**Files:**
- Create: `src/test/e2e.test.tsx`

This test exercises the full user workflow: open app → configure global settings → add shelf → edit dimension → verify cut list. It uses the real store and real engine functions, no mocks.

- [ ] **Step 1: Write failing test**

```tsx
// src/test/e2e.test.tsx
import { render, screen, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach } from 'vitest'
import App from '../App'
import { useStore } from '../store/store'

beforeEach(() => {
  // Reset store to fresh state before each test
  useStore.setState({
    projects: [{
      id: 'test-proj',
      name: 'Cabinet 1',
      root: { id: 'root-node', elementType: 'void' },
      globalSettings: {
        unit: 'mm', height: 800, width: 600, depth: 500,
        thickness: 18, backThickness: 6, toeKick: null, defaultMaterial: 'oak',
      },
    }],
    activeProjectId: 'test-proj',
    selectedId: null,
    snapGrid: 5,
  }, true)  // replace flag
  useStore.temporal.getState().clear()
})

describe('Full cabinet workflow', () => {
  it('renders the cabinet canvas with outer panels', () => {
    render(<App />)
    const canvas = screen.getByTestId('cabinet-canvas')
    expect(canvas).toBeInTheDocument()
    // SVG should have rects for the 4 outer panels
    const rects = canvas.querySelectorAll('rect')
    expect(rects.length).toBeGreaterThanOrEqual(4)
  })

  it('clicking a void selects it', async () => {
    const user = userEvent.setup()
    render(<App />)
    const voids = screen.getAllByTestId(/^void-/)
    await user.click(voids[0])
    expect(useStore.getState().selectedId).not.toBeNull()
  })

  it('adding a shelf splits the selected void', async () => {
    const user = userEvent.setup()
    render(<App />)
    // Select the root void
    await user.click(screen.getByTestId('void-root-node'))
    // Click Add Shelf
    await user.click(screen.getByRole('button', { name: /add shelf/i }))
    // Now there should be 2 voids
    expect(screen.getAllByTestId(/^void-/).length).toBe(2)
  })

  it('after adding one shelf, each void is 373mm tall (800 - 2×18 - 18) / 2', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByTestId('void-root-node'))
    await user.click(screen.getByRole('button', { name: /add shelf/i }))

    // The dimension labels should show 373 mm
    const labels = screen.getAllByText(/373/)
    expect(labels.length).toBeGreaterThanOrEqual(1)
  })

  it('typing a new height into the top void adjusts the bottom void', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByTestId('void-root-node'))
    await user.click(screen.getByRole('button', { name: /add shelf/i }))

    // Click the top void's height label (which shows 373) to open DimensionEditor
    const topHeightLabel = screen.getAllByText(/373/)[0]
    await user.click(topHeightLabel)

    // Type new dimension into the DimensionEditor input
    const input = screen.getByRole('spinbutton')
    await user.clear(input)
    await user.type(input, '200')
    await user.keyboard('{Enter}')

    // Bottom void should now be 800 - 2*18 - 18 - 200 = 546
    expect(screen.getByText(/546/)).toBeInTheDocument()

    // Click the lock icon on the top void to unlock it
    const lockIcon = screen.getByLabelText('Unlock section')
    await user.click(lockIcon)
    const labels = screen.getAllByText(/373/)
    expect(labels.length).toBeGreaterThanOrEqual(1)
  })

  it('cut list shows correct panel count after adding shelf and divider', async () => {
    const user = userEvent.setup()
    render(<App />)
    // Add shelf
    await user.click(screen.getByTestId('void-root-node'))
    await user.click(screen.getByRole('button', { name: /add shelf/i }))

    // Open cut list (native <details> — click summary)
    await user.click(screen.getByText(/cut list/i))

    // Should show Side panel, Top panel, Bottom panel, Back panel, Shelf
    expect(screen.getByText('Side panel')).toBeInTheDocument()
    expect(screen.getByText('Shelf')).toBeInTheDocument()
    expect(screen.getByText('Back panel')).toBeInTheDocument()
  })

  it('undo restores the tree after adding a shelf', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByTestId('void-root-node'))
    await user.click(screen.getByRole('button', { name: /add shelf/i }))
    expect(screen.getAllByTestId(/^void-/).length).toBe(2)

    // Trigger undo
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(screen.getAllByTestId(/^void-/).length).toBe(1)
  })
})
```

- [ ] **Step 2: Run – expect FAIL**

```bash
npx vitest run src/test/e2e.test.tsx
```

Expected: test file found, some tests pass (render), some fail (dimension label text assertions may need DOM queries tuned).

- [ ] **Step 3: Run all tests to confirm full suite passes**

```bash
npm test
```

Expected: all tests across all files pass.

- [ ] **Step 4: Commit**

```bash
git add src/test/e2e.test.tsx
git commit -m "test: end-to-end integration test covering full cabinet workflow

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

---
### Task 17: Accessory System (Hanging Rails)

**Self-contained task** — adds all accessory code in one place. Earlier tasks do NOT add accessory types or functions; they note "See Task 17".

**Files:**
- Modify: `src/types/index.ts` — add `Accessory`, `AccessoryType`, `CabinetNode.accessories`, `LayoutVoid.accessories`
- Modify: `src/engine/treeMutations.ts` — add `addAccessory`, `removeAccessory`
- Modify: `src/store/store.ts` — add `addAccessory`, `removeAccessory` actions + import `AccessoryType`, `Accessory`
- Modify: `src/engine/layoutEngine.ts` — pass `accessories: node.accessories ?? []` in void push
- Create: `src/components/AccessoryPanel.tsx`
- Modify: `src/components/CabinetCanvas/CanvasLayers.tsx` — accessories already rendered from `v.accessories`
- Modify: `src/engine/cutList.ts` — add hanging-rail entries
- Test: `src/engine/treeMutations.test.ts` — add accessory tests
- Test: `src/components/AccessoryPanel.test.tsx`

- [ ] **Step 1: Add Accessory types to `src/types/index.ts`**

```ts
// Add to src/types/index.ts (after AccessoryType line which already exists):
export interface Accessory {
  id: string          // nanoid()
  type: AccessoryType
  heightFromBottom: number  // mm from bottom of void
}
```

Also add to `CabinetNode`:
```ts
  accessories?: Accessory[]      // accessories attached to this void
```

And to `LayoutVoid`:
```ts
  accessories: Accessory[]
```

- [ ] **Step 2: Write failing tests for accessory mutations**

In `src/engine/treeMutations.test.ts`, add:
```ts
describe('accessory mutations', () => {
  it('addAccessory adds to node accessories', () => {
    const root = leaf()
    const acc: Accessory = { id: 'a1', type: 'hanging-rail', heightFromBottom: 100 }
    const next = addAccessory(root, root.id, acc)
    expect(next.accessories).toHaveLength(1)
    expect(next.accessories![0].type).toBe('hanging-rail')
  })

  it('removeAccessory removes by id', () => {
    const acc: Accessory = { id: 'a1', type: 'hanging-rail', heightFromBottom: 100 }
    const root = { ...leaf(), accessories: [acc] }
    const next = removeAccessory(root, root.id, 'a1')
    expect(next.accessories).toHaveLength(0)
  })
})
```

Also update the treeMutations.test.ts import to include `addAccessory` and `removeAccessory`:
```ts
import { addShelf, addDivider, deleteBoard, setNodeSize, setSplitRatio, setLocked, setMaterial, unlockNode, addAccessory, removeAccessory } from './treeMutations'
import type { CabinetNode, Accessory } from '../types'
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- treeMutations --run`
Expected: FAIL with "treeMutations.addAccessory is not a function"

- [ ] **Step 4: Add accessory mutations to treeMutations.ts**

In `src/engine/treeMutations.ts`, add the `Accessory` import and these functions:
```ts
import type { CabinetNode, MaterialId, SplitAxis, ElementType, DrawerConfig, Accessory } from '../types'

export function addAccessory(root: CabinetNode, nodeId: string, acc: Accessory): CabinetNode {
  return mapNode(root, (n) => {
    if (n.id !== nodeId) return n
    return { ...n, accessories: [...(n.accessories ?? []), acc] }
  })
}

export function removeAccessory(root: CabinetNode, nodeId: string, accId: string): CabinetNode {
  return mapNode(root, (n) => {
    if (n.id !== nodeId) return n
    return { ...n, accessories: (n.accessories ?? []).filter((a) => a.id !== accId) }
  })
}
```

- [ ] **Step 5: Run tests**

Run: `npm run test -- treeMutations --run`
Expected: PASS

- [ ] **Step 6: Add accessory store actions**

In `src/store/store.ts`, add to `StoreState` interface:
```ts
addAccessory: (nodeId: string, type: AccessoryType, heightFromBottom: number) => void
removeAccessory: (nodeId: string, accId: string) => void
```

Update imports:
```ts
import type { ..., AccessoryType, Accessory } from '../types'
import { ..., addAccessory as treeAddAccessory, removeAccessory as treeRemoveAccessory } from '../engine/treeMutations'
```

Add to store implementation:
```ts
addAccessory: (nodeId, type, heightFromBottom) => set(s => {
  const design = activeDesign(s)
  if (!design) return
  const acc: Accessory = { id: nanoid(), type, heightFromBottom }
  design.root = treeAddAccessory(design.root, nodeId, acc)
}),
removeAccessory: (nodeId, accId) => set(s => {
  const design = activeDesign(s)
  if (!design) return
  design.root = treeRemoveAccessory(design.root, nodeId, accId)
}),
```

- [ ] **Step 7: Update layoutEngine to pass accessories to LayoutVoid**

In `src/engine/layoutEngine.ts`, ensure the leaf void push includes `accessories: node.accessories ?? []`:

```ts
voids.push({
  nodeId: node.id, x, y, w, h,
  parentSplitAxis,
  elementType: node.elementType ?? 'void',
  drawerConfig: node.drawerConfig,
  material,
  accessories: node.accessories ?? [],
})
```

- [ ] **Step 8: Write failing AccessoryPanel test**

Create `src/components/AccessoryPanel.test.tsx`:
```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import AccessoryPanel from './AccessoryPanel'
import { useStore } from '../store/store'
import type { Design } from '../types'

function makeProject(): Design {
  return {
    id: 'proj1',
    name: 'Test',
    root: { id: 'node1', elementType: 'void' },
    globalSettings: {
      unit: 'mm', height: 800, width: 600, depth: 500,
      thickness: 18, backThickness: 6, toeKick: null, defaultMaterial: 'oak',
    },
  }
}

beforeEach(() => {
  useStore.setState({
    projects: [makeProject()],
    activeProjectId: 'proj1',
    selectedId: 'node1',
    snapGrid: 5,
  }, true)
  useStore.temporal.getState().clear()
})

it('adds a hanging rail when button clicked', () => {
  render(<AccessoryPanel />)
  fireEvent.click(screen.getByText('Add Hanging Rail'))
  expect(useStore.getState().projects[0].root.accessories).toHaveLength(1)
  expect(useStore.getState().projects[0].root.accessories![0].type).toBe('hanging-rail')
})

it('removes a hanging rail when delete clicked', () => {
  useStore.getState().addAccessory('node1', 'hanging-rail', 100)
  render(<AccessoryPanel />)
  fireEvent.click(screen.getByLabelText('Remove accessory'))
  expect(useStore.getState().projects[0].root.accessories).toHaveLength(0)
})
```

- [ ] **Step 9: Run test to verify it fails**

Run: `npm run test -- AccessoryPanel --run`
Expected: FAIL (component not yet created)

- [ ] **Step 10: Implement AccessoryPanel**

Create `src/components/AccessoryPanel.tsx`:
```tsx
import { useState } from 'react'
import { useStore } from '../store/store'
import { findNode } from '../engine/treeMutations'

export default function AccessoryPanel() {
  const selectedId = useStore((s) => s.selectedId)
  const accessories = useStore((s) => {
    if (!selectedId) return []
    const design = s.projects.find((p) => p.id === s.activeProjectId)
    if (!design) return []
    return findNode(design.root, selectedId)?.accessories ?? []
  })
  const addAccessory = useStore((s) => s.addAccessory)
  const removeAccessory = useStore((s) => s.removeAccessory)
  const [height, setHeight] = useState(200)

  if (!selectedId) return null

  return (
    <div className="p-4 border-t border-gray-200">
      <h3 className="font-semibold text-sm mb-2">Accessories</h3>
      <div className="flex gap-2 mb-2">
        <input
          type="number"
          value={height}
          onChange={(e) => setHeight(Number(e.target.value))}
          className="w-20 border rounded px-1 text-sm"
          placeholder="Height mm"
        />
        <button
          onClick={() => addAccessory(selectedId, 'hanging-rail', height)}
          className="text-sm bg-blue-600 text-white px-2 py-1 rounded"
        >
          Add Hanging Rail
        </button>
      </div>
      <ul className="space-y-1">
        {accessories.map((acc) => (
          <li key={acc.id} className="flex justify-between items-center text-sm">
            <span>Rail @ {acc.heightFromBottom}mm</span>
            <button
              aria-label="Remove accessory"
              onClick={() => removeAccessory(selectedId, acc.id)}
              className="text-red-500 hover:text-red-700"
            >×</button>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 11: Run tests**

Run: `npm run test -- AccessoryPanel --run`
Expected: PASS

- [ ] **Step 12: Verify CanvasLayers renders from accessories**

Confirm `src/components/CabinetCanvas/CanvasLayers.tsx` renders hanging rails from `v.accessories` (the accessories layer renders from the same `layout.voids` data that Task 17 now populates). The rendering in `CanvasLayers.tsx` should already handle:
```tsx
{(v.accessories ?? [])
  .filter((a) => a.type === 'hanging-rail')
  .map((a) => {
    const railY = v.y + v.h - a.heightFromBottom
    return (
      <line key={a.id} x1={v.x} y1={railY} x2={v.x + v.w} y2={railY}
        stroke="#666" strokeWidth={3} strokeDasharray="4 2" />
    )
  })}
```

- [ ] **Step 13: Add hanging-rail cut-list entries**

In `src/engine/cutList.ts`, after the drawer boxes section, add:
```ts
  // Hanging rails
  for (const v of layout.voids) {
    const rails = v.accessories?.filter((a) => a.type === 'hanging-rail') ?? []
    for (const rail of rails) {
      entries.push({
        label: 'Hanging rail',
        qty: 1,
        width: v.w - 2 * t,
        height: 0,
        depth: gs.depth - (gs.backThickness ?? 6),
        material: gs.defaultMaterial,
        notes: `Rail at ${rail.heightFromBottom}mm from bottom`,
      })
    }
  }
```

- [ ] **Step 14: Commit**

```bash
git add src/types/index.ts src/engine/treeMutations.ts src/store/store.ts         src/engine/layoutEngine.ts src/engine/cutList.ts         src/components/AccessoryPanel.tsx src/components/canvas/AccessoryLayer.tsx         src/engine/treeMutations.test.ts src/components/AccessoryPanel.test.tsx
git commit -m "feat: full accessory system (hanging rails)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Self-Review Checklist

### Spec Coverage

| Spec requirement | Task |
|---|---|
| Unit toggle mm/cm/in, fractional inch | Task 3 (unitConversion) + Task 7 (Toolbar) |
| Global inputs: H/W/D/Thickness | Task 7 (Toolbar) |
| Toe-kick in GlobalSettings | Task 4 (layoutEngine), Task 13 (cutList) |
| SVG canvas, front-elevation view | Task 8 |
| Dimension overlays, editable | Task 10 |
| Locking on type, scaling-without-lock on drag | Task 4 (distributeTwo), Task 6 (commitDrag), Task 11 |
| Add Shelf / Add Divider buttons | Task 5 (mutations) + Task 12 (ActionPanel) |
| Delete board, merge voids | Task 5 (deleteBoard) + Task 12 (ActionPanel) |
| Over-constraint detection + WarningBanner | Task 4 + Task 14 |
| Material colours per panel | Task 2 (types), Task 8/9 (layers), Task 12 (MaterialPanel) |
| Drawer with DrawerConfig (slide/reveal) | Task 2, Task 6, Task 12 (DrawerConfigPanel), Task 13 (cutList) |
| Hanging rail accessory system | Task 17 (self-contained) |
| Drag handles + snap | Task 11 |
| Autoscaling engine rules | Task 4 (distributeTwo) |
| Cut-list with formulas | Task 13 (cutList.ts) |
| Back panel in cut-list | Task 13 |
| SVG export stripped | Task 14 (exportSVG) |
| Undo/redo Ctrl+Z/Y, Delete key | Task 15 |
| Multiple named projects | Task 6 (store), Task 7 (ProjectTabs) |
| localStorage persistence | Task 6 (persist middleware) |
| README | Task 15 |
| copilot-instructions.md | Task 15 |
| E2E integration test | Task 16 |

All 22 spec requirements are covered. ✓

### Type Consistency Check

- `LayoutDivider.childAId` and `childBId` carry actual node IDs — DragHandles and DividerLayer use these for selection and drag. ✓
- `commitDrag(parentNodeId, ratio)` — 2 params (parentNodeId, ratio 0-1) in store.ts and DragHandles.tsx ✓
- `formatDisplay` returns a string — used as SVG `<text>` children ✓
- `CutListEntry.depth` — third dimension (physical thickness of the piece) ✓
- `LayoutVoid.accessories` flows from tree → layout → CanvasLayers and cut-list tasks ✓

---

## Simplification Review Applied

The following simplifications were applied to this plan after the initial review:

| # | Fix | Impact |
|---|-----|--------|
| D1 | **Merge 4 canvas layers into `CanvasLayers.tsx`** | `PanelLayer.tsx`, `VoidLayer.tsx`, `DividerLayer.tsx`, `AccessoryLayer.tsx` removed; single file with inline `<g>` groups |
| D2 | **`children?: [CabinetNode, CabinetNode]` tuple** | TypeScript enforces binary split invariant; all `length !== 2` guards removed |
| Fix 1 | **Remove duplicate `selectNode`** | Only `setSelectedId` remains in `StoreState`; `selectNode` alias deleted |
| Fix 2 | **Move `setElementType`/`setDrawerConfig` to `treeMutations.ts`** | IIFE tree-walkers in store replaced with `treeMutations.setElementType` / `treeMutations.setDrawerConfig` |
| Fix 3 | **Replace `allNodes`/`flattenTree` with `findNode` + `selectedNode` prop** | `Sidebar` receives `selectedNode: CabinetNode \| null` directly; no flat list, no local `findNode` |
| Fix 4 | **Derive `overConstrainedIds` with `useMemo`** | No `onLayoutComputed` callback; no side-effect in `useMemo`; no `useState` in App for this |
| Fix 5 | **Inline `ExportButton` into Toolbar** | `src/components/ExportButton/` directory removed; button and `downloadSVG` import live in `Toolbar.tsx` |
| Fix 6 | **Delete `findDividerContext`** | Dead export removed from `treeMutations.ts` |
| Fix 7 | **Remove dead `distributeTwo` branch** | "Both have fixedSize but neither locked" unreachable branch deleted |
| Fix 8 | **Delete trivial property-setter tests** | `setSplitRatio`, `setLocked`, `setMaterial` test blocks removed from `treeMutations.test.ts` |
| Fix 9 | **Remove DOM-only Toolbar tests** | "shows unit toggle buttons" and "shows height/width/depth/thickness" tests removed |
| Fix 10 | **Remove `ScaledProps`/unused `scale`** | Merged `CanvasLayers.tsx` uses absolute mm coordinates directly (no per-function scale prop) |
| Fix 11 | **`<details>` for cut-list collapse** | `showCutList` state and custom toggle button removed; native `<details>`/`<summary>` used |
| Fix 12 | **Merge Sidebar sub-panels into `Sidebar.tsx`** | `ActionPanel.tsx`, `ElementTypePanel.tsx`, `MaterialPanel.tsx`, `DrawerConfigPanel.tsx` removed as separate files |
| Fix 13 | **CanvasLayers consolidation (D1 implementation)** | Task 9 replaced with a verification step; no new separate layer files |
| Fix 14 | **`children` tuple (D2 implementation)** | Type updated in Task 2; `length !== 2` guards removed from Task 4; `as [CabinetNode, CabinetNode]` cast added in `splitNode` |
| Fix 15 | **Consolidate accessory code into Task 17 only** | Tasks 2, 5, 6 no longer add accessories; Task 17 is fully self-contained |
| Fix 16 | **E2E test uses `userEvent` not direct store calls** | `act(() => store.getState().setNodeSize(...))` replaced with `userEvent.click` + `userEvent.type` + `userEvent.keyboard` |
