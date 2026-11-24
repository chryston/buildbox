/**
 * The `Beam` tool's overlay (#77 §3, criteria 1, 2).
 *
 * Two clicks on the reference line, three numbers, one Intent. A Beam is a straight record of
 * something already built, so there is no chain, no arc and no join to work out: the second click
 * ends the geometry and the bar's `Add Beam` writes it.
 *
 * The three numbers are Width, Depth and Underside, which are the three a person reading a ceiling
 * can actually answer for. `Top` is never asked for here because it is never stored — it is the sum
 * of the two boxes, and the bar prints it so the reader sees what they have just typed.
 *
 * Esc puts the tool down and sends nothing, which is why the draft is a value held above this
 * component: leaving mid-draft cannot leave a half-Beam behind, because nothing was ever written.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { WallJustification } from '../../../domain'
import type { Pt } from '../../../derive'
import type { Viewport } from '../viewport'
import { STRINGS } from '../../strings'
import { formatMm, parseMmInput } from '../displayUnits'
import type { DisplayUnit } from '../../../domain'

/** The three numbers a Beam needs besides its line, in millimetres. */
export interface BeamDraftResult {
  start: Pt
  end: Pt
  width: number
  height: number
  underside: number
  justification: WallJustification
}

export interface BeamDraft {
  start: Pt | null
  end: Pt | null
  width: number
  height: number
  underside: number
  justification: WallJustification
}

export const emptyBeamDraft = (width: number, height: number): BeamDraft => ({
  start: null,
  end: null,
  width,
  height,
  underside: 0,
  justification: 'centre',
})

export interface BeamDraftOverlayProps {
  viewport: Viewport
  draft: BeamDraft
  onDraft(draft: BeamDraft): void
  /** The plan snap set, applied to a click's point, exactly as the Wall tool's does (#59 §5). */
  snapAt(at: Pt, from: Pt | null): Pt
  onCancel(): void
  /** `Add Beam`: one `beam.create` for the line and the three numbers. */
  onFinish(result: BeamDraftResult): void
  unit: DisplayUnit
  precision: number
}

/** A Beam is a Beam when it has two different places to run between and a body with two sizes. */
export function beamDraftIsFinishable(draft: BeamDraft): boolean {
  if (draft.start === null || draft.end === null) return false
  return (
    Math.hypot(draft.end.x - draft.start.x, draft.end.y - draft.start.y) > 0 &&
    draft.width > 0 &&
    draft.height > 0
  )
}

/** The words the bar shows for the step the draft is on. */
export function beamDraftPrompt(draft: BeamDraft): string {
  if (draft.start === null) return STRINGS.beamPickStart
  return draft.end === null ? STRINGS.beamPickEnd : STRINGS.beamSetUnderside
}

const JUSTIFICATIONS: readonly WallJustification[] = ['left', 'centre', 'right']
// The same words the Wall and Beam inspectors use (#64 D6): the reference line's own direction is
// not something a person reading a plan has, so `left` and `right` never appear.
const JUSTIFICATION_LABEL: Record<WallJustification, string> = {
  left: STRINGS.justificationThisSide,
  centre: STRINGS.originCentre,
  right: STRINGS.justificationOtherSide,
}

export function BeamDraftOverlay(props: BeamDraftOverlayProps): ReactNode {
  const { viewport, draft, onDraft, snapAt, onCancel, onFinish, unit, precision } = props
  const layerRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<BeamDraft | null>(null)
  const step = draft.start === null ? 'start' : draft.end === null ? 'end' : 'numbers'
  const shown = hover ?? draft

  useEffect(() => {
    layerRef.current?.focus()
  }, [])

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
   * The second click aims at the angle snap against the first, which is what lets a run of Beams
   * under one roof line be clicked out square without a protractor.
   */
  const aim = useCallback(
    (at: Pt): BeamDraft => ({ ...draft, end: step === 'end' ? snapAt(at, draft.start) : snapAt(at, null) }),
    [draft, snapAt, step],
  )

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (step === 'numbers') return
      const at = toFloor(event.clientX, event.clientY)
      if (at === null) return
      setHover(aim(at))
    },
    [aim, step, toFloor],
  )

  const finish = useCallback(
    (over: Partial<BeamDraft> = {}): void => {
      const next = { ...draft, ...over }
      if (!beamDraftIsFinishable(next) || next.start === null || next.end === null) return
      onFinish({
        start: next.start,
        end: next.end,
        width: next.width,
        height: next.height,
        underside: next.underside,
        justification: next.justification,
      })
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
        event.preventDefault()
        onDraft(step === 'end' ? { ...draft, start: null, end: null } : { ...draft, end: null })
        setHover(null)
        return
      }
      if (event.key === 'Enter' && step === 'numbers') {
        event.preventDefault()
        finish()
      }
    },
    [draft, finish, onDraft, onCancel, step],
  )

  /** The body the pointer has offered: the band the Beam would have, drawn as it will be drawn. */
  const preview = useMemo(() => {
    const { start, end } = shown
    if (start === null || end === null) return ''
    const dx = end.x - start.x
    const dy = end.y - start.y
    const length = Math.hypot(dx, dy)
    if (length === 0) return ''
    // The face offsets of the chosen justification, measured along the left normal (-y, x), which
    // is the one convention the whole product shares: left of +x is +y.
    const nx = -dy / length
    const ny = dx / length
    const offsets = shown.justification === 'left' ? [0, shown.width] : shown.justification === 'right' ? [-shown.width, 0] : [-shown.width / 2, shown.width / 2]
    const at = (along: number, o: number): string => `${start.x + dx * along + nx * o} ${start.y + dy * along + ny * o}`
    return `M ${at(0, offsets[0])} L ${at(1, offsets[0])} L ${at(1, offsets[1])} L ${at(0, offsets[1])} Z`
  }, [shown])

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

  /** One millimetre box: the same control the inspector uses, so a number looks the same twice. */
  const box = (label: string, value: number, key: keyof BeamDraft, min: number): ReactNode => (
    <label className="bb-beam-draft-field">
      <span>{label}</span>
      <input
        type="number"
        data-testid={`beam-draft-${key}`}
        value={Number.isFinite(value) ? String(value) : ''}
        min={min}
        step={1}
        onChange={(event) => {
          const parsed = parseMmInput(event.target.value, unit)
          if (parsed === null) return
          onDraft({ ...draft, [key]: Math.max(min, parsed) } as BeamDraft)
        }}
      />
    </label>
  )

  const shownLength =
    shown.start !== null && shown.end !== null
      ? Math.hypot(shown.end.x - shown.start.x, shown.end.y - shown.start.y)
      : 0

  return (
    <div
      ref={layerRef}
      data-testid="beam-draft-overlay"
      className="absolute inset-0 cursor-crosshair outline-none"
      tabIndex={-1}
      onPointerMove={onPointerMove}
      onPointerLeave={() => setHover(null)}
      onPointerUp={(event) => {
        if (step === 'numbers') return
        const at = toFloor(event.clientX, event.clientY)
        if (at === null) return
        const next = aim(at)
        if (step === 'start') {
          onDraft({ ...draft, start: next.end })
          setHover(null)
        } else {
          // The second click ends the geometry; the numbers stay editable in the bar.
          onDraft({ ...draft, end: next.end })
          setHover(null)
        }
      }}
      onKeyDown={onKeyDown}
    >
      <svg className="absolute inset-0 h-full w-full" data-testid="beam-draft-preview" aria-hidden="true">
        {preview === '' ? null : (
          <path d={preview} fill="var(--bb-accent, #2563eb)" fillOpacity={0.18} stroke="var(--bb-accent, #2563eb)" strokeWidth={1.5 / viewport.zoom} />
        )}
        {shown.start === null ? null : dot(shown.start, 'start')}
        {shown.end === null ? null : dot(shown.end, 'end')}
      </svg>

      <div className="bb-beam-draft-bar absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-3 rounded-md border border-slate-300 bg-white/95 px-3 py-2 text-xs shadow">
        <span data-testid="beam-draft-prompt">{beamDraftPrompt(shown)}</span>
        {box(STRINGS.beamWidth, shown.width, 'width', 1)}
        {box(STRINGS.beamDepth, shown.height, 'height', 1)}
        {box(STRINGS.beamUnderside, shown.underside, 'underside', 0)}
        <label className="bb-beam-draft-field">
          <span>{STRINGS.beamJustification}</span>
          <select
            data-testid="beam-draft-justification"
            value={shown.justification}
            onChange={(event) => onDraft({ ...draft, justification: event.target.value as WallJustification })}
          >
            {JUSTIFICATIONS.map((each) => (
              <option key={each} value={each}>
                {JUSTIFICATION_LABEL[each]}
              </option>
            ))}
          </select>
        </label>
        <span data-testid="beam-draft-summary">
          {formatMm(shownLength, unit, precision)} × {formatMm(shown.width, unit, precision)} · {STRINGS.beamTop}{' '}
          {formatMm(shown.underside + shown.height, unit, precision)}
        </span>
        <button
          type="button"
          data-testid="beam-draft-done"
          disabled={!beamDraftIsFinishable(shown)}
          onClick={() => finish()}
        >
          {STRINGS.beamDone}
        </button>
        <button type="button" data-testid="beam-draft-cancel" onClick={onCancel}>
          {STRINGS.beamCancel}
        </button>
      </div>
    </div>
  )
}
