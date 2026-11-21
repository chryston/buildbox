/**
 * The Wall tool's gesture layer (#64 §12, §13; criteria 4, 5, 11).
 *
 * It sits above the Plan View the way the calibration overlay does and owns the pointer while a
 * chain is being drawn: the pointer becomes Floor millimetres through the same viewport, the
 * shared resolver picks what it snaps to (#59 §5 — the same 12 CSS px of acquisition, the same
 * nine switches), and a click places a point carrying whatever the indicator was naming. Nothing
 * reaches the Project until `Finish`: one chain, one Intent, one undo step (#26).
 *
 * The band is drawn at its real thickness rather than as a line, because the reference line is
 * not a thing a person sees anywhere else in the app (#64 §15) — a draft should not start a habit
 * of reading centrelines.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { SNAP_ACQUISITION_PX, distance, resolveSnap, snapCandidates } from '../../../derive'
import type { FloorWalls, Pt, Segment, SnapKind } from '../../../derive'
import type { DisplayUnit, WallClassification } from '../../../domain'
import { STRINGS } from '../../strings'
import { formatMm } from '../displayUnits'
import { ToolbarMenu } from '../WorkspaceToolbar'
import type { Viewport } from '../viewport'
import {
  canFinish,
  circleThrough,
  draftChip,
  draftSegments,
  joinLabel,
  placePoint,
  toChainPayload,
  undoPoint,
  wallTargetAt,
  withTypedLength,
  withWallCursor,
  withWallTool,
} from './wallDraft'
import type { WallChainDraft, WallDraft, WallDraftSegment, WallSegmentTool, WallSnapTarget } from './wallDraft'

/** What a new Wall inherits: the tool options, not a per-Wall decision. */
export interface WallToolDefaults {
  readonly thickness: number
  readonly justification: 'left' | 'centre' | 'right'
  readonly baseElevation: number
  readonly height: number
  readonly classification: WallClassification | null
  readonly constructionLabel: string
}

/** The closed classification vocabulary, in the words the inspector uses (#64 §13). */
export const WALL_CLASSIFICATIONS: readonly { value: WallClassification; label: string }[] = [
  { value: 'external', label: 'External' },
  { value: 'internal', label: 'Internal' },
  { value: 'partition', label: 'Partition' },
]

/**
 * The thickness picker's entries (#64 §13). The pack has no Wall entries to list yet, so these
 * are the four the issue names, by the same plain names, with a custom number beside them.
 */
export const WALL_THICKNESS_PRESETS: readonly { label: string; thickness: number }[] = [
  { label: 'Inside wall', thickness: 100 },
  { label: 'Kitchen wall', thickness: 120 },
  { label: 'Outside wall', thickness: 150 },
  { label: 'End wall of the block', thickness: 175 },
]

/** The three justifications, in the words the issue prescribes — never `L` or `R` (D6). */
export const WALL_JUSTIFICATIONS: readonly { value: 'centre' | 'left' | 'right'; label: string }[] = [
  { value: 'centre', label: 'Centre' },
  { value: 'left', label: 'Face on this side' },
  { value: 'right', label: 'Face on the other side' },
]

export interface WallDraftOverlayProps {
  viewport: Viewport
  floorWalls: FloorWalls
  /** The draft so far, held by the Floor workspace so a re-render cannot lose it. */
  draft: WallDraft
  onDraft: (draft: WallDraft) => void
  /** `Cancel (Esc)`, and the tool leaving the Wall tool. Nothing is sent. */
  onCancel: () => void
  /** `Finish`: one `wall.createChain` for the whole chain. */
  onFinish: (chain: WallChainDraft) => void
  floorId: string
  defaults: WallToolDefaults
  /** The tool options changed: the next Wall inherits them; nothing already drawn moves. */
  onOptions: (defaults: WallToolDefaults) => void
  snapKinds: ReadonlySet<SnapKind>
  gridSpacingMm: number
  angleIncrementDeg: number
  unit: DisplayUnit
  precision: number
}

/** The three segment modes, in the order the bar shows them (#64 §12). */
const SEGMENT_TOOLS: readonly { id: WallSegmentTool; label: string; testId: string }[] = [
  { id: 'line', label: 'Line', testId: 'wall-tool-line' },
  { id: 'arc', label: 'Arc', testId: 'wall-tool-arc' },
  { id: 'arcFromLast', label: 'Arc from last', testId: 'wall-tool-arc-from-last' },
]

/** The chip's number: grouped thousands in the Project's display unit. */
const chipNumber = (unit: DisplayUnit, precision: number): ((mm: number) => string) => {
  const group = new Intl.NumberFormat('en-GB', { maximumFractionDigits: precision })
  return (mm: number) => group.format(Number(formatMm(mm, unit, precision)))
}

/**
 * The SVG arc of the circle through three points. `circleThrough` already gives the radius and
 * the signed sweep, and a positive sweep is clockwise on screen — which is SVG's own `1`.
 */
const arcCommand = (start: Pt, through: Pt, end: Pt): string => {
  const curve = circleThrough(start, through, end)
  if (curve === null) return `L ${end.x} ${end.y}`
  const large = Math.abs(curve.sweep) > Math.PI ? 1 : 0
  const sweep = curve.sweep >= 0 ? 1 : 0
  return `A ${curve.radius} ${curve.radius} 0 ${large} ${sweep} ${end.x} ${end.y}`
}

/** The last drawn segment in the shape the shared snap engine takes (#59 §5). */
const draftSegmentOf = (segment: WallDraftSegment): readonly Segment[] => {
  if (segment.through === null) return [{ kind: 'line', to: segment.end }]
  const curve = circleThrough(segment.start, segment.through, segment.end)
  if (curve === null) return [{ kind: 'line', to: segment.end }]
  return [{ kind: 'arc', to: segment.end, center: curve.center, sweepDeg: (curve.sweep * 180) / Math.PI }]
}

export function WallDraftOverlay(props: WallDraftOverlayProps): ReactNode {
  const {
    viewport, floorWalls, draft, onDraft, onCancel, onFinish, floorId, defaults, onOptions,
    snapKinds, gridSpacingMm, angleIncrementDeg, unit, precision,
  } = props
  const layerRef = useRef<HTMLDivElement>(null)
  const press = useRef<{ x: number; y: number } | null>(null)
  const [hover, setHover] = useState<{ at: Pt; label: string | null } | null>(null)
  const [typing, setTyping] = useState(false)
  const [lengthText, setLengthText] = useState('')
  const num = chipNumber(unit, precision)

  // Focus follows the tool: the keyboard belongs to the draft the moment it is armed.
  useEffect(() => {
    layerRef.current?.focus()
  }, [])

  /** Client pixels to Floor millimetres, through the same viewport the canvas uses. */
  const toFloor = useCallback((clientX: number, clientY: number): Pt | null => {
    const el = layerRef.current
    if (el === null) return null
    const rect = el.getBoundingClientRect()
    return {
      x: (clientX - rect.left - viewport.panX) / viewport.zoom,
      y: (clientY - rect.top - viewport.panY) / viewport.zoom,
    }
  }, [viewport])

  /** The points that ARE corners of the tidied outline, including the free caps. */
  const cornerPoints = useMemo(
    () => floorWalls.snapSources.flatMap((source) => source.corners.map((corner) => corner.point)),
    [floorWalls],
  )

  /** The point a click would place, what it would join, and the words that say so. */
  const aim = useCallback((cursor: Pt): { at: Pt; target: WallSnapTarget; label: string | null } => {
    const segments = draftSegments(draft)
    const last = segments[segments.length - 1]
    // A face projection is a point on a line; a corner is a point. The projection is built on
    // the cursor, so standing on a corner it is a hair nearer than the corner itself and would
    // win the tie inside the kind — the corner of an L would then never be the point you get.
    // Within the same twelve pixels the corner is the answer, so the projections step aside.
    const reach = SNAP_ACQUISITION_PX / viewport.zoom
    const nearCorner = cornerPoints.some((point) => distance(point, cursor) <= reach)
    const candidates = snapCandidates({
      geometry: [],
      walls: floorWalls.snapSources,
      cursor,
      from: last?.end ?? null,
      draft: last === undefined ? [] : draftSegmentOf(last),
      gridSpacingMm,
      angleIncrementDeg,
      enabled: snapKinds,
    })
    const offered = nearCorner
      ? candidates.filter((candidate) => candidate.kind !== 'wallFace'
        || cornerPoints.some((point) => point.x === candidate.point.x && point.y === candidate.point.y))
      : candidates
    // The scene is drawn in Floor millimetres at `zoom` pixels per millimetre, so one pixel is
    // 1/zoom millimetres: the resolver wants millimetres per pixel, and handing it the zoom made
    // the reach 12 mm at 12× and 1 mm at 0.5× — the very defect criterion 5 names.
    const snap = resolveSnap(offered, cursor, 1 / viewport.zoom, snapKinds)
    if (snap === null) return { at: cursor, target: wallTargetAt(cursor, floorWalls.snapSources), label: null }
    return { at: snap.point, target: wallTargetAt(snap.point, floorWalls.snapSources), label: snap.target.label }
  }, [draft, floorWalls, cornerPoints, gridSpacingMm, angleIncrementDeg, snapKinds, viewport.zoom])

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    // The pointer over the row or the bar is not aiming at the canvas. Moving the rubber band
    // while a hand reaches for Finish also reflows the bar under that hand.
    if ((event.target as HTMLElement).closest('button, select, input, label') !== null) return
    const cursor = toFloor(event.clientX, event.clientY)
    if (cursor === null) return
    const aimed = aim(cursor)
    setHover({ at: aimed.at, label: aimed.label })
    onDraft(withWallCursor(draft, aimed.at, aimed.target))
  }, [toFloor, aim, draft, onDraft])

  /**
   * The click places where it landed, aimed the same way the rubber band is. The rubber band's
   * cursor is not trusted for this: a pointermove is a continuous event, so its state update can
   * still be pending when the click on the very same position is already being handled, and a
   * click that lands on a draft whose cursor has not arrived yet would place nothing at all.
   */
  const place = (event: React.MouseEvent<HTMLDivElement>): void => {
    const cursor = toFloor(event.clientX, event.clientY)
    if (cursor === null) return
    const aimed = aim(cursor)
    const next = placePoint(withWallCursor(draft, aimed.at, aimed.target))
    if (next !== null) onDraft(next)
  }

  const finish = (): void => {
    if (!canFinish(draft)) return
    const chain = toChainPayload(draft, floorId, { ...defaults, classification: defaults.classification ?? undefined })
    if (chain !== null) onFinish(chain)
  }

  const commitLength = (): void => {
    const value = Number(lengthText)
    if (lengthText !== '' && Number.isFinite(value) && value > 0) onDraft(withTypedLength(draft, value))
    setTyping(false)
    setLengthText('')
    layerRef.current?.focus()
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Backspace') {
      event.preventDefault()
      onDraft(undoPoint(draft))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      finish()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
    } else if (/^\d$/.test(event.key) && !typing) {
      // A digit opens the length field with the digit already in it (#64 §12).
      event.preventDefault()
      setTyping(true)
      setLengthText(event.key)
    }
  }

  const segments = draftSegments(draft)
  const chip = segments.length === 0 ? null : draftChip(segments[segments.length - 1]!, num, unit)
  const indicator = draft.cursor === null ? null : joinLabel(draft.cursor.target)
  const screen = hover === null
    ? null
    : { left: hover.at.x * viewport.zoom + viewport.panX, top: hover.at.y * viewport.zoom + viewport.panY }

  return (
    <div
      ref={layerRef}
      data-testid="wall-draft-layer"
      className="absolute inset-0"
      style={{ cursor: 'crosshair', outline: 'none' }}
      tabIndex={-1}
      onPointerDown={(event) => {
        // Where a press began decides whether releasing it places a point. A press that began on
        // the row or the bar belongs to that control: Firefox hands the click ending it to the
        // layer as well, and choosing Finish would otherwise add a Wall to the chain it commits.
        const control = (event.target as HTMLElement).closest('button, select, input, label')
        press.current = control === null ? { x: event.clientX, y: event.clientY } : null
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
        onDraft(withWallCursor(draft, null))
      }}
      onDoubleClick={finish}
      onKeyDown={onKeyDown}
    >
      <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
        <g transform={`matrix(${viewport.zoom},0,0,${viewport.zoom},${viewport.panX},${viewport.panY})`}>
          {segments.map((segment, index) => (
            <path
              key={index}
              data-testid={index === segments.length - 1 ? 'wall-draft-rubber-band' : undefined}
              d={segment.through === null
                ? `M ${segment.start.x} ${segment.start.y} L ${segment.end.x} ${segment.end.y}`
                : `M ${segment.start.x} ${segment.start.y} ${arcCommand(segment.start, segment.through, segment.end)}`}
              stroke="rgba(37, 99, 235, 0.35)"
              strokeWidth={defaults.thickness}
              fill="none"
              strokeLinecap="butt"
            />
          ))}
        </g>
      </svg>
      <div
        data-testid="wall-tool-options"
        className="absolute top-2 left-1/2 flex -translate-x-1/2 items-center gap-2"
        onClick={(event) => {
          // The row sits over the canvas; choosing an option is not a click that places a point.
          event.stopPropagation()
        }}
      >
        <label className="flex items-center gap-1">
          {STRINGS.wallThickness}
          <select
            data-testid="wall-thickness-picker"
            value={WALL_THICKNESS_PRESETS.some((entry) => entry.thickness === defaults.thickness)
              ? String(defaults.thickness)
              : 'custom'}
            onChange={(event) => {
              if (event.target.value === 'custom') return
              onOptions({ ...defaults, thickness: Number(event.target.value) })
            }}
          >
            {WALL_THICKNESS_PRESETS.map((entry) => (
              <option key={entry.thickness} value={String(entry.thickness)}>
                {`${entry.label} · ${entry.thickness} mm`}
              </option>
            ))}
            <option value="custom">{STRINGS.wallCustom}</option>
          </select>
        </label>
        <input
          data-testid="wall-thickness-field"
          type="number"
          aria-label={STRINGS.wallThicknessField}
          value={defaults.thickness}
          min={1}
          onChange={(event) => {
            const value = Number(event.target.value)
            if (Number.isFinite(value) && value > 0) onOptions({ ...defaults, thickness: value })
          }}
        />
        <ToolbarMenu label="More options" testId="wall-more-options">
          <label className="flex items-center gap-1">
            {STRINGS.wallJustification}
            <select
              data-testid="wall-justification"
              value={defaults.justification}
              onChange={(event) => onOptions({ ...defaults, justification: event.target.value as 'centre' | 'left' | 'right' })}
            >
              {WALL_JUSTIFICATIONS.map((entry) => (
                <option key={entry.value} value={entry.value}>{entry.label}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1">
            {STRINGS.wallClassification}
            <select
              data-testid="wall-classification"
              value={defaults.classification ?? ''}
              onChange={(event) => onOptions({
                ...defaults,
                classification: event.target.value === '' ? null : event.target.value as WallClassification,
              })}
            >
              <option value="">{STRINGS.wallClassificationNone}</option>
              {WALL_CLASSIFICATIONS.map((entry) => (
                <option key={entry.value} value={entry.value}>{entry.label}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1">
            {STRINGS.wallConstructionLabel}
            <input
              data-testid="wall-construction-label"
              value={defaults.constructionLabel}
              onChange={(event) => onOptions({ ...defaults, constructionLabel: event.target.value })}
            />
          </label>
        </ToolbarMenu>
      </div>
      {screen !== null && (
        <div
          data-testid="wall-hover-label"
          className="pointer-events-none absolute"
          style={{ left: screen.left + 12, top: screen.top - 24 }}
        >
          {hover?.label ?? ''}
        </div>
      )}
      {screen !== null && indicator !== null && (
        <div
          data-testid="wall-join-indicator"
          className="pointer-events-none absolute"
          style={{ left: screen.left + 12, top: screen.top - 8 }}
        >
          {indicator}
        </div>
      )}
      <div
        data-testid="wall-draft-bar"
        className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2"
        onClick={(event) => {
          // The bar is inside the layer that places points; its own clicks are not clicks on canvas.
          event.stopPropagation()
        }}
      >
        {SEGMENT_TOOLS.map((definition) => (
          <button
            key={definition.id}
            type="button"
            data-testid={definition.testId}
            aria-pressed={draft.tool === definition.id ? 'true' : 'false'}
            className="bb-workspace-tool-button"
            onClick={() => onDraft(withWallTool(draft, definition.id))}
          >
            {definition.label}
          </button>
        ))}
        <span data-testid="wall-chip" className="bb-workspace-chip tabular-nums min-w-[13ch] text-center">
          {chip ?? ''}
        </span>
        {typing && (
          <input
            data-testid="wall-length-field"
            autoFocus
            type="number"
            value={lengthText}
            aria-label="Length"
            onChange={(event) => setLengthText(event.target.value)}
            onBlur={commitLength}
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
          />
        )}
        <button type="button" data-testid="wall-undo" className="bb-workspace-tool-button" onClick={() => onDraft(undoPoint(draft))}>
          {STRINGS.wallUndoPoint}
        </button>
        <button type="button" data-testid="wall-finish" className="bb-workspace-tool-button" disabled={!canFinish(draft)} onClick={finish}>
          {STRINGS.wallFinish}
        </button>
        <button type="button" data-testid="wall-cancel" className="bb-workspace-tool-button" onClick={onCancel}>
          {STRINGS.wallCancelEsc}
        </button>
      </div>
    </div>
  )
}

/** The armed draft the workspace shows before the first click (#64 §12). */
export { emptyWallDraft } from './wallDraft'
