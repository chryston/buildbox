/**
 * The Plan View canvas (#55 criterion 3, #57 §4–5, #60 criterion 14): the Floor's Plan Image,
 * its Placed Items, the selection's measurements and the Item Origin markers, drawn from one
 * `DisplayList` through the one renderer.
 *
 * What #60 changed is that nothing here draws anything. The Floor comes out of `derive`
 * already projected — every corner, every bound, every arc — and `drawing` turns it into a
 * display list; this file is the viewport, the pointer and the gestures. It used to project
 * the four footprint corners itself, size the dimension text itself and measure the
 * `Floor bounds` chip's box as `text.length * 6.2`, and the Item Detail canvas did the same
 * arithmetic a second time with different constants.
 *
 * The viewport still arrives from the workspace store and the device-local cache behind it.
 * A drag previews in the store and commits one `plan.movePlacement` when the pointer comes
 * up; the rotate handle previews in local state and commits one `plan.rotatePlacement`;
 * `Pick on canvas` only ever opens the origin preview. Nothing here dispatches mid-gesture
 * (#26).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { affineApply, affineInvert, resolveSnap } from '../../derive'
import type { DerivedFloor, FloorWalls, SnapCandidate, SnapKind } from '../../derive'
import type { DisplayUnit, Point2 } from '../../domain'
import { footprintPath } from '../../domain'
import {
  LAYER_ORDER,
  drawPlanView,
  drawSelectionAnnotations,
  drawWalls,
  unionRect,
} from '../../drawing'
import type { DisplayLayer, DisplayList, OpeningPreview, PlanPreview, Sizing, WallOpenings } from '../../drawing'
import { DisplayListSvg } from '../drawing/DisplayListSvg'
import type { DisplayListInteractions } from '../drawing/DisplayListSvg'
import { formatMm } from './displayUnits'
import { rotationFromPointer } from './rotateHandle'
import { fitViewport, zoomAround } from './viewport'
import type { Viewport } from './viewport'
import type { AngleSnap, DesignEditPreview, ItemDragPreview, WorkspaceTool } from './workspaceStore'

const WHEEL_IN = 1.25
const WHEEL_OUT = 0.8
/** The sheet drawn behind a Floor with no Plan Image, in millimetres. */
const PLACEHOLDER_MM = { w: 800, h: 600 }

export interface PlanViewCanvasProps {
  hostRef: RefObject<HTMLDivElement | null>
  svgRef: RefObject<SVGSVGElement | null>
  /** The Floor, already derived through the session's cache (#60 criterion 3). */
  floor: DerivedFloor
  /** The Plan View's own switch; a Floor can show its Plan Image in one view and not another. */
  showPlanImage: boolean
  /** The Plan Image's bytes as a URL the browser can load, or `null` when they are not loaded. */
  imageSrc: string | null
  /** `null` until the cache has answered or the first `Fit` has run. */
  viewport: Viewport | null
  onViewport: (viewport: Viewport) => void
  tool: WorkspaceTool
  selection: string | null
  onSelect: (id: string | null) => void
  /**
   * Where the pointer is over the Floor, in Floor millimetres; `null` when it leaves the canvas.
   * The tools that aim at the Floor rather than at a handle — the Opening ghost (#65) — read the
   * pointer from here: an overlay drawn above the canvas cannot see the moves of the canvas under
   * it, and a ghost that only appears when the pointer happens to cross the overlay's own pixels
   * is a ghost that never appears.
   */
  onCursorChange?: (point: Point2 | null) => void
  /**
   * A click that landed on the Floor itself, in Floor millimetres — not a click on a footprint, a
   * handle or the tool's own controls, and not the end of a drag. The Door / window tool places
   * its Opening here (#65 criterion 1).
   */
  onCanvasClick?: (point: Point2) => void
  dragPreview: ItemDragPreview | null
  onDragPreview: (preview: ItemDragPreview | null) => void
  /** The pointer came up after a real move: commit the whole drag as one Intent. */
  onMoveItem: (id: string, x: number, y: number) => void
  /** The pointer came up after a turn: commit the whole turn as one Intent. */
  onRotateItem: (id: string, rotationDeg: number) => void
  /** The design edit awaiting `Apply` (D3), or `null`. */
  designPreview: DesignEditPreview | null
  /** `Pick on canvas` armed: the next click on the selected placement sets the Item Origin. */
  pickingOrigin: boolean
  /** Item Origin candidates of the selected placement's design, for the pick's snap. */
  originCandidates: readonly SnapCandidate[]
  /** The kinds the nine `Snaps ▾` rows switch on; the pick honours them like every other tool. */
  snapKinds: ReadonlySet<SnapKind>
  /** The pick's answer, in footprint-local millimetres. Opens the preview; commits nothing. */
  onPickOrigin: (origin: Point2) => void
  unit: DisplayUnit
  precision: number
  angleSnap: AngleSnap
  /** The Floor's tidied Walls, drawn as bands under the footprints (#64 §15). */
  walls?: FloorWalls | null
  /** The selected Wall: drawn with a heavier line and its end handles (#64 §15). */
  selectedWallId?: string | null
  /** A Wall band was clicked; the selection moves to it (#64 §15). */
  onSelectWall?: (id: string) => void
  /**
   * The Floor's Openings, resolved against their hosts by `wallOpenings` (#65 §12). The caller
   * resolves them because the same answer feeds the hit-testing and the drawing, and because a
   * canvas that derived them itself would rebuild the Wall clean-up on every pointer move.
   */
  openings?: readonly WallOpenings[]
  /** The selected Opening: its symbol drawn heavier than its neighbours (#65 §11). */
  selectedOpeningId?: string | null
  /** The Opening being placed right now, as a ghost (#65 §10). */
  openingPreview?: OpeningPreview | null
  /** An Opening's symbol was clicked; the selection moves to it (#65 §11). */
  onSelectOpening?: (id: string) => void
  /** Drawn above the items while calibrating; it owns the pointer meanwhile. SVG: it lives in
   * the scene's own `<g>`, so it must be drawn in the Floor's millimetres. */
  overlay?: ReactNode
  /**
   * An HTML layer over the canvas — the Wall draft's bar and chips, which are words and
   * controls, not geometry. It sits on the canvas host, whose box is the same one the scene's
   * matrix is measured from, so a point placed at `x·zoom + panX` lands where the scene draws
   * `x`. It owns the pointer meanwhile.
   */
  htmlOverlay?: ReactNode
}

/**
 * The one cache the Plan View reads through (#60 criterion 3).
 *
 * Module-level and shared by every canvas in the app, keyed by the Project's identity and
 * revision: two views of the same Floor at the same revision share the work, and a revision
 * bump misses. `ui` never builds one — see `session.createProjectSession`.
 */
export function PlanViewCanvas(props: PlanViewCanvasProps): ReactNode {
  const {
    hostRef, svgRef, floor, showPlanImage, imageSrc, viewport, onViewport,
    tool, selection, onSelect, onCursorChange, onCanvasClick, dragPreview, onDragPreview, onMoveItem, onRotateItem,
    designPreview, pickingOrigin, originCandidates, snapKinds, onPickOrigin, unit, precision,
    angleSnap, overlay, htmlOverlay, walls, selectedWallId = null, onSelectWall,
    openings = [], selectedOpeningId = null, openingPreview = null, onSelectOpening,
  } = props
  const [hostSize, setHostSize] = useState({ width: 0, height: 0 })
  const [dragging, setDragging] = useState(false)
  /** The live turn: the Item being turned and the rotation its pointer asks for. */
  const [turnPreview, setTurnPreview] = useState<{ id: string; rotationDeg: number } | null>(null)
  const panning = useRef(false)
  const lastPan = useRef({ x: 0, y: 0 })
  const panMoved = useRef(false)
  /**
   * Where the gesture that just started began. The renderer delegates from a `<path>` deep in
   * the tree, so the element that took the pointer is not the one that can be captured: the
   * canvas keeps the client point and the Floor point the pointer was at, and the drag reads
   * them back.
   */
  const lastClient = useRef({ x: 0, y: 0 })
  const lastPointer = useRef<Point2 | null>(null)

  const contentW = floor.planImage === null
    ? PLACEHOLDER_MM.w
    : floor.planImage.widthPx * Math.hypot(floor.planImage.pxToFloor.a, floor.planImage.pxToFloor.b)
  const contentH = floor.planImage === null
    ? PLACEHOLDER_MM.h
    : floor.planImage.heightPx * Math.hypot(floor.planImage.pxToFloor.c, floor.planImage.pxToFloor.d)
  const pixelsPerMm = floor.planImage === null
    ? null
    : 1 / Math.hypot(floor.planImage.pxToFloor.a, floor.planImage.pxToFloor.b)

  // The host's size drives both `Fit` and the first-viewport decision.
  useEffect(() => {
    const el = hostRef.current
    if (el === null) return
    const measure = (): void => setHostSize({ width: el.clientWidth, height: el.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [hostRef])

  // No cached viewport for this view: `Fit` once the host has a size.
  useEffect(() => {
    if (viewport !== null || hostSize.width <= 0 || hostSize.height <= 0) return
    onViewport(fitViewport(hostSize.width, hostSize.height, contentW, contentH))
  }, [viewport, hostSize, contentW, contentH, onViewport])

  // Wheel zoom needs a non-passive listener to keep the page from scrolling. It goes on the
  // canvas host rather than the `<svg>`, because an HTML overlay over the canvas — the Wall
  // draft — is a sibling of the `<svg>` and would otherwise swallow the wheel: putting down a
  // Wall must not cost a person the ability to zoom while they place it (#64 §12).
  useEffect(() => {
    const el = hostRef.current ?? svgRef.current
    if (el === null) return
    const onWheel = (event: Event): void => {
      const wheel = event as WheelEvent
      wheel.preventDefault()
      if (viewport === null) return
      const rect = el.getBoundingClientRect()
      onViewport(zoomAround(viewport, wheel.deltaY < 0 ? WHEEL_IN : WHEEL_OUT, wheel.clientX - rect.left, wheel.clientY - rect.top))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [hostRef, svgRef, viewport, onViewport])

  /** True while a footprint or the handle has taken the pointer for this gesture. */
  const consumedPointer = useRef(false)

  const onPointerDown = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    // A pointerdown that reaches the Floor starts a fresh gesture: whatever a footprint or the
    // handle took last time is over, so this click is a click on the Floor again.
    consumedPointer.current = false
    if (overlay !== undefined || htmlOverlay !== undefined) return // it owns the pointer
    const isPanGesture = tool === 'pan' || event.button === 1
    if (!isPanGesture || viewport === null) return
    panning.current = true
    panMoved.current = false
    lastPan.current = { x: event.clientX, y: event.clientY }
    svgRef.current?.setPointerCapture(event.pointerId)
  }, [overlay, htmlOverlay, tool, viewport, svgRef])

  const onPointerMove = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (!panning.current || viewport === null) return
    const dx = event.clientX - lastPan.current.x
    const dy = event.clientY - lastPan.current.y
    if (dx !== 0 || dy !== 0) panMoved.current = true
    lastPan.current = { x: event.clientX, y: event.clientY }
    onViewport({ zoom: viewport.zoom, panX: viewport.panX + dx, panY: viewport.panY + dy })
  }, [viewport, onViewport])

  const onPointerUp = useCallback(() => {
    panning.current = false
  }, [])

  /** Client pixels to Floor millimetres — the one place the viewport is inverted. */
  const toFloor = useCallback((clientX: number, clientY: number): Point2 | null => {
    const el = svgRef.current
    if (el === null || viewport === null) return null
    const rect = el.getBoundingClientRect()
    return {
      x: (clientX - rect.left - viewport.panX) / viewport.zoom,
      y: (clientY - rect.top - viewport.panY) / viewport.zoom,
    }
  }, [svgRef, viewport])

  /**
   * Report the pointer to the tools that aim at the Floor, then pan if a pan is in progress. The
   * order matters: a pan is a move too, and the ghost under a panning pointer should follow it.
   */
  const onCanvasPointerMove = useCallback((event: React.PointerEvent<SVGSVGElement>): void => {
    onCursorChange?.(toFloor(event.clientX, event.clientY))
    onPointerMove(event)
  }, [onCursorChange, toFloor, onPointerMove])

  const onBackgroundClick = useCallback((event: React.MouseEvent<SVGSVGElement>) => {
    // A pointerdown that a footprint or the rotate handle took is not a click on the Floor,
    // even when the click itself lands on the root — which is what a drag does, its pointer
    // coming up somewhere else. Clearing the selection there would undo the selection the
    // same gesture just made.
    if (consumedPointer.current) return
    if (overlay !== undefined || panMoved.current) return
    // The Wall tool's layer takes its own clicks: a click that finished a Wall segment is not a
    // click on the Floor. The Door / window tool has no layer of its own — its controls are
    // transparent to the pointer — so a click that reached the canvas reached the Floor, and the
    // tool places where it landed.
    if (tool === 'select' && htmlOverlay === undefined) onSelect(null)
    if (tool !== 'opening') return
    const at = toFloor(event.clientX, event.clientY)
    if (at !== null) onCanvasClick?.(at)
  }, [overlay, htmlOverlay, panMoved, tool, onSelect, onCanvasClick, toFloor])

  function startItemDrag(id: string): void {
    const item = floor.placements.find((p) => p.id === id)
    if (item === undefined || tool !== 'select' || viewport === null) return
    consumedPointer.current = true
    // `Pick on canvas` armed: this click sets the Item Origin preview rather than dragging.
    if (pickingOrigin && selection === id) {
      const at = lastPointer.current
      if (at === null) return
      const local = affineApply(affineInvert(item.worldTransform), at)
      // #59 §5: `Pick on canvas` is a tool like any other, so it goes through the same
      // resolver — the same 12 CSS px of acquisition at this zoom, the same tie-break, and the
      // same nine switches. `viewport.zoom` is pixels per millimetre, which is what converts.
      const snap = resolveSnap(originCandidates, local, viewport.zoom, snapKinds)
      onPickOrigin(snap?.point ?? local)
      return
    }
    onSelect(id)
    const startX = lastClient.current.x
    const startY = lastClient.current.y
    const origX = item.translation.x
    const origY = item.translation.y
    let moved = false
    let latest = { x: origX, y: origY }

    const onMove = (moveEvent: PointerEvent): void => {
      const dx = (moveEvent.clientX - startX) / viewport.zoom
      const dy = (moveEvent.clientY - startY) / viewport.zoom
      if (!moved && Math.abs(moveEvent.clientX - startX) + Math.abs(moveEvent.clientY - startY) <= 4) return
      moved = true
      latest = { x: origX + dx, y: origY + dy }
      onDragPreview({ id, x: latest.x, y: latest.y })
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setDragging(false)
      onDragPreview(null)
      if (moved) onMoveItem(id, latest.x, latest.y)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    setDragging(true)
  }

  /**
   * The rotate handle's drag: the rotation follows the pointer about the Item Origin, snapped
   * to the angle increment while angle snap is on, and commits once when the pointer comes up.
   */
  function startRotateDrag(id: string): void {
    const item = floor.placements.find((p) => p.id === id)
    if (item === undefined || tool !== 'select' || viewport === null) return
    consumedPointer.current = true
    let latest = item.rotationDeg
    let turned = false

    const onMove = (moveEvent: PointerEvent): void => {
      const at = toFloor(moveEvent.clientX, moveEvent.clientY)
      if (at === null) return
      latest = rotationFromPointer(item.translation, at, angleSnap)
      turned = true
      setTurnPreview({ id, rotationDeg: latest })
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setTurnPreview(null)
      if (turned && latest !== item.rotationDeg) onRotateItem(id, latest)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const zoom = viewport?.zoom ?? 1
  const panX = viewport?.panX ?? 0
  const panY = viewport?.panY ?? 0
  const matrix = viewport === null
    ? undefined
    : `matrix(${viewport.zoom},0,0,${viewport.zoom},${panX},${panY})`
  const cursor = overlay !== undefined || htmlOverlay !== undefined
    ? 'crosshair'
    : dragging
      ? tool === 'pan' ? 'grabbing' : 'move'
      : tool === 'pan' ? 'grab' : pickingOrigin ? 'crosshair' : 'default'

  // ------------------------------------------------------------- what is drawn
  /**
   * One preview for both halves of the drawing: the Floor draws the Item being dragged or
   * turned at where the pointer says it is, and the annotations follow it, so a measurement
   * reads the size the Item is being shown at rather than the size it was last committed at.
   */
  const preview: PlanPreview | null = designPreview !== null
    && (designPreview.footprint !== null || designPreview.origin !== null)
    ? {
      scope: 'design',
      id: designPreview.itemDesignId,
      ...(designPreview.footprint === null ? {} : { footprint: footprintPath(designPreview.footprint) }),
      ...(designPreview.origin === null ? {} : { origin: designPreview.origin }),
    }
    : selection !== null && (dragPreview?.id === selection || turnPreview?.id === selection)
      ? {
        scope: 'placement',
        id: selection,
        ...(dragPreview !== null && dragPreview.id === selection
          ? { translation: { x: dragPreview.x, y: dragPreview.y } }
          : {}),
        ...(turnPreview !== null && turnPreview.id === selection ? { rotationDeg: turnPreview.rotationDeg } : {}),
      }
      : null

  const sizing: Sizing = { kind: 'screen', pxPerMm: zoom }
  const formatLength = (mm: number): string => formatMm(mm, unit, precision)
  const resolveAsset = (hash: string): string | null =>
    floor.planImage !== null && floor.planImage.assetHash === hash ? imageSrc : null

  const list = drawPlanView(floor, { showPlanImage, preview }, { sizing })
  // Walls and footprints are two lists built for two reasons, but they share one z-order:
  // `LAYER_ORDER` is the only source, so the bands are interleaved by layer rather than
  // appended, or a Wall would land on top of the Item standing in it (#60 §3, #64 §15).
  const wallList = walls === undefined || walls === null || walls.walls.length === 0
    ? null
    : drawWalls(walls, { sizing, selectedWallId, openings, selectedOpeningId, preview: openingPreview })
  const withWalls: DisplayList = wallList === null
    ? list
    : {
        ...list,
        bounds: unionRect(list.bounds, wallList.bounds),
        layers: LAYER_ORDER.flatMap((key): DisplayLayer[] => {
          const items = [...list.layers, ...wallList.layers]
            .filter((layer) => layer.key === key)
            .flatMap((layer) => layer.items)
          return items.length === 0 ? [] : [{ key, items }]
        }),
      }
  const annotations = overlay === undefined
    ? drawSelectionAnnotations(floor, selection, { sizing, formatLength, preview })
    : null
  // One flat text layer, not two. The drawing's words and the selection's words are built as
  // separate lists because they are keyed differently — one by the revision, one by a click —
  // but they reach the screen as a single untransformed group, which is what keeps a label
  // upright and addressable by one name.
  const textOnly: DisplayList = annotations === null
    ? withWalls
    : { ...annotations, layers: [...withWalls.layers, ...annotations.layers] }

  const interactions: DisplayListInteractions = {
    onWallPointerDown: onSelectWall === undefined
      ? undefined
      : (id) => {
          // The click that selected this Wall must not be answered again as a click on the
          // background, which would deselect it in the same gesture (#64 §15). While the Door /
          // window tool is in hand the pointerdown is not a selection, and the background click
          // still owns it: that click is what places the Opening.
          if (tool !== 'opening') consumedPointer.current = true
          onSelectWall(id)
        },
    onOpeningPointerDown: onSelectOpening === undefined
      ? undefined
      : (id) => {
          if (tool !== 'opening') consumedPointer.current = true
          onSelectOpening(id)
        },
    onItemPointerDown: (id, event) => {
      lastClient.current = { x: event.clientX, y: event.clientY }
      lastPointer.current = toFloor(event.clientX, event.clientY)
      event.stopPropagation()
      startItemDrag(id)
    },
    onRotatePointerDown: (id, event) => {
      lastClient.current = { x: event.clientX, y: event.clientY }
      startRotateDrag(id)
    },
  }

  return (
    <>
      <svg
        ref={svgRef}
        data-testid="floor-plan-canvas"
        style={{ touchAction: 'none', cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onCanvasPointerMove}
        onPointerLeave={() => onCursorChange?.(null)}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={onBackgroundClick}
      >
        {matrix !== undefined && (
          <>
            <DisplayListSvg
              list={withWalls}
              sizing={sizing}
              matrix={matrix}
              textSpace="screen"
              textLayer={annotations === null ? 'with' : 'none'}
              screen={{ pxPerUnit: zoom, panX, panY }}
              emphasis={{ selected: selection === null ? undefined : new Set([selection]) }}
              resolveAsset={resolveAsset}
              interactions={interactions}
            />
            {annotations === null
              ? overlay !== undefined && <g transform={matrix}>{overlay}</g>
              : (
                <>
                  {/* The selection's measurements and Item Origins are a second list, keyed by a
                      click rather than by the revision, so a gesture does not rebuild a hundred
                      footprints. */}
                  <DisplayListSvg
                    list={annotations}
                    sizing={sizing}
                    matrix={matrix}
                    textSpace="screen"
                    textLayer="none"
                    screen={{ pxPerUnit: zoom, panX, panY }}
                    resolveAsset={resolveAsset}
                    interactions={interactions}
                  >
                    {overlay}
                  </DisplayListSvg>
                  {/* Then every word of both lists, last and flat on the screen, exactly as one
                      canvas draws them: a label that crosses an Item Origin paints over the
                      crosshair, not under it. */}
                  <DisplayListSvg
                    list={textOnly}
                    sizing={sizing}
                    matrix={matrix}
                    textSpace="screen"
                    textLayer="only"
                    screen={{ pxPerUnit: zoom, panX, panY }}
                    emphasis={{ selected: selection === null ? undefined : new Set([selection]) }}
                    resolveAsset={resolveAsset}
                    interactions={interactions}
                  />
                </>
              )}
          </>
        )}
      </svg>
      {htmlOverlay}
      {pixelsPerMm !== null && (
        <div className="bb-workspace-scale-hint" data-testid="scale-hint">
          Scale: 1px = {(1 / pixelsPerMm).toFixed(2)}mm
        </div>
      )}
    </>
  )
}

// -------------------------------------------------------------------- the derived Floor
