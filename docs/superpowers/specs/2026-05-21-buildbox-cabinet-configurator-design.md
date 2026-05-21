# BuildBox — 2D Cabinet Design Configurator
## Design Specification
**Date:** 2026-05-21 (revised after adversarial review)
**Stack:** React + Vite + TypeScript, Tailwind CSS, Zustand + Immer + zundo, SVG canvas
**Repo:** git@github.com:chryston/buildbox.git

---

## 1. Overview

BuildBox is a single-page web application for fast iteration of custom carpentry designs. Users configure a 2D front-facing elevation of a cabinet, partition it with shelves and dividers, assign element types (drawers, hanging spaces), and export the result as an SVG. A live cut-list panel surfaces the exact dimensions of every wood piece and hardware item required.

**Goals:**
- Interactive, pixel-accurate 2D canvas for cabinet layout
- Autoscaling engine that preserves overall dimensions when sections are edited
- Multiple named project support with localStorage persistence
- SVG export of the designed cabinet
- Undo/redo via Zustand temporal middleware (zundo)
- Zoom (scroll wheel) and pan (background drag) on the canvas

**Non-goals (v1):**
- 3D view
- Cloud sync / user accounts
- PDF or CSV export (SVG only)
- Python backend (all math is client-side TypeScript)
- Touch / mobile device support (desktop only)
- Face frames, doors, applied drawer fronts
- Per-panel outer-frame material override (outer frame always uses `defaultMaterial`)

---

## 2. Stack & Tooling

| Concern | Choice |
|---|---|
| Framework | React 18 + Vite + TypeScript |
| Styling | Tailwind CSS only (no custom CSS, no CSS modules, no inline styles except SVG geometry attrs) |
| State | Zustand with Immer middleware + zundo temporal middleware (undo/redo) |
| Testing | Vitest + React Testing Library |
| Canvas | SVG (rendered as React JSX) |
| Persistence | Zustand `persist` middleware → `localStorage` key `buildbox-v1` |
| Export | SVG DOM clone → Blob URL → `<a download>` |

---

## 3. Data Model

All dimensions are stored internally in **millimetres (mm)**. Unit conversion is a display-layer concern only. This prevents floating-point drift from repeated round-trips between units.

### 3.1 Design Constraint: Binary Splits Only

The tree model uses **binary splits** — every `addShelf` or `addDivider` operation creates exactly 2 children. This is a deliberate design choice:
- It keeps the tree traversal and locking cascade simple and deterministic.
- It means N equal sections require O(N) nesting depth (fine in practice for real cabinets ≤12 levels deep).
- Cross-sibling proportional redistribution only works within one parent; this is an intentional scope limit.

### 3.2 Core Types

```ts
type Unit = 'mm' | 'cm' | 'in';
type SplitAxis = 'horizontal' | 'vertical';
type MaterialId = 'oak' | 'walnut' | 'white' | 'birch' | 'mdf';
type ElementType = 'void' | 'drawer' | 'hanging-space';
type AccessoryType = 'hanging-rail';
type SlideType = 'side-mount' | 'undermount';

interface DrawerConfig {
  slideType: SlideType;
  reveal: number;         // mm gap between drawer face and adjacent faces (default: 2mm)
}

interface GlobalSettings {
  unit: Unit;             // display unit (default: mm)
  height: number;         // mm — external cabinet height (default: 800)
  width: number;          // mm — external cabinet width (default: 600)
  depth: number;          // mm — external cabinet depth (default: 500)
  thickness: number;      // mm — carcass material thickness (default: 18)
  backThickness: number;  // mm — back panel material thickness (default: 6)
  defaultMaterial: MaterialId;
  toeKick: ToeKick | null; // structural toe-kick; null = no toe-kick
}

interface ToeKick {
  height: number;     // mm — vertical height of the toe-kick section
  setback: number;    // mm — horizontal recess from cabinet face (default: 50)
}

interface Accessory {
  id: string;
  type: AccessoryType;
  heightFromBottom: number;  // mm offset from bottom of parent void (in cabinet domain coords)
}

interface Divider {
  id: string;
  materialId: MaterialId;    // defaults to globalSettings.defaultMaterial
}

interface CabinetNode {
  id: string;
  type: 'leaf' | 'container';
  // Leaf-only fields
  elementType?: ElementType;       // default: 'void'
  drawerConfig?: DrawerConfig;     // only when elementType === 'drawer'
  accessories?: Accessory[];       // hanging rails etc.
  materialId?: MaterialId;         // per-void material override; fallback to defaultMaterial
  // Container-only fields
  splitAxis?: SplitAxis;
  children?: CabinetNode[];        // always exactly 2 (binary splits only)
  dividers?: Divider[];            // always exactly 1 (length === children.length - 1)
  // Locking (applies to leaf nodes only; set by explicit user dimension input)
  locked?: boolean;
  fixedSize?: number;              // mm — valid only when locked === true
}

interface CabinetDesign {
  id: string;
  name: string;
  root: CabinetNode;
  globalSettings: GlobalSettings;
  createdAt: number;   // Unix timestamp ms
  updatedAt: number;
}
```

### 3.3 Tree Invariants

- A `leaf` node has no `children`, `dividers`, or `splitAxis`.
- A `container` node has exactly `children.length === 2` and `dividers.length === 1`.
- Only leaf nodes can have `elementType`, `accessories`, `drawerConfig`, and `materialId`.
- `fixedSize` is always in mm regardless of the active display unit.
- `locked` / `fixedSize` may only be set on leaf nodes (not containers). Container dimensions are fully derived.
- Root node dimensions are controlled exclusively via `GlobalSettings`. `setNodeSize` must guard against being called on the root.
- A node with `elementType === 'drawer'` may not be subdivided (Add Shelf / Add Divider blocked).
- MAX_TREE_DEPTH = 12. `addShelf` / `addDivider` must block if depth would exceed this.

### 3.4 Default New Project State

On first boot with no localStorage, or when `createProject` is called, create:
```ts
{
  name: 'My Cabinet',
  root: { id: uuid(), type: 'leaf', elementType: 'void' },
  globalSettings: {
    unit: 'mm',
    height: 800, width: 600, depth: 500,
    thickness: 18, backThickness: 6,
    defaultMaterial: 'mdf',
    toeKick: null,
  }
}
```

---

## 4. Math Engine

**File:** `src/engine/layoutEngine.ts`
**Principle:** Pure TypeScript functions only. No React imports. 100% unit-testable in isolation.

All layout computation produces **cabinet-domain coordinates**: origin at top-left of the outer cabinet box. x increases right, y increases downward (matching SVG convention — this is intentional and explicit; "top" = minimum y).

### 4.1 Coordinate Convention

- Origin (0, 0) = top-left corner of the outer cabinet (including outer panels).
- x increases rightward; y increases downward (SVG coordinate space, intentionally aligned).
- "Top" in domain language = minimum y. "Bottom" = maximum y.
- `Accessory.heightFromBottom` converts to SVG y via: `svgY = parentNode.y + parentNode.height - accessory.heightFromBottom`
- All positions and sizes are in mm until the final render step.

### 4.2 Layout Computation

```ts
computeLayout(design: CabinetDesign): LayoutItem[]
```

Returns a flat list of positioned rectangles (voids, dividers, and outer panels) in mm. The SVG render layer applies `scaleFactor = svgPixelWidth / cabinetMM_width` to convert to screen coordinates.

**Algorithm (recursive):**

1. Emit four outer `LayoutPanel` items (top, bottom, left, right) using `globalSettings.thickness`.
2. If `toeKick` is set, subtract `toeKick.height` from the bottom panel allocation — the internal layout starts `toeKick.height` mm above the bottom panel's inner edge. The toe-kick area does NOT enter the tree; it is a fixed structural element.
3. Compute internal root bounds:
   - `x0 = thickness`, `y0 = thickness`
   - `innerWidth = width − 2 × thickness`
   - `innerHeight = height − 2 × thickness − (toeKick?.height ?? 0)`
4. For each `container` node with 2 children and 1 divider:
   - `available = parentDimension − thickness` (1 divider × thickness)
   - Locked child claims its `fixedSize` (clamped to `max(MIN_SECTION_SIZE, fixedSize)`).
   - Unlocked child receives `available − lockedSize`.
5. Positions accumulate left-to-right (vertical split) or top-to-bottom (horizontal split).

**MIN_SECTION_SIZE = 50mm.** Locking cascade must not squeeze any sibling below this.

### 4.3 Locking Cascade

**Only explicit dimension input (typing a value) creates locks.** Dragging never locks nodes.

When a user types a new value for a void's editable axis:
1. Set `node.locked = true`, `node.fixedSize = clamp(inputValue, MIN_SECTION_SIZE, available − MIN_SECTION_SIZE)`.
2. The sibling's `locked` flag is cleared and `fixedSize` removed — it absorbs freely.
3. Re-run `computeLayout` — the sibling gets whatever space remains.

Since the tree is binary (always 2 children), "sibling" is unambiguous: the other child in the parent container.

**Over-constraint (both siblings locked):** If the sum of locked `fixedSize` values exceeds `available`:
- The engine computes *effective* sizes proportionally for layout only: `effectiveSize = fixedSize × (available / sum)`.
- **`fixedSize` values are NOT mutated.** The user's intent is preserved.
- A `WarningBanner` component (see §5) is shown in `CanvasArea` reading: *"Locked sizes exceed available space — proportional scaling applied. Unlock a section to restore exact dimensions."* — dismissible, disappears when constraint resolves.

### 4.4 Unit Conversion

```ts
// src/engine/unitConversion.ts
toDisplay(mm: number, unit: Unit): number   // returns numeric value in display unit
fromDisplay(value: number, unit: Unit): number   // returns mm
formatDisplay(mm: number, unit: Unit): string
// mm  → "473 mm"
// cm  → "47.3 cm"
// in  → fractional: nearest 1/16" → "18 11/16\"" (or whole: "3/4\"" for 19.05mm)
```

Conversion factors: `1 cm = 10 mm`, `1 in = 25.4 mm`.
Fractional inch rounding: `round(mm / 25.4 × 16) / 16` → rendered as proper fraction (e.g. `11/16`, `1 3/8`).

### 4.5 Drag Pixel→mm Conversion

Drag interactions require converting screen pixel deltas to mm. At `pointerdown`, capture:

```ts
const scaleFactor = cabinetWidth_mm / svgElement.getBoundingClientRect().width;
// pixels × scaleFactor = mm
```

Re-capture at `pointerdown` (not during drag) as the SVG may be resized by window resize events.
When zoom is active, also apply the zoom scale: `mmDelta = pixelDelta × scaleFactor / zoomLevel`.

### 4.6 Layout Output Types

```ts
interface LayoutVoid {
  kind: 'void';
  nodeId: string;
  x: number; y: number; width: number; height: number;  // mm
  elementType: ElementType;
  drawerConfig?: DrawerConfig;
  accessories: Accessory[];
  locked: boolean;
  materialId: MaterialId;
}

interface LayoutDivider {
  kind: 'divider';
  dividerId: string;
  parentNodeId: string;
  axis: SplitAxis;           // axis of the PARENT split (divider is perpendicular to split)
  x: number; y: number; width: number; height: number;  // mm
  materialId: MaterialId;
}

interface LayoutPanel {
  kind: 'panel';
  role: 'top' | 'bottom' | 'left' | 'right' | 'toe-kick-board';
  x: number; y: number; width: number; height: number;  // mm
  materialId: MaterialId;  // always globalSettings.defaultMaterial in v1
}

type LayoutItem = LayoutVoid | LayoutDivider | LayoutPanel;
```

### 4.7 Tree Mutation Utilities

**File:** `src/engine/treeMutations.ts` — pure functions, no store dependencies.

```ts
resizeNode(root: CabinetNode, nodeId: string, newSizeMm: number, thickness: number): CabinetNode
addShelf(root: CabinetNode, nodeId: string, thickness: number): CabinetNode
addDivider(root: CabinetNode, nodeId: string, thickness: number): CabinetNode
deleteBoard(root: CabinetNode, dividerId: string): CabinetNode
setNodeElement(root: CabinetNode, nodeId: string, type: ElementType): CabinetNode
setNodeMaterial(root: CabinetNode, nodeId: string, mat: MaterialId): CabinetNode
setDividerMaterial(root: CabinetNode, dividerId: string, mat: MaterialId): CabinetNode
unlockNode(root: CabinetNode, nodeId: string): CabinetNode
findNode(root: CabinetNode, id: string): CabinetNode | null
findDividerContext(root: CabinetNode, dividerId: string): { parent: CabinetNode; index: number } | null
```

The Zustand store actions are thin wrappers calling these functions via Immer produce.

---

## 5. Component Architecture

```
App
 ProjectTabs                    ← list of CabinetDesign names; create / rename / delete
 Toolbar                        ← GlobalSettings inputs + unit toggle + snap grid control
   └── ToeKickPanel               ← enable/configure toe-kick
 MainLayout
   ├── Sidebar
   │   ├── ActionPanel            ← Add Shelf / Add Divider / Delete Board buttons
   │   ├── ElementTypePanel       ← assign ElementType to selected void
   │   ├── DrawerConfigPanel      ← drawer config (slide type, reveal) — shown when drawer selected
   │   ├── MaterialPanel          ← per-panel material override (selected node or divider)
   │   ├── AccessoryPanel         ← add/remove hanging rails on selected void
   │   └── CutListPanel           ← summary of all wood pieces + hardware
   └── CanvasArea
 WarningBanner          ← dismissible over-constraint warning       ├
       ├── CabinetCanvas (SVG)
       │   ├── PanelLayer         ← outer frame panels (incl. toe-kick board if set)
       │   ├── VoidLayer          ← leaf node rectangles (clickable, selectable)
       │   ├── DividerLayer       ← divider rectangles (clickable)
       │   ├── AccessoryLayer     ← hanging rails as SVG <line> elements
       │   ├── DimensionLabels    ← SVG <text> labels per void (H on horizontal edge, W on vertical edge)
       │   ├── DragHandles        ← transparent hit-strips on dividers (±8 screen px, non-scaling)
       │   └── SnapGuides         ← ghost lines shown during drag near snap targets
       ├── DimensionEditor        ← floating HTML <input> (outside SVG, portal-rendered), one at a time
       ├── ZoomControls           ← zoom in/out buttons + reset
       └── ExportButton           ← triggers SVG export
```

### 5.1 Selection Model

`selectedId: string | null` in the Zustand store. Can be a node ID (void) or divider ID. Clicking the canvas background deselects. The Sidebar panels react to selection.

### 5.2 Sidebar Panel Visibility

| Selection | Visible panels |
|---|---|
| Nothing | ActionPanel (disabled), CutListPanel |
| Void (non-drawer) | ActionPanel, ElementTypePanel, MaterialPanel, AccessoryPanel |
| Void (drawer) | ActionPanel (Add Shelf/Divider disabled), ElementTypePanel, DrawerConfigPanel, MaterialPanel |
| Divider | MaterialPanel (for that divider), Delete action in ActionPanel |

### 5.3 Dimension Labels (SVG `<text>`)

Each void has two labels rendered as SVG `<text>` elements:
- **Height label**: centred on the left edge of the void (vertical text, rotated -90°). Shows formatted height. Greyed out when height is fixed by an ancestor (the void's parent is a horizontal split of a locked parent — in practice: always editable since we have binary trees and only leaves lock).
- **Width label**: centred on the top edge of the void. Shows formatted width.

Clicking a label activates `DimensionEditor` for the corresponding axis.

### 5.4 DimensionEditor (Floating HTML Overlay)

A single `<input>` element rendered in a React Portal to `document.body`, positioned via `element.getBoundingClientRect()` of the target SVG `<text>` label. It floats above the SVG in normal DOM flow, avoiding all `foreignObject` issues.

- Shows current formatted dimension pre-filled.
- Accepts a number in the current unit.
- Enter / blur → `fromDisplay(value, unit)` → `store.setNodeSize(nodeId, mm)`.
- Escape → close without commit.
- On window resize, re-position or close.

### 5.5 Lock Indicator

Each dimension label has a small lock icon (SVG `<g>`) adjacent to it. Clicking the icon calls `store.unlockNode(nodeId)` — releases the lock and re-enables autoscaling for that dimension. Icon is visually filled (🔒) when locked, outlined (🔓) when unlocked.

### 5.6 Viewport Model (Zoom & Pan)

The `CabinetCanvas` SVG uses a `viewBox` that starts fitting the full cabinet with 20mm padding on all sides. Zoom and pan are implemented via SVG `transform` on an inner `<g>` container:

- **Zoom**: `wheel` event on the SVG → update `zoomLevel` (range: 0.2× – 5×). Zoom towards cursor position.
- **Pan**: `pointerdown` on SVG background (no hit target) → `pointermove` to translate → `pointerup` to commit.
- Zoom state (`zoomLevel`, `panOffset`) lives in **local React state** in `CabinetCanvas` (not in the Zustand store — it is ephemeral view state).
- Drag hit areas and snap thresholds must be computed in screen-pixel space accounting for zoom (see §4.5).

---

## 6. Interaction Model

### 6.1 Dimension Editing (Click-to-Edit)

Clicking a dimension `<text>` label activates the floating `DimensionEditor`:
- Only the **editable axis** for that void is active. The other axis is informational only.
- Editable axis = the split axis of the void's parent container (horizontal parent → height editable; vertical parent → width editable).
- Root leaf (no parent split yet) → both axes are informational (use GlobalSettings to change cabinet dimensions).

### 6.2 Drag to Resize

Each divider has a transparent `<rect>` drag-handle (±8 **screen pixels** converted to SVG units via scale factor — use `vector-effect="non-scaling-stroke"` equivalently via computed width). Interaction:

1. `pointerdown` → capture pointer; record cursor start position; capture `scaleFactor` and current `zoomLevel`.
2. `pointermove` → **update ephemeral drag state via `useRef`** and direct SVG attribute mutation (`element.setAttribute`) — do NOT write to Zustand store during drag. This avoids 60fps React renders.
3. Apply snapping to the computed mm position.
4. `pointerup` → commit final positions to Zustand store via tree mutation. **Dragging does NOT lock nodes.** The adjacent nodes' `fixedSize` is not set; they remain unlocked and participate in autoscaling.

### 6.3 Snapping

Snap priority (applied in order to the dragged position in mm):
1. **Grid snap**: nearest multiple of `snapGrid` mm (default: 5mm, configurable in Toolbar).
2. **Element snap**: within 10mm (screen-space, adjusted for zoom) of any other divider/shelf position → snap to it. A temporary `SnapGuide` SVG `<line>` is drawn.

### 6.4 Add Shelf (horizontal split)

On selected leaf node `N`:
1. `addShelf(root, nodeId, thickness)` → converts `N` to `container { splitAxis: 'horizontal', children: [leaf, leaf], dividers: [{ id, materialId: defaultMaterial }] }`.
2. Both children are unlocked (equal split).
3. Blocked if: `N.elementType === 'drawer'` or tree depth would exceed MAX_TREE_DEPTH.

### 6.5 Add Divider (vertical split)

Same as 6.4 but `splitAxis: 'vertical'`.

### 6.6 Delete Board

Select a divider, click Delete (or press Delete/Backspace key):
- Precondition: both children adjacent to this divider must be leaf nodes. If not: show inline error *"Remove nested subdivisions first."* This constraint comes from the binary tree model — merging two subtrees is architecturally undefined in v1.
- If valid: `deleteBoard(root, dividerId)` → merges both leaf siblings into a single leaf with `elementType: 'void'`, `locked: false`, no `fixedSize`.

### 6.7 Global Dimension Changes

When `globalSettings.width`, `globalSettings.height`, or `globalSettings.thickness` changes:
- Re-run `computeLayout`. Over-constraint handling applies automatically.
- Show `WarningBanner` if any locked sizes now exceed available space.
- If `thickness` changes: show a confirmation dialog first — *"Changing material thickness may rescale locked sections. Continue?"*

---

## 7. Cut-List Panel

Derives from `computeLayout()` output + `globalSettings`.

### 7.1 Board Entries

| Component | Qty | Dimensions (W × H × D) |
|---|---|---|
| Side panels | 2 | `thickness × height × depth` |
| Top panel | 1 | `(width − 2t) × thickness × depth` |
| Bottom panel | 1 | `(width − 2t) × thickness × depth` |
| Back panel | 1 | `(width − 2t) × (height − 2t) × backThickness` |
| Toe-kick board | 1 (if set) | `(width − 2t) × toeKick.height × thickness` |
| Each horizontal divider (shelf) | 1 | `LayoutDivider.width × thickness × depth` (from layout output) |
| Each vertical divider | 1 | `thickness × LayoutDivider.height × depth` (from layout output) |

**Note on toe-kick and side panels:** When a toe-kick is set, side panels remain full `height` — the toe-kick area is handled by a separate kick board + separate return pieces (defined as part of the toe-kick board entry). v1 does not model side-panel notching for toe-kicks.

**Drawer box entries** (when `elementType === 'drawer'`, per LayoutVoid):

Variables:
- `W` = `LayoutVoid.width` (void width in mm)
- `H` = `LayoutVoid.height` (void height in mm)
- `D` = `globalSettings.depth`
- `t` = `globalSettings.thickness`
- `r` = `drawerConfig.reveal` (mm)
- `sideClearance` = 25mm if `slideType === 'side-mount'`, 0mm if `slideType === 'undermount'`
- `faceHeight` = `H − r` (drawer face = void height minus reveal)
- `boxHeight` = `faceHeight − 12mm` (standard clearance below face)
- `boxWidth` = `W − 2 × sideClearance`
- `boxDepth` = `D − t` (box sits behind the face)

| Piece | Qty | Dimensions |
|---|---|---|
| Drawer face | 1 | `W × faceHeight × t` |
| Drawer sides | 2 | `t × boxHeight × boxDepth` |
| Drawer back | 1 | `(boxWidth − 2t) × boxHeight × t` |
| Drawer bottom | 1 | `(boxWidth − 2t) × boxDepth × (t/3)` (6mm ply) |

### 7.2 Hardware Entries

| Component | Qty | Dimension |
|---|---|---|
| Hanging rail | 1 per accessory | `LayoutVoid.width` mm (rod length) |
| Drawer slides | 1 pair per drawer void | `boxDepth` mm (slide length) |

All dimensions shown in the active display unit. Fractional inches for `unit === 'in'`.

---

## 8. State Management

### 8.1 Zustand Store Shape

```ts
interface AppStore {
  // Data
  projects: CabinetDesign[];
  activeProjectId: string;

  // UI (NOT persisted)
  selectedId: string | null;
  snapGrid: number;   // mm, default 5
  overConstrainedNodeIds: string[];  // populated by computeLayout warning path

  // Project actions
  createProject(name: string): void;
  renameProject(id: string, name: string): void;
  /** On deletion: if deleted was active, set active to first remaining project.
   *  If no projects remain, auto-create a new default project. */
  deleteProject(id: string): void;
  setActiveProject(id: string): void;

  // Settings
  updateSettings(patch: Partial<GlobalSettings>): void;

  // Tree mutations (thin wrappers over treeMutations.ts)
  addShelf(nodeId: string): void;
  addDivider(nodeId: string): void;
  deleteBoard(dividerId: string): void;
  setNodeSize(nodeId: string, sizeMm: number): void;  // sets locked=true; guards against root
  unlockNode(nodeId: string): void;                    // clears locked + fixedSize
  setNodeElement(nodeId: string, type: ElementType): void;
  setNodeMaterial(nodeId: string, mat: MaterialId): void;
  setDividerMaterial(dividerId: string, mat: MaterialId): void;
  setDrawerConfig(nodeId: string, config: DrawerConfig): void;
  addAccessory(nodeId: string, type: AccessoryType): void;
  removeAccessory(nodeId: string, accessoryId: string): void;

  // Selection
  setSelected(id: string | null): void;

  // Snap
  setSnapGrid(mm: number): void;
}
```

### 8.2 Undo / Redo

Wrap the store with `zundo` temporal middleware:
```ts
import { temporal } from 'zundo';
// Only track structural mutations in history (not UI state like selectedId, snapGrid)
// partialize: (state) => ({ projects: state.projects, activeProjectId: state.activeProjectId })
```

Expose `undo()` / `redo()` / `canUndo` / `canRedo` from the temporal store.
Keyboard: `Ctrl+Z` → undo, `Ctrl+Shift+Z` / `Ctrl+Y` → redo.

### 8.3 Computed Layout (Memoisation)

```ts
// In CabinetCanvas component:
const layoutItems = useMemo(
  () => computeLayout(activeDesign),
  [activeDesign.root, activeDesign.globalSettings]
);
```

Do not re-run `computeLayout` on `selectedId`, `snapGrid`, zoom, or pan changes.

### 8.4 Persistence

Zustand `persist` middleware writes `{ projects, activeProjectId }` to `localStorage` under key `buildbox-v1`.

On `QuotaExceededError`: surface a toast notification — *"Storage limit reached. Delete unused projects to free space."* Do not silently fail.

UI state (`selectedId`, `snapGrid`, zoom, pan) is not persisted.

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

- Leaf voids use `node.materialId ?? globalSettings.defaultMaterial`.
- Dividers use `divider.materialId` (defaults to `defaultMaterial` on creation).
- Outer frame panels always use `defaultMaterial` in v1.

---

## 10. SVG Export

`src/utils/exportSVG.ts`:

1. Accept a React `ref` to the `<svg>` element (not `document.getElementById`).
2. Clone the SVG DOM node (`svgEl.cloneNode(true)`).
3. Remove the inner `<g>` zoom/pan transform — reset viewBox to fit cabinet with 10mm padding.
4. Strip interactive attributes: `data-*`, `pointer-events`, `cursor`, `class` (Tailwind).
5. Inline `fill` and `stroke` from `MATERIALS` lookup on all elements.
6. Strip `<DragHandle>` rects (invisible hit targets).
7. Strip `<SnapGuide>` lines.
8. Add `<title>` with project name and `<desc>` with dimensions.
9. Dimension labels (`<text>`) remain in the export.
10. Serialise via `XMLSerializer`, create `Blob('image/svg+xml')`, trigger `<a download="<name>.svg">` click.

---

## 11. Testing Strategy

### 11.1 Unit Vitest (Tests `src/engine/`) 

**`layoutEngine.test.ts`**
- Equal distribution — 2 unlocked siblings in horizontal split
- Single locked sibling — unlocked sibling absorbs remainder
- Thickness accounting — 1 divider consumes `thickness` from available
- Over-constraint — both locked, sum > available → proportional scaling; `fixedSize` values unchanged
- Minimum section size — locked size below 50mm is clamped
- Toe-kick subtraction — innerHeight reduced by toeKick.height
- Deep nesting — 4-level tree produces correct flat layout

**`treeMutations.test.ts`**
- `addShelf` on leaf → binary container with 2 equal leaf children
- `addShelf` on drawer void → throws / returns unchanged (blocked)
- `deleteBoard` → merges 2 leaf siblings to 1 void leaf
- `deleteBoard` on container sibling → throws / error
- `resizeNode` → locks target, sibling absorbs; MIN_SECTION_SIZE enforced
- `unlockNode` → clears lock, sibling free again
- `findDividerContext` → finds correct parent and index

**`unitConversion.test.ts`**
- mm → cm → mm round-trip
- mm → in (fractional) formatting: 18mm → `"11/16"`, 25.4mm → `"1"`, 38.1mm → `"1 1/2"`
- `fromDisplay` for all three units

### 11.2 Component Tests (Vitest + React Testing Library)

**`CabinetCanvas`** — renders correct count of voids/dividers from a known fixture tree
**`DimensionLabels`** — shows two labels per void; height label greyed when parent is vertical split
**`DimensionEditor`** — click label → input appears; commit → `store.setNodeSize` called; Escape → no call
**`Toolbar`** — unit toggle converts all visible values; thickness change shows confirmation dialog
**`ProjectTabs`** — create, rename, delete, switch; `deleteProject` on active switches to next
**`CutListPanel`** — correct piece count and dimensions for 3-shelf cabinet fixture

### 11.3 Integration Tests

**Full user flow:**
1. Create project → defaults: 600×800×500mm, thickness 18mm
2. Add shelf → `computeLayout` → two equal unlocked voids: (800 − 2×18 − 18) / 2 = **373mm** each
3. Type `200` in top void height → top locks to 200mm, bottom = 800−36−18−200 = **546mm**
4. Unlock top void → both equal again: **373mm** each
5. Export SVG → verify no `<foreignObject>`, verify `<title>` present, verify dimension `<text>` nodes

**Drag test:**
- Simulate `pointerdown → pointermove → pointerup` sequence on a divider
- Verify Zustand store is NOT called during `pointermove`
- Verify Zustand store IS called on `pointerup` with correct mm value
- Verify nodes remain unlocked after drag

**Undo/redo test:**
- Add shelf → undo → verify root is leaf again → redo → verify 2 children

**localStorage test:**
- Write projects to store → `JSON.parse(localStorage.getItem('buildbox-v1'))` → verify structure

### 11.4 File Layout

```
src/
  engine/
    layoutEngine.ts
    layoutEngine.test.ts
    treeMutations.ts
    treeMutations.test.ts
    unitConversion.ts
    unitConversion.test.ts
  components/
    CabinetCanvas/
      CabinetCanvas.tsx
      CabinetCanvas.test.tsx
      DimensionLabels.tsx
      DimensionLabels.test.tsx
      DragHandles.tsx
    DimensionEditor/
      DimensionEditor.tsx
      DimensionEditor.test.tsx
    Toolbar/
      Toolbar.tsx
      Toolbar.test.tsx
    ProjectTabs/
      ProjectTabs.tsx
      ProjectTabs.test.tsx
    CutListPanel/
      CutListPanel.tsx
      CutListPanel.test.tsx
    WarningBanner/
      WarningBanner.tsx
  utils/
    exportSVG.ts
  store/
    store.ts
    store.test.ts
```

---

## 12. COPILOT Instructions (`copilot-instructions.md`)

The root `copilot-instructions.md` must document:
- Project architecture (React + Vite + TypeScript, SVG canvas, Zustand + Immer + zundo)
- Tailwind CSS enforcement (no custom CSS files, no CSS modules, no inline styles except SVG `x/y/width/height` geometry attributes)
- Cabinet tree data structure rules (see §3) — binary splits only, MAX_TREE_DEPTH = 12
- Coordinate convention: cabinet-domain coordinates; y increases downward; all values in mm until render
- Unit conversion rules: always store in mm; convert at display layer only; inches = fractional 1/16"
- Minimum section size: MIN_SECTION_SIZE = 50mm
- Drag state: ephemeral via `useRef` + direct SVG mutation; Zustand only on `pointerup`
- Locking rule: only explicit dimension input locks; dragging never locks
- Testing mandate: every new math function needs unit tests; every interactive component needs RTL tests; no exceptions

---

## 13. README

The root `README.md` must document:
- Project overview and purpose
- Local development setup (`npm install && npm run dev`)
- Testing (`npm run test`)
- Architecture overview (link to this spec)
- Key concepts: cabinet tree, autoscaling engine, unit handling, binary-split model
