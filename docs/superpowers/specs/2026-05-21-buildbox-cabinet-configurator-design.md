# BuildBox — 2D Cabinet Design Configurator
## Design Specification
**Date:** 2026-05-21  
**Stack:** React + Vite + TypeScript, Tailwind CSS, Zustand + Immer, SVG canvas  
**Repo:** git@github.com:chryston/buildbox.git  

---

## 1. Overview

BuildBox is a single-page web application for fast iteration of custom carpentry designs. Users configure a 2D front-facing elevation of a cabinet, partition it with shelves and dividers, assign element types (drawers, toe kicks, hanging spaces), and export the result as an SVG. A live cut-list panel surfaces the exact dimensions of every wood piece and hardware item required.

**Goals:**
- Interactive, pixel-accurate 2D canvas for cabinet layout
- Autoscaling engine that preserves overall dimensions when sections are edited
- Multiple named project support with localStorage persistence
- SVG export of the designed cabinet

**Non-goals (v1):**
- 3D view
- Cloud sync / user accounts
- PDF or CSV export (SVG only)
- Python backend (all math is client-side TypeScript)

---

## 2. Stack & Tooling

| Concern | Choice |
|---|---|
| Framework | React 18 + Vite + TypeScript |
| Styling | Tailwind CSS only (no custom CSS, no CSS modules, no inline styles except SVG geometry) |
| State | Zustand with Immer middleware |
| Testing | Vitest + React Testing Library |
| Canvas | SVG (rendered as React JSX) |
| Persistence | Zustand `persist` middleware → `localStorage` key `buildbox-v1` |
| Export | SVG DOM clone → Blob URL → `<a download>` |

---

## 3. Data Model

All dimensions are stored internally in **millimetres (mm)**. Unit conversion is a display-layer concern only. This prevents floating-point drift from repeated round-trips between units.

### 3.1 Core Types

```ts
type Unit = 'mm' | 'cm' | 'in';
type SplitAxis = 'horizontal' | 'vertical';
type MaterialId = 'oak' | 'walnut' | 'white' | 'birch' | 'mdf';
type ElementType = 'void' | 'drawer' | 'toe-kick' | 'hanging-space';
type AccessoryType = 'hanging-rail';

interface GlobalSettings {
  unit: Unit;             // display unit (default: mm)
  height: number;         // mm — external cabinet height
  width: number;          // mm — external cabinet width
  depth: number;          // mm — external cabinet depth
  thickness: number;      // mm — material thickness (default: 18)
  defaultMaterial: MaterialId;
}

interface Accessory {
  id: string;
  type: AccessoryType;
  heightFromBottom: number;  // mm offset from bottom of parent void
}

interface Divider {
  id: string;
  materialId: MaterialId;    // defaults to globalSettings.defaultMaterial
}

interface CabinetNode {
  id: string;
  type: 'leaf' | 'container';
  // Leaf-only fields
  elementType?: ElementType;    // default: 'void'
  accessories?: Accessory[];
  // Container-only fields
  splitAxis?: SplitAxis;
  children?: CabinetNode[];     // always length ≥ 2
  dividers?: Divider[];         // length === children.length - 1
  // Locking
  locked?: boolean;             // true = user has fixed this node's dimension
  fixedSize?: number;           // mm; set when locked = true
}

interface CabinetDesign {
  id: string;
  name: string;
  root: CabinetNode;
  globalSettings: GlobalSettings;
  createdAt: number;   // Unix timestamp
  updatedAt: number;
}
```

### 3.2 Tree Invariants

- A `leaf` node has no `children`, `dividers`, or `splitAxis`.
- A `container` node has `children.length >= 2` and `dividers.length === children.length - 1`.
- Only leaf nodes can have `elementType` and `accessories`.
- `fixedSize` is always in mm regardless of the active display unit.

---

## 4. Math Engine

**File:** `src/engine/layoutEngine.ts`  
**Principle:** Pure TypeScript functions only. No React imports. 100% unit-testable in isolation.

### 4.1 Layout Computation

```ts
computeLayout(design: CabinetDesign): LayoutItem[]
```

Returns a flat list of positioned rectangles (voids and dividers) in mm, relative to the cabinet's top-left origin (0, 0). The outer frame (top/bottom/side panels) is represented as `LayoutItem` entries with `kind: 'panel'`.

**Algorithm (recursive):**

1. Start with the root node allocated the full cabinet internal space:
   - `internalWidth  = settings.width  − 2 × settings.thickness`
   - `internalHeight = settings.height − 2 × settings.thickness`

2. For each `container` node with N children and (N−1) dividers:
   - `available = parentDimension − (N − 1) × thickness`
   - `locked children` claim their `fixedSize` first (clamped to ≥ 1mm)
   - `remaining = available − sum(lockedSizes)`
   - Each unlocked child receives `remaining / unlockedCount`

3. Positions are accumulated as children are laid out left-to-right (vertical split) or top-to-bottom (horizontal split).

### 4.2 Locking Cascade

When a user edits a void's dimension directly, that node becomes `locked = true, fixedSize = newValue`. The remaining space is distributed among **unlocked** siblings.

| Case | Rule |
|---|---|
| Middle vertical division (shelf gap) changed | Edited node locked; all unlocked siblings redistribute to absorb |
| Middle horizontal division (column) changed | Edited node locked; all unlocked siblings redistribute to absorb |
| **Topmost** vertical division changed | Edited node locked; unlocked siblings below absorb equally |
| **Rightmost** horizontal division changed | Edited node locked; unlocked siblings to the left absorb equally |
| **All siblings already locked** | Over-constraint path (see §4.3) |

"Absorb" means all unlocked siblings in the same container share the remaining space equally. If multiple unlocked siblings exist, they all participate — not just the nearest neighbour.

### 4.3 Over-constraint Handling

If all siblings in a container are locked and their sizes sum to more than `available`, the engine distributes proportionally (each locked size scaled to fit). A warning is surfaced in the UI.

### 4.4 Unit Conversion

```ts
// src/engine/unitConversion.ts
toDisplay(mm: number, unit: Unit): number
fromDisplay(value: number, unit: Unit): number
formatDisplay(mm: number, unit: Unit): string  // e.g. "473mm", "47.3cm", "18.62in"
```

Conversion factors: `1 cm = 10 mm`, `1 in = 25.4 mm`. All values rounded to 1 decimal place for display.

### 4.5 Layout Output Types

```ts
interface LayoutVoid {
  kind: 'void';
  nodeId: string;
  x: number; y: number; width: number; height: number;  // mm
  elementType: ElementType;
  accessories: Accessory[];
  locked: boolean;
}

interface LayoutDivider {
  kind: 'divider';
  dividerId: string;
  parentNodeId: string;
  axis: SplitAxis;
  x: number; y: number; width: number; height: number;  // mm
  materialId: MaterialId;
}

interface LayoutPanel {
  kind: 'panel';
  role: 'top' | 'bottom' | 'left' | 'right';
  x: number; y: number; width: number; height: number;  // mm
  materialId: MaterialId;
}

type LayoutItem = LayoutVoid | LayoutDivider | LayoutPanel;
```

---

## 5. Component Architecture

```
App
├── ProjectTabs                  ← list of CabinetDesign names; create / rename / delete
├── Toolbar                      ← GlobalSettings inputs + unit toggle
├── MainLayout
│   ├── Sidebar
│   │   ├── ActionPanel          ← Add Shelf / Add Divider / Delete Board buttons
│   │   ├── ElementTypePanel     ← assign ElementType to selected void
│   │   ├── MaterialPanel        ← per-panel material override (selected node)
│   │   ├── AccessoryPanel       ← add/remove hanging rails on selected void
│   │   └── CutListPanel         ← summary of all wood pieces + hardware
│   └── CanvasArea
│       ├── CabinetCanvas (SVG)
│       │   ├── PanelLayer       ← outer frame panels
│       │   ├── VoidLayer        ← leaf node rectangles (clickable, selectable)
│       │   ├── DividerLayer     ← divider rectangles (clickable, draggable)
│       │   ├── AccessoryLayer   ← hanging rails as SVG lines
│       │   ├── DimensionOverlays← foreignObject input labels per void
│       │   ├── DragHandles      ← invisible hit-strips on dividers (±8px)
│       │   └── SnapGuides       ← ghost lines shown during drag near snap targets
│       └── ExportButton         ← triggers SVG export
```

### 5.1 Selection Model

`selectedId: string | null` in the Zustand store. Clicking a void or divider sets it. The Sidebar panels react to the selection and display relevant controls. Clicking the canvas background deselects.

### 5.2 Sidebar Panel Visibility

| Selection | Visible panels |
|---|---|
| Nothing | ActionPanel (disabled), CutListPanel |
| Void selected | ActionPanel, ElementTypePanel, MaterialPanel, AccessoryPanel |
| Divider selected | MaterialPanel (for that divider), Delete action |

---

## 6. Interaction Model

### 6.1 Click-to-Edit Dimensions

`DimensionOverlays` renders a `<foreignObject>` SVG element per void, centred within it, showing the formatted height × width label.

- Click → switches to `<input>` (auto-focused, value pre-filled)
- Enter / blur → commits the value, applies locking cascade, recomputes layout
- Escape → cancels, restores previous value

### 6.2 Drag to Resize

Each divider has a transparent drag-handle strip (±8px around its centre line). Interaction:

1. `pointerdown` → capture pointer, record start position and divider offset in mm
2. `pointermove` → compute delta in mm, apply snapping, preview new positions immediately
3. `pointerup` → commit final positions to store, recompute layout

The nodes on either side of the dragged divider are both explicitly resized: both have their `fixedSize` updated to the new computed size and `locked = true`. Since the total available space is preserved by the drag (the two adjacent nodes' sizes always sum to the same total), no other siblings need to absorb.

### 6.3 Snapping

Snap priority (applied in order):
1. **Grid snap**: nearest multiple of `snapGrid` mm (default: 5mm, configurable in Toolbar)
2. **Element snap**: within 10mm of any other divider/shelf position → snap to it; a temporary `SnapGuide` line is drawn

### 6.4 Add Shelf (horizontal split)

On selected void leaf node `N`:
1. Convert `N` to `container { splitAxis: 'horizontal' }`
2. Create 2 equal leaf children (each `fixedSize` unset, `locked: false`)
3. Create 1 divider with `defaultMaterial`

### 6.5 Add Divider (vertical split)

Same as 6.4 but `splitAxis: 'vertical'`.

### 6.6 Delete Board

Precondition: both siblings adjacent to the selected divider must be leaf nodes (no nested containers). If not, show error: *"Remove nested subdivisions first."*

If valid: remove divider + merge siblings into a single leaf inheriting `elementType: 'void'` and no `locked` / `fixedSize`.

---

## 7. Cut-List Panel

Displayed in the Sidebar. Derives directly from `computeLayout()` output plus `globalSettings.depth`.

### 7.1 Board Entries

| Component | Qty | Dimensions |
|---|---|---|
| Side panels | 2 | `height × depth` (full external height) |
| Top panel | 1 | `(width − 2×thickness) × depth` |
| Bottom panel | 1 | `(width − 2×thickness) × depth` |
| Each shelf / horizontal divider | 1 | `parentInternalWidth × depth` |
| Each vertical divider | 1 | `internalHeightOfColumn × depth` |
| Toe-kick void | 1 | generates one horizontal board entry |
| Drawer void | 1 set | front (W×H), 2 sides (depth×H), back (W×H), bottom (W×depth) |

### 7.2 Hardware Entries

| Component | Qty | Note |
|---|---|---|
| Hanging rail | per rail | `internalWidth` of its void |

All dimensions shown in the active display unit.

---

## 8. State Management

### 8.1 Zustand Store Shape

```ts
interface AppStore {
  // Data
  projects: CabinetDesign[];
  activeProjectId: string;

  // UI
  selectedId: string | null;
  snapGrid: number;   // mm, default 5

  // Project actions
  createProject(name: string): void;
  renameProject(id: string, name: string): void;
  deleteProject(id: string): void;
  setActiveProject(id: string): void;

  // Settings
  updateSettings(patch: Partial<GlobalSettings>): void;

  // Tree mutations
  addShelf(nodeId: string): void;
  addDivider(nodeId: string): void;
  deleteBoard(dividerId: string): void;
  setNodeSize(nodeId: string, size: number): void;  // mm; locks node + cascade
  setNodeElement(nodeId: string, type: ElementType): void;
  setDividerMaterial(dividerId: string, mat: MaterialId): void;
  addAccessory(nodeId: string, type: AccessoryType): void;
  removeAccessory(nodeId: string, accessoryId: string): void;

  // Selection
  setSelected(id: string | null): void;

  // Snap
  setSnapGrid(mm: number): void;
}
```

### 8.2 Persistence

Zustand `persist` middleware writes `{ projects, activeProjectId }` to `localStorage` under key `buildbox-v1`. UI state (`selectedId`, `snapGrid`) is not persisted (ephemeral per session).

---

## 9. Material Palette

```ts
const MATERIALS: Record<MaterialId, { label: string; fill: string; stroke: string }> = {
  oak:    { label: 'Oak',    fill: '#C8A96E', stroke: '#8B6914' },
  walnut: { label: 'Walnut', fill: '#5C3D1E', stroke: '#3B2410' },
  white:  { label: 'White',  fill: '#F5F5F0', stroke: '#D0CEC8' },
  birch:  { label: 'Birch',  fill: '#E8D5A3', stroke: '#B09050' },
  mdf:    { label: 'MDF',    fill: '#D4C5A9', stroke: '#9E8E72' },
};
```

Global default is set in `GlobalSettings.defaultMaterial`. Per-panel overrides are stored on each `Divider.materialId`. The outer frame panels use `defaultMaterial` unless individual overrides are added in a future iteration.

---

## 10. SVG Export

`src/utils/exportSVG.ts`:

1. `document.getElementById('cabinet-svg')` → clone the SVG DOM node
2. Strip interactive attributes: `data-*`, `pointer-events`, `cursor`, event handlers
3. Inline `fill` and `stroke` attributes from the material palette (removes Tailwind class dependencies)
4. Add a `<title>` element with the project name
5. Serialise via `XMLSerializer`, create `Blob('image/svg+xml')`, trigger `<a download="<name>.svg">` click

---

## 11. Testing Strategy

### 11.1 Unit Tests (Vitest)

**`src/engine/layoutEngine.test.ts`**
- Equal distribution among N unlocked siblings
- Locking cascade: middle, topmost, bottommost cases
- Thickness accounting: N boards consume N×thickness from available space
- Over-constraint: graceful proportional rescaling
- Zero-thickness edge case

**`src/engine/unitConversion.test.ts`**
- mm ↔ cm ↔ in round-trip accuracy
- Display formatting

### 11.2 Component Tests (Vitest + React Testing Library)

**`CabinetCanvas`** — renders correct count of void/divider elements from a known tree  
**`DimensionOverlay`** — click → input; commit → store update; Escape → cancel  
**`Toolbar`** — unit toggle converts all visible values  
**`ProjectTabs`** — create, rename, delete, switch projects  
**`CutListPanel`** — correct piece count and dimensions for a 3-shelf cabinet

### 11.3 Integration Tests

**Full user flow:**
1. Create project → set width=600, height=800, depth=500mm, thickness=18mm
2. Add shelf → internal height = 764mm; shelf = 18mm; each void = (764−18)/2 = **373mm**
3. Edit top void to 200mm → bottom void autoscales to 764−18−200 = **546mm**
4. Export SVG → verify SVG blob contains correct `<rect>` count

### 11.4 File Layout

```
src/
  engine/
    layoutEngine.ts
    layoutEngine.test.ts
    unitConversion.ts
    unitConversion.test.ts
  components/
    CabinetCanvas/
      CabinetCanvas.tsx
      CabinetCanvas.test.tsx
    DimensionOverlay/
      DimensionOverlay.tsx
      DimensionOverlay.test.tsx
    Toolbar/
      Toolbar.tsx
      Toolbar.test.tsx
    ProjectTabs/
      ProjectTabs.tsx
      ProjectTabs.test.tsx
    CutListPanel/
      CutListPanel.tsx
      CutListPanel.test.tsx
  utils/
    exportSVG.ts
  store/
    store.ts
    store.test.ts
```

---

## 12. COPILOT Instructions (`copilot-instructions.md`)

The root `copilot-instructions.md` will document:
- Project architecture (React + Vite + TypeScript, SVG canvas, Zustand + Immer)
- Tailwind CSS enforcement (no custom CSS files, no CSS modules, no inline styles except SVG geometry attributes)
- Cabinet tree data structure rules (see Section 3)
- Unit conversion rules (always store in mm; convert at display layer only)
- Mathematical precision rules (1 decimal place display; no intermediate unit conversions)
- Testing mandate (every new math function must have unit tests; every new interactive component must have RTL tests)

---

## 13. README

The root `README.md` will document:
- Project overview and purpose
- Local development setup (`npm install && npm run dev`)
- Testing (`npm run test`)
- Architecture overview (link to this spec)
- Key concepts: cabinet tree, autoscaling engine, unit handling
