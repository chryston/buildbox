# Floor Plan Feature Design

## Overview

A top-view floor plan module for BuildBox that lets users upload a photo of their floor plan, calibrate its scale, then place and annotate furniture, appliances, and fixtures. Separate from the cabinet configurator — independent state, independent canvas.

Also includes a dark theme update to the entire application.

---

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Canvas technology | SVG-native (extends existing cabinet canvas) | Zero new dependencies; SVG export works for free; reuses pan/zoom/drag infrastructure |
| Floor plan relationship to cabinet projects | Standalone — independent of cabinet projects | Simpler data model; user can have a floor plan without any cabinet design |
| Object representation | SVG icons (paths) with text labels | Clean, consistent, scalable; no external assets needed |
| Object sizing | Resizable after placement (drag handles) | User can fit objects to their specific room |
| Scale calibration | Two-point line on image + real-world mm input | Most intuitive for users who know one wall dimension |
| Annotations | Coloured SVG overlays only (no structured data) | YAGNI — sufficient for marking walls and tile zones |
| Export | Both SVG and JSON | SVG for sharing, JSON for re-import |
| Theme | Dark-only — always dark | Modern SaaS aesthetic; user preference |

---

## Theme Update

Replace the current light theme with a dark palette. Only `tailwind.config.ts` and `src/index.css` change — no component files need updating since everything uses Tailwind semantic tokens.

| Token | Light (current) | Dark (new) |
|---|---|---|
| `surface` | `#ffffff` | `#1c1c1e` |
| `panel` | `#f8f9fa` | `#2c2c2e` |
| `accent` | `#2563eb` | `#0a84ff` |
| `accent-hover` | `#1d4ed8` | `#1a93ff` |
| `divider` | `#e5e7eb` | `#38383a` |
| `text-primary` | `#111827` | `#f5f5f7` |
| `text-muted` | `#6b7280` | `#86868b` |

CSS variables updated in `src/index.css`:
- `--color-dim-label`: `#a1a1aa` (was `#374151`)
- `--color-accent`: `#0a84ff` (was `#2563eb`)

---

## Floor Plan State

### Data Types (additions to `src/types/index.ts`)

```ts
export type FloorPlanObjectType =
  // Seating
  | 'sofa-2' | 'sofa-3' | 'armchair'
  // Sleeping
  | 'bed-single' | 'bed-double' | 'bed-queen' | 'bed-king'
  // Appliances
  | 'fridge' | 'washer' | 'dryer' | 'water-heater' | 'robot-vacuum'
  // Bathroom
  | 'toilet' | 'basin' | 'bathtub' | 'shower'
  // Lighting & other
  | 'ceiling-fan' | 'light' | 'tv' | 'curtain-rail'
  // Carpentry
  | 'wardrobe' | 'kitchen-counter' | 'cabinet-unit'
  // Custom
  | 'custom'

export type AnnotationType = 'wall-hack' | 'tile-zone'

export interface FloorPlanObject {
  id: string
  type: FloorPlanObjectType
  label: string
  x: number          // mm from SVG origin
  y: number          // mm from SVG origin
  w: number          // mm
  h: number          // mm
  rotation: 0 | 90 | 180 | 270
  color: string      // CSS color string
  isCustom?: boolean
}

export interface Annotation {
  id: string
  type: AnnotationType
  // wall-hack: polyline through points
  // tile-zone: rect defined by first two points as corners
  points: { x: number; y: number }[]  // mm coords
  label?: string
}

export interface FloorPlanImage {
  dataUrl: string
  widthPx: number
  heightPx: number
}

export interface FloorPlanState {
  image: FloorPlanImage | null
  pixelsPerMm: number | null        // null until calibrated
  objects: FloorPlanObject[]
  annotations: Annotation[]
  selectedObjectId: string | null
  activeAnnotationType: AnnotationType | null   // null = normal mode
}
```

### Store Slice (additions to `src/store/store.ts`)

Actions:
- `setFloorPlanImage(image: FloorPlanImage | null)`
- `setFloorPlanScale(pixelsPerMm: number)`
- `addFloorPlanObject(obj: FloorPlanObject)`
- `updateFloorPlanObject(id: string, patch: Partial<FloorPlanObject>)`
- `removeFloorPlanObject(id: string)`
- `addAnnotation(ann: Annotation)`
- `removeAnnotation(id: string)`
- `setSelectedObjectId(id: string | null)`
- `setActiveAnnotationType(type: AnnotationType | null)`

---

## Object Catalog

Static catalog in `src/data/floorPlanObjects.ts`. Each entry defines:
- `type`: `FloorPlanObjectType`
- `label`: display name
- `category`: one of 6 categories
- `defaultW`, `defaultH`: mm dimensions
- `color`: default CSS color
- `svgPath`: SVG path string for the top-view icon (simple geometric representation)

All sizes are standard Singapore/metric dimensions:

| Object | W (mm) | H (mm) |
|---|---|---|
| Sofa 2-seater | 1500 | 800 |
| Sofa 3-seater | 2100 | 800 |
| Armchair | 800 | 800 |
| Single Bed | 900 | 1900 |
| Double Bed | 1350 | 1900 |
| Queen Bed | 1520 | 1980 |
| King Bed | 1820 | 1980 |
| Fridge | 600 | 650 |
| Washer | 600 | 600 |
| Dryer | 600 | 600 |
| Water Heater | 400 | 400 |
| Robot Vacuum | 350 | 350 |
| Toilet | 380 | 680 |
| Basin | 500 | 400 |
| Bathtub | 750 | 1500 |
| Shower | 900 | 900 |
| Ceiling Fan | 1200 | 1200 |
| Light | 200 | 200 |
| TV | 1200 | 80 |
| Curtain Rail | 1800 | 50 |
| Wardrobe | 1800 | 600 |
| Kitchen Counter | 2400 | 600 |
| Cabinet Unit | 600 | 600 |

---

## Components

### `src/components/FloorPlan/` (new directory)

| File | Responsibility |
|---|---|
| `FloorPlanPage.tsx` | Top-level layout: sidebar + canvas + properties |
| `FloorPlanCanvas.tsx` | SVG canvas: image background + pan/zoom + object/annotation layers |
| `FloorPlanSidebar.tsx` | Left panel: object library (categorized), annotation tools, custom shape button |
| `FloorPlanProperties.tsx` | Right panel: dimensions, rotation, label, color, delete for selected object |
| `PlacedObject.tsx` | SVG group for a single floor plan object with drag + 8-point resize handles |
| `AnnotationLayer.tsx` | SVG layer for wall-hack polylines and tile-zone rects |
| `CalibrationOverlay.tsx` | SVG overlay active during scale calibration (crosshair + line preview) |
| `ScaleCalibrationModal.tsx` | Modal: "Enter real-world distance (mm)" after drawing calibration line |
| `CustomShapeModal.tsx` | Modal: label + width + height for custom shapes |
| `FloorPlanPage.test.tsx` | E2E integration test |

---

## Interactions

### Scale Calibration
1. User clicks "Calibrate Scale" → canvas enters calibration mode (`cursor: crosshair`)
2. User clicks point A → stored in temporary state
3. User clicks point B → `ScaleCalibrationModal` opens
4. User enters real-world mm → `pixelsPerMm = sqrt((bx-ax)²+(by-ay)²) / mm`
5. Canvas displays "1px = Xmm" indicator

### Object Placement
1. User clicks an item in `FloorPlanSidebar`
2. Object placed at SVG viewport centre with default dimensions
3. User drags to reposition (pointer events on SVG rect)
4. Corner/edge handles (8 points) to resize — updates `w`/`h` in mm
5. Properties panel shows current dimensions, rotation, label, color

### Rotation
- "Rotate 90°" button in properties panel: cycles `rotation` through 0→90→180→270→0
- Applied as SVG `transform="rotate(deg, cx, cy)"`

### Annotations
- **Wall to hack**: click to enter wall-hack mode; click adds points; dbl-click finishes → red dashed polyline
- **Floor to tile**: click-drag to draw rect → blue semi-transparent filled rect

### Custom Shapes
- Click "+ Add Custom Shape" → `CustomShapeModal`
- User enters label, width (mm), height (mm)
- Creates `FloorPlanObject` with `type: 'custom'`, `isCustom: true`
- Rendered as dashed amber border rect with label centered

---

## Export

### SVG Export
- Serialize the floor plan SVG element (same `downloadSVG` utility as cabinet canvas)
- Includes background image (embedded as data URL), all objects, all annotations

### JSON Export
- Export `{ objects: FloorPlanObject[], annotations: Annotation[], pixelsPerMm, imageWidthPx, imageHeightPx }`
- Triggers browser download as `.json`

---

## Testing Strategy

- **Unit tests**: store actions (add/remove/update objects, annotations)
- **Component tests**: `FloorPlanSidebar` (click adds object), `FloorPlanProperties` (rotate, delete, label change)
- **E2E integration test**: upload image → calibrate → add 3 objects → add annotation → export JSON — all via store API (no file picker mocking needed)

---

## Out of Scope

- Re-importing previously exported JSON
- Free-form rotation (only 90° increments)
- Snapping to grid
- Layers/z-ordering of objects
- Multi-select
- Copy/paste of objects
