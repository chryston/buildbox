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
import type { DerivedFloor, FloorRooms, FloorWalls, RenovationState, SnapCandidate, SnapKind } from '../../derive'
import type { DisplayUnit, Point2 } from '../../domain'
import { footprintPath } from '../../domain'
import {
  LAYER_ORDER,
  displayRects,
  drawPlanView,
  drawPlacement,
  drawRooms,
  drawSelectionAnnotations,
  drawWarningBadges,
  drawWalls,
  pathToCommands,
  renovationOverlays,
  unionRect,
  wallLabelBoxes,
} from '../../drawing'
import type { BadgeSubject, DisplayLayer, DisplayList, OpeningPreview, PlanPreview, RenovationOutline, RoomProposal, Sizing, WallOpenings } from '../../drawing'
import { DisplayListSvg } from '../drawing/DisplayListSvg'
import type { DisplayListInteractions } from '../drawing/DisplayListSvg'
import { STRINGS } from '../strings'
import { formatMm, formatSquareMetres } from './displayUnits'
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
  /**
   * The Renovation Display this canvas is drawing (#70 §F), or nothing at all when the flag is off.
   *
   * `states` answers two questions with one map: an entity absent from it is not drawn in this
   * Display, and an entity present in it is drawn as that State — which decides the overlay laid on
   * top. The entity's own item is never rewritten: the overlay arrives as separate display-list
   * items in the same layer, so the layer's colour is still what is underneath it.
   */
  renovation?: { states: ReadonlyMap<string, RenovationState> } | null
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
  /**
   * The Floor's Rooms, derived through the session's cache (#67 §3). Their areas are drawn under
   * the Wall bands and their labels in the same text half as the `W-n` references, so this canvas
   * interleaves them by `LAYER_ORDER` rather than appending them.
   */
  rooms?: FloorRooms | null
  /** The selected Room: heavier line and a deeper fill (#67 behaviour 3). */
  selectedRoomId?: string | null
  /** A Room's area was clicked; the selection moves to it (#67 behaviour 3). */
  onSelectRoom?: (id: string) => void
  /**
   * The Room being drawn or edited, with every region it shares with another Room. Red and
   * hatched when it cannot be committed, accent while it can (#67 behaviours 20–21).
   */
  roomProposal?: RoomProposal | null
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
  /**
   * The entities carrying an open or reopened warning, with the box each one takes (#66 §14).
   * The canvas places the `!` badges itself, because it is the canvas that knows what is already
   * drawn: a badge must not cover a label, a handle or another badge, and only the lists about
   * to be painted say what those are.
   *
   * The badges are built here and never in the Floor's own list, which is what keeps them off
   * the export — the sheets are composed from `drawPlanView` and `drawWalls` alone, and warnings
   * never appear on drawings.
   */
  warningSubjects?: readonly BadgeSubject[]
  /** A badge was clicked: open the Warning strip at that entity's first row. */
  onSelectWarningBadge?: (id: string) => void
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
    angleSnap, overlay, htmlOverlay, walls, renovation = null, selectedWallId = null, onSelectWall,
    openings = [], selectedOpeningId = null, openingPreview = null, onSelectOpening,
    rooms = null, selectedRoomId = null, onSelectRoom, roomProposal = null,
    warningSubjects = [], onSelectWarningBadge,
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

  // #70 §F: a Renovation Display draws a subset of the Floor and marks what it draws. The subset is
  // `states`' domain — an entity the Display does not draw is absent from it — and the marking is
  // the overlay items `renovationOverlays` lays in each entity's own layer. Flag-off, `renovation`
  // is null and every one of these is the same object the canvas was already given.
  const states = renovation === null ? null : renovation.states
  const drawnFloor: DerivedFloor = states === null
    ? floor
    : { ...floor, placements: floor.placements.filter((p) => states.has(p.id)) }
  const drawnWalls: FloorWalls | null | undefined = states === null || walls === undefined || walls === null
    ? walls
    : { ...walls, walls: walls.walls.filter((wall) => states.has(wall.id)) }
  const drawnRooms: FloorRooms | null = states === null || rooms === null
    ? rooms
    : { ...rooms, rooms: rooms.rooms.filter((room) => states.has(room.id)) }
  const overlayList: DisplayList | null = states === null
    ? null
    : {
        space: 'floor',
        bounds: drawnFloor.bounds ?? { x: 0, y: 0, w: 0, h: 0 },
        layers: renovationOverlays(renovationOutlines(drawnFloor, drawnWalls ?? null, drawnRooms), states, sizing),
        missingGlyphs: [],
      }

  const list = drawPlanView(renovation === null ? floor : drawnFloor, { showPlanImage, preview }, { sizing })
  // Walls, Rooms and footprints are lists built for three reasons, but they share one z-order:
  // `LAYER_ORDER` is the only source, so each is interleaved by layer rather than appended, or a
  // Wall would land on top of the Item standing in it (#60 §3, #64 §15, #67 behaviour 35).
  // An Opening belongs to the Wall it is cut in: a Display that does not draw that Wall does not
  // draw its Openings either, and `drawWalls` is handed only the hosts it will find.
  const drawnOpenings = states === null
    ? openings
    : openings.filter((host) => states.has(host.wallId))
  const wallList = drawnWalls === undefined || drawnWalls === null || drawnWalls.walls.length === 0
    ? null
    : drawWalls(drawnWalls, { sizing, selectedWallId, openings: drawnOpenings, selectedOpeningId, preview: openingPreview })
  // A Room's label may not sit on a `W-n` reference, and the only honest source for where those
  // are is the placement that draws them.
  const roomList = drawnRooms === null || drawnRooms.rooms.length === 0
    ? null
    : drawRooms(drawnRooms, {
      sizing,
      selectedRoomId,
      proposal: roomProposal,
      obstacles: drawnWalls === undefined || drawnWalls === null ? [] : wallLabelBoxes(drawnWalls, sizing),
      formatLabel: (name, squareMillimetres) => STRINGS.roomLabel(name, formatSquareMetres(squareMillimetres)),
    })
  const extra = [wallList, roomList, overlayList].filter((one): one is DisplayList => one !== null)
  const withWalls: DisplayList = extra.length === 0
    ? list
    : {
        ...list,
        bounds: extra.reduce((bounds, one) => unionRect(bounds, one.bounds), list.bounds),
        layers: LAYER_ORDER.flatMap((key): DisplayLayer[] => {
          const items = [list, ...extra]
            .flatMap((one) => one.layers)
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
  // The badges are placed against what this canvas is about to paint, and nothing else: the
  // labels, the dimensions, the chip and the selection's handles are the boxes a `!` must not
  // cover, and they only exist here (#66 §14).
  const warningBadges: DisplayList | null = warningSubjects.length === 0
    ? null
    : drawWarningBadges(warningSubjects, {
        sizing,
        obstacles: annotations === null
          ? displayRects(withWalls)
          : [...displayRects(withWalls), ...displayRects(annotations)],
      })

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
    // A Room takes the pointer only while the Select tool is in hand. Under a drawing tool the
    // click belongs to the tool — it closes a draft or drops a vertex — so the Room answers
    // nothing and the click reaches the Floor behind it, which is what the draft is drawn on.
    onRoomPointerDown: onSelectRoom === undefined || tool !== 'select'
      ? undefined
      : (id) => {
          // The click that selected this Room must not be answered again as a click on the
          // background, which would deselect it in the same gesture (#64 §15).
          consumedPointer.current = true
          onSelectRoom(id)
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
    onWarningBadgePointerDown: onSelectWarningBadge,
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
            {/* Then the warnings, last of all and above every word: a badge is the one mark on
                this canvas that must never be hidden, and it is keyed by what the engine
                answered rather than by the revision, so it is its own list and never a layer of
                the Floor's — which is what keeps it off the export (#66 §14). */}
            {warningBadges !== null && (
              <DisplayListSvg
                list={warningBadges}
                sizing={sizing}
                matrix={matrix}
                textSpace="screen"
                screen={{ pxPerUnit: zoom, panX, panY }}
                resolveAsset={resolveAsset}
                interactions={interactions}
              />
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

/**
 * The outlines the renovation overlays are laid on (#70 §F).
 *
 * Each one is the same outline the entity's own item is drawn from — a Wall's tidied band, a Placed
 * Item's world path, a Room's evaluated loop — so the dashed outline sits exactly on the edge it is
 * annotating rather than beside it. Entities the Display does not draw are absent from `states` and
 * are left out here too: an overlay on something invisible would be a mark with nothing under it.
 */
function renovationOutlines(
  floor: DerivedFloor,
  walls: FloorWalls | null,
  rooms: FloorRooms | null,
): RenovationOutline[] {
  return [
    ...(walls === null ? [] : walls.walls.map((wall): RenovationOutline => ({
      ref: { id: wall.id, role: 'wall' },
      layer: 'walls',
      outline: pathToCommands(wall.outline),
    }))),
    ...floor.placements.map((placement): RenovationOutline => ({
      ref: { id: placement.id, role: 'placed-item' },
      layer: 'placed-items',
      outline: drawPlacement(placement, null).segments,
    })),
    ...(rooms === null ? [] : rooms.rooms.map((room): RenovationOutline => ({
      ref: { id: room.id, role: 'room' },
      layer: 'rooms',
      outline: pathToCommands(room.path),
    }))),
  ]
}
