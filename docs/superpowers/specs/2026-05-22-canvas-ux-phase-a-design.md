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
- Ensure dimension labels are always at least 12px on screen (minimum readable size).
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

At the bottom of the sidebar, a `<details>` section (collapsed by default, `open` omitted) renders `<CutListPanel entries={cutList} />`. The import of `CutListPanel` moves from `App.tsx` into `Sidebar.tsx`.

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

Zoom constraints: min `0.05`, max `10`.  
Zoom steps: zoom-in multiplies by `1.25`; zoom-out multiplies by `0.8`.

**Accessibility:** each button has `aria-label` ("Zoom in", "Zoom out", "Fit to screen").

### 4.3 Fit-All Algorithm

Implemented as a pure function (testable in isolation):

```ts
// src/utils/fitAll.ts
export function computeFitAll(
  cabinetWidthMm: number,
  cabinetHeightMm: number,
  viewportWidthPx: number,
  viewportHeightPx: number,
  paddingFactor = 0.9,
): { zoom: number; panX: number; panY: number } {
  const zoom = Math.min(
    viewportWidthPx / cabinetWidthMm,
    viewportHeightPx / cabinetHeightMm,
  ) * paddingFactor
  const panX = (viewportWidthPx - cabinetWidthMm * zoom) / 2
  const panY = (viewportHeightPx - cabinetHeightMm * zoom) / 2
  return { zoom, panX, panY }
}
```

`CabinetCanvas` calls this in its `handleFitAll` callback using:
- `cabinetWidthMm / cabinetHeightMm` from `design.globalSettings`
- `viewportWidthPx / viewportHeightPx` from the SVG wrapper's `getBoundingClientRect()`

The SVG wrapper needs a `ref` (`wrapperRef: useRef<HTMLDivElement>`) for this measurement.

### 4.4 Minimum Font Size

**File changed:** `src/components/CabinetCanvas/DimensionLabels.tsx`

`DimensionLabels` gains a `zoom: number` prop (already available in `CabinetCanvas`).

The font size formula:

```ts
const fontSize = Math.max(12, 12 / zoom)
```

Behaviour:
- At `zoom = 0.5`: `fontSize = 24` SVG units → 24 × 0.5 = **12px** on screen (minimum enforced)
- At `zoom = 1.0`: `fontSize = 12` SVG units → **12px** on screen
- At `zoom = 2.0`: `fontSize = 12` SVG units → 12 × 2 = **24px** on screen (grows naturally)

The same formula applies to lock-icon sizes in `DimensionLabels`.

---

## 5. Component Interfaces

### `ZoomControls` props
```ts
interface ZoomControlsProps {
  zoom: number
  onZoomIn: () => void
  onZoomOut: () => void
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
  └─ Sidebar (cutList prop) → CutListPanel (collapsed section at bottom)

CabinetCanvas (holds: zoom, panX, panY state)
  ├─ ZoomControls (overlay)
  │    onZoomIn  → setZoom(z => Math.min(10, z * 1.25))
  │    onZoomOut → setZoom(z => Math.max(0.05, z * 0.8))
  │    onFitAll  → computeFitAll(...) → setZoom + setPan
  └─ DimensionLabels (zoom prop) → fontSize = max(12, 12/zoom)
```

---

## 7. New & Changed Files

| File | Change |
|------|--------|
| `src/App.tsx` | Remove right panel div; pass `cutList` to `Sidebar` |
| `src/components/Sidebar/Sidebar.tsx` | Add `cutList` prop; render `CutListPanel` at bottom |
| `src/components/CabinetCanvas/CabinetCanvas.tsx` | Render `ZoomControls`; compute `handleFitAll`; pass `zoom` to `DimensionLabels`; add `wrapperRef` |
| `src/components/CabinetCanvas/ZoomControls.tsx` | **New** — presentational overlay |
| `src/components/CabinetCanvas/ZoomControls.test.tsx` | **New** — 3 tests |
| `src/components/CabinetCanvas/DimensionLabels.tsx` | Accept `zoom` prop; apply font formula |
| `src/utils/fitAll.ts` | **New** — pure `computeFitAll` function |
| `src/utils/fitAll.test.ts` | **New** — unit tests for fit algorithm |

---

## 8. Tests & Success Criteria

### Unit tests (`fitAll.test.ts`)
1. Zoom is limited by the narrower dimension (portrait cabinet in landscape viewport → capped by height)
2. Zoom is limited by the wider dimension (landscape cabinet in portrait viewport → capped by width)
3. Cabinet is centred (panX and panY produce equal margins on each side)
4. Padding factor is respected (zoom = expected × 0.9)

### Component tests (`ZoomControls.test.tsx`)
1. Clicking "Zoom in" calls `onZoomIn`
2. Clicking "Zoom out" calls `onZoomOut`
3. Clicking "Fit to screen" calls `onFitAll`

### Integration (extend existing `cabinetFlow.test.tsx`)
1. After clicking "Fit to screen", `zoom` is a positive number between 0.05 and 10
2. Cut list appears in the sidebar (the right panel is gone)

### Visual verification (manual)
- Open a 2000mm × 1000mm cabinet at default zoom → labels are readable (≥12px)
- Click "−" repeatedly → cabinet shrinks but labels never become unreadably small
- Click "⊡" → cabinet fits the viewport with padding on all sides

---

## 9. Non-Goals / Explicitly Excluded

- Cursor-centred zoom on scroll (existing scroll zoom behaviour unchanged)
- Zoom level displayed as percentage (not needed for Phase A)
- Animated zoom transitions
- Keyboard shortcuts for zoom (+/- keys) — can be added in Phase B/C if needed
