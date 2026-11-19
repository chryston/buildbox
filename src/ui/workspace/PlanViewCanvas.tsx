/**
 * The Plan View canvas (#55 criterion 3, #57 §4–5): the Floor's Plan Image and its Placed
 * Items, drawn under one `matrix(zoom,0,0,zoom,panX,panY)`, exactly as the legacy canvas drew
 * them — the same 0.1×–10× range, the same cursor-centred wheel zoom, the same raw-pixel
 * drawing of an uncalibrated image.
 *
 * What #57 changed is *how a footprint is drawn*. It used to be an axis-aligned rect with a
 * `rotate(θ, cx, cy)` on its group, which could only ever be a quarter turn and turned the
 * item's own name with it — upside down at 180°. Now the four Item Footprint corners are
 * projected through the placement's `PlacementContext` and drawn as a polygon, and every
 * piece of text — the item label, the dimension text, the `Floor bounds` chip — sits in a
 * separate layer with no transform at all, so it reads horizontally at 0°, 37°, 90°, 180° and
 * 270° alike (criterion 11).
 *
 * The viewport still arrives from the workspace store and the device-local cache behind it.
 * A drag previews in the store and commits one `plan.movePlacement` when the pointer comes
 * up; the rotate handle previews in local state and commits one `plan.rotatePlacement`;
 * `Pick on canvas` only ever opens the origin preview. Nothing here dispatches mid-gesture
 * (#26).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { localPointOf, resolveSnap, worldPointOf } from '../../derive'
import type { PlacementContext, SnapCandidate, SnapKind } from '../../derive'
import { footprintSize } from '../../domain'
import type { DisplayUnit, Point2 } from '../../domain'
import { formatMm } from './displayUnits'
import { placeLabels } from './labelPlacer'
import type { Rect } from './labelPlacer'
import type { PlanImageView, PlanItemView } from './planModel'
import { handlePoint, handleRadiusMm, rotationFromPointer } from './rotateHandle'
import { fitViewport, zoomAround } from './viewport'
import type { Viewport } from './viewport'
import type { AngleSnap, DesignEditPreview, ItemDragPreview, WorkspaceTool } from './workspaceStore'

const WHEEL_IN = 1.25
const WHEEL_OUT = 0.8
/** How far outside the footprint the dimension lines run, and their text beyond them. */
const DIM_OFFSET_PX = 22
const DIM_TEXT_GAP_PX = 8
const DIM_TICK_PX = 5
/** The `Floor bounds` chip's box, in CSS pixels: the placer needs a box, not a string. */
const CHIP_HEIGHT_PX = 18
const CHIP_CHAR_PX = 6.2
/** The rotate handle's grip radius, in CSS pixels. */
const HANDLE_R_PX = 6

/** The Item Footprint's four corners, local millimetres, from (0, 0). */
const localCorners = (width: number, depth: number): readonly Point2[] => [
  { x: 0, y: 0 },
  { x: width, y: 0 },
  { x: width, y: depth },
  { x: 0, y: depth },
]

/** The same placement read at another rotation or another origin position. */
const contextAs = (item: PlanItemView, rotationDeg: number, translation: Point2): PlacementContext => ({
  rotationDeg,
  translation,
  origin: item.origin,
})

const cornersOf = (context: PlacementContext, width: number, depth: number): readonly Point2[] =>
  localCorners(width, depth).map((corner) => worldPointOf(context, corner))

const pointsAttr = (points: readonly Point2[]): string =>
  points.map((point) => `${point.x},${point.y}`).join(' ')

export interface PlanViewCanvasProps {
  hostRef: RefObject<HTMLDivElement | null>
  svgRef: RefObject<SVGSVGElement | null>
  items: readonly PlanItemView[]
  image: PlanImageView | null
  /** `null` until the cache has answered or the first `Fit` has run. */
  viewport: Viewport | null
  onViewport: (viewport: Viewport) => void
  tool: WorkspaceTool
  selection: string | null
  onSelect: (id: string | null) => void
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
  /** Drawn above the items while calibrating; it owns the pointer meanwhile. */
  overlay?: ReactNode
}

/** One horizontal text in the untransformed layer, in CSS pixels from the SVG's top-left. */
interface TextRun {
  readonly key: string
  readonly testId: string
  readonly x: number
  readonly y: number
  readonly text: string
  readonly size: number
  readonly fill: string
  readonly anchor?: 'start' | 'middle' | 'end'
  /** The box it occupies in world millimetres, for the label placer's obstacles. */
  readonly obstacle: Rect
}

export function PlanViewCanvas(props: PlanViewCanvasProps): ReactNode {
  const {
    hostRef, svgRef, items, image, viewport, onViewport, tool, selection, onSelect,
    dragPreview, onDragPreview, onMoveItem, onRotateItem, designPreview, pickingOrigin,
    originCandidates, snapKinds, onPickOrigin, unit, precision, angleSnap, overlay,
  } = props
  const [hostSize, setHostSize] = useState({ width: 0, height: 0 })
  const [dragging, setDragging] = useState(false)
  /** The live turn: the Item being turned and the rotation its pointer asks for. */
  const [turnPreview, setTurnPreview] = useState<{ id: string; rotationDeg: number } | null>(null)
  const panning = useRef(false)
  const lastPan = useRef({ x: 0, y: 0 })
  const panMoved = useRef(false)

  const contentW = image?.widthMm ?? 800
  const contentH = image?.heightMm ?? 600

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

  // Wheel zoom needs a non-passive listener to keep the page from scrolling.
  useEffect(() => {
    const el = svgRef.current
    if (el === null) return
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      if (viewport === null) return
      const rect = el.getBoundingClientRect()
      onViewport(zoomAround(viewport, event.deltaY < 0 ? WHEEL_IN : WHEEL_OUT, event.clientX - rect.left, event.clientY - rect.top))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [svgRef, viewport, onViewport])

  /** True while a footprint or the handle has taken the pointer for this gesture. */
  const consumedPointer = useRef(false)

  const onPointerDown = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    // A pointerdown that reaches the Floor starts a fresh gesture: whatever a footprint or the
    // handle took last time is over, so this click is a click on the Floor again.
    consumedPointer.current = false
    if (overlay !== undefined) return // the calibration overlay owns the pointer
    const isPanGesture = tool === 'pan' || event.button === 1
    if (!isPanGesture || viewport === null) return
    panning.current = true
    panMoved.current = false
    lastPan.current = { x: event.clientX, y: event.clientY }
    svgRef.current?.setPointerCapture(event.pointerId)
  }, [overlay, tool, viewport, svgRef])

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

  const onBackgroundClick = useCallback(() => {
    // A pointerdown that a footprint or the rotate handle took is not a click on the Floor,
    // even when the click itself lands on the root — which is what a drag does, its pointer
    // coming up somewhere else. Clearing the selection there would undo the selection the
    // same gesture just made.
    if (consumedPointer.current) return
    if (overlay !== undefined || panMoved.current) return
    if (tool === 'select') onSelect(null)
  }, [overlay, panMoved, tool, onSelect])

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

  function startItemDrag(event: React.PointerEvent<SVGGElement>, item: PlanItemView): void {
    if (tool !== 'select' || viewport === null) return
    event.stopPropagation()
    consumedPointer.current = true
    // `Pick on canvas` armed: this click sets the Item Origin preview rather than dragging.
    if (pickingOrigin && selection === item.id) {
      const at = toFloor(event.clientX, event.clientY)
      if (at === null) return
      const local = localPointOf(item.context, at)
      // #59 §5: `Pick on canvas` is a tool like any other, so it goes through the same
      // resolver — the same 12 CSS px of acquisition at this zoom, the same tie-break, and the
      // same nine switches. `viewport.zoom` is pixels per millimetre, which is what converts.
      const snap = resolveSnap(originCandidates, local, viewport.zoom, snapKinds)
      onPickOrigin(snap?.point ?? local)
      return
    }
    onSelect(item.id)
    const startX = event.clientX
    const startY = event.clientY
    const origX = item.translation.x
    const origY = item.translation.y
    let moved = false
    let latest = { x: origX, y: origY }
    const target = event.currentTarget

    const onMove = (moveEvent: PointerEvent): void => {
      const dx = (moveEvent.clientX - startX) / viewport.zoom
      const dy = (moveEvent.clientY - startY) / viewport.zoom
      if (!moved && Math.abs(moveEvent.clientX - startX) + Math.abs(moveEvent.clientY - startY) <= 4) return
      moved = true
      latest = { x: origX + dx, y: origY + dy }
      onDragPreview({ id: item.id, x: latest.x, y: latest.y })
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setDragging(false)
      onDragPreview(null)
      if (moved) onMoveItem(item.id, latest.x, latest.y)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    setDragging(true)
    target.setPointerCapture(event.pointerId)
  }

  /**
   * The rotate handle's drag: the rotation follows the pointer about the Item Origin, snapped
   * to the angle increment while angle snap is on, and commits once when the pointer comes up.
   */
  function startRotateDrag(event: React.PointerEvent<SVGCircleElement>, item: PlanItemView): void {
    if (tool !== 'select' || viewport === null) return
    event.stopPropagation()
    consumedPointer.current = true
    const target = event.currentTarget
    let latest = item.rotationDeg
    let turned = false

    const onMove = (moveEvent: PointerEvent): void => {
      const at = toFloor(moveEvent.clientX, moveEvent.clientY)
      if (at === null) return
      latest = rotationFromPointer(item.translation, at, angleSnap)
      turned = true
      setTurnPreview({ id: item.id, rotationDeg: latest })
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setTurnPreview(null)
      if (turned && latest !== item.rotationDeg) onRotateItem(item.id, latest)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    target.setPointerCapture(event.pointerId)
  }

  const zoom = viewport?.zoom ?? 1
  const panX = viewport?.panX ?? 0
  const panY = viewport?.panY ?? 0
  const matrix = viewport === null
    ? undefined
    : `matrix(${viewport.zoom},0,0,${viewport.zoom},${panX},${panY})`
  /** Floor millimetres to CSS pixels. Text is drawn in this space, so it never turns. */
  const toScreen = (point: Point2): Point2 => ({ x: point.x * zoom + panX, y: point.y * zoom + panY })
  const cursor = overlay !== undefined
    ? 'crosshair'
    : dragging
      ? tool === 'pan' ? 'grabbing' : 'move'
      : tool === 'pan' ? 'grab' : pickingOrigin ? 'crosshair' : 'default'

  // ------------------------------------------------------------- what is drawn where
  const selected = items.find((item) => item.id === selection) ?? null
  /** The design whose origin marker shows: the selected placement's, whatever its rotation. */
  const markedDesignId = selected?.designId ?? null
  const turn = turnPreview !== null && turnPreview.id === selected?.id ? turnPreview.rotationDeg : null
  const moveDelta = (item: PlanItemView): Point2 =>
    dragPreview !== null && dragPreview.id === item.id
      ? { x: dragPreview.x - item.translation.x, y: dragPreview.y - item.translation.y }
      : { x: 0, y: 0 }

  const effective = (item: PlanItemView): { context: PlacementContext; width: number; depth: number } => {
    const isTurned = turn !== null && item.id === selected?.id
    const pending = designPreview !== null && designPreview.itemDesignId === item.designId
      ? designPreview.footprint
      : null
    // A pending footprint previews by its own bounds: the Floor plan draws boxes, and the
    // shape itself is drawn where it is edited — the Item Design canvas (#58 §3).
    const size = pending === null ? { width: item.width, depth: item.depth } : footprintSize(pending)
    return {
      context: contextAs(
        item,
        isTurned ? (turn as number) : item.rotationDeg,
        { x: item.translation.x + moveDelta(item).x, y: item.translation.y + moveDelta(item).y },
      ),
      width: size.width,
      depth: size.depth,
    }
  }

  const texts: TextRun[] = []
  const pushText = (run: TextRun): void => { texts.push(run) }

  // ------------------------------------------------------------- dimension lines
  const dimensions: ReactNode[] = []
  if (selected !== null && overlay === undefined) {
    const { context, width, depth } = effective(selected)
    const offset = DIM_OFFSET_PX / zoom
    const gap = DIM_TEXT_GAP_PX / zoom
    const tick = DIM_TICK_PX / zoom
    const lineProps = {
      stroke: 'var(--bb-accent)',
      strokeWidth: 1 / zoom,
      style: { pointerEvents: 'none' as const },
    }
    // Width runs along the local X axis, below the footprint; Depth along local Y, left of it.
    const widthFrom = worldPointOf(context, { x: 0, y: depth + offset })
    const widthTo = worldPointOf(context, { x: width, y: depth + offset })
    const depthFrom = worldPointOf(context, { x: -offset, y: 0 })
    const depthTo = worldPointOf(context, { x: -offset, y: depth })
    const widthTextAt = worldPointOf(context, { x: width / 2, y: depth + offset + gap })
    const depthTextAt = worldPointOf(context, { x: -offset - gap, y: depth / 2 })
    const tickOf = (at: Point2, along: 'x' | 'y'): ReactNode => {
      const local = along === 'x'
        ? [
          worldPointOf(context, { x: at.x, y: at.y - tick }),
          worldPointOf(context, { x: at.x, y: at.y + tick }),
        ]
        : [
          worldPointOf(context, { x: at.x - tick, y: at.y }),
          worldPointOf(context, { x: at.x + tick, y: at.y }),
        ]
      const [a, b] = local as [Point2, Point2]
      return <line key={`${along}-tick-${at.x}-${at.y}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} {...lineProps} />
    }
    dimensions.push(
      <g key="dimensions" data-testid="dimension-lines">
        <line data-testid="dimension-width-line" x1={widthFrom.x} y1={widthFrom.y} x2={widthTo.x} y2={widthTo.y} {...lineProps} />
        <line data-testid="dimension-depth-line" x1={depthFrom.x} y1={depthFrom.y} x2={depthTo.x} y2={depthTo.y} {...lineProps} />
        {tickOf({ x: 0, y: depth + offset }, 'x')}
        {tickOf({ x: width, y: depth + offset }, 'x')}
        {tickOf({ x: -offset, y: 0 }, 'y')}
        {tickOf({ x: -offset, y: depth }, 'y')}
      </g>,
    )
    const widthLabel = formatMm(width, unit, precision)
    const depthLabel = formatMm(depth, unit, precision)
    const widthScreen = toScreen(widthTextAt)
    const depthScreen = toScreen(depthTextAt)
    pushText({
      key: 'dim-width',
      testId: 'dimension-width',
      x: widthScreen.x,
      y: widthScreen.y,
      text: widthLabel,
      size: 11,
      fill: 'var(--bb-accent)',
      obstacle: textObstacle(widthLabel, 11, widthTextAt, zoom),
    })
    pushText({
      key: 'dim-depth',
      testId: 'dimension-depth',
      x: depthScreen.x,
      y: depthScreen.y,
      text: depthLabel,
      size: 11,
      fill: 'var(--bb-accent)',
      anchor: 'end',
      obstacle: textObstacle(depthLabel, 11, depthTextAt, zoom, 'end'),
    })
  }

  // ------------------------------------------------------------- the Floor bounds chip
  // One collision-aware placer call for the chip (#57 §4): it keeps the chip off the
  // footprint and off the dimension texts, and #66 will pass its warning badge box in as one
  // more obstacle. The box it is given is the one the placement covers on the Floor, which
  // contains the turned Item Footprint at every rotation — clear of it is clear of the item.
  let chip: { box: Rect; text: string } | null = null
  if (selected !== null && overlay === undefined) {
    const xs = selected.corners.map((corner) => corner.x)
    const ys = selected.corners.map((corner) => corner.y)
    const footprint: Rect = {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    }
    const text = `Floor bounds ${formatMm(selected.boundsWidth, unit, precision)} × ${formatMm(selected.boundsDepth, unit, precision)}`
    const w = (text.length * CHIP_CHAR_PX) / zoom
    const h = CHIP_HEIGHT_PX / zoom
    const [box] = placeLabels({
      footprint,
      obstacles: texts.map((run) => run.obstacle),
      labels: [{ id: 'floor-bounds', anchor: { x: footprint.x + footprint.w / 2, y: footprint.y }, w, h }],
    })
    if (box !== undefined) chip = { box, text }
  }

  return (
    <>
      <svg
        ref={svgRef}
        data-testid="floor-plan-canvas"
        style={{ touchAction: 'none', cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={onBackgroundClick}
      >
        {matrix !== undefined && (
          <g transform={matrix}>
            {image !== null && (
              <image
                href={image.src}
                x={0}
                y={0}
                width={image.widthMm}
                height={image.heightMm}
                preserveAspectRatio="none"
                style={{ pointerEvents: 'none' }}
              />
            )}
            {image === null && (
              <rect
                x={0}
                y={0}
                width={contentW}
                height={contentH}
                style={{ fill: 'var(--bb-bg-card)', stroke: 'var(--bb-border-card)' }}
                strokeWidth={2}
              />
            )}
            {items.map((item) => {
              const { context, width, depth } = effective(item)
              const corners = turn !== null && item.id === selected?.id
                ? cornersOf(context, width, depth)
                : dragPreview !== null && dragPreview.id === item.id
                  ? cornersOf(context, width, depth)
                  : item.corners
              const isSelected = selection === item.id
              const pending = designPreview !== null && designPreview.itemDesignId === item.designId
              const fill = pending && designPreview?.color != null ? designPreview.color : item.color
              return (
                <g
                  key={item.id}
                  data-testid={`placed-object-${item.id}`}
                  style={{ cursor: tool === 'select' ? (pickingOrigin && isSelected ? 'crosshair' : 'move') : undefined }}
                  onPointerDown={(event) => startItemDrag(event, item)}
                  // A click that started on a footprint is not a click on the Floor: without
                  // this the root's deselect-on-click undoes the selection this pointerdown
                  // just made, and nothing on the canvas can be selected at all.
                  onClick={(event) => event.stopPropagation()}
                >
                  <polygon
                    points={pointsAttr(corners)}
                    fill={fill + '33'}
                    style={isSelected ? { stroke: 'var(--bb-text)' } : { stroke: fill }}
                    strokeWidth={(isSelected ? 2 : 1) / zoom}
                  />
                </g>
              )
            })}
            {/* The pending design edit, drawn on every placement of that design (D3). */}
            {designPreview !== null && items
              .filter((item) => item.designId === designPreview.itemDesignId && designPreview.origin !== null)
              .map((item) => {
                const at = worldPointOf(item.context, designPreview.origin as Point2)
                return <OriginMarker key={`preview-${item.id}`} at={at} testId={`origin-preview-${item.id}`} zoom={zoom} preview />
              })}
            {/* The Item Origin of every placement of the selected design (criterion 1). */}
            {markedDesignId !== null && items
              .filter((item) => item.designId === markedDesignId)
              .map((item) => (
                <OriginMarker
                  key={`marker-${item.id}`}
                  at={effective(item).context.translation}
                  testId={`origin-marker-${item.id}`}
                  zoom={zoom}
                />
              ))}
            {dimensions}
            {selected !== null && overlay === undefined && (() => {
              const { context } = effective(selected)
              const radius = handleRadiusMm(selected.width, selected.depth, selected.origin, zoom)
              const grip = handlePoint(context, radius)
              return (
                <g data-testid="rotate-handle-group">
                  <line
                    x1={context.translation.x}
                    y1={context.translation.y}
                    x2={grip.x}
                    y2={grip.y}
                    stroke="var(--bb-accent)"
                    strokeWidth={1 / zoom}
                    style={{ pointerEvents: 'none' }}
                  />
                  <circle
                    data-testid="rotate-handle"
                    cx={grip.x}
                    cy={grip.y}
                    r={HANDLE_R_PX / zoom}
                    fill="var(--bb-bg-card)"
                    stroke="var(--bb-accent)"
                    strokeWidth={1.5 / zoom}
                    style={{ cursor: 'grab' }}
                    onPointerDown={(event) => startRotateDrag(event, selected)}
                    onClick={(event) => event.stopPropagation()}
                  />
                </g>
              )
            })()}
            {overlay}
          </g>
        )}
        {matrix !== undefined && (
          /* Every piece of text, in CSS pixels and with no transform of any kind: the item
             label, the dimension text, the Floor-bounds chip. A footprint turns; its words
             never do (#57 criterion 11). */
          <g data-testid="plan-text-layer" style={{ pointerEvents: 'none', userSelect: 'none' }}>
            {items.map((item) => {
              const { context, width, depth } = effective(item)
              const centre = toScreen(worldPointOf(context, { x: width / 2, y: depth / 2 }))
              return (
                <text
                  key={`label-${item.id}`}
                  data-testid={`item-label-${item.id}`}
                  x={centre.x}
                  y={centre.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={12}
                  fill={item.color}
                >
                  {item.label}
                </text>
              )
            })}
            {texts.map((run) => (
              <text
                key={run.key}
                data-testid={run.testId}
                x={run.x}
                y={run.y}
                textAnchor={run.anchor ?? 'middle'}
                dominantBaseline="middle"
                fontSize={run.size}
                fill={run.fill}
              >
                {run.text}
              </text>
            ))}
            {chip !== null && (() => {
              const x = chip.box.x * zoom + panX
              const y = chip.box.y * zoom + panY
              const w = chip.box.w * zoom
              const h = chip.box.h * zoom
              return (
                <g data-testid="floor-bounds-chip">
                  <rect
                    x={x}
                    y={y}
                    width={w}
                    height={h}
                    rx={4}
                    fill="var(--bb-bg-card)"
                    stroke="var(--bb-border-card)"
                    strokeWidth={1}
                  />
                  <text
                    x={x + w / 2}
                    y={y + h / 2}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={11}
                    fill="var(--bb-text-muted)"
                  >
                    {chip.text}
                  </text>
                </g>
              )
            })()}
          </g>
        )}
      </svg>
      {image !== null && image.pixelsPerMm !== null && (
        <div className="bb-workspace-scale-hint" data-testid="scale-hint">
          Scale: 1px = {(1 / image.pixelsPerMm).toFixed(2)}mm
        </div>
      )}
    </>
  )
}

/** The Item Origin: a crosshair with a dot, at the placement's own `translation`. */
function OriginMarker(props: { at: Point2; testId: string; zoom: number; preview?: boolean }): ReactNode {
  const { at, testId, zoom, preview } = props
  const arm = 7 / zoom
  const stroke = preview ? 'var(--bb-accent)' : 'var(--bb-text)'
  return (
    <g
      data-testid={testId}
      data-x={at.x}
      data-y={at.y}
      style={{ pointerEvents: 'none' }}
      stroke={stroke}
      strokeWidth={1.25 / zoom}
    >
      <line x1={at.x - arm} y1={at.y} x2={at.x + arm} y2={at.y} />
      <line x1={at.x} y1={at.y - arm} x2={at.x} y2={at.y + arm} />
      <circle cx={at.x} cy={at.y} r={2 / zoom} fill={stroke} stroke="none" />
    </g>
  )
}

/**
 * The box one horizontal text takes in world millimetres, so the label placer can keep the
 * `Floor bounds` chip clear of it. The text is drawn in CSS pixels, hence the divide by zoom.
 */
function textObstacle(
  text: string,
  sizePx: number,
  centre: Point2,
  zoom: number,
  anchor: 'start' | 'middle' | 'end' = 'middle',
): Rect {
  const w = (text.length * sizePx * 0.62) / zoom
  const h = (sizePx * 1.4) / zoom
  const x = anchor === 'end' ? centre.x - w : anchor === 'start' ? centre.x : centre.x - w / 2
  return { x, y: centre.y - h / 2, w, h }
}
