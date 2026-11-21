/**
 * The Room tool's gesture layer (#67 §4, §7).
 *
 * It owns the pointer the way the Wall tool's overlay does: the cursor becomes Floor millimetres
 * through the same viewport, the shared resolver picks what it snaps to (#59 §5 — the same twelve
 * CSS pixels, the same nine switches), and a click places a vertex. The path machine underneath is
 * the Item Footprint editor's, so Line, Arc and Elliptical arc behave here exactly as they behave
 * in the Shape tab, in millimetres instead of design units.
 *
 * What the layer does *not* do is decide whether the shape is allowed. The overlap verdict arrives
 * as a prop, computed by the workspace from the same outline, so the sentence in this bar and the
 * region painted on the canvas are one fact told once. A blocked draft cannot be closed, cannot be
 * entered, and is never sent: nothing invalid reaches the model or the history (#67 §7).
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { SNAP_ACQUISITION_PX, distance, resolveSnap, snapCandidates } from '../../../derive'
import type { FloorWalls, Pt, Segment, SnapGeometry, SnapKind } from '../../../derive'
import type { RoomOutlineShape } from '../../../edit'
import type { DisplayUnit } from '../../../domain'
import { STRINGS } from '../../strings'
import { formatMm } from '../displayUnits'
import type { Viewport } from '../viewport'
import {
  beginClose,
  clickDraft,
  closeDraft,
  draftChip,
  draftEnd,
  draftPreviewSegments,
  draftSegments,
  startDraft,
  undoPoint,
  withCursor,
  withTypedLength,
} from '../shape/draftPath'
import type { DrawTool, PathDraft } from '../shape/draftPath'
import type { RoomOverlapPreview } from './roomDraft'

export interface RoomDraftOverlayProps {
  viewport: Viewport
  floorWalls: FloorWalls
  /** The Floor's Room Outlines, so a Room can be drawn corner-to-corner with its neighbours. */
  roomGeometry: readonly SnapGeometry[]
  tool: DrawTool
  /** `null` before the first click, which is what opens the draft at the point it lands on. */
  draft: PathDraft | null
  onDraft: (draft: PathDraft | null) => void
  /** `Cancel`, and Esc: nothing is sent. */
  onCancel: () => void
  /** The draft closed cleanly: the workspace writes the Intent. */
  onClose: (outline: RoomOutlineShape) => void
  /** The live overlap verdict for the outline this draft would commit. */
  overlap: RoomOverlapPreview
  /** The tool's own word — `Line`, `Arc`, `Elliptical arc` — for the hint. */
  toolLabel: string
  snapKinds: ReadonlySet<SnapKind>
  gridSpacingMm: number
  angleIncrementDeg: number
  unit: DisplayUnit
  precision: number
}

/** The chip's number: grouped thousands in the Project's display unit. */
const chipNumber = (unit: DisplayUnit, precision: number): ((mm: number) => string) => {
  const group = new Intl.NumberFormat('en-GB', { maximumFractionDigits: precision })
  return (mm: number) => group.format(Number(formatMm(mm, unit, precision)))
}

/** One draft Edge as the SVG commands that draw it, in Floor millimetres. */
function segmentPath(segment: Segment, from: Pt): string {
  if (segment.kind === 'line') return `L ${segment.to.x} ${segment.to.y}`
  const large = Math.abs(segment.sweepDeg) > 180 ? 1 : 0
  const sweep = segment.sweepDeg >= 0 ? 1 : 0
  if (segment.kind === 'arc') {
    const radius = Math.hypot(from.x - segment.center.x, from.y - segment.center.y)
    return `A ${radius} ${radius} 0 ${large} ${sweep} ${segment.to.x} ${segment.to.y}`
  }
  return `A ${segment.rx} ${segment.ry} ${segment.rotationDeg} ${large} ${sweep} ${segment.to.x} ${segment.to.y}`
}

/** The draft's Edges, rubber band included, as one open path. */
function draftPathData(draft: PathDraft): string {
  const segments = draftPreviewSegments(draft)
  if (segments.length === 0) return ''
  let cursor = draft.start
  let d = `M ${draft.start.x} ${draft.start.y}`
  for (const segment of segments) {
    d += ` ${segmentPath(segment, cursor)}`
    cursor = segment.to
  }
  return d
}

export function RoomDraftOverlay(props: RoomDraftOverlayProps): ReactNode {
  const {
    viewport, floorWalls, roomGeometry, tool, draft, onDraft, onCancel, onClose, overlap,
    toolLabel, snapKinds, gridSpacingMm, angleIncrementDeg, unit, precision,
  } = props
  const layerRef = useRef<HTMLDivElement>(null)
  const press = useRef<{ x: number; y: number } | null>(null)
  const [hover, setHover] = useState<{ at: Pt; label: string | null } | null>(null)
  const [typing, setTyping] = useState(false)
  const [lengthText, setLengthText] = useState('')

  const toFloor = useCallback((clientX: number, clientY: number): Pt | null => {
    const el = layerRef.current
    if (el === null) return null
    const rect = el.getBoundingClientRect()
    return {
      x: (clientX - rect.left - viewport.panX) / viewport.zoom,
      y: (clientY - rect.top - viewport.panY) / viewport.zoom,
    }
  }, [viewport])

  /** The point a click would place: snapped when a candidate is within the twelve pixels. */
  const aim = useCallback((cursor: Pt): { at: Pt; label: string | null } => {
    const placed = draft === null ? [] : draftSegments(draft)
    const snap = resolveSnap(snapCandidates({
      geometry: roomGeometry,
      walls: floorWalls.snapSources,
      cursor,
      from: placed.length === 0 ? draft?.start ?? null : placed[placed.length - 1]!.to,
      draft: [...placed].reverse(),
      gridSpacingMm,
      angleIncrementDeg,
      enabled: snapKinds,
    }), cursor, 1 / viewport.zoom, snapKinds)
    if (snap === null) return { at: cursor, label: null }
    return { at: snap.point, label: snap.target.label }
  }, [draft, floorWalls, roomGeometry, gridSpacingMm, angleIncrementDeg, snapKinds, viewport.zoom])

  /**
   * `Close` is live from three vertices up — fewer would not be a loop — and never while the
   * proposal overlaps another Room (#67 §7). Esc, or a shape that leaves the other Room alone,
   * is the way out.
   */
  const closeLive = draft !== null && draft.placed.length >= 2 && !overlap.blocked

  const close = (kind: DrawTool, bulge: Pt | null = null): void => {
    if (draft === null || !closeLive) return
    onClose({ kind: 'path', path: closeDraft(draft, kind, bulge) })
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    // The pointer over the bar is not aiming at the canvas.
    if ((event.target as HTMLElement).closest('button, input, label') !== null) return
    const cursor = toFloor(event.clientX, event.clientY)
    if (cursor === null) return
    const aimed = aim(cursor)
    setHover(aimed)
    if (draft !== null) onDraft(withCursor(draft, aimed.at))
  }

  /**
   * The click places where it landed, aimed the way the rubber band is: a pointermove is a
   * continuous event, so its state update can still be pending when the click on the very same
   * position is already being handled.
   */
  const place = (event: React.MouseEvent<HTMLDivElement>): void => {
    const cursor = toFloor(event.clientX, event.clientY)
    if (cursor === null) return
    const { at } = aim(cursor)
    if (draft === null) {
      onDraft(startDraft(tool, at))
      return
    }
    if (closeLive && !draft.pendingClose && distance(at, draft.start) <= SNAP_ACQUISITION_PX / viewport.zoom) {
      // The bar's `Close` closes straight; the start marker closes with the active tool's kind,
      // which for an arc means one more click for the closing segment's bulge.
      if (tool === 'line') close('line')
      else onDraft(beginClose(draft))
      return
    }
    const next = clickDraft(draft, at)
    if (next.pendingClose && next.bulge !== null) close(next.tool, next.bulge)
    else onDraft(next)
  }

  const commitLength = (): void => {
    const value = Number(lengthText)
    if (draft !== null && lengthText !== '' && Number.isFinite(value) && value > 0) {
      const aimed = withTypedLength(draft, value)
      const end = draftEnd(aimed)
      if (end !== null) onDraft(clickDraft(aimed, end))
    }
    setTyping(false)
    setLengthText('')
    layerRef.current?.focus()
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Backspace') {
      event.preventDefault()
      const back = draft === null ? null : undoPoint(draft)
      if (back === null) onCancel()
      else onDraft(back)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (draft !== null) close(draft.tool, draft.pendingClose ? draft.bulge : null)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
    } else if (/^\d$/.test(event.key) && !typing) {
      // A digit opens the length field with the digit already in it (#59 behaviour 9).
      event.preventDefault()
      setTyping(true)
      setLengthText(event.key)
    }
  }

  const num = useMemo(() => chipNumber(unit, precision), [unit, precision])
  const chip = draft === null ? null : draftChip(draft)
  const awaitingBulge = draft !== null && (draft.pendingClose
    || (draft.placed.length > 0 && draft.placed[draft.placed.length - 1]!.kind !== 'line' && draft.bulge === null))
  const hint = draft === null || draft.placed.length === 0
    ? STRINGS.draftFirstPoint(toolLabel)
    : awaitingBulge
      ? STRINGS.draftBulge(toolLabel)
      : STRINGS.draftPlace(toolLabel)
  const path = draft === null ? '' : draftPathData(draft)
  const vertices: readonly Pt[] = draft === null
    ? []
    : [draft.start, ...draft.placed.map((vertex) => vertex.to)]
  const screen = hover === null
    ? null
    : { left: hover.at.x * viewport.zoom + viewport.panX, top: hover.at.y * viewport.zoom + viewport.panY }

  return (
    <div
      ref={layerRef}
      data-testid="room-draft-layer"
      className="absolute inset-0"
      style={{ cursor: 'crosshair', outline: 'none' }}
      tabIndex={-1}
      onPointerDown={(event) => {
        // A press that began on the bar belongs to that control: Firefox hands the click ending
        // it to the layer as well, and closing the draft would otherwise also place a vertex.
        const control = (event.target as HTMLElement).closest('button, input, label')
        press.current = control === null ? { x: event.clientX, y: event.clientY } : null
        layerRef.current?.focus()
      }}
      onPointerUp={(event) => {
        const started = press.current
        press.current = null
        if (started === null) return
        // A press that slid across the canvas is a gesture, not a point.
        if (Math.abs(event.clientX - started.x) > 3 || Math.abs(event.clientY - started.y) > 3) return
        place(event)
      }}
      onPointerMove={onPointerMove}
      onPointerLeave={() => {
        setHover(null)
        if (draft !== null) onDraft(withCursor(draft, null))
      }}
      onKeyDown={onKeyDown}
    >
      <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
        <g transform={`matrix(${viewport.zoom},0,0,${viewport.zoom},${viewport.panX},${viewport.panY})`}>
          {path !== '' && (
            <path
              data-testid="room-draft-path"
              d={path}
              stroke={overlap.blocked ? 'var(--bb-danger-dot)' : 'var(--bb-accent)'}
              strokeWidth={2 / viewport.zoom}
              fill="none"
              strokeDasharray={`${6 / viewport.zoom} ${4 / viewport.zoom}`}
            />
          )}
          {vertices.map((vertex, index) => (
            <circle
              key={index}
              // Filled, never a ring: Firefox delivers no pointer on a stroke-only shape, and the
              // start handle is the point a click on a closing draft has to hit.
              data-testid={index === 0 ? 'room-draft-start' : undefined}
              cx={vertex.x}
              cy={vertex.y}
              r={4 / viewport.zoom}
              fill={overlap.blocked ? 'var(--bb-danger-dot)' : 'var(--bb-accent)'}
            />
          ))}
        </g>
      </svg>
      {hover !== null && screen !== null && (
        <div
          data-testid="room-draft-hover"
          className="pointer-events-none absolute"
          style={{ left: screen.left + 12, top: screen.top - 24 }}
        >
          {hover.label ?? ''}
        </div>
      )}
      <div
        data-testid="room-draft-bar"
        // The bottom of the canvas belongs to the warnings strip (#66): with any warning open it
        // covered the bar, so the overlap sentence could not be read and `Close` could not be
        // pressed. Draft bars live at the top, where the shell puts its own.
        className="absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-2"
        onClick={(event) => {
          // The bar sits inside the layer that places points; its own clicks are not canvas clicks.
          event.stopPropagation()
        }}
      >
        {chip !== null && (
          <span data-testid="room-draft-chip" className="bb-shape-hint">
            {`${num(chip.lengthMm)} · ${Math.round(chip.directionDeg)}°`}
            {typing && (
              <input
                data-testid="room-draft-length"
                aria-label={STRINGS.length}
                autoFocus
                value={lengthText}
                onChange={(event) => setLengthText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    commitLength()
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    setTyping(false)
                    setLengthText('')
                    layerRef.current?.focus()
                  }
                }}
                onBlur={commitLength}
                style={{ width: 72, marginLeft: 6 }}
              />
            )}
          </span>
        )}
        {overlap.message !== null ? (
          <span role="status" data-testid="room-draft-blocked" className="bb-shape-problem">
            {overlap.message}
          </span>
        ) : (
          <span data-testid="room-draft-hint" className="bb-shape-hint">{hint}</span>
        )}
        <button
          type="button"
          data-testid="room-draft-cancel"
          className="bb-workspace-secondary-button"
          onClick={onCancel}
        >
          {STRINGS.cancel}
        </button>
        <button
          type="button"
          data-testid="room-draft-close"
          className="bb-workspace-primary-button"
          disabled={!closeLive}
          onClick={() => close('line')}
        >
          {STRINGS.close}
        </button>
      </div>
    </div>
  )
}
