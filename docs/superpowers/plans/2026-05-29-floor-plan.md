# Floor Plan Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a top-view floor plan module to BuildBox where users upload a floor plan image, calibrate its scale, place/resize/rotate furniture and appliances from a built-in library, annotate walls and tile zones, and export the result as SVG or JSON.

**Architecture:** SVG-native canvas extending the existing cabinet canvas pattern (pan/zoom/drag reused). Floor plan state (image, scale, objects, annotations) lives in a new Zustand slice that is persisted but excluded from undo/redo history. All ~23 object types are defined in a static catalog with default mm dimensions.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, Zustand (immer + persist + temporal), Vite, Vitest/Testing Library

**Worktree:** `/home/chryston/docker/copilot/repos/worktrees/buildbox-feature-improvements-floor-plan` (branch: `floor-plan`, based on `feature-improvements`)

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `tailwind.config.ts` | Dark color palette |
| Modify | `src/index.css` | CSS custom property updates |
| Modify | `src/types/index.ts` | Add FloorPlan types |
| Create | `src/data/floorPlanObjects.ts` | Static object catalog (23 items) |
| Modify | `src/store/store.ts` | Add floorPlan slice + actions |
| Modify | `src/store/store.test.ts` | Floor plan store tests |
| Create | `src/components/FloorPlan/FloorPlanCanvas.tsx` | SVG canvas: image + object layer + annotation layer |
| Create | `src/components/FloorPlan/PlacedObject.tsx` | Draggable/resizable SVG group for one object |
| Create | `src/components/FloorPlan/AnnotationLayer.tsx` | Wall-hack polyline + tile-zone rect rendering/drawing |
| Create | `src/components/FloorPlan/CalibrationOverlay.tsx` | Two-point click overlay for scale calibration |
| Create | `src/components/FloorPlan/ScaleCalibrationModal.tsx` | Modal: "enter real distance mm" |
| Create | `src/components/FloorPlan/FloorPlanSidebar.tsx` | Left panel: categorized object library + annotation tools |
| Create | `src/components/FloorPlan/FloorPlanProperties.tsx` | Right panel: selected object dimensions/label/color/rotate/delete |
| Create | `src/components/FloorPlan/CustomShapeModal.tsx` | Modal: label + width + height for custom objects |
| Create | `src/components/FloorPlan/FloorPlanPage.tsx` | Layout: sidebar + canvas + properties; wires all state |
| Create | `src/utils/floorPlanExport.ts` | `downloadFloorPlanJSON` utility |
| Modify | `src/App.tsx` | Replace `FloorPlanPlaceholder` with `<FloorPlanPage />` |
| Create | `src/integration/floorPlanFlow.test.tsx` | E2E integration test |
| Create | `src/components/FloorPlan/FloorPlanPage.test.tsx` | Component tests |

---

## Task 1: Dark Theme

**Files:**
- Modify: `tailwind.config.ts`
- Modify: `src/index.css`

- [ ] **Step 1: Update `tailwind.config.ts`**

```typescript
// tailwind.config.ts — full file replacement
import type { Config } from 'tailwindcss'
import forms from '@tailwindcss/forms'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: '#1c1c1e',
        panel: '#2c2c2e',
        'surface-raised': '#3a3a3c',
        accent: '#0a84ff',
        'accent-hover': '#1a93ff',
        divider: '#38383a',
        'text-primary': '#f5f5f7',
        'text-muted': '#86868b',
      },
    },
  },
  plugins: [forms],
} satisfies Config
```

- [ ] **Step 2: Update `src/index.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --color-dim-label: #a1a1aa;
  --color-accent: #0a84ff;
}
```

- [ ] **Step 3: Run full test suite to verify no breakage**

```bash
cd /home/chryston/docker/copilot/repos/worktrees/buildbox-feature-improvements-floor-plan
npm test -- --run 2>&1 | tail -10
```

Expected: `Tests 186 passed (186)` — all existing tests still pass (Tailwind token names unchanged)

- [ ] **Step 4: Commit**

```bash
git add tailwind.config.ts src/index.css
git commit -m "feat(theme): dark-only palette — surface/panel/divider/text updated"
```

---

## Task 2: Floor Plan Types + Object Catalog

**Files:**
- Modify: `src/types/index.ts`
- Create: `src/data/floorPlanObjects.ts`
- Create: `src/data/floorPlanObjects.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/data/floorPlanObjects.test.ts
import { describe, expect, it } from 'vitest'
import { OBJECT_CATALOG, OBJECT_CATEGORIES } from './floorPlanObjects'
import type { FloorPlanObjectType } from '../types'

describe('OBJECT_CATALOG', () => {
  it('every item has positive defaultW and defaultH', () => {
    OBJECT_CATALOG.forEach(o => {
      expect(o.defaultW).toBeGreaterThan(0)
      expect(o.defaultH).toBeGreaterThan(0)
    })
  })

  it('OBJECT_CATEGORIES covers all catalog items', () => {
    const allCategoryTypes = Object.values(OBJECT_CATEGORIES).flat()
    OBJECT_CATALOG.forEach(o => {
      expect(allCategoryTypes).toContain(o.type)
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --run src/data/floorPlanObjects.test.ts 2>&1 | tail -5
```

Expected: FAIL — "Cannot find module './floorPlanObjects'"

- [ ] **Step 3: Add types to `src/types/index.ts`**

Append at the end of `src/types/index.ts`:

```typescript
// --- Floor Plan types ---

export type FloorPlanObjectType =
  | 'sofa-2' | 'sofa-3' | 'armchair'
  | 'bed-single' | 'bed-double' | 'bed-queen' | 'bed-king'
  | 'fridge' | 'washer' | 'dryer' | 'water-heater' | 'robot-vacuum'
  | 'toilet' | 'basin' | 'bathtub' | 'shower'
  | 'ceiling-fan' | 'light' | 'tv' | 'curtain-rail'
  | 'wardrobe' | 'kitchen-counter' | 'cabinet-unit'
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
  color: string      // CSS hex color
  isCustom?: boolean
}

export interface Annotation {
  id: string
  type: AnnotationType
  points: { x: number; y: number }[]   // mm coords; tile-zone uses [topLeft, bottomRight]
  label?: string
}

export interface FloorPlanImage {
  dataUrl: string    // data:image/... base64
  widthPx: number
  heightPx: number
}

export interface CustomTemplate {
  id: string
  label: string
  defaultW: number  // mm
  defaultH: number  // mm
  color: string
}

export interface FloorPlanData {
  image: FloorPlanImage | null
  pixelsPerMm: number | null
  objects: FloorPlanObject[]
  annotations: Annotation[]
  customTemplates: CustomTemplate[]   // ADD this field
}
```

- [ ] **Step 4: Create `src/data/floorPlanObjects.ts`**

```typescript
// src/data/floorPlanObjects.ts
import type { FloorPlanObjectType } from '../types'

export const OBJECT_CATALOG = [
  // Seating
  { type: 'sofa-2',          label: 'Sofa 2-seater',   defaultW: 1500, defaultH: 800,  color: '#6366f1' },
  { type: 'sofa-3',          label: 'Sofa 3-seater',   defaultW: 2100, defaultH: 800,  color: '#6366f1' },
  { type: 'armchair',        label: 'Armchair',         defaultW: 800,  defaultH: 800,  color: '#6366f1' },
  // Sleeping
  { type: 'bed-single',      label: 'Single Bed',       defaultW: 900,  defaultH: 1900, color: '#8b5cf6' },
  { type: 'bed-double',      label: 'Double Bed',       defaultW: 1350, defaultH: 1900, color: '#8b5cf6' },
  { type: 'bed-queen',       label: 'Queen Bed',        defaultW: 1520, defaultH: 1980, color: '#8b5cf6' },
  { type: 'bed-king',        label: 'King Bed',         defaultW: 1820, defaultH: 1980, color: '#8b5cf6' },
  // Appliances
  { type: 'fridge',          label: 'Fridge',           defaultW: 600,  defaultH: 650,  color: '#10b981' },
  { type: 'washer',          label: 'Washing Machine',  defaultW: 600,  defaultH: 600,  color: '#10b981' },
  { type: 'dryer',           label: 'Dryer',            defaultW: 600,  defaultH: 600,  color: '#10b981' },
  { type: 'water-heater',    label: 'Water Heater',     defaultW: 400,  defaultH: 400,  color: '#10b981' },
  { type: 'robot-vacuum',    label: 'Robot Vacuum',     defaultW: 350,  defaultH: 350,  color: '#10b981' },
  // Bathroom
  { type: 'toilet',          label: 'Toilet',           defaultW: 380,  defaultH: 680,  color: '#0ea5e9' },
  { type: 'basin',           label: 'Basin',            defaultW: 500,  defaultH: 400,  color: '#0ea5e9' },
  { type: 'bathtub',         label: 'Bathtub',          defaultW: 750,  defaultH: 1500, color: '#0ea5e9' },
  { type: 'shower',          label: 'Shower',           defaultW: 900,  defaultH: 900,  color: '#0ea5e9' },
  // Lighting & other
  { type: 'ceiling-fan',     label: 'Ceiling Fan',      defaultW: 1200, defaultH: 1200, color: '#f59e0b' },
  { type: 'light',           label: 'Light',            defaultW: 200,  defaultH: 200,  color: '#f59e0b' },
  { type: 'tv',              label: 'TV',               defaultW: 1200, defaultH: 80,   color: '#374151' },
  { type: 'curtain-rail',    label: 'Curtain Rail',     defaultW: 1800, defaultH: 50,   color: '#374151' },
  // Carpentry
  { type: 'wardrobe',        label: 'Wardrobe',         defaultW: 1800, defaultH: 600,  color: '#92400e' },
  { type: 'kitchen-counter', label: 'Kitchen Counter',  defaultW: 2400, defaultH: 600,  color: '#92400e' },
  { type: 'cabinet-unit',    label: 'Cabinet Unit',     defaultW: 600,  defaultH: 600,  color: '#92400e' },
]

export const OBJECT_CATEGORIES = {
  'Seating':          ['sofa-2', 'sofa-3', 'armchair'],
  'Sleeping':         ['bed-single', 'bed-double', 'bed-queen', 'bed-king'],
  'Appliances':       ['fridge', 'washer', 'dryer', 'water-heater', 'robot-vacuum'],
  'Bathroom':         ['toilet', 'basin', 'bathtub', 'shower'],
  'Lighting & Other': ['ceiling-fan', 'light', 'tv', 'curtain-rail'],
  'Carpentry':        ['wardrobe', 'kitchen-counter', 'cabinet-unit'],
} as const satisfies Record<string, FloorPlanObjectType[]>
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npm test -- --run src/data/floorPlanObjects.test.ts 2>&1 | tail -5
```

Expected: `Tests 2 passed`

- [ ] **Step 6: Commit**

```bash
git add src/types/index.ts src/data/floorPlanObjects.ts src/data/floorPlanObjects.test.ts
git commit -m "feat(floor-plan): types + object catalog"
```

---

## Task 3: Store Slice

**Files:**
- Modify: `src/store/store.ts`
- Modify: `src/store/store.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/store/store.test.ts`:

```typescript
describe('floor plan store', () => {
  beforeEach(() => {
    useStore.setState({
      projects: [{ id: 'proj1', name: 'Test', units: [{ type: 'cabinet', id: 'u1', label: 'Unit 1', x: 0, y: 0, settings: { unit: 'mm', height: 800, width: 600, depth: 500, thickness: 18, backThickness: 6, toeKick: null, material: 'oak' }, root: { id: 'r1', elementType: 'void' } }] }],
      activeProjectId: 'proj1',
      selectedId: null,
      snapGrid: 5,
      activeUnitId: 'u1',
      floorPlanSelectedId: null,
      floorPlan: { image: null, pixelsPerMm: null, objects: [], annotations: [], customTemplates: [] },
    })
  })

  it('setFloorPlanImage stores image data', () => {
    const { result } = renderHook(() => useStore())
    const img = { dataUrl: 'data:image/png;base64,abc', widthPx: 1000, heightPx: 800 }
    act(() => result.current.setFloorPlanImage(img))
    expect(result.current.floorPlan.image).toEqual(img)
  })

  it('setFloorPlanScale stores pixelsPerMm', () => {
    const { result } = renderHook(() => useStore())
    act(() => result.current.setFloorPlanScale(0.5))
    expect(result.current.floorPlan.pixelsPerMm).toBe(0.5)
  })

  it('addFloorPlanObject appends object', () => {
    const { result } = renderHook(() => useStore())
    const obj = { id: 'o1', type: 'sofa-2' as const, label: 'Sofa', x: 100, y: 200, w: 1500, h: 800, rotation: 0 as const, color: '#6366f1' }
    act(() => result.current.addFloorPlanObject(obj))
    expect(result.current.floorPlan.objects).toHaveLength(1)
    expect(result.current.floorPlan.objects[0].id).toBe('o1')
  })

  it('updateFloorPlanObject patches object fields', () => {
    const { result } = renderHook(() => useStore())
    const obj = { id: 'o1', type: 'sofa-2' as const, label: 'Sofa', x: 100, y: 200, w: 1500, h: 800, rotation: 0 as const, color: '#6366f1' }
    act(() => result.current.addFloorPlanObject(obj))
    act(() => result.current.updateFloorPlanObject('o1', { label: 'My Sofa', w: 2000 }))
    const updated = result.current.floorPlan.objects[0]
    expect(updated.label).toBe('My Sofa')
    expect(updated.w).toBe(2000)
  })

  it('removeFloorPlanObject deletes by id', () => {
    const { result } = renderHook(() => useStore())
    const obj = { id: 'o1', type: 'sofa-2' as const, label: 'Sofa', x: 0, y: 0, w: 1500, h: 800, rotation: 0 as const, color: '#6366f1' }
    act(() => result.current.addFloorPlanObject(obj))
    act(() => result.current.removeFloorPlanObject('o1'))
    expect(result.current.floorPlan.objects).toHaveLength(0)
  })

  it('addAnnotation appends annotation', () => {
    const { result } = renderHook(() => useStore())
    const ann = { id: 'a1', type: 'wall-hack' as const, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }
    act(() => result.current.addAnnotation(ann))
    expect(result.current.floorPlan.annotations).toHaveLength(1)
  })

  it('removeAnnotation deletes by id', () => {
    const { result } = renderHook(() => useStore())
    const ann = { id: 'a1', type: 'wall-hack' as const, points: [{ x: 0, y: 0 }] }
    act(() => result.current.addAnnotation(ann))
    act(() => result.current.removeAnnotation('a1'))
    expect(result.current.floorPlan.annotations).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --run src/store/store.test.ts 2>&1 | tail -8
```

Expected: FAIL — "result.current.setFloorPlanImage is not a function"

- [ ] **Step 3: Update `src/store/store.ts`**

**3a.** Add `FloorPlanData, FloorPlanObject, Annotation, FloorPlanImage, CustomTemplate` to the import from `'../types'`:

```typescript
import type { Accessory, CabinetMaterialId, CabinetSceneUnit, Design, GlobalSettings, DrawerConfig, UIState, ElementType, FloorPlanData, FloorPlanObject, Annotation, FloorPlanImage, CustomTemplate } from '../types'
```

**3b.** Update `PersistedState` interface to include `floorPlan`:

```typescript
interface PersistedState {
  projects: Design[]
  activeProjectId: string | null
  floorPlan: FloorPlanData
}
```

**3c.** Add floor plan state/actions to `StoreState` interface (after `importWorkspace`):

```typescript
  floorPlanSelectedId: string | null

  // floor plan
  setFloorPlanImage: (image: FloorPlanImage | null) => void
  setFloorPlanScale: (pixelsPerMm: number) => void
  addFloorPlanObject: (obj: FloorPlanObject) => void
  updateFloorPlanObject: (id: string, patch: Partial<FloorPlanObject>) => void
  removeFloorPlanObject: (id: string) => void
  addAnnotation: (ann: Annotation) => void
  removeAnnotation: (id: string) => void
  addCustomTemplate: (template: CustomTemplate) => void
  removeCustomTemplate: (id: string) => void
  selectFloorPlanObject: (id: string | null) => void
```

**3d.** Update `partializeProjectState` to also save `floorPlan` for persistence (but NOT for temporal/undo-redo — temporal keeps its own partialize that only covers projects):

After `const partializeProjectState = ...`, add a separate function for persist:

```typescript
const partializeProjectState = (state: PersistedState) => ({
  projects: state.projects,
  activeProjectId: state.activeProjectId,
})

const partializeForPersist = (state: PersistedState) => ({
  projects: state.projects,
  activeProjectId: state.activeProjectId,
  floorPlan: state.floorPlan,
})
```

**3e.** Update the `persist` call to use `partializeForPersist`, bump the persist `version` to `3`, and add a migration for the new floor-plan shape:

```typescript
      persist(
        immer((set) => ({...})),
        {
          ...
          version: 3,
          partialize: partializeForPersist,  // was partializeProjectState
          migrate: (persisted, version) => {
            let fromVersion = version ?? 0

            if (fromVersion <= 2) {
              (persisted as any).floorPlan ??= {
                image: null,
                pixelsPerMm: null,
                objects: [],
                annotations: [],
                customTemplates: [],
              }
              ;(persisted as any).floorPlan.customTemplates ??= []
              fromVersion = 3
            }

            // keep the existing v1 migration logic after this block
            ...
            return persisted as PersistedState
          },
          ...
        }
      ),
```

**3f.** Add initial `floorPlan` state, selection state, and actions inside the `immer` set call (after `activeProjectId: _initialDesign.id,`):

```typescript
        floorPlan: { image: null, pixelsPerMm: null, objects: [], annotations: [], customTemplates: [] },
        floorPlanSelectedId: null,

        setFloorPlanImage: (image) => set(s => { s.floorPlan.image = image }),
        setFloorPlanScale: (pixelsPerMm) => set(s => { s.floorPlan.pixelsPerMm = pixelsPerMm }),
        addFloorPlanObject: (obj) => set(s => { s.floorPlan.objects.push(obj) }),
        updateFloorPlanObject: (id, patch) => set(s => {
          const obj = s.floorPlan.objects.find(o => o.id === id)
          if (obj) Object.assign(obj, patch)
        }),
        removeFloorPlanObject: (id) => set(s => {
          s.floorPlan.objects = s.floorPlan.objects.filter(o => o.id !== id)
          if (s.floorPlanSelectedId === id) s.floorPlanSelectedId = null
        }),
        addAnnotation: (ann) => set(s => { s.floorPlan.annotations.push(ann) }),
        removeAnnotation: (id) => set(s => {
          s.floorPlan.annotations = s.floorPlan.annotations.filter(a => a.id !== id)
        }),
        addCustomTemplate: (template) => set(s => { s.floorPlan.customTemplates.push(template) }),
        removeCustomTemplate: (id) => set(s => {
          s.floorPlan.customTemplates = s.floorPlan.customTemplates.filter(t => t.id !== id)
        }),
        selectFloorPlanObject: (id) => set(s => { s.floorPlanSelectedId = id }),
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --run src/store/store.test.ts 2>&1 | tail -8
```

Expected: All store tests pass (previous 12 + new 7 = 19 tests)

- [ ] **Step 5: Commit**

```bash
git add src/store/store.ts src/store/store.test.ts
git commit -m "feat(floor-plan): store slice — image, scale, objects, annotations"
```

---

## Task 4: FloorPlanCanvas

**Files:**
- Create: `src/components/FloorPlan/FloorPlanCanvas.tsx`

No test file for this task — it is purely a rendering wrapper tested via FloorPlanPage.test.tsx in Task 11.

> **Dependency note:** `PlacedObject` (Task 5), `AnnotationLayer` (Task 6), and `CalibrationOverlay` (Task 7) are created after this task. Add stub files now so TypeScript compiles; later tasks will replace them.

- [ ] **Step 0: Create stub files for forward dependencies**

```typescript
// src/components/FloorPlan/AnnotationLayer.tsx
import type { Annotation } from '../../types'
interface Props {
  annotations: Annotation[]
  activeType: 'wall-hack' | 'tile-zone' | null
  zoom: number
  onAddAnnotation: (ann: Annotation) => void
}
export default function AnnotationLayer(_props: Props) { return null }
```

```typescript
// src/components/FloorPlan/CalibrationOverlay.tsx
interface Props { zoom: number; pixelsPerMm: number | null; onMeasured: (distancePx: number) => void }
export default function CalibrationOverlay(_props: Props) { return null }
```

```typescript
// src/components/FloorPlan/PlacedObject.tsx
export default function PlacedObject(_props: { id: string; zoom: number; isSelected?: boolean }) { return null }
```

- [ ] **Step 1: Create `src/components/FloorPlan/FloorPlanCanvas.tsx`**

```typescript
import { useCallback, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useStore } from '../../store/store'
import { shallow } from 'zustand/shallow'
import type { Annotation, FloorPlanData } from '../../types'
import AnnotationLayer from './AnnotationLayer'
import PlacedObject from './PlacedObject'
import CalibrationOverlay from './CalibrationOverlay'

const ZOOM_MIN = 0.1
const ZOOM_MAX = 10
const PADDING = 80

interface Props {
  floorPlan: FloorPlanData
  svgRef: RefObject<SVGSVGElement | null>
  isCalibrating: boolean
  activeAnnotationType: 'wall-hack' | 'tile-zone' | null
  onCalibrationPoints: (distancePx: number) => void
  onAddAnnotation: (ann: Annotation) => void
}

export default function FloorPlanCanvas({
  floorPlan, svgRef, isCalibrating, activeAnnotationType, onCalibrationPoints, onAddAnnotation,
}: Props) {
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const isPanning = useRef(false)
  const lastPan = useRef({ x: 0, y: 0 })

  const { image, pixelsPerMm, annotations } = floorPlan
  const objectIds = useStore(s => s.floorPlan.objects.map(o => o.id), shallow)
  const selectFloorPlanObject = useStore(s => s.selectFloorPlanObject)

  // Image dimensions in SVG mm-space (or pixels if not calibrated)
  const imgW = image ? (pixelsPerMm ? image.widthPx / pixelsPerMm : image.widthPx) : 800
  const imgH = image ? (pixelsPerMm ? image.heightPx / pixelsPerMm : image.heightPx) : 600
  const viewBox = `${-PADDING} ${-PADDING} ${imgW + 2 * PADDING} ${imgH + 2 * PADDING}`

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    setZoom(z => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * (e.deltaY < 0 ? 1.25 : 0.8))))
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 1 && !e.altKey) return
    isPanning.current = true
    lastPan.current = { x: e.clientX, y: e.clientY }
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPanning.current) return
    const dx = e.clientX - lastPan.current.x
    const dy = e.clientY - lastPan.current.y
    lastPan.current = { x: e.clientX, y: e.clientY }
    setPan(p => ({ x: p.x + dx, y: p.y + dy }))
  }, [])

  const onPointerUp = useCallback(() => { isPanning.current = false }, [])

  function handleFitToScreen() {
    if (!svgRef.current) return
    const container = svgRef.current.parentElement
    if (!container) return
    const { width: cw, height: ch } = container.getBoundingClientRect()
    const scaleX = (cw - 2 * PADDING) / imgW
    const scaleY = (ch - 2 * PADDING) / imgH
    const newZoom = Math.min(scaleX, scaleY, ZOOM_MAX)
    setZoom(newZoom)
    setPan({ x: 0, y: 0 })
  }

  function handleBackgroundClick() {
    if (!isCalibrating && !activeAnnotationType) selectFloorPlanObject(null)
  }

  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-surface">
      <svg
        ref={svgRef}
        data-testid="floor-plan-canvas"
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full"
        style={{ touchAction: 'none', cursor: isCalibrating ? 'crosshair' : 'default' }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={handleBackgroundClick}
      >
        <g transform={`matrix(${zoom},0,0,${zoom},${pan.x},${pan.y})`}>
          {image && (
            <image
              href={image.dataUrl}
              x={0}
              y={0}
              width={imgW}
              height={imgH}
              preserveAspectRatio="none"
              style={{ pointerEvents: 'none' }}
            />
          )}
          {!image && (
            <rect x={0} y={0} width={imgW} height={imgH}
              fill="var(--color-surface-raised, #3a3a3c)"
              stroke="var(--color-divider, #38383a)" strokeWidth={2}
            />
          )}
          <AnnotationLayer
            annotations={annotations}
            activeType={activeAnnotationType}
            zoom={zoom}
            onAddAnnotation={onAddAnnotation}
          />
          {objectIds.map(id => (
            <PlacedObject
              key={id}
              id={id}
              zoom={zoom}
            />
          ))}
          {isCalibrating && (
            <CalibrationOverlay
              zoom={zoom}
              pixelsPerMm={pixelsPerMm}
              onMeasured={onCalibrationPoints}
            />
          )}
        </g>
      </svg>

      {/* Zoom controls */}
      <div className="absolute bottom-4 right-4 flex gap-1">
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => setZoom(z => Math.max(ZOOM_MIN, z * 0.8))}
          className="rounded border border-divider bg-panel px-2 py-1 text-sm text-text-primary hover:bg-surface-raised"
        >−</button>
        <button
          type="button"
          aria-label="Fit to screen"
          onClick={handleFitToScreen}
          className="rounded border border-divider bg-panel px-2 py-1 text-sm text-text-primary hover:bg-surface-raised"
        >⊞ Fit</button>
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => setZoom(z => Math.min(ZOOM_MAX, z * 1.25))}
          className="rounded border border-divider bg-panel px-2 py-1 text-sm text-text-primary hover:bg-surface-raised"
        >+</button>
      </div>

      {pixelsPerMm && (
        <div className="absolute bottom-4 left-4 text-xs text-text-muted">
          Scale: 1px = {(1 / pixelsPerMm).toFixed(2)}mm
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Run the full test suite (no new tests, verify no TS errors)**

```bash
npm test -- --run 2>&1 | tail -5
```

Expected: All tests still pass (no new tests added in this task)

- [ ] **Step 3: Commit**

```bash
git add src/components/FloorPlan/FloorPlanCanvas.tsx \
        src/components/FloorPlan/PlacedObject.tsx \
        src/components/FloorPlan/AnnotationLayer.tsx \
        src/components/FloorPlan/CalibrationOverlay.tsx
git commit -m "feat(floor-plan): FloorPlanCanvas — SVG canvas with image/zoom/pan (+ stubs)"
```

---

## Task 5: PlacedObject

**Files:**
- Create: `src/components/FloorPlan/PlacedObject.tsx`
- Create: `src/components/FloorPlan/PlacedObject.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// src/components/FloorPlan/PlacedObject.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from '../../store/store'
import PlacedObject from './PlacedObject'
import type { FloorPlanObject } from '../../types'

const sofa: FloorPlanObject = {
  id: 'o1', type: 'sofa-2', label: 'Sofa', x: 100, y: 200,
  w: 1500, h: 800, rotation: 0, color: '#6366f1',
}

function resetStore(selectedId: string | null = null, obj: FloorPlanObject = sofa) {
  useStore.setState({
    floorPlanSelectedId: selectedId,
    floorPlan: {
      image: null,
      pixelsPerMm: null,
      objects: [obj],
      annotations: [],
      customTemplates: [],
    },
  })
}

function renderInSvg(ui: React.ReactNode) {
  return render(<svg viewBox="0 0 3000 2000">{ui}</svg>)
}

describe('PlacedObject', () => {
  beforeEach(() => resetStore())

  it('renders label text from store state', () => {
    renderInSvg(<PlacedObject id="o1" zoom={1} />)
    expect(screen.getByText('Sofa')).toBeInTheDocument()
  })

  it('clicking object selects it in the store', async () => {
    const user = userEvent.setup()
    renderInSvg(<PlacedObject id="o1" zoom={1} />)
    await user.click(screen.getByTestId('placed-object-o1'))
    expect(useStore.getState().floorPlanSelectedId).toBe('o1')
  })

  it('shows resize handles when selected', () => {
    resetStore('o1')
    renderInSvg(<PlacedObject id="o1" zoom={1} />)
    expect(screen.getAllByTestId(/^resize-handle-/)).toHaveLength(8)
  })

  it('hides resize handles when not selected', () => {
    renderInSvg(<PlacedObject id="o1" zoom={1} />)
    expect(screen.queryAllByTestId(/^resize-handle-/)).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --run src/components/FloorPlan/PlacedObject.test.tsx 2>&1 | tail -5
```

Expected: FAIL — at least one assertion fails because the Task 4 stub renders `null` and does not select, render, or resize anything

- [ ] **Step 3: Create `src/components/FloorPlan/PlacedObject.tsx`**

```typescript
import { useStore } from '../../store/store'
import type { FloorPlanObject } from '../../types'

const HANDLE_SIZE = 8  // px at zoom=1 (scaled by 1/zoom)

interface Props {
  id: string
  zoom: number
}

export default function PlacedObject({ id, zoom }: Props) {
  const obj = useStore(s => s.floorPlan.objects.find(o => o.id === id) ?? null)
  const selectedId = useStore(s => s.floorPlanSelectedId)
  const updateFloorPlanObject = useStore(s => s.updateFloorPlanObject)
  const selectFloorPlanObject = useStore(s => s.selectFloorPlanObject)

  if (!obj) return null

  const isSelected = selectedId === id
  const { x, y, w, h, rotation, color, label } = obj
  const cx = x + w / 2
  const cy = y + h / 2
  const fontSize = Math.max(12 / zoom, 8)
  const handleR = HANDLE_SIZE / zoom

  function handlePointerDown(e: React.PointerEvent<SVGGElement>) {
    e.stopPropagation()
    selectFloorPlanObject(id)
    const startX = e.clientX
    const startY = e.clientY
    const origX = x
    const origY = y
    const svgScale = getSvgScale(e.currentTarget)

    function onMove_(ev: PointerEvent) {
      const dx = (ev.clientX - startX) / svgScale / zoom
      const dy = (ev.clientY - startY) / svgScale / zoom
      updateFloorPlanObject(id, { x: origX + dx, y: origY + dy })
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove_)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove_)
    window.addEventListener('pointerup', onUp)
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }

  function makeResizeHandler(handle: 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w') {
    return (e: React.PointerEvent<SVGCircleElement>) => {
      e.stopPropagation()
      selectFloorPlanObject(id)
      const startX = e.clientX
      const startY = e.clientY
      const origX = x
      const origY = y
      const origW = w
      const origH = h
      const svgScale = getSvgScale(e.currentTarget)

      function onMove_(ev: PointerEvent) {
        const dx = (ev.clientX - startX) / svgScale / zoom
        const dy = (ev.clientY - startY) / svgScale / zoom

        const nextX = handle.includes('w') ? origX + dx : origX
        const nextY = handle.includes('n') ? origY + dy : origY
        const nextW = Math.max(50, handle.includes('w') ? origW - dx : handle.includes('e') ? origW + dx : origW)
        const nextH = Math.max(50, handle.includes('n') ? origH - dy : handle.includes('s') ? origH + dy : origH)

        updateFloorPlanObject(id, {
          x: handle.includes('w') ? origX + (origW - nextW) : nextX,
          y: handle.includes('n') ? origY + (origH - nextH) : nextY,
          w: nextW,
          h: nextH,
        })
      }
      function onUp() {
        window.removeEventListener('pointermove', onMove_)
        window.removeEventListener('pointerup', onUp)
      }

      window.addEventListener('pointermove', onMove_)
      window.addEventListener('pointerup', onUp)
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    }
  }

  const handles = [
    { key: 'nw', cx: x,       cy: y,       cursor: 'nw-resize' },
    { key: 'n',  cx: x + w/2, cy: y,       cursor: 'n-resize'  },
    { key: 'ne', cx: x + w,   cy: y,       cursor: 'ne-resize' },
    { key: 'e',  cx: x + w,   cy: y + h/2, cursor: 'e-resize'  },
    { key: 'se', cx: x + w,   cy: y + h,   cursor: 'se-resize' },
    { key: 's',  cx: x + w/2, cy: y + h,   cursor: 's-resize'  },
    { key: 'sw', cx: x,       cy: y + h,   cursor: 'sw-resize' },
    { key: 'w',  cx: x,       cy: y + h/2, cursor: 'w-resize'  },
  ] as const

  return (
    <g
      data-testid={`placed-object-${id}`}
      transform={`rotate(${rotation}, ${cx}, ${cy})`}
      style={{ cursor: 'move' }}
      onPointerDown={handlePointerDown}
    >
      <rect
        x={x} y={y} width={w} height={h}
        fill={color + '33'}
        stroke={isSelected ? '#f5f5f7' : color}
        strokeWidth={isSelected ? 2 / zoom : 1 / zoom}
        rx={4 / zoom}
      />
      {renderIcon(obj)}
      <text
        x={cx} y={cy}
        textAnchor="middle" dominantBaseline="middle"
        fontSize={fontSize}
        fill={color}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        {label}
      </text>
      {isSelected && handles.map(h => (
        <circle
          key={h.key}
          data-testid={`resize-handle-${id}-${h.key}`}
          cx={h.cx} cy={h.cy} r={handleR}
          fill="#f5f5f7" stroke={color} strokeWidth={1 / zoom}
          style={{ cursor: h.cursor }}
          onPointerDown={makeResizeHandler(h.key)}
        />
      ))}
    </g>
  )
}

function renderIcon(obj: FloorPlanObject) {
  const { x, y, w, h, color } = obj
  const sw = 1.5
  const alpha = '80'

  switch (obj.type) {
    case 'bed-single':
    case 'bed-double':
    case 'bed-queen':
    case 'bed-king':
      return <rect x={x + w*0.05} y={y + h*0.03} width={w*0.9} height={h*0.17}
        fill="none" stroke={color + alpha} strokeWidth={sw} rx={sw} />

    case 'sofa-2':
    case 'sofa-3':
      return <g fill="none" stroke={color + alpha} strokeWidth={sw}>
        <rect x={x + w*0.12} y={y + h*0.05} width={w*0.76} height={h*0.3} rx={sw} />
        <rect x={x + w*0.02} y={y + h*0.05} width={w*0.1}  height={h*0.9} rx={sw} />
        <rect x={x + w*0.88} y={y + h*0.05} width={w*0.1}  height={h*0.9} rx={sw} />
      </g>

    case 'armchair':
      return <g fill="none" stroke={color + alpha} strokeWidth={sw}>
        <rect x={x + w*0.15} y={y + h*0.1} width={w*0.7} height={h*0.3} rx={sw} />
        <rect x={x + w*0.02} y={y + h*0.1} width={w*0.13} height={h*0.85} rx={sw} />
        <rect x={x + w*0.85} y={y + h*0.1} width={w*0.13} height={h*0.85} rx={sw} />
      </g>

    case 'toilet':
      return <g fill="none" stroke={color + alpha} strokeWidth={sw}>
        <rect x={x + w*0.05} y={y + h*0.03} width={w*0.9} height={h*0.25} rx={sw} />
        <ellipse cx={x + w/2} cy={y + h*0.65} rx={w*0.42} ry={h*0.3} />
      </g>

    case 'basin':
      return <ellipse cx={x + w/2} cy={y + h/2} rx={w*0.38} ry={h*0.38}
        fill="none" stroke={color + alpha} strokeWidth={sw} />

    case 'bathtub':
      return <g fill="none" stroke={color + alpha} strokeWidth={sw}>
        <rect x={x + w*0.05} y={y + h*0.05} width={w*0.9} height={h*0.9} rx={w*0.08} />
        <circle cx={x + w/2} cy={y + h*0.82} r={w*0.08} />
      </g>

    case 'shower':
      return <g fill="none" stroke={color + alpha} strokeWidth={sw}>
        <rect x={x + w*0.05} y={y + h*0.05} width={w*0.9} height={h*0.9} rx={sw} />
        <circle cx={x + w/2} cy={y + h/2} r={w*0.08} />
      </g>

    case 'washer':
    case 'dryer':
      return <circle cx={x + w/2} cy={y + h/2} r={w*0.35}
        fill="none" stroke={color + alpha} strokeWidth={sw} />

    case 'ceiling-fan':
      return <g fill={color + alpha} stroke="none">
        <ellipse cx={x + w/2} cy={y + h*0.3}  rx={w*0.08} ry={h*0.18} />
        <ellipse cx={x + w/2} cy={y + h*0.7}  rx={w*0.08} ry={h*0.18} />
        <ellipse cx={x + w*0.3}  cy={y + h/2} rx={w*0.18} ry={h*0.08} />
        <ellipse cx={x + w*0.7}  cy={y + h/2} rx={w*0.18} ry={h*0.08} />
        <circle cx={x + w/2} cy={y + h/2} r={w*0.05} fill={color} />
      </g>

    case 'light':
      return <circle cx={x + w/2} cy={y + h/2} r={w*0.38}
        fill="none" stroke={color + alpha} strokeWidth={sw} />

    case 'tv':
      return <line x1={x + w*0.1} y1={y + h/2} x2={x + w*0.9} y2={y + h/2}
        stroke={color + alpha} strokeWidth={sw} />

    case 'fridge':
      return <line x1={x + w/2} y1={y + h*0.05} x2={x + w/2} y2={y + h*0.95}
        stroke={color + alpha} strokeWidth={sw} />

    default:
      return null
  }
}

function getSvgScale(el: Element): number {
  const svg = el.closest('svg')
  if (!svg) return 1
  const rect = svg.getBoundingClientRect()
  const vb = svg.getAttribute('viewBox')?.split(' ').map(Number)
  if (!vb) return 1
  return rect.width / vb[2]
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --run src/components/FloorPlan/PlacedObject.test.tsx 2>&1 | tail -5
```

Expected: `Tests 4 passed`

- [ ] **Step 5: Commit**

```bash
git add src/components/FloorPlan/PlacedObject.tsx src/components/FloorPlan/PlacedObject.test.tsx
git commit -m "feat(floor-plan): PlacedObject — drag, resize handles, rotation, icons"
```

---

## Task 6: AnnotationLayer

**Files:**
- Create: `src/components/FloorPlan/AnnotationLayer.tsx`
- Create: `src/components/FloorPlan/AnnotationLayer.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// src/components/FloorPlan/AnnotationLayer.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import AnnotationLayer from './AnnotationLayer'
import type { Annotation } from '../../types'

const wallHack: Annotation = {
  id: 'a1', type: 'wall-hack',
  points: [{ x: 0, y: 0 }, { x: 200, y: 0 }],
}
const tileZone: Annotation = {
  id: 'a2', type: 'tile-zone',
  points: [{ x: 50, y: 50 }, { x: 300, y: 200 }],
}

function renderInSvg(ui: React.ReactNode) {
  return render(<svg>{ui}</svg>)
}

describe('AnnotationLayer', () => {
  it('renders wall-hack as a polyline', () => {
    const { container } = renderInSvg(
      <AnnotationLayer annotations={[wallHack]} activeType={null} zoom={1} onAddAnnotation={vi.fn()} />
    )
    const polyline = container.querySelector('polyline')
    expect(polyline).toBeInTheDocument()
    expect(polyline?.getAttribute('points')).toBe('0,0 200,0')
  })

  it('renders tile-zone as a rect', () => {
    const { container } = renderInSvg(
      <AnnotationLayer annotations={[tileZone]} activeType={null} zoom={1} onAddAnnotation={vi.fn()} />
    )
    const rect = container.querySelector('rect')
    expect(rect).toBeInTheDocument()
    expect(rect?.getAttribute('x')).toBe('50')
    expect(rect?.getAttribute('y')).toBe('50')
    expect(rect?.getAttribute('width')).toBe('250')
    expect(rect?.getAttribute('height')).toBe('150')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --run src/components/FloorPlan/AnnotationLayer.test.tsx 2>&1 | tail -5
```

Expected: FAIL — "Cannot find module './AnnotationLayer'"

- [ ] **Step 3: Create `src/components/FloorPlan/AnnotationLayer.tsx`**

```typescript
import { useState } from 'react'
import type { Annotation, AnnotationType } from '../../types'
import { nanoid } from 'nanoid'

interface Props {
  annotations: Annotation[]
  activeType: AnnotationType | null
  zoom: number
  onAddAnnotation: (ann: Annotation) => void
}

export default function AnnotationLayer({ annotations, activeType, zoom, onAddAnnotation }: Props) {
  const [inProgressPoints, setInProgressPoints] = useState<{ x: number; y: number }[]>([])
  const [previewPoint, setPreviewPoint] = useState<{ x: number; y: number } | null>(null)
  const [tileStart, setTileStart] = useState<{ x: number; y: number } | null>(null)

  function svgPoint(e: React.MouseEvent<SVGGElement>): { x: number; y: number } {
    const svg = e.currentTarget.ownerSVGElement as SVGSVGElement
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const xf = pt.matrixTransform(e.currentTarget.getScreenCTM()!.inverse())
    return { x: xf.x, y: xf.y }
  }

  function handleClick(e: React.MouseEvent<SVGGElement>) {
    if (!activeType) return
    e.stopPropagation()
    const pt = svgPoint(e)

    if (activeType === 'wall-hack') {
      setInProgressPoints(prev => [...prev, pt])
    } else if (activeType === 'tile-zone') {
      if (!tileStart) {
        setTileStart(pt)
      } else {
        commitTileZone(tileStart, pt)
        setTileStart(null)
        setPreviewPoint(null)
      }
    }
  }

  function handleDblClick(e: React.MouseEvent<SVGGElement>) {
    if (activeType !== 'wall-hack' || inProgressPoints.length < 2) return
    e.stopPropagation()
    commitWallHack(inProgressPoints)
    setInProgressPoints([])
    setPreviewPoint(null)
  }

  function handleMouseMove(e: React.MouseEvent<SVGGElement>) {
    if (!activeType) return
    setPreviewPoint(svgPoint(e))
  }

  function commitWallHack(points: { x: number; y: number }[]) {
    onAddAnnotation({ id: nanoid(), type: 'wall-hack', points })
  }

  function commitTileZone(a: { x: number; y: number }, b: { x: number; y: number }) {
    const left = Math.min(a.x, b.x)
    const right = Math.max(a.x, b.x)
    const top = Math.min(a.y, b.y)
    const bottom = Math.max(a.y, b.y)

    if (right - left < 1 || bottom - top < 1) return

    onAddAnnotation({
      id: nanoid(), type: 'tile-zone',
      points: [
        { x: left, y: top },
        { x: right, y: bottom },
      ],
    })
  }

  const sw = 3 / zoom

  return (
    <g
      data-layer="annotations"
      onClick={handleClick}
      onDoubleClick={handleDblClick}
      onMouseMove={handleMouseMove}
      style={{ cursor: activeType ? 'crosshair' : 'default' }}
    >
      {annotations.map(ann => {
        if (ann.type === 'wall-hack') {
          const pts = ann.points.map(p => `${p.x},${p.y}`).join(' ')
          return (
            <polyline
              key={ann.id}
              points={pts}
              fill="none"
              stroke="#ef4444"
              strokeWidth={sw}
              strokeDasharray={`${8/zoom},${4/zoom}`}
            />
          )
        }
        // tile-zone: first point is top-left, second is bottom-right
        const [tl, br] = ann.points
        return (
          <rect
            key={ann.id}
            x={tl.x} y={tl.y}
            width={br.x - tl.x} height={br.y - tl.y}
            fill="rgba(59,130,246,0.2)"
            stroke="#3b82f6"
            strokeWidth={sw}
            strokeDasharray={`${6/zoom},${3/zoom}`}
          />
        )
      })}

      {/* In-progress wall-hack preview */}
      {activeType === 'wall-hack' && inProgressPoints.length > 0 && previewPoint && (
        <polyline
          points={[...inProgressPoints, previewPoint].map(p => `${p.x},${p.y}`).join(' ')}
          fill="none" stroke="#ef4444" strokeWidth={sw} strokeDasharray={`${4/zoom},${4/zoom}`}
          style={{ pointerEvents: 'none' }}
        />
      )}

      {/* In-progress tile-zone preview */}
      {activeType === 'tile-zone' && tileStart && previewPoint && (
        <rect
          x={Math.min(tileStart.x, previewPoint.x)}
          y={Math.min(tileStart.y, previewPoint.y)}
          width={Math.abs(previewPoint.x - tileStart.x)}
          height={Math.abs(previewPoint.y - tileStart.y)}
          fill="rgba(59,130,246,0.1)"
          stroke="#3b82f6"
          strokeWidth={sw}
          strokeDasharray={`${4/zoom},${4/zoom}`}
          style={{ pointerEvents: 'none' }}
        />
      )}
    </g>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --run src/components/FloorPlan/AnnotationLayer.test.tsx 2>&1 | tail -5
```

Expected: `Tests 2 passed`

- [ ] **Step 5: Commit**

```bash
git add src/components/FloorPlan/AnnotationLayer.tsx src/components/FloorPlan/AnnotationLayer.test.tsx
git commit -m "feat(floor-plan): AnnotationLayer — wall-hack polyline + tile-zone rect"
```

---

## Task 7: CalibrationOverlay + ScaleCalibrationModal

**Files:**
- Create: `src/components/FloorPlan/CalibrationOverlay.tsx`
- Create: `src/components/FloorPlan/ScaleCalibrationModal.tsx`
- Create: `src/components/FloorPlan/ScaleCalibrationModal.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// src/components/FloorPlan/ScaleCalibrationModal.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import ScaleCalibrationModal from './ScaleCalibrationModal'

describe('ScaleCalibrationModal', () => {
  it('calls onConfirm with pixelsPerMm = distancePx / mm', async () => {
    const onConfirm = vi.fn()
    const user = userEvent.setup()
    render(<ScaleCalibrationModal distancePx={500} onConfirm={onConfirm} onClose={vi.fn()} />)

    await user.clear(screen.getByRole('spinbutton'))
    await user.type(screen.getByRole('spinbutton'), '2500')
    await user.click(screen.getByRole('button', { name: /confirm/i }))

    expect(onConfirm).toHaveBeenCalledWith(500 / 2500)  // 0.2
  })

  it('calls onClose when cancel clicked', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<ScaleCalibrationModal distancePx={500} onConfirm={vi.fn()} onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalled()
  })

  it('does not call onConfirm if mm input is 0', async () => {
    const onConfirm = vi.fn()
    const user = userEvent.setup()
    render(<ScaleCalibrationModal distancePx={500} onConfirm={onConfirm} onClose={vi.fn()} />)
    await user.clear(screen.getByRole('spinbutton'))
    await user.type(screen.getByRole('spinbutton'), '0')
    await user.click(screen.getByRole('button', { name: /confirm/i }))
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --run src/components/FloorPlan/ScaleCalibrationModal.test.tsx 2>&1 | tail -5
```

Expected: FAIL — "Cannot find module './ScaleCalibrationModal'"

- [ ] **Step 3: Create `src/components/FloorPlan/CalibrationOverlay.tsx`**

```typescript
import { useState } from 'react'

interface Props {
  zoom: number
  pixelsPerMm: number | null
  onMeasured: (distancePx: number) => void
}

export default function CalibrationOverlay({ zoom, pixelsPerMm, onMeasured }: Props) {
  const [pointA, setPointA] = useState<{ x: number; y: number } | null>(null)
  const [preview, setPreview] = useState<{ x: number; y: number } | null>(null)

  function toSvgCoords(e: React.MouseEvent<SVGGElement>): { x: number; y: number } {
    const svg = e.currentTarget.ownerSVGElement as SVGSVGElement
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const xf = pt.matrixTransform(e.currentTarget.getScreenCTM()!.inverse())
    return { x: xf.x, y: xf.y }
  }

  function handleClick(e: React.MouseEvent<SVGGElement>) {
    e.stopPropagation()
    const pt = toSvgCoords(e)
    if (!pointA) {
      setPointA(pt)
    } else {
      const dx = pt.x - pointA.x
      const dy = pt.y - pointA.y
      const distanceMm = Math.hypot(dx, dy)
      // When pixelsPerMm is already set, local coords are in mm — convert back to raw pixels.
      // When no scale yet, local coords are raw pixels already.
      const rawDistancePx = pixelsPerMm ? distanceMm * pixelsPerMm : distanceMm
      onMeasured(rawDistancePx)
      setPointA(null)
      setPreview(null)
    }
  }

  function handleMouseMove(e: React.MouseEvent<SVGGElement>) {
    if (pointA) setPreview(toSvgCoords(e))
  }

  const r = 6 / zoom

  return (
    <g
      data-layer="calibration"
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      style={{ cursor: 'crosshair' }}
    >
      {/* Transparent full-canvas hit area — use % units so it always covers the viewBox */}
      <rect
        x="-50%" y="-50%"
        width="200%" height="200%"
        fill="transparent"
        style={{ cursor: 'crosshair' }}
      />

      {pointA && (
        <circle cx={pointA.x} cy={pointA.y} r={r}
          fill="#f5f5f7" stroke="#0a84ff" strokeWidth={2/zoom} />
      )}
      {pointA && preview && (
        <line
          x1={pointA.x} y1={pointA.y} x2={preview.x} y2={preview.y}
          stroke="#0a84ff" strokeWidth={2/zoom}
          strokeDasharray={`${8/zoom},${4/zoom}`}
        />
      )}
      {pointA && (
        <text x={pointA.x + r + 4/zoom} y={pointA.y}
          fontSize={12/zoom} fill="#f5f5f7" dominantBaseline="middle">
          Click second point
        </text>
      )}
      {!pointA && (
        <text x={0} y={-20/zoom}
          fontSize={12/zoom} fill="#0a84ff" dominantBaseline="middle">
          Click first calibration point
        </text>
      )}
    </g>
  )
}
```

- [ ] **Step 4: Create `src/components/FloorPlan/ScaleCalibrationModal.tsx`**

```typescript
import { useState } from 'react'

interface Props {
  distancePx: number
  onConfirm: (pixelsPerMm: number) => void
  onClose: () => void
}

export default function ScaleCalibrationModal({ distancePx, onConfirm, onClose }: Props) {
  const [mm, setMm] = useState(1000)

  function handleConfirm() {
    if (mm <= 0) return
    onConfirm(distancePx / mm)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-80 rounded-lg bg-panel p-6 shadow-xl border border-divider">
        <h2 className="mb-4 text-lg font-semibold text-text-primary">Calibrate Scale</h2>
        <p className="mb-4 text-sm text-text-muted">
          You drew a line of <strong className="text-text-primary">{Math.round(distancePx)}px</strong>.<br />
          What is the real-world length of this line?
        </p>
        <div className="mb-6">
          <label className="mb-1 block text-sm text-text-muted">Distance (mm)</label>
          <input
            type="number"
            min={1}
            value={mm}
            onChange={e => setMm(Number(e.target.value))}
            className="w-full rounded border border-divider bg-surface px-3 py-2 text-text-primary"
            autoFocus
          />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleConfirm}
            className="flex-1 rounded bg-accent py-2 text-sm font-medium text-white hover:bg-accent-hover"
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded border border-divider bg-surface py-2 text-sm text-text-primary hover:bg-surface-raised"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test -- --run src/components/FloorPlan/ScaleCalibrationModal.test.tsx 2>&1 | tail -5
```

Expected: `Tests 3 passed`

- [ ] **Step 6: Commit**

```bash
git add src/components/FloorPlan/CalibrationOverlay.tsx src/components/FloorPlan/ScaleCalibrationModal.tsx src/components/FloorPlan/ScaleCalibrationModal.test.tsx
git commit -m "feat(floor-plan): CalibrationOverlay + ScaleCalibrationModal"
```

---

## Task 8: FloorPlanSidebar

**Files:**
- Create: `src/components/FloorPlan/FloorPlanSidebar.tsx`
- Create: `src/components/FloorPlan/FloorPlanSidebar.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// src/components/FloorPlan/FloorPlanSidebar.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../../store/store'
import FloorPlanSidebar from './FloorPlanSidebar'

beforeEach(() => {
  useStore.setState({
    floorPlan: {
      image: null,
      pixelsPerMm: null,
      objects: [],
      annotations: [],
      customTemplates: [
        { id: 'ct1', label: 'Study Nook', defaultW: 1200, defaultH: 900, color: '#f59e0b' },
      ],
    },
  })
})

describe('FloorPlanSidebar', () => {
  it('renders all 6 category headings', () => {
    render(
      <FloorPlanSidebar
        onAddObject={vi.fn()}
        onAddCustomTemplate={vi.fn()}
        onAddCustomShape={vi.fn()}
        onSetAnnotationType={vi.fn()}
        activeAnnotationType={null}
      />,
    )
    expect(screen.getByText('Seating')).toBeInTheDocument()
    expect(screen.getByText('Sleeping')).toBeInTheDocument()
    expect(screen.getByText('Appliances')).toBeInTheDocument()
    expect(screen.getByText('Bathroom')).toBeInTheDocument()
    expect(screen.getByText('Lighting & Other')).toBeInTheDocument()
    expect(screen.getByText('Carpentry')).toBeInTheDocument()
  })

  it('clicking an object type calls onAddObject with that type', async () => {
    const onAddObject = vi.fn()
    const user = userEvent.setup()
    render(<FloorPlanSidebar onAddObject={onAddObject} onAddCustomTemplate={vi.fn()} onAddCustomShape={vi.fn()} onSetAnnotationType={vi.fn()} activeAnnotationType={null} />)
    await user.click(screen.getByText('Sofa 2-seater'))
    expect(onAddObject).toHaveBeenCalledWith('sofa-2')
  })

  it('clicking Wall to Hack calls onSetAnnotationType with wall-hack', async () => {
    const onSetAnnotationType = vi.fn()
    const user = userEvent.setup()
    render(<FloorPlanSidebar onAddObject={vi.fn()} onAddCustomTemplate={vi.fn()} onAddCustomShape={vi.fn()} onSetAnnotationType={onSetAnnotationType} activeAnnotationType={null} />)
    await user.click(screen.getByText('Wall to Hack'))
    expect(onSetAnnotationType).toHaveBeenCalledWith('wall-hack')
  })

  it('active annotation type button uses aria-pressed', () => {
    render(<FloorPlanSidebar onAddObject={vi.fn()} onAddCustomTemplate={vi.fn()} onAddCustomShape={vi.fn()} onSetAnnotationType={vi.fn()} activeAnnotationType="wall-hack" />)
    expect(screen.getByRole('button', { name: /wall to hack/i })).toHaveAttribute('aria-pressed', 'true')
  })

  it('renders saved custom templates and custom-shape action', async () => {
    const onAddCustomTemplate = vi.fn()
    const onAddCustomShape = vi.fn()
    const user = userEvent.setup()
    render(<FloorPlanSidebar onAddObject={vi.fn()} onAddCustomTemplate={onAddCustomTemplate} onAddCustomShape={onAddCustomShape} onSetAnnotationType={vi.fn()} activeAnnotationType={null} />)
    await user.click(screen.getByText('Study Nook'))
    expect(onAddCustomTemplate).toHaveBeenCalledWith('ct1')
    await user.click(screen.getByText('+ Add Custom Shape'))
    expect(onAddCustomShape).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --run src/components/FloorPlan/FloorPlanSidebar.test.tsx 2>&1 | tail -5
```

Expected: FAIL — "Cannot find module './FloorPlanSidebar'"

- [ ] **Step 3: Create `src/components/FloorPlan/FloorPlanSidebar.tsx`**

```typescript
import { useStore } from '../../store/store'
import type { AnnotationType, FloorPlanObjectType } from '../../types'
import { OBJECT_CATALOG, OBJECT_CATEGORIES } from '../../data/floorPlanObjects'

interface Props {
  onAddObject: (type: FloorPlanObjectType) => void
  onAddCustomTemplate: (id: string) => void
  onAddCustomShape: () => void
  onSetAnnotationType: (type: AnnotationType | null) => void
  activeAnnotationType: AnnotationType | null
}

const CATEGORY_ICONS: Record<keyof typeof OBJECT_CATEGORIES, string> = {
  'Seating': '🪑',
  'Sleeping': '🛏',
  'Appliances': '🍳',
  'Bathroom': '🚿',
  'Lighting & Other': '💡',
  'Carpentry': '🏗',
}

export default function FloorPlanSidebar({ onAddObject, onAddCustomTemplate, onAddCustomShape, onSetAnnotationType, activeAnnotationType }: Props) {
  const customTemplates = useStore(s => s.floorPlan.customTemplates)

  return (
    <aside className="flex w-48 flex-col overflow-y-auto border-r border-divider bg-panel text-xs">
      <div className="px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-text-muted">
        Object Library
      </div>

      {(Object.entries(OBJECT_CATEGORIES) as [keyof typeof OBJECT_CATEGORIES, FloorPlanObjectType[]][]).map(([category, types]) => (
        <div key={category}>
          <div className="px-3 py-1 text-xs font-semibold text-text-primary">
            {CATEGORY_ICONS[category]} {category}
          </div>
          {types.map(type => {
            const def = OBJECT_CATALOG.find(o => o.type === type)!
            return (
              <button
                key={type}
                type="button"
                onClick={() => onAddObject(type)}
                className="w-full px-4 py-1 text-left text-text-muted hover:bg-surface-raised hover:text-text-primary"
              >
                {def.label}
              </button>
            )
          })}
        </div>
      ))}

      <div className="mt-2 border-t border-divider px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-text-muted">
        Annotations
      </div>
      <button
        type="button"
        aria-pressed={activeAnnotationType === 'wall-hack'}
        onClick={() => onSetAnnotationType(activeAnnotationType === 'wall-hack' ? null : 'wall-hack')}
        className={`mx-2 mb-1 rounded border px-2 py-1 text-left text-xs ${
          activeAnnotationType === 'wall-hack'
            ? 'border-red-500 bg-accent text-white'
            : 'border-red-500 text-red-400 hover:bg-surface-raised'
        }`}
      >
        🔨 Wall to Hack
      </button>
      <button
        type="button"
        aria-pressed={activeAnnotationType === 'tile-zone'}
        onClick={() => onSetAnnotationType(activeAnnotationType === 'tile-zone' ? null : 'tile-zone')}
        className={`mx-2 mb-1 rounded border px-2 py-1 text-left text-xs ${
          activeAnnotationType === 'tile-zone'
            ? 'border-blue-500 bg-accent text-white'
            : 'border-blue-500 text-blue-400 hover:bg-surface-raised'
        }`}
      >
        🟦 Floor to Tile
      </button>

      <div className="mt-2 border-t border-divider px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-text-muted">
        Custom
      </div>
      {customTemplates.map(template => (
        <button
          key={template.id}
          type="button"
          onClick={() => onAddCustomTemplate(template.id)}
          className="mx-2 mb-1 rounded border border-divider px-2 py-1 text-left text-text-muted hover:bg-surface-raised hover:text-text-primary"
        >
          {template.label}
        </button>
      ))}
      <button
        type="button"
        onClick={onAddCustomShape}
        className="mx-2 mb-3 rounded bg-accent py-1 text-center text-xs text-white hover:bg-accent-hover"
      >
        + Add Custom Shape
      </button>
    </aside>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --run src/components/FloorPlan/FloorPlanSidebar.test.tsx 2>&1 | tail -5
```

Expected: `Tests 5 passed`

- [ ] **Step 5: Commit**

```bash
git add src/components/FloorPlan/FloorPlanSidebar.tsx src/components/FloorPlan/FloorPlanSidebar.test.tsx
git commit -m "feat(floor-plan): FloorPlanSidebar — categorized object library + annotation tools"
```

---

## Task 9: FloorPlanProperties + CustomShapeModal

**Files:**
- Create: `src/components/FloorPlan/FloorPlanProperties.tsx`
- Create: `src/components/FloorPlan/FloorPlanProperties.test.tsx`
- Create: `src/components/FloorPlan/CustomShapeModal.tsx`
- Create: `src/components/FloorPlan/CustomShapeModal.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// src/components/FloorPlan/FloorPlanProperties.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import FloorPlanProperties from './FloorPlanProperties'
import type { FloorPlanObject } from '../../types'

const sofa: FloorPlanObject = {
  id: 'o1', type: 'sofa-2', label: 'Sofa', x: 0, y: 0,
  w: 1500, h: 800, rotation: 0, color: '#6366f1',
}

describe('FloorPlanProperties', () => {
  it('shows empty state when no object selected', () => {
    render(<FloorPlanProperties obj={null} onUpdate={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByText(/select an object/i)).toBeInTheDocument()
  })

  it('shows selected object label', () => {
    render(<FloorPlanProperties obj={sofa} onUpdate={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByDisplayValue('Sofa')).toBeInTheDocument()
  })

  it('rotate button cycles rotation 0→90', async () => {
    const onUpdate = vi.fn()
    const user = userEvent.setup()
    render(<FloorPlanProperties obj={sofa} onUpdate={onUpdate} onDelete={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /rotate/i }))
    expect(onUpdate).toHaveBeenCalledWith('o1', { rotation: 90 })
  })

  it('delete button calls onDelete', async () => {
    const onDelete = vi.fn()
    const user = userEvent.setup()
    render(<FloorPlanProperties obj={sofa} onUpdate={vi.fn()} onDelete={onDelete} />)
    await user.click(screen.getByRole('button', { name: /delete/i }))
    expect(onDelete).toHaveBeenCalledWith('o1')
  })

  it('width input calls onUpdate with new w', async () => {
    const onUpdate = vi.fn()
    const user = userEvent.setup()
    render(<FloorPlanProperties obj={sofa} onUpdate={onUpdate} onDelete={vi.fn()} />)
    const widthInput = screen.getByLabelText(/width/i)
    await user.clear(widthInput)
    await user.type(widthInput, '2000')
    await user.tab()
    expect(onUpdate).toHaveBeenCalledWith('o1', { w: 2000 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --run src/components/FloorPlan/FloorPlanProperties.test.tsx 2>&1 | tail -5
```

Expected: FAIL — "Cannot find module './FloorPlanProperties'"

- [ ] **Step 3: Create `src/components/FloorPlan/FloorPlanProperties.tsx`**

```typescript
import type { FloorPlanObject } from '../../types'

interface Props {
  obj: FloorPlanObject | null
  onUpdate: (id: string, patch: Partial<FloorPlanObject>) => void
  onDelete: (id: string) => void
}

const COLORS = ['#6366f1', '#10b981', '#0ea5e9', '#f59e0b', '#ef4444', '#8b5cf6', '#92400e', '#374151']

export default function FloorPlanProperties({ obj, onUpdate, onDelete }: Props) {
  if (!obj) {
    return (
      <aside className="flex w-44 flex-col border-l border-divider bg-panel p-3 text-xs text-text-muted">
        <p className="mt-4 text-center">Select an object to edit its properties</p>
      </aside>
    )
  }

  return (
    <aside className="flex w-44 flex-col overflow-y-auto border-l border-divider bg-panel p-3 text-xs">
      <div className="mb-3 text-[10px] font-bold uppercase tracking-widest text-text-muted">Properties</div>
      <div className="mb-1 font-semibold text-text-primary">{obj.label}</div>

      <label className="mb-1 text-text-muted" htmlFor="fp-label">Label</label>
      <input
        id="fp-label"
        type="text"
        value={obj.label}
        onChange={e => onUpdate(obj.id, { label: e.target.value })}
        className="mb-3 rounded border border-divider bg-surface px-2 py-1 text-text-primary"
      />

      <label className="mb-1 text-text-muted" htmlFor="fp-width">Width (mm)</label>
      <input
        id="fp-width"
        type="number"
        min={10}
        value={Math.round(obj.w)}
        onChange={e => onUpdate(obj.id, { w: Math.max(10, Number(e.target.value)) })}
        onBlur={e => onUpdate(obj.id, { w: Math.max(10, Number(e.target.value)) })}
        className="mb-3 rounded border border-divider bg-surface px-2 py-1 text-text-primary"
      />

      <label className="mb-1 text-text-muted" htmlFor="fp-height">Depth (mm)</label>
      <input
        id="fp-height"
        type="number"
        min={10}
        value={Math.round(obj.h)}
        onChange={e => onUpdate(obj.id, { h: Math.max(10, Number(e.target.value)) })}
        className="mb-3 rounded border border-divider bg-surface px-2 py-1 text-text-primary"
      />

      <div className="mb-1 text-text-muted">Rotation: {obj.rotation}°</div>
      <button
        type="button"
        aria-label="Rotate 90°"
        onClick={() => onUpdate(obj.id, { rotation: ((obj.rotation + 90) % 360) as 0 | 90 | 180 | 270 })}
        className="mb-3 rounded border border-divider bg-surface px-2 py-1 text-text-primary hover:bg-surface-raised"
      >
        ↻ Rotate 90°
      </button>

      <div className="mb-2 text-text-muted">Color</div>
      <div className="mb-4 flex flex-wrap gap-1">
        {COLORS.map(c => (
          <button
            key={c}
            type="button"
            aria-label={`Color ${c}`}
            onClick={() => onUpdate(obj.id, { color: c })}
            style={{ background: c }}
            className={`h-5 w-5 rounded-full border-2 ${obj.color === c ? 'border-text-primary' : 'border-transparent'}`}
          />
        ))}
      </div>

      <button
        type="button"
        aria-label="Delete object"
        onClick={() => onDelete(obj.id)}
        className="rounded bg-red-600 py-1 text-center text-white hover:bg-red-700"
      >
        🗑 Delete
      </button>
    </aside>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --run src/components/FloorPlan/FloorPlanProperties.test.tsx 2>&1 | tail -5
```

Expected: `Tests 5 passed`

- [ ] **Step 4: Write the failing test (CustomShapeModal)**

```typescript
// src/components/FloorPlan/CustomShapeModal.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import CustomShapeModal from './CustomShapeModal'

describe('CustomShapeModal', () => {
  it('calls onConfirm with label, width, height from form', async () => {
    const onConfirm = vi.fn()
    const user = userEvent.setup()
    render(<CustomShapeModal onConfirm={onConfirm} onClose={vi.fn()} />)

    await user.clear(screen.getByLabelText(/label/i))
    await user.type(screen.getByLabelText(/label/i), 'Study Nook')
    await user.clear(screen.getByLabelText(/width/i))
    await user.type(screen.getByLabelText(/width/i), '1200')
    await user.clear(screen.getByLabelText(/depth/i))
    await user.type(screen.getByLabelText(/depth/i), '900')
    await user.click(screen.getByRole('button', { name: /save/i }))

    expect(onConfirm).toHaveBeenCalledWith('Study Nook', 1200, 900)
  })

  it('calls onClose when cancel is clicked', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<CustomShapeModal onConfirm={vi.fn()} onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 4b: Run test to verify it fails**

```bash
npm test -- --run src/components/FloorPlan/CustomShapeModal.test.tsx 2>&1 | tail -5
```

Expected: FAIL — "Cannot find module './CustomShapeModal'"

- [ ] **Step 4c: Create `src/components/FloorPlan/CustomShapeModal.tsx`**

```typescript
import { useState } from 'react'

interface Props {
  onConfirm: (label: string, w: number, h: number) => void
  onClose: () => void
}

export default function CustomShapeModal({ onConfirm, onClose }: Props) {
  const [label, setLabel] = useState('')
  const [w, setW] = useState(1000)
  const [h, setH] = useState(1000)

  function handleConfirm() {
    const trimmed = label.trim()
    if (!trimmed || w <= 0 || h <= 0) return
    onConfirm(trimmed, w, h)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-80 rounded-lg bg-panel p-6 shadow-xl border border-divider">
        <h2 className="mb-4 text-lg font-semibold text-text-primary">Save Custom Template</h2>

        <label className="mb-1 block text-sm text-text-muted" htmlFor="cs-label">Label</label>
        <input
          id="cs-label"
          type="text"
          value={label}
          onChange={e => setLabel(e.target.value)}
          placeholder="e.g. Study Nook"
          className="mb-3 w-full rounded border border-divider bg-surface px-3 py-2 text-text-primary"
          autoFocus
        />

        <label className="mb-1 block text-sm text-text-muted" htmlFor="cs-width">Width (mm)</label>
        <input
          id="cs-width"
          type="number"
          min={10}
          value={w}
          onChange={e => setW(Number(e.target.value))}
          className="mb-3 w-full rounded border border-divider bg-surface px-3 py-2 text-text-primary"
        />

        <label className="mb-1 block text-sm text-text-muted" htmlFor="cs-depth">Depth (mm)</label>
        <input
          id="cs-depth"
          type="number"
          min={10}
          value={h}
          onChange={e => setH(Number(e.target.value))}
          className="mb-4 w-full rounded border border-divider bg-surface px-3 py-2 text-text-primary"
        />

        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleConfirm}
            className="flex-1 rounded bg-accent py-2 text-sm font-medium text-white hover:bg-accent-hover"
          >
            Save Template
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded border border-divider bg-surface py-2 text-sm text-text-primary hover:bg-surface-raised"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test -- --run src/components/FloorPlan/FloorPlanProperties.test.tsx src/components/FloorPlan/CustomShapeModal.test.tsx 2>&1 | tail -5
```

Expected: `Tests 7 passed` (5 properties + 2 custom shape)

- [ ] **Step 6: Commit**

```bash
git add src/components/FloorPlan/FloorPlanProperties.tsx src/components/FloorPlan/FloorPlanProperties.test.tsx \
        src/components/FloorPlan/CustomShapeModal.tsx src/components/FloorPlan/CustomShapeModal.test.tsx
git commit -m "feat(floor-plan): FloorPlanProperties + CustomShapeModal"
```

---

## Task 10: Export Utility + FloorPlanPage

**Files:**
- Create: `src/utils/floorPlanExport.ts`
- Create: `src/components/FloorPlan/FloorPlanPage.tsx`
- Create: `src/components/FloorPlan/FloorPlanPage.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// src/components/FloorPlan/FloorPlanPage.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import FloorPlanPage from './FloorPlanPage'
import { useStore } from '../../store/store'

function resetStore() {
  useStore.setState({
    projects: [{ id: 'p1', name: 'Test', units: [{ type: 'cabinet', id: 'u1', label: 'Unit 1', x: 0, y: 0, settings: { unit: 'mm', height: 800, width: 600, depth: 500, thickness: 18, backThickness: 6, toeKick: null, material: 'oak' }, root: { id: 'r1', elementType: 'void' } }] }],
    activeProjectId: 'p1', selectedId: null, snapGrid: 5, activeUnitId: 'u1',
    floorPlanSelectedId: null,
    floorPlan: { image: null, pixelsPerMm: null, objects: [], annotations: [], customTemplates: [] },
  })
}

describe('FloorPlanPage', () => {
  beforeEach(resetStore)

  it('clicking Sofa 2-seater adds object to store', async () => {
    const user = userEvent.setup()
    render(<FloorPlanPage />)
    await user.click(screen.getByText('Sofa 2-seater'))
    expect(useStore.getState().floorPlan.objects).toHaveLength(1)
    expect(useStore.getState().floorPlan.objects[0].type).toBe('sofa-2')
  })

  it('shows Calibrate Scale button', () => {
    render(<FloorPlanPage />)
    expect(screen.getByRole('button', { name: /calibrate scale/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --run src/components/FloorPlan/FloorPlanPage.test.tsx 2>&1 | tail -5
```

Expected: FAIL — "Cannot find module './FloorPlanPage'"

- [ ] **Step 3: Create `src/utils/floorPlanExport.ts`**

```typescript
import type { FloorPlanData } from '../types'

export function downloadFloorPlanJSON(data: FloorPlanData, name: string): void {
  const payload = {
    pixelsPerMm: data.pixelsPerMm,
    imageWidthPx: data.image?.widthPx ?? null,
    imageHeightPx: data.image?.heightPx ?? null,
    objects: data.objects,
    annotations: data.annotations,
    customTemplates: data.customTemplates,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${name}-floor-plan.json`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 100)
}
```

- [ ] **Step 4: Create `src/components/FloorPlan/FloorPlanPage.tsx`**

```typescript
import { useRef, useState } from 'react'
import { nanoid } from 'nanoid'
import { useStore } from '../../store/store'
import { OBJECT_CATALOG } from '../../data/floorPlanObjects'
import { downloadSVG } from '../../utils/exportSVG'
import { downloadFloorPlanJSON } from '../../utils/floorPlanExport'
import type { AnnotationType, FloorPlanObject, FloorPlanObjectType } from '../../types'
import FloorPlanCanvas from './FloorPlanCanvas'
import FloorPlanSidebar from './FloorPlanSidebar'
import FloorPlanProperties from './FloorPlanProperties'
import ScaleCalibrationModal from './ScaleCalibrationModal'
import CustomShapeModal from './CustomShapeModal'

export default function FloorPlanPage() {
  const svgRef = useRef<SVGSVGElement>(null)
  const [isCalibrating, setIsCalibrating] = useState(false)
  const [pendingDistancePx, setPendingDistancePx] = useState<number | null>(null)
  const [activeAnnotationType, setActiveAnnotationType] = useState<AnnotationType | null>(null)
  const [showCustomShape, setShowCustomShape] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const floorPlan = useStore(s => s.floorPlan)
  const floorPlanSelectedId = useStore(s => s.floorPlanSelectedId)
  const setFloorPlanImage = useStore(s => s.setFloorPlanImage)
  const setFloorPlanScale = useStore(s => s.setFloorPlanScale)
  const addFloorPlanObject = useStore(s => s.addFloorPlanObject)
  const updateFloorPlanObject = useStore(s => s.updateFloorPlanObject)
  const removeFloorPlanObject = useStore(s => s.removeFloorPlanObject)
  const addAnnotation = useStore(s => s.addAnnotation)
  const addCustomTemplate = useStore(s => s.addCustomTemplate)
  const selectFloorPlanObject = useStore(s => s.selectFloorPlanObject)

  const selectedObject = floorPlan.objects.find(o => o.id === floorPlanSelectedId) ?? null

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget
    const file = input.files?.[0]
    if (!file) return

    setUploadError(null)

    if (!file.type.startsWith('image/')) {
      setUploadError('Please choose a valid image file.')
      input.value = ''
      return
    }

    const reader = new FileReader()
    reader.onerror = () => {
      setUploadError('Could not read that image file.')
      input.value = ''
    }
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        setUploadError('Could not decode that image file.')
        input.value = ''
        return
      }

      const img = new Image()
      img.onload = () => {
        setFloorPlanImage({ dataUrl: result, widthPx: img.naturalWidth, heightPx: img.naturalHeight })
        input.value = ''
      }
      img.onerror = () => {
        setUploadError('The uploaded file is not a valid image.')
        input.value = ''
      }
      img.src = result
    }
    reader.readAsDataURL(file)
  }

  function handleAddObject(type: FloorPlanObjectType) {
    const def = OBJECT_CATALOG.find(o => o.type === type)
    if (!def) return
    const obj: FloorPlanObject = {
      id: nanoid(),
      type,
      label: def.label,
      x: 100,
      y: 100,
      w: def.defaultW,
      h: def.defaultH,
      rotation: 0,
      color: def.color,
    }
    addFloorPlanObject(obj)
    selectFloorPlanObject(obj.id)
  }

  function handleAddCustomTemplate(templateId: string) {
    const template = floorPlan.customTemplates.find(t => t.id === templateId)
    if (!template) return

    const obj: FloorPlanObject = {
      id: nanoid(),
      type: 'custom',
      label: template.label,
      x: 100,
      y: 100,
      w: template.defaultW,
      h: template.defaultH,
      rotation: 0,
      color: template.color,
      isCustom: true,
    }
    addFloorPlanObject(obj)
    selectFloorPlanObject(obj.id)
  }

  function handleSaveCustomShape(label: string, w: number, h: number) {
    addCustomTemplate({
      id: nanoid(),
      label,
      defaultW: w,
      defaultH: h,
      color: '#f59e0b',
    })
    setShowCustomShape(false)
  }

  function handleCalibrationPoints(distancePx: number) {
    setIsCalibrating(false)
    setPendingDistancePx(distancePx)
  }

  function handleScaleConfirm(pixelsPerMm: number) {
    setFloorPlanScale(pixelsPerMm)
    setPendingDistancePx(null)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-divider bg-panel px-4 py-2">
        <label className="cursor-pointer rounded border border-divider bg-surface px-3 py-1 text-sm text-text-primary hover:bg-surface-raised">
          📷 Upload Image
          <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
        </label>
        <button
          type="button"
          aria-label="Calibrate Scale"
          onClick={() => setIsCalibrating(true)}
          disabled={!floorPlan.image}
          className="rounded border border-divider bg-surface px-3 py-1 text-sm text-text-primary hover:bg-surface-raised disabled:opacity-40"
        >
          📐 Calibrate Scale
        </button>
        {floorPlan.pixelsPerMm && (
          <span className="text-xs text-text-muted">
            Scale: 1px = {(1 / floorPlan.pixelsPerMm).toFixed(2)}mm
          </span>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => svgRef.current && downloadSVG(svgRef.current, 'floor-plan')}
          className="rounded border border-divider bg-surface px-3 py-1 text-sm text-text-primary hover:bg-surface-raised"
        >
          Export SVG
        </button>
        <button
          type="button"
          onClick={() => downloadFloorPlanJSON(floorPlan, 'floor-plan')}
          className="rounded border border-divider bg-surface px-3 py-1 text-sm text-text-primary hover:bg-surface-raised"
        >
          Export JSON
        </button>
      </div>

      {/* Shared floor plan banner */}
      <div className="border-b border-divider bg-panel px-4 py-2 text-sm text-text-muted">
        <span className="mr-1 text-accent">ℹ</span>
        Floor plan is shared across all projects.
      </div>

      {uploadError && (
        <div role="alert" className="border-b border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200">
          {uploadError}
        </div>
      )}
      {floorPlan.image && !floorPlan.pixelsPerMm && (
        <div className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-100">
          Image uploaded. Calibrate scale before trusting dimensions or exports.
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <FloorPlanSidebar
          onAddObject={handleAddObject}
          onAddCustomTemplate={handleAddCustomTemplate}
          onAddCustomShape={() => setShowCustomShape(true)}
          onSetAnnotationType={setActiveAnnotationType}
          activeAnnotationType={activeAnnotationType}
        />
        <FloorPlanCanvas
          floorPlan={floorPlan}
          svgRef={svgRef}
          isCalibrating={isCalibrating}
          activeAnnotationType={activeAnnotationType}
          onCalibrationPoints={handleCalibrationPoints}
          onAddAnnotation={addAnnotation}
        />
        <FloorPlanProperties
          obj={selectedObject}
          onUpdate={updateFloorPlanObject}
          onDelete={removeFloorPlanObject}
        />
      </div>

      {pendingDistancePx !== null && (
        <ScaleCalibrationModal
          distancePx={pendingDistancePx}
          onConfirm={handleScaleConfirm}
          onClose={() => setPendingDistancePx(null)}
        />
      )}
      {showCustomShape && (
        <CustomShapeModal
          onConfirm={handleSaveCustomShape}
          onClose={() => setShowCustomShape(false)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test -- --run src/components/FloorPlan/FloorPlanPage.test.tsx 2>&1 | tail -5
```

Expected: `Tests 2 passed`

- [ ] **Step 6: Commit**

```bash
git add src/utils/floorPlanExport.ts src/components/FloorPlan/FloorPlanPage.tsx src/components/FloorPlan/FloorPlanPage.test.tsx
git commit -m "feat(floor-plan): FloorPlanPage + JSON export utility"
```

---

## Task 11 (was 12-13): App.tsx wiring + E2E Integration Test

**Files:**
- Modify: `src/App.tsx`
- Create: `src/integration/floorPlanFlow.test.tsx`

- [ ] **Step 1: Update `src/App.tsx`**

Replace the `FloorPlanPlaceholder` import and usage:

```typescript
// Remove this import:
// import FloorPlanPlaceholder from './components/FloorPlanPlaceholder/FloorPlanPlaceholder'

// Add this import at the top:
import FloorPlanPage from './components/FloorPlan/FloorPlanPage'
```

Replace the render:

```tsx
// Replace:
// activeModule === 'floorplan' ? <FloorPlanPlaceholder /> : ...
// With:
activeModule === 'floorplan' ? <FloorPlanPage /> : ...
```

The full relevant section of `src/App.tsx` (lines 155-180 approximately) becomes:

```tsx
      <main className="flex flex-1 overflow-hidden">
        {activeModule === 'floorplan' ? (
          <FloorPlanPage />
        ) : (
          <>
            {sceneLayout && (
              <CabinetCanvas
                sceneLayout={sceneLayout}
                svgRef={svgRef}
                onUnlockNode={storeUnlockNode}
                onUnitClick={setActiveUnit}
                selectedNode={selectedNode}
              />
            )}
            <Sidebar
              cutList={cutList}
              units={activeProject?.units ?? []}
              activeUnitId={activeUnitId}
              onAddUnit={addUnit}
              onRemoveUnit={removeUnit}
              onSelectUnit={setActiveUnit}
              onRenameUnit={renameUnit}
              selectedId={selectedId}
              selectedNode={selectedNode}
              onAddShelf={storeAddShelf}
              onAddDivider={storeAddDivider}
              onDelete={storeDeleteBoard}
              onToggleLock={(id) => {
                if (selectedNode?.locked) storeUnpinNode(id)
                else {
                  const sizeMm = selectedVoid?.parentSplitAxis === 'vertical' ? selectedVoid.w : (selectedVoid?.h ?? selectedNode?.fixedSize ?? 0)
                  if (sizeMm > 0) storePinNode(id, sizeMm)
                }
              }}
              onSetCabinetMaterial={storeSetCabinetMaterial}
              currentMaterial={activeUnit?.settings.material ?? 'oak'}
              selectedVoid={selectedVoid}
              evenH={evenH}
              onDistributeEvenly={(colId, h) => storeDistributeEvenly(colId, h)}
              onSetElementType={storeSetElementType}
              onSetDrawerConfig={storeDrawerConfig}
              onAddAccessory={(nodeId, type) => storeAddAccessory(nodeId, { id: crypto.randomUUID(), type })}
              onRemoveAccessory={storeRemoveAccessory}
            />
          </>
        )}
      </main>
```

- [ ] **Step 2: Verify TypeScript compiles (run full suite after App.tsx change)**

```bash
npm test -- --run 2>&1 | tail -5
```

Expected: Existing tests still pass

- [ ] **Step 3: Write the E2E integration test**

```typescript
// src/integration/floorPlanFlow.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { useStore } from '../store/store'

function resetStore() {
  localStorage.clear()
  useStore.setState({
    projects: [{
      id: 'p1',
      name: 'My Home',
      units: [{
        type: 'cabinet', id: 'u1', label: 'Unit 1', x: 0, y: 0,
        settings: { unit: 'mm', height: 800, width: 600, depth: 500, thickness: 18, backThickness: 6, toeKick: null, material: 'oak' },
        root: { id: 'r1', elementType: 'void' },
      }],
    }],
    activeProjectId: 'p1',
    selectedId: null,
    snapGrid: 5,
    activeUnitId: 'u1',
    floorPlanSelectedId: null,
    floorPlan: { image: null, pixelsPerMm: null, objects: [], annotations: [], customTemplates: [] },
  })
  useStore.temporal.getState().clear()
}

describe('Floor Plan E2E', () => {
  beforeEach(resetStore)

  it('user switches to floor plan, adds objects via sidebar, and exports JSON', async () => {
    const user = userEvent.setup()
    render(<App />)

    // 1. Switch to floor plan module
    await user.click(screen.getByRole('button', { name: /floor plan/i }))
    expect(screen.getByTestId('floor-plan-canvas')).toBeInTheDocument()

    // 2. Object library is visible
    expect(screen.getByText('Seating')).toBeInTheDocument()

    // 3. Add 3 objects by clicking in sidebar
    await user.click(screen.getByText('Sofa 2-seater'))
    await user.click(screen.getByText('Queen Bed'))
    await user.click(screen.getByText('Toilet'))

    const { floorPlan } = useStore.getState()
    expect(floorPlan.objects).toHaveLength(3)
    expect(floorPlan.objects.map(o => o.type)).toEqual(
      expect.arrayContaining(['sofa-2', 'bed-queen', 'toilet'])
    )

    // 4. Latest object is selected via store-backed selection — properties panel shows
    expect(useStore.getState().floorPlanSelectedId).toBe(floorPlan.objects[2].id)
    expect(screen.queryByText(/select an object/i)).not.toBeInTheDocument()

    // 5. Export button is present and enabled after objects are placed
    // (jsdom can't simulate SVG drag for calibration, so scale/annotation tests are skipped)
    expect(screen.getByRole('button', { name: /export json/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- --run src/integration/floorPlanFlow.test.tsx 2>&1 | tail -8
```

Expected: `Tests 1 passed`

- [ ] **Step 5: Run full test suite**

```bash
npm test -- --run 2>&1 | tail -10
```

Expected: All tests pass (≥ 210 tests)

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/integration/floorPlanFlow.test.tsx
git commit -m "feat(floor-plan): wire FloorPlanPage into App.tsx + E2E integration test"
```

---

## Success Criteria

All of the following must be true before this plan is complete:

1. `npm test -- --run` passes with ≥ 215 tests, 0 failures
2. Floor plan module is accessible via the "Floor Plan" tab in the module switcher
3. Users can upload a JPEG/PNG floor plan image and see it rendered on the canvas
4. Scale calibration (two-point line + mm dialog) sets `pixelsPerMm` in the store
5. Clicking any item in the object library adds a placed object to the canvas
6. Objects can be selected, moved (drag), resized (handles), rotated (90° increments), relabeled, and colored
7. Custom shapes can be added via the "+ Add Custom Shape" dialog
8. Wall-hack and tile-zone annotations can be drawn on the canvas
9. "Export SVG" and "Export JSON" buttons work
10. Switching between Cabinet and Floor Plan modules preserves each module's state
11. Dark theme is applied application-wide (dark surface, dark panel, blue accent)
