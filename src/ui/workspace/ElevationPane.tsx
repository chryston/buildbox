/**
 * The Elevation View pane (#75 §2, criteria 1, 3, 4): the picture `drawElevationView` built, pannable
 * and zoomable like the Plan canvas, clickable down to one entity, with the glyph that says which way
 * the view stands.
 *
 * It is presentational by construction. The caller has already run `elevationScene` and
 * `drawElevationView`, already resolved the click through the cycle, and already owns the viewport's
 * device-local cache — so this component holds no Project, derives nothing of its own and writes
 * nothing. What it owns is the gesture:
 *
 * - **Pan and zoom** are the Plan canvas's, copied rather than re-invented: the `<svg>` is drawn under
 *   `matrix(zoom,0,0,zoom,panX,panY)`, a drag of empty space moves the pan, the wheel zooms around the
 *   cursor through a non-passive listener on the host, and a view with no remembered viewport is fitted
 *   once the host has a size. Nothing here drags an entity: an Elevation View is a picture of the Floor,
 *   and editing it would mean editing the Floor.
 * - **Picking** is done against `scene.rows` rather than against the rendered nodes, because the rows are
 *   what the projection produced and what the cycle is ordered by — and because an Opening's marks in
 *   this drawing carry the Wall's own address, so a canvas that picked against nodes could not tell an
 *   Opening from its host. The rows keep the raw distance along the view line; the horizontal mapping
 *   below is the drawing's mirror, so a click and a pixel agree.
 * - **Cycling** is #74's, widened by one axis: the first click takes the nearest candidate under the
 *   pointer, and a second click in the same spot walks the stack (#75 §4). The candidates are ordered by
 *   `cycleOrder(…, 'elevation')`, which is nearest-first.
 *
 * Selection is the plan's own emphasis — the `:selected` style row of the same entity — so a Wall that is
 * selected in the Plan pane is selected in this one the same way. An id the view does not draw is simply
 * not highlighted here: an entity behind the viewer has no pixels to highlight.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react'
import type { ElevationView, Point2, RenovationDisplay } from '../../domain'
import { elevationFrameOf } from '../../derive'
import type { ElevationScene } from '../../derive'
import type { DisplayList, Sizing } from '../../drawing'
import { DisplayListSvg } from '../drawing/DisplayListSvg'
import { STRINGS } from '../strings'
import { RENOVATION_STRINGS } from '../strings/renovation'
import { displayLabel } from './renovation/displayTheme'
import { cycleOrder, isSameSpot } from './selection/overlapCycle'
import type { VerticalSnapCandidate } from '../../derive'
import { ElevationDragLayer } from './elevation/ElevationDragLayer'
import type { CanvasPoint, CycleCandidate } from './selection/overlapCycle'
import { clampZoom, fitViewport, zoomAround } from './viewport'
import type { Viewport } from './viewport'
import './workspace.css'

/** The wheel's two steps, the same pair the Plan canvas uses. */
const WHEEL_IN = 1.25
const WHEEL_OUT = 0.8

/** The glyph's own size in CSS pixels, and how far its point reaches from the middle. */
const GLYPH_PX = 40
const GLYPH_TIP_PX = 15

export interface ElevationPaneProps {
  view: ElevationView
  scene: ElevationScene
  list: DisplayList
  /**
   * The height the drawing's `y = 0` stands at, from `drawElevationView`: the pane's own y grows
   * downward from it, so every gesture that reads a pointer back as a height converts through it.
   */
  topMm: number
  sizing: Sizing
  /** The Design Option's name, or null for "No Design Option". */
  optionName: string | null
  display: RenovationDisplay
  /** The stable ids selected in the workspace; highlighted here when effective (present in `scene.rows`). */
  selectedIds: readonly string[]
  /** One id per click, already resolved through the cycle by the caller's `onPick`. */
  onPick(id: string | null): void
  viewport: Viewport | null
  onViewport(viewport: Viewport): void
  hostRef: RefObject<HTMLDivElement | null>
  resolveAsset: (hash: string) => string | null
  /**
   * The heights a vertical drag may stop at, or null for no handles at all (#75 §6, §7). The caller
   * owns the `Snaps ▾` state and the view's own layer and Display rules, because the pane must not
   * know what a Design Option is in order to draw a square.
   */
  dragCandidates?: readonly VerticalSnapCandidate[] | null
  /** One finished drag, in the field of the canonical entity the caller's Intent writes. */
  onVerticalExtent?: (field: 'base' | 'height' | 'top', value: number) => void
  children?: never
}

/**
 * The pane's header: the view's name, the Design Option it looks through and the Renovation Display it
 * draws — the three settings that decide what is on screen, in the words the rest of the product uses
 * for them. Exported so the caller words the split's header with the same sentence the test reads.
 */
export function elevationPaneTitle(view: ElevationView, optionName: string | null, display: RenovationDisplay): string {
  return `${view.name} · ${optionName ?? RENOVATION_STRINGS.noDesignOptionShort} · ${displayLabel(display)}`
}

/**
 * The glyph's rotation in degrees for a view: the direction the viewer stands toward, in screen space
 * (y down).
 *
 * It is the frame's own viewing normal, so the arrow and the content cannot disagree: the band the
 * drawing is made of is everything between the view line and `depth` millimetres along that normal, and
 * the arrow points into it. The base glyph points right, which is 0°.
 */
export function elevationArrowDeg(view: ElevationView): number {
  const { n } = elevationFrameOf(view)
  return (Math.atan2(n.y, n.x) * 180) / Math.PI
}

/** What the pane is looking at, as the split's CSS and the browser suite need to name it. */
export function ElevationPane(props: ElevationPaneProps): ReactNode {
  const {
    view, scene, list, topMm, sizing, optionName, display, selectedIds, onPick,
    viewport, onViewport, hostRef, resolveAsset, dragCandidates = null, onVerticalExtent,
  } = props
  const svgRef = useRef<SVGSVGElement>(null)
  const panning = useRef(false)
  const panMoved = useRef(false)
  /** True while the pointer is down on empty space: that press is a pan, and a still one is a deselect. */
  const pressedEmpty = useRef(false)
  const lastPan = useRef({ x: 0, y: 0 })
  /** What the last pick remembered: where it landed and the stack it walked, which is what a second
   * click in the same spot has to match before it is allowed to continue the cycle (#70 §8). */
  const lastPick = useRef<{ point: CanvasPoint; ids: readonly string[] } | null>(null)
  const [hostSize, setHostSize] = useState({ width: 0, height: 0 })

  // The host's box drives `Fit` and nothing else. Where there is no `ResizeObserver` — jsdom lays
  // nothing out — `offsetWidth` is read once, which is the number a test hands the host.
  useEffect(() => {
    const el = hostRef.current
    if (el === null) return
    const measure = (): void => setHostSize({ width: el.offsetWidth, height: el.offsetHeight })
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [hostRef])

  // No remembered viewport for this view: fit the drawing once the host has a size, exactly as the Plan
  // canvas fits a Floor.
  useEffect(() => {
    if (viewport !== null || hostSize.width <= 0 || hostSize.height <= 0) return
    const fitted = fitViewport(hostSize.width, hostSize.height, list.bounds.w, list.bounds.h)
    onViewport({ zoom: clampZoom(fitted.zoom), panX: fitted.panX, panY: fitted.panY })
  }, [viewport, hostSize, list, onViewport])

  // The wheel needs a non-passive listener to keep the page from scrolling, and it goes on the host
  // rather than the `<svg>` so an overlay above the canvas cannot swallow it (#64 §12).
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
  }, [hostRef, viewport, onViewport])

  /** Client pixels to the drawing's own millimetres — the one place the viewport is inverted. */
  const toDrawing = useCallback((clientX: number, clientY: number): Point2 | null => {
    const el = svgRef.current
    if (el === null || viewport === null) return null
    const rect = el.getBoundingClientRect()
    return {
      x: (clientX - rect.left - viewport.panX) / viewport.zoom,
      y: (clientY - rect.top - viewport.panY) / viewport.zoom,
    }
  }, [viewport])

  /**
   * The drawing's horizontal mapping of a distance along the view line: a viewer standing on the `left`
   * has their right hand at −u, so the picture is mirrored and the line's own start is on the right.
   * `drawElevationView` mirrors the same way, which is what makes a click land on what it was aimed at.
   */
  const xOf = (s: number): number => (scene.frame.side === 'left' ? scene.length - s : s)

  /**
   * Floor-relative Z to the pane's y, and back.
   *
   * The drawing stands on its Datum — y grows downward from `topMm`, the highest height it holds — and
   * the pane draws at the screen's scale of 1, so the two are one subtraction apart. Everything here
   * that reads a pointer as a height, or puts a handle at one, goes through these two and nothing else.
   */
  const yOf = (z: number): number => topMm - z
  const zOf = (y: number): number => topMm - y

  /**
   * The rows the pointer is standing on, in the order a click walks them: nearest first.
   *
   * A row covers the band its entity projects to and the heights it stands at, so a click inside a
   * cabinet's box is also inside the Wall behind it — which is the stack the cycle is for.
   */
  const candidatesAt = (at: Point2): CycleCandidate[] => {
    const under = scene.rows.filter((row) => {
      const left = Math.min(xOf(row.sMin), xOf(row.sMax))
      const right = Math.max(xOf(row.sMin), xOf(row.sMax))
      const low = Math.min(yOf(row.zMin), yOf(row.zMax))
      const high = Math.max(yOf(row.zMin), yOf(row.zMax))
      return at.x >= left && at.x <= right && at.y >= low && at.y <= high
    })
    // An Elevation row carries no Renovation State of its own: `derive` has already drawn the Display's
    // subset, so what is on screen is drawn as what it is.
    return cycleOrder(
      under.map((row, index): CycleCandidate => ({
        entityId: row.id,
        renovationState: 'existing',
        drawOrder: index,
        distance: row.distance,
      })),
      'elevation',
    )
  }

  const onPointerDown = useCallback((event: ReactPointerEvent<SVGSVGElement>): void => {
    const at = toDrawing(event.clientX, event.clientY)
    if (at === null) return
    const order = candidatesAt(at)
    if (order.length === 0) {
      // Empty space: the gesture belongs to the pan. Whether it was a click or a drag is decided on
      // release, by whether the pointer moved.
      panning.current = true
      panMoved.current = false
      pressedEmpty.current = true
      lastPan.current = { x: event.clientX, y: event.clientY }
      svgRef.current?.setPointerCapture(event.pointerId)
      return
    }
    pressedEmpty.current = false
    const point: CanvasPoint = { x: event.clientX, y: event.clientY }
    const previous = lastPick.current
    const sole = selectedIds.length === 1 ? selectedIds[0] : undefined
    const atSole = order.findIndex((candidate) => candidate.entityId === sole)
    // The cycle continues only on the pane's own terms: the same entity is already the one selection,
    // this click is in the same spot as the last, and that entity is in the stack under the pointer.
    const continuing = sole !== undefined
      && atSole >= 0
      && previous !== null
      && previous.ids.includes(sole)
      && isSameSpot(previous.point, point)
    lastPick.current = { point, ids: order.map((candidate) => candidate.entityId) }
    onPick(continuing ? order[(atSole + 1) % order.length]!.entityId : order[0]!.entityId)
  }, [toDrawing, scene, selectedIds, onPick])

  const onPointerMove = useCallback((event: ReactPointerEvent<SVGSVGElement>): void => {
    if (!panning.current || viewport === null) return
    const dx = event.clientX - lastPan.current.x
    const dy = event.clientY - lastPan.current.y
    if (dx !== 0 || dy !== 0) panMoved.current = true
    lastPan.current = { x: event.clientX, y: event.clientY }
    onViewport({ zoom: viewport.zoom, panX: viewport.panX + dx, panY: viewport.panY + dy })
  }, [viewport, onViewport])

  const onPointerUp = useCallback((): void => {
    // A press on empty space that never moved is a click on nothing: the selection goes, as it does on
    // the Plan canvas. A drag is not a click, whatever the pointer came up over.
    const deselect = pressedEmpty.current && !panMoved.current
    panning.current = false
    pressedEmpty.current = false
    if (deselect) onPick(null)
  }, [onPick])

  // The one selected entity this view actually draws. A selection the pane cannot see — an entity on
  // another Floor, or one the Display hides — gets no handles, because there is no box to put them on.
  const selectedRow = selectedIds.length === 1
    ? scene.rows.find((row) => row.id === selectedIds[0]) ?? null
    : null

  const zoom = viewport?.zoom ?? 1
  const panX = viewport?.panX ?? 0
  const panY = viewport?.panY ?? 0
  const matrix = viewport === null
    ? undefined
    : `matrix(${viewport.zoom},0,0,${viewport.zoom},${panX},${panY})`

  return (
    <div
      className="bb-elevation-pane"
      data-testid="elevation-pane"
      data-display={display}
      data-option={optionName ?? 'none'}
    >
      <svg
        ref={svgRef}
        className="bb-elevation-canvas"
        data-testid="elevation-canvas"
        style={{ touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {matrix !== undefined && (
          <DisplayListSvg
            list={list}
            sizing={sizing}
            matrix={matrix}
            textSpace="screen"
            screen={{ pxPerUnit: zoom, panX, panY }}
            emphasis={{ selected: selectedIds.length === 0 ? undefined : new Set(selectedIds) }}
            resolveAsset={resolveAsset}
          />
        )}
        {matrix !== undefined && viewport !== null && dragCandidates !== null && selectedRow !== null && (
          <ElevationDragLayer
            row={selectedRow}
            viewport={viewport}
            toDrawing={toDrawing}
            yOf={yOf}
            zOf={zOf}
            candidates={dragCandidates}
            onCommit={(field, value) => onVerticalExtent?.(field, value)}
          />
        )}
      </svg>
      {/* Which way the view stands: the glyph points into the band the drawing was made of. */}
      <svg
        className="bb-elevation-direction"
        data-testid="elevation-direction"
        role="img"
        aria-label={STRINGS.elevationDirection}
        width={GLYPH_PX}
        height={GLYPH_PX}
        viewBox={`${-GLYPH_PX / 2} ${-GLYPH_PX / 2} ${GLYPH_PX} ${GLYPH_PX}`}
      >
        <g data-testid="elevation-arrow" transform={`rotate(${elevationArrowDeg(view)})`}>
          <path className="bb-elevation-direction-shaft" d={`M ${-GLYPH_TIP_PX} 0 L ${GLYPH_TIP_PX - 6} 0`} />
          <path className="bb-elevation-direction-head" d={`M ${GLYPH_TIP_PX - 6} -5 L ${GLYPH_TIP_PX} 0 L ${GLYPH_TIP_PX - 6} 5 Z`} />
        </g>
      </svg>
    </div>
  )
}
