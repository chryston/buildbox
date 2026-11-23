/**
 * The `New Elevation View` tool's overlay (#75 §3, behaviour 12, criterion 5).
 *
 * Three steps in the middle of the Plan View: the view line's start, its end, then the side and the
 * depth. The draft itself is a value owned by the Floor workspace (`elevationDraft.ts`), so this
 * component holds only what the pointer is offering right now — a preview that is never sent
 * anywhere until a click or Enter makes it the draft.
 *
 * The depth answers to both hands, which is the point of step three: the prism's far edge follows the
 * pointer's perpendicular distance, and a number typed into the box replaces it. Both write the same
 * `side` + `depth` pair, so there is one finish, not two.
 *
 * Esc at any step puts the tool down and sends nothing. That is the whole of the cancel path, and it
 * is why the draft lives above this component: leaving the tool mid-draft cannot leave a half-view
 * behind, because nothing was ever written.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { ElevationViewSide } from '../../../domain'
import type { Pt } from '../../../derive'
import type { Viewport } from '../viewport'
import { STRINGS } from '../../strings'
import { formatMm, parseMmInput } from '../displayUnits'
import type { DisplayUnit } from '../../../domain'
import {
  elevationAim,
  elevationArrowPath,
  elevationDraftStep,
  elevationPrismPoints,
  emptyElevationDraft,
} from './elevationDraft'
import type { ElevationDraft, ElevationDraftStep } from './elevationDraft'

/** The three numbers a finished view needs, in millimetres. */
export interface ElevationDraftResult {
  start: Pt
  end: Pt
  side: ElevationViewSide
  depth: number
}

export interface ElevationDraftOverlayProps {
  viewport: Viewport
  /** The draft so far, held by the Floor workspace so a re-render cannot lose it. */
  draft: ElevationDraft
  onDraft(draft: ElevationDraft): void
  /**
   * The plan snap set, applied to a click's point (#75 §3 step 2: "the plan snap set applies").
   * The caller owns the snap sources, so this overlay never reads the Floor.
   */
  snapAt(at: Pt, from: Pt | null): Pt
  /** `Cancel (Esc)`, and the tool leaving. Nothing is sent. */
  onCancel(): void
  /** `Done`: one `elevationView.create` for the whole line, side and depth. */
  onFinish(result: ElevationDraftResult): void
  unit: DisplayUnit
  precision: number
}

/** The line and depth are only a view when they are two different places and a real distance. */
export function draftIsFinishable(draft: ElevationDraft): boolean {
  if (draft.start === null || draft.end === null) return false
  return Math.hypot(draft.end.x - draft.start.x, draft.end.y - draft.start.y) > 0 && draft.depth > 0
}

/** The words the bar shows for the step the draft is on. */
export function elevationDraftPrompt(step: ElevationDraftStep): string {
  if (step === 'start') return STRINGS.elevationPickStart
  return step === 'end' ? STRINGS.elevationPickEnd : STRINGS.elevationSetDepth
}

export function ElevationDraftOverlay(props: ElevationDraftOverlayProps): ReactNode {
  const { viewport, draft, onDraft, snapAt, onCancel, onFinish, unit, precision } = props
  const layerRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<ElevationDraft | null>(null)
  const [typing, setTyping] = useState(false)
  const [depthText, setDepthText] = useState('')
  const step = elevationDraftStep(draft)
  /** What the picture shows: the pointer's offer where there is one, the draft where there is not. */
  const shown = hover ?? draft

  // Focus follows the tool: the keyboard belongs to the draft the moment it is armed, which is what
  // makes Esc a cancel rather than a deselection of whatever the canvas had focused.
  useEffect(() => {
    layerRef.current?.focus()
  }, [])

  /** Client pixels to Floor millimetres, through the same viewport the canvas uses. */
  const toFloor = useCallback(
    (clientX: number, clientY: number): Pt | null => {
      const el = layerRef.current
      if (el === null) return null
      const rect = el.getBoundingClientRect()
      return {
        x: (clientX - rect.left - viewport.panX) / viewport.zoom,
        y: (clientY - rect.top - viewport.panY) / viewport.zoom,
      }
    },
    [viewport],
  )

  /**
   * Where the pointer stands, snapped where a snap applies.
   *
   * Only the two clicks on the line snap. The depth does not: a far edge that jumped to the nearest
   * Wall face every 200 mm would be a depth you could not read off the pointer, and the number box
   * is the exact control for people who want an exact depth.
   */
  const aim = useCallback(
    (at: Pt): ElevationDraft =>
      step === 'depth' ? elevationAim(draft, at) : elevationAim(draft, snapAt(at, step === 'end' ? draft.start : null)),
    [draft, snapAt, step],
  )

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      const at = toFloor(event.clientX, event.clientY)
      if (at === null) return
      setHover(aim(at))
    },
    [aim, toFloor],
  )

  /** `Enter`, or the click that ends step three: one view, one Intent, one undo step. */
  const finish = useCallback(
    (over: Partial<ElevationDraft> = {}): void => {
      const next = { ...draft, ...over }
      if (next.start === null || next.end === null) return
      const depth = over.depth ?? next.depth
      if (Math.hypot(next.end.x - next.start.x, next.end.y - next.start.y) <= 0 || depth <= 0) return
      onFinish({ start: next.start, end: next.end, side: next.side, depth })
    },
    [draft, onFinish],
  )

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
        return
      }
      if (event.key === 'Backspace' && step !== 'start') {
        // One step back: the depth goes first, then the end, then the start.
        event.preventDefault()
        onDraft(step === 'depth' ? { ...draft, end: null, depth: 0 } : { ...draft, start: null, end: null, depth: 0 })
        setHover(null)
        return
      }
      if (event.key === 'Enter' && !typing) {
        event.preventDefault()
        finish(hover ?? {})
      }
    },
    [draft, finish, hover, onDraft, onCancel, step, typing],
  )

  const prism = useMemo(
    () =>
      shown.start !== null && shown.end !== null && shown.depth > 0
        ? elevationPrismPoints(shown.start, shown.end, shown.side, shown.depth)
        : [],
    [shown],
  )
  const arrow =
    shown.start !== null && shown.end !== null && shown.depth > 0
      ? elevationArrowPath(shown.start, shown.end, shown.side, shown.depth, Math.max(200, shown.depth * 0.35))
      : ''
  const line =
    shown.start !== null && shown.end !== null
      ? `M ${shown.start.x} ${shown.start.y} L ${shown.end.x} ${shown.end.y}`
      : ''

  /** The endpoint squares, in screen size: a handle is 8 CSS px whatever the zoom. */
  const handle = 8 / viewport.zoom
  const dot = (at: Pt, key: string): ReactNode => (
    <rect
      key={key}
      x={at.x - handle / 2}
      y={at.y - handle / 2}
      width={handle}
      height={handle}
      fill="var(--bb-accent, #2563eb)"
      stroke="white"
      strokeWidth={1.5 / viewport.zoom}
    />
  )

  return (
    <div
      ref={layerRef}
      data-testid="elevation-draft-overlay"
      className="absolute inset-0 cursor-crosshair outline-none"
      tabIndex={-1}
      onPointerMove={onPointerMove}
      onPointerLeave={() => setHover(null)}
      onPointerUp={(event) => {
        if (typing) return
        const at = toFloor(event.clientX, event.clientY)
        if (at === null) return
        const next = aim(at)
        onDraft(next)
        if (elevationDraftStep(next) === 'depth' && next.depth > 0) finish()
      }}
      onKeyDown={onKeyDown}
    >
      <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
        <g transform={`matrix(${viewport.zoom},0,0,${viewport.zoom},${viewport.panX},${viewport.panY})`}>
          {prism.length === 4 && (
            <polygon
              data-testid="elevation-draft-band"
              points={prism.map((point) => `${point.x},${point.y}`).join(' ')}
              fill="rgba(37, 99, 235, 0.12)"
              stroke="rgba(37, 99, 235, 0.5)"
              strokeWidth={1 / viewport.zoom}
            />
          )}
          {line !== '' && (
            <path
              data-testid="elevation-draft-line"
              d={line}
              stroke="var(--bb-accent, #2563eb)"
              strokeWidth={2 / viewport.zoom}
              fill="none"
            />
          )}
          {arrow !== '' && (
            <path
              data-testid="elevation-draft-arrow"
              d={arrow}
              stroke="var(--bb-accent, #2563eb)"
              strokeWidth={2 / viewport.zoom}
              fill="none"
            />
          )}
          {shown.start !== null && dot(shown.start, 'elevation-draft-start')}
          {shown.end !== null && dot(shown.end, 'elevation-draft-end')}
        </g>
      </svg>
      <div
        data-testid="elevation-draft-bar"
        className="absolute top-2 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded bg-[var(--bb-surface,#fff)] px-2 py-1 text-sm shadow"
        onClick={(event) => {
          // The bar sits over the canvas; typing a depth is not a click that places a point.
          event.stopPropagation()
        }}
      >
        <span data-testid="elevation-draft-prompt">{elevationDraftPrompt(step)}</span>
        {step === 'depth' && (
          <label className="flex items-center gap-1">
            {STRINGS.depthMm}
            <input
              data-testid="elevation-draft-depth-field"
              className="bb-workspace-input w-24"
              type="number"
              autoFocus={typing}
              value={depthText}
              onChange={(event) => setDepthText(event.target.value)}
              onFocus={() => setTyping(true)}
              onBlur={() => setTyping(false)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  const typed = parseMmInput(depthText, unit)
                  if (typed !== null) finish({ depth: typed })
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  onCancel()
                }
              }}
            />
          </label>
        )}
        <button
          type="button"
          data-testid="elevation-draft-done"
          className="bb-workspace-primary-button"
          disabled={!draftIsFinishable(shown)}
          onClick={() => finish(hover ?? {})}
        >
          {STRINGS.apply}
        </button>
        <button type="button" data-testid="elevation-draft-cancel" className="bb-workspace-secondary-button" onClick={onCancel}>
          {STRINGS.cancel}
        </button>
      </div>
      {step === 'depth' && shown.depth > 0 && shown.start !== null && shown.end !== null && (
        <span
          data-testid="elevation-draft-chip"
          className="absolute rounded bg-[var(--bb-surface,#fff)] px-1 text-xs shadow"
          style={{
            left: ((shown.start.x + shown.end.x) / 2) * viewport.zoom + viewport.panX,
            top: ((shown.start.y + shown.end.y) / 2) * viewport.zoom + viewport.panY,
          }}
        >
          {formatMm(shown.depth, unit, precision)}
        </span>
      )}
    </div>
  )
}

/** A draft for a tool that has just been armed: nothing placed, defaults ready. */
export const emptyElevationToolDraft = (): ElevationDraft => emptyElevationDraft()
