# BuildBox — Canvas UX Phase A Design Spec

**Date:** 2026-05-22  
**Branch:** `canvas-ux`  
**Scope:** Phase A of a three-phase enhancement. Covers canvas maximisation, zoom controls, fit-all, and minimum font size. Phase B (multi-unit canvas) and Phase C (kitchen countertop) are separate specs.

---

## 1. Problem Statement

Four independent UX pain points identified in the existing BuildBox implementation:

1. **Canvas is too small.** A 272px cut list panel on the right permanently reduces canvas width.
2. **No zoom affordance beyond scroll wheel.** Users with trackpads or mice without scroll wheels cannot zoom.
3. **Dimension labels become unreadably small** when a large cabinet is zoomed out to fit the viewport.
4. **No "fit to screen" shortcut.** Users must manually scroll/zoom to find their cabinet after changing settings.

---

## 2. Goals

- Maximise canvas real estate by relocating the cut list into the existing sidebar.
- Provide on-screen zoom +/− buttons and a fit-all button.
- Ensure dimension labels are always exactly 14px on screen (constant size, fully counter-scaled against zoom).
- Keep architectural changes minimal and localised — no data model changes, no store changes.

---

## 3. Out of Scope (Phase A)

- Multi-unit / multi-cabinet canvas (Phase B).
- Kitchen countertop mode (Phase C).
- Cursor-centred zoom (scroll-wheel zoom is already implemented; only button zoom is added here).
- Zoom persistence across page reloads.
- Pan reset button (fit-all replaces this use case).

---

## 4. Architecture

### 4.1 Cut List Relocation

**Files changed:** `src/App.tsx`, `src/components/Sidebar/Sidebar.tsx`

The right panel div (`w-72`) is removed from `App.tsx`. `Sidebar` gains one new prop:

```ts
cutList: CutListEntry[]
```

At the bottom of the sidebar, a `<details>` section (collapsed by default, `open` omitted) renders a scrollable wrapper around `<CutListPanel entries={cutList} />`:

```tsx
<div className="max-h-64 overflow-y-auto">
  <CutListPanel entries={cutList} />
</div>
```

This caps the expanded cut list at 256px, keeping the Actions section always visible without requiring sidebar scrolling. The import of `CutListPanel` moves from `App.tsx` into `Sidebar.tsx`.

`App.tsx` computes `cutList` via `useMemo` (already present) and passes it down to `Sidebar`.

The canvas `<main>` layout becomes: sidebar (left, fixed width) + canvas (flex-1, takes all remaining space).

### 4.2 ZoomControls Component

**New file:** `src/components/CabinetCanvas/ZoomControls.tsx`

A stateless presentational component rendered inside `CabinetCanvas`'s wrapper `<div>` as an absolute overlay:

```tsx
interface Props {
  zoom: number
  onZoomIn: () => void
  onZoomOut: () => void
  onFitAll: () => void
}
```

Positioned: `absolute bottom-4 right-4 z-10`. Renders three buttons in a row: **−**, **+**, **⊡** (fit all).

Zoom limits are defined as module-level constants shared by both scroll-wheel and button handlers:
```ts
export const ZOOM_MIN = 0.05
export const ZOOM_MAX = 10
```

Zoom steps: zoom-in multiplies by `1.25`; zoom-out multiplies by `0.8`.

The `−` button is **disabled** when `zoom <= ZOOM_MIN`; the `+` button is **disabled** when `zoom >= ZOOM_MAX`. The `onWheel` handler in `CabinetCanvas` is updated to use the same `ZOOM_MIN`/`ZOOM_MAX` constants (replacing the current hardcoded `[0.2, 5]` clamp).

**Accessibility:** each button has `aria-label` ("Zoom in", "Zoom out", "Fit to screen"). Disabled buttons use `disabled` attribute.

### 4.3 Fit-All

The fit-all action resets zoom and pan to their natural starting state. The SVG's `viewBox` is already computed from `globalSettings` to frame the full cabinet (with 40mm padding on each side), so `zoom=1, pan=(0,0)` is the correct "fit" state — no viewport measurement needed.

```ts
// src/utils/fitAll.ts
export function computeFitAll(): { zoom: number; panX: number; panY: number } {
  // The SVG viewBox already frames the full cabinet at scale 1.
  // Fit-all simply resets the user-controlled zoom/pan transform.
  return { zoom: 1, panX: 0, panY: 0 }
}
```

`CabinetCanvas.handleFitAll` calls `computeFitAll()` and applies the result to `zoom`/`pan` state. No `wrapperRef` is needed.

### 4.4 Constant 14px Dimension Labels

**File changed:** `src/components/CabinetCanvas/DimensionLabels.tsx`

`DimensionLabels` gains a `zoom: number` prop (passed from `CabinetCanvas`).

The font size formula fully counter-scales the zoom transform so labels always appear as exactly 14px on screen regardless of zoom level:

```ts
const fontSize = 14 / zoom
```

Behaviour:
- At `zoom = 0.5`: `fontSize = 28` SVG units → 28 × 0.5 = **14px** on screen ✓
- At `zoom = 1.0`: `fontSize = 14` SVG units → **14px** on screen ✓
- At `zoom = 2.0`: `fontSize = 7` SVG units → 7 × 2 = **14px** on screen ✓

Label y-offset also scales with `fontSize` to prevent text overflowing void boundaries:
```ts
// Width label (horizontal): y = v.y + fontSize + 2
// Height label (vertical): x = v.x + fontSize + 2
```

**Lock icon scaling:** The lock icon `<g>` transform uses `scale(1/zoom)` applied at the icon's position, so it counteracts the zoom and remains a constant screen size:
```ts
transform={`translate(${v.x + v.w - 18}, ${v.y + 4}) scale(${1 / zoom})`}
```

---

## 5. Component Interfaces

### `ZoomControls` props
```ts
interface ZoomControlsProps {
  zoom: number          // used to derive disabled states
  onZoomIn: () => void  // disabled when zoom >= ZOOM_MAX
  onZoomOut: () => void // disabled when zoom <= ZOOM_MIN
  onFitAll: () => void
}
```

### `Sidebar` props (addition only)
```ts
cutList: CutListEntry[]   // new — passed from App.tsx
```

### `DimensionLabels` props (addition only)
```ts
zoom: number   // new — passed from CabinetCanvas
```

---

## 6. Data Flow

```
App
  └─ useMemo → cutList
  └─ Sidebar (cutList prop) → CutListPanel (collapsed, max-h-64 scrollable section at bottom)

CabinetCanvas (holds: zoom, panX, panY state; ZOOM_MIN=0.05, ZOOM_MAX=10)
  ├─ ZoomControls (overlay, bottom-right)
  │    onZoomIn  → setZoom(z => Math.min(ZOOM_MAX, z * 1.25))  [disabled at ZOOM_MAX]
  │    onZoomOut → setZoom(z => Math.max(ZOOM_MIN, z * 0.8))   [disabled at ZOOM_MIN]
  │    onFitAll  → computeFitAll() → setZoom(1) + setPan({x:0,y:0})
  ├─ onWheel → clamp to [ZOOM_MIN, ZOOM_MAX] (replaces hardcoded [0.2, 5])
  └─ DimensionLabels (zoom prop) → fontSize = 14/zoom (constant 14px screen size)
                                 → lock icon scale(1/zoom)
```

---

## 7. New & Changed Files

| File | Change |
|------|--------|
| `src/App.tsx` | Remove right panel div; pass `cutList` to `Sidebar` |
| `src/components/Sidebar/Sidebar.tsx` | Add `cutList` prop; render `CutListPanel` at bottom |
| `src/components/CabinetCanvas/CabinetCanvas.tsx` | Render `ZoomControls`; add `handleFitAll`; pass `zoom` to `DimensionLabels`; update `onWheel` clamp to `[ZOOM_MIN, ZOOM_MAX]` |
| `src/components/CabinetCanvas/ZoomControls.tsx` | **New** — presentational overlay |
| `src/components/CabinetCanvas/ZoomControls.test.tsx` | **New** — 3 tests |
| `src/components/CabinetCanvas/DimensionLabels.tsx` | Accept `zoom` prop; apply font formula |
| `src/utils/fitAll.ts` | **New** — pure `computeFitAll` function |
| `src/utils/fitAll.test.ts` | **New** — unit tests for fit algorithm |

---

## 8. Tests & Success Criteria

### Unit tests (`fitAll.test.ts`)
1. `computeFitAll()` returns `{ zoom: 1, panX: 0, panY: 0 }` — the natural fit state.

### Component tests (`ZoomControls.test.tsx`)
1. Clicking "Zoom in" calls `onZoomIn`
2. Clicking "Zoom out" calls `onZoomOut`
3. Clicking "Fit to screen" calls `onFitAll`
4. "Zoom in" button is disabled when `zoom >= ZOOM_MAX`
5. "Zoom out" button is disabled when `zoom <= ZOOM_MIN`

### Unit tests (`DimensionLabels` font formula)
1. `14 / 0.5 = 28` SVG units at zoom=0.5 → 28 × 0.5 = 14px on screen
2. `14 / 2.0 = 7` SVG units at zoom=2.0 → 7 × 2 = 14px on screen
3. `14 / 1.0 = 14` SVG units at zoom=1.0 → 14px on screen

### Integration (extend existing `cabinetFlow.test.tsx`)
1. Sidebar contains a `<details>` element with summary matching `/cut list/i`
2. The right-side panel (`data-testid="cutlist-panel-right"`) is no longer in the DOM
3. After clicking "Fit to screen", zoom is reset to 1

### Visual verification (manual)
- Open a 2000mm × 1000mm cabinet → labels are 14px at any zoom level
- Click "−" until disabled → cabinet is very small but labels remain 14px
- Click "⊡" → cabinet snaps back to natural fitted view

---

## 9. Non-Goals / Explicitly Excluded

- Cursor-centred zoom on scroll (existing scroll zoom behaviour unchanged)
- Zoom level displayed as percentage (not needed for Phase A)
- Animated zoom transitions
- Keyboard shortcuts for zoom (+/- keys) — can be added in Phase B/C if needed
