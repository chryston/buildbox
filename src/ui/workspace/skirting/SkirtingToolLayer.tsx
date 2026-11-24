/**
 * The `Skirting` tool's layer (#78 §3, criteria 1–4).
 *
 * One Wall face is offered at a time: the one the pointer is nearest. Each face is a band twelve
 * CSS pixels wide on either side of it — the same reach every other pointer affordance uses — so the
 * nearer of two faces wins without the person having to zoom in first.
 *
 * The face says what it is before anything is written: `W-1 · Kitchen side`, named for the Room it
 * borders, or `W-1 · side 1` when no Room adjoins it. The words `left` and `right` never reach the
 * screen, because nobody stands in a Flat and thinks in them.
 *
 * One click skirts the **whole** face — the tidied face, so a corner stops the strip where the Wall
 * does — with the three numbers the bar is showing. Esc puts the tool down and sends nothing.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { SkirtingFaceTarget } from '../../../derive'
import { SNAP_ACQUISITION_PX } from '../../../derive'
import type { DisplayUnit } from '../../../domain'
import { STRINGS } from '../../strings'
import { formatMm, parseMmInput } from '../displayUnits'
import type { Viewport } from '../viewport'

/** Half the hit band, in CSS pixels: the acquisition range of every other pointer affordance. */
const HALF_PX = SNAP_ACQUISITION_PX

/** The three numbers the tool carries, all in millimetres. */
export interface SkirtingDraft {
  height: number
  thickness: number
  bottom: number
}

/** The issue's defaults: 100 and 15, both captioned `measure yours`, and a Bottom of 0. */
export const DEFAULT_SKIRTING_HEIGHT_MM = 100
export const DEFAULT_SKIRTING_THICKNESS_MM = 15

export const emptySkirtingDraft = (): SkirtingDraft => ({
  height: DEFAULT_SKIRTING_HEIGHT_MM,
  thickness: DEFAULT_SKIRTING_THICKNESS_MM,
  bottom: 0,
})

/** The one key a face is known by inside the layer. */
export const skirtingFaceKey = (target: SkirtingFaceTarget): string => `${target.wallId}|${target.side}`

/**
 * `W-1 · Kitchen side`, or `W-1 · side 1` when no Room adjoins the face (#78 §3 step 1). The Room's
 * own name carries the ` side`, which is how it is read out loud in a house.
 */
export function skirtingFaceName(target: SkirtingFaceTarget): string {
  const side = target.roomName === null ? STRINGS.skirtingSideNumber(target.sideNumber) : `${target.roomName} side`
  return STRINGS.skirtingFaceLabel(target.ref, side)
}

export interface SkirtingToolLayerProps {
  readonly viewport: Viewport
  /** Every face of every standing Wall, nearest-first order does not matter: the pointer decides. */
  readonly targets: readonly SkirtingFaceTarget[]
  readonly draft: SkirtingDraft
  readonly onDraft: (draft: SkirtingDraft) => void
  readonly onCancel: () => void
  /** One click on a face: skirt the whole thing with the numbers the bar shows. */
  readonly onCreate: (target: SkirtingFaceTarget, draft: SkirtingDraft) => void
  readonly unit: DisplayUnit
  readonly precision: number
}

export function SkirtingToolLayer(props: SkirtingToolLayerProps): ReactNode {
  const { viewport, targets, draft, onDraft, onCancel, onCreate, unit, precision } = props
  const [hover, setHover] = useState<{ key: string; x: number; y: number } | null>(null)
  const hovered = hover === null ? null : targets.find((each) => skirtingFaceKey(each) === hover.key) ?? null

  /** One millimetre box with a caption: the same control the inspector uses, so a number looks the same twice. */
  const box = (label: string, caption: string | null, key: keyof SkirtingDraft, min: number): ReactNode => (
    <label className="bb-skirting-draft-field flex items-center gap-1">
      <span>{label}</span>
      <input
        type="number"
        data-testid={`skirting-draft-${key}`}
        value={Number.isFinite(draft[key]) ? String(draft[key]) : ''}
        min={min}
        step={1}
        onChange={(event) => {
          const parsed = parseMmInput(event.target.value, unit)
          if (parsed === null) return
          onDraft({ ...draft, [key]: Math.max(min, parsed) })
        }}
      />
      {caption === null ? null : <span data-testid={`skirting-draft-${key}-caption`} className="text-slate-500">{caption}</span>}
    </label>
  )

  return (
    <div
      data-testid="skirting-tool-layer"
      className="absolute inset-0"
      style={{ cursor: 'crosshair', outline: 'none' }}
      tabIndex={-1}
      onPointerLeave={() => setHover(null)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onCancel()
        }
      }}
    >
      {targets.map((target) => {
        const key = skirtingFaceKey(target)
        // The band is a screen constant: twelve pixels either side of the face, whatever the zoom.
        const dx = target.to.x - target.from.x
        const dy = target.to.y - target.from.y
        const length = Math.hypot(dx, dy) * viewport.zoom
        const deg = (Math.atan2(dy, dx) * 180) / Math.PI
        const live = hover?.key === key
        return (
          <div
            key={key}
            data-testid={`skirting-face-hit-${key}`}
            role="button"
            aria-label={skirtingFaceName(target)}
            style={{
              position: 'absolute',
              left: target.from.x * viewport.zoom + viewport.panX,
              top: target.from.y * viewport.zoom + viewport.panY - HALF_PX,
              width: `${length}px`,
              height: `${HALF_PX * 2}px`,
              transformOrigin: `0 ${HALF_PX}px`,
              transform: `rotate(${deg}deg)`,
              background: 'var(--bb-accent)',
              opacity: live ? 0.34 : 0.1,
              borderBottom: '1px solid var(--bb-accent)',
              borderTop: '1px solid var(--bb-accent)',
              pointerEvents: 'all',
              cursor: 'pointer',
            }}
            onPointerMove={(event) => {
              const boxRect = (event.currentTarget.parentElement ?? event.currentTarget).getBoundingClientRect()
              setHover({ key, x: event.clientX - boxRect.left, y: event.clientY - boxRect.top })
            }}
            onPointerDown={(event) => {
              event.stopPropagation()
              onCreate(target, draft)
            }}
          />
        )
      })}
      {hover !== null && hovered !== null && (
        <div
          data-testid="skirting-face-label"
          className="absolute flex items-center gap-2"
          style={{ left: hover.x + 12, top: hover.y + 12, pointerEvents: 'none' }}
        >
          <span className="bb-shape-hint">{skirtingFaceName(hovered)}</span>
          <span className="bb-skirting-draft-summary">
            {formatMm(hovered.end - hovered.start, unit, precision)} × {formatMm(draft.height, unit, precision)}
          </span>
        </div>
      )}
      <div
        data-testid="skirting-tool-bar"
        className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-md border border-slate-300 bg-white/95 px-3 py-2 text-xs shadow"
        onClick={(event) => {
          event.stopPropagation()
        }}
      >
        <span data-testid="skirting-tool-hint" className="bb-shape-hint">{STRINGS.skirtingPickFace}</span>
        {box(STRINGS.skirtingHeight, STRINGS.skirtingMeasureYours, 'height', 1)}
        {box(STRINGS.skirtingThickness, STRINGS.skirtingMeasureYours, 'thickness', 1)}
        {box(STRINGS.skirtingBottom, null, 'bottom', Number.NEGATIVE_INFINITY)}
        <button
          type="button"
          data-testid="skirting-tool-cancel"
          className="bb-workspace-secondary-button"
          onClick={onCancel}
        >
          {STRINGS.skirtingCancel}
        </button>
      </div>
    </div>
  )
}
