/**
 * The `Service` tool's layer (#79 §6, criteria 1–3).
 *
 * One button, two shapes: the bar carries a `Run` / `Riser` switch. A Run takes two clicks on the
 * plan — the ends of one straight centreline — and a Riser takes one. The bar says which of the two
 * it is waiting for, in the same words all the way down, so a person never has to guess whether the
 * next click finishes the Service or only starts it.
 *
 * The numbers the bar shows are the ones the tool will store. The sizes are placeholders captioned
 * `measure yours`: there is no size table and no typical-size preset, because a Service that is
 * documented and not modelled is documented from a survey, not from a catalogue.
 *
 * The tool session remembers the last-used values and nothing else — they are not persisted, and a
 * second Service drawn without touching a box lands with the numbers of the first. Esc puts the tool
 * down mid-Run and sends nothing.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { DisplayUnit, Point2, ServiceKind, ServiceSection, ServiceShape } from '../../../domain'
import { SERVICE_KINDS } from '../../../domain'
import { STRINGS } from '../../strings'
import { formatMm, parseMmInput } from '../displayUnits'
import type { Viewport } from '../viewport'

/** Everything the tool carries from one Service to the next, in millimetres. */
export interface ServiceDraft {
  shape: ServiceShape
  kind: ServiceKind
  section: ServiceSection
  outsideDiameter: number
  width: number
  depth: number
  /** A Run's stored centreline; the bar shows it as `Centre` and derives Bottom and Top from it. */
  centrelineElevation: number
  /** A Riser's Bottom; its Top is Bottom plus `riserHeight`. */
  bottomElevation: number
  riserHeight: number
}

/** The issue's placeholders: Ø50 round, 80 × 60 rectangular, a Run at the Datum, a Riser one storey. */
export const DEFAULT_SERVICE_CENTRELINE_MM = 0
export const DEFAULT_SERVICE_RISER_HEIGHT_MM = 2600

export const emptyServiceDraft = (): ServiceDraft => ({
  shape: 'run',
  kind: 'water',
  section: 'round',
  outsideDiameter: 50,
  width: 80,
  depth: 60,
  centrelineElevation: DEFAULT_SERVICE_CENTRELINE_MM,
  bottomElevation: 0,
  riserHeight: DEFAULT_SERVICE_RISER_HEIGHT_MM,
})

/** The Kind's word: `Water`, `Air-con`, and the one word the issue allows for the rest. */
const KIND_LABELS: Record<ServiceKind, string> = {
  water: STRINGS.serviceKindWater,
  drain: STRINGS.serviceKindDrain,
  gas: STRINGS.serviceKindGas,
  electrical: STRINGS.serviceKindElectrical,
  air_con: STRINGS.serviceKindAirCon,
  other: STRINGS.serviceKindOther,
}

export interface ServiceToolLayerProps {
  readonly viewport: Viewport
  readonly draft: ServiceDraft
  readonly onDraft: (draft: ServiceDraft) => void
  readonly onCancel: () => void
  /** The Run's first end, already placed, or `null` when the tool is waiting for it. */
  readonly anchor: Point2 | null
  readonly onAnchor: (at: Point2 | null) => void
  /** A click on the plan: the tool decides whether it anchors a Run or finishes one. */
  readonly onClick: (at: Point2) => void
  readonly unit: DisplayUnit
  readonly precision: number
}

export function ServiceToolLayer(props: ServiceToolLayerProps): ReactNode {
  const { viewport, draft, onDraft, onCancel, anchor, onClick, unit, precision } = props
  const [hover, setHover] = useState<Point2 | null>(null)

  const toFloor = (event: React.PointerEvent<HTMLDivElement>): Point2 | null => {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: (event.clientX - rect.left - viewport.panX) / viewport.zoom,
      y: (event.clientY - rect.top - viewport.panY) / viewport.zoom,
    }
  }

  const number = (label: string, caption: string | null, key: keyof ServiceDraft, min: number): ReactNode => (
    <label className="bb-service-draft-field flex items-center gap-1">
      <span>{label}</span>
      <input
        type="number"
        data-testid={`service-draft-${key}`}
        value={String(draft[key])}
        min={min}
        step={1}
        onChange={(event) => {
          const parsed = parseMmInput(event.target.value, unit)
          if (parsed === null) return
          onDraft({ ...draft, [key]: parsed } as ServiceDraft)
        }}
      />
      {caption === null ? null : <span data-testid={`service-draft-${key}-caption`} className="text-slate-500">{caption}</span>}
    </label>
  )

  const measureYours = STRINGS.serviceMeasureYours
  const round = draft.section === 'round'

  return (
    <div
      data-testid="service-tool-layer"
      className="absolute inset-0"
      style={{ cursor: 'crosshair', outline: 'none' }}
      tabIndex={-1}
      onPointerMove={(event) => setHover(toFloor(event))}
      onPointerLeave={() => setHover(null)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onCancel()
        }
      }}
      onPointerDown={(event) => {
        const at = toFloor(event)
        if (at === null) return
        event.stopPropagation()
        onClick(at)
      }}
    >
      {/* The bar: the two shapes, the Kind, the section, the size and the height it sits at. */}
      <div
        data-testid="service-tool-bar"
        className="absolute left-2 top-2 flex flex-wrap items-center gap-2 rounded border border-slate-300 bg-white/95 p-2 text-xs"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div role="group" aria-label={STRINGS.toolService} className="flex gap-1">
          {(['run', 'riser'] as const).map((shape) => (
            <button
              key={shape}
              type="button"
              data-testid={`service-shape-${shape}`}
              aria-pressed={draft.shape === shape}
              className={draft.shape === shape ? 'rounded bg-slate-800 px-2 py-1 text-white' : 'rounded px-2 py-1'}
              onClick={() => onDraft({ ...draft, shape })}
            >
              {shape === 'run' ? STRINGS.serviceShapeRun : STRINGS.serviceShapeRiser}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1">
          <span>{STRINGS.serviceKind}</span>
          <select
            data-testid="service-draft-kind"
            value={draft.kind}
            onChange={(event) => onDraft({ ...draft, kind: event.target.value as ServiceKind })}
          >
            {SERVICE_KINDS.map((kind) => (
              <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>
            ))}
          </select>
        </label>
        {draft.shape === 'riser' ? null : (
          <label className="flex items-center gap-1">
            <span>{STRINGS.serviceSection}</span>
            <select
              data-testid="service-draft-section"
              value={draft.section}
              onChange={(event) => onDraft({ ...draft, section: event.target.value as ServiceSection })}
            >
              <option value="round">{STRINGS.serviceSectionRound}</option>
              <option value="rectangular">{STRINGS.serviceSectionRectangular}</option>
            </select>
          </label>
        )}
        {draft.shape === 'riser' || round
          ? number(STRINGS.serviceDiameter, measureYours, 'outsideDiameter', 1)
          : null}
        {draft.shape === 'riser' || round ? null : number(STRINGS.serviceWidth, measureYours, 'width', 1)}
        {draft.shape === 'riser' || round ? null : number(STRINGS.serviceDepth, measureYours, 'depth', 1)}
        {draft.shape === 'riser'
          ? number(STRINGS.serviceBottom, null, 'bottomElevation', Number.NEGATIVE_INFINITY)
          : number(STRINGS.serviceCentre, null, 'centrelineElevation', Number.NEGATIVE_INFINITY)}
        {draft.shape === 'riser' ? number(STRINGS.serviceHeight, null, 'riserHeight', 1) : null}
        <span data-testid="service-tool-hint" className="text-slate-500">
          {draft.shape === 'riser'
            ? STRINGS.serviceClickOnce
            : anchor === null
              ? STRINGS.serviceClickStart
              : STRINGS.serviceClickEnd}
        </span>
      </div>

      {/* The rubber line: the Run already anchored, drawn to wherever the pointer currently is. */}
      {draft.shape === 'run' && anchor !== null && hover !== null ? (
        <svg className="pointer-events-none absolute inset-0 h-full w-full">
          <line
            data-testid="service-rubber"
            x1={anchor.x * viewport.zoom + viewport.panX}
            y1={anchor.y * viewport.zoom + viewport.panY}
            x2={hover.x * viewport.zoom + viewport.panX}
            y2={hover.y * viewport.zoom + viewport.panY}
            stroke="var(--bb-accent)"
            strokeWidth={1.5}
            strokeDasharray="6 4"
          />
          <circle
            data-testid="service-anchor"
            cx={anchor.x * viewport.zoom + viewport.panX}
            cy={anchor.y * viewport.zoom + viewport.panY}
            r={3}
            fill="var(--bb-accent)"
          />
          <text
            data-testid="service-rubber-length"
            x={(anchor.x + hover.x) / 2 * viewport.zoom + viewport.panX}
            y={(anchor.y + hover.y) / 2 * viewport.zoom + viewport.panY - 6}
            textAnchor="middle"
            fontSize={11}
            fill="var(--bb-text)"
          >
            {formatMm(Math.round(Math.hypot(hover.x - anchor.x, hover.y - anchor.y)), unit, precision)}
          </text>
        </svg>
      ) : null}
    </div>
  )
}
