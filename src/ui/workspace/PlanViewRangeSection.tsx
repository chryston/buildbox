/**
 * The **Plan View Range** section of the saved-view card (#74 §4): a vertical gauge with two draggable
 * stops, the same two numbers as fields, and the one line that says what the three styles mean.
 *
 * It sits between the Renovation Display cards and the Layers list because the three answer one
 * question in order: which Display is being drawn, how tall a slice of the Floor it draws, and which
 * Layers are in it. It is a Plan View's own setting, so it is shown only while one is active.
 *
 * The gauge is a *coarse* control and the fields are the exact one. A drag rounds to the millimetre —
 * the finest resolution the Project stores — and commits once, on release; Esc gives the number back
 * mid-drag. The fields take the Project's display unit and commit on Enter or blur.
 *
 * The scale is the Floor's, not the Range's own: the Floor Datum, any Floor limits and the whole
 * Vertical Extent of the content, padded by 5%, so the stops always have the building's full height to
 * be dragged across. It also covers the current Range, because a stop that could not be dragged back to
 * its own number is a control that cannot undo itself.
 *
 * Tick labels are never clipped, and that is a layout fact rather than a hope: the label column is
 * `max-content` wide, so it is exactly as wide as the widest full number it holds, and every label is a
 * child of the gauge container. The type scale is the card's — a gauge is not a poster.
 */
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { DisplayUnit, Floor, ItemDesign, PlanViewRange } from '../../domain'
import { openingExtent, placementExtent, wallExtent } from '../../derive'
import type { EffectiveModel } from '../../derive'
import { STRINGS } from '../strings'
import { formatMm } from './displayUnits'
import { ExtentNumberField } from './VerticalExtentFields'

/** What the gauge can show, in millimetres from the Floor Datum. */
export interface RangeGaugeScale {
  readonly lowerMm: number
  readonly upperMm: number
}

/** The narrowest band the domain accepts: a Range is `lower` below `upper`, in millimetres. */
const MIN_BAND_MM = 1

/** The tick steps on offer, coarsest last: the first that leaves at most eight labels wins. */
const TICK_STEPS = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000]

/** The gauge's padding, as the issue states it. */
const SCALE_PADDING = 0.05

/**
 * The gauge's scale: the Floor Datum, the Floor's own limits, the full Vertical Extent of everything
 * standing on the Floor, and the Range as it stands — then 5% of that span of air at each end, so a
 * stop at the top of the building is not sitting on the edge of the glass.
 *
 * The Effective Model is what is read, exactly as `rangeClasses` reads it: the gauge shows the same
 * Floor the drawing shows, Proposed entities included.
 */
export function rangeGaugeScale(
  floor: Floor,
  model: EffectiveModel,
  designs: readonly ItemDesign[],
  range: PlanViewRange,
): RangeGaugeScale {
  const designOf = new Map(designs.map((design) => [design.id, design]))
  const bands = [
    ...model.walls.map(({ entity }) => wallExtent(entity)),
    ...model.openings.map(({ entity }) => openingExtent(entity)),
    ...model.placedItems.flatMap(({ entity }) => {
      const design = designOf.get(entity.itemDesignId)
      return design === undefined ? [] : [placementExtent(design, entity)]
    }),
  ]
  const bottom = Math.min(
    0,
    range.lowerMm,
    ...bands.map((band) => band.lo),
    ...(typeof floor.limits?.lowerMm === 'number' ? [floor.limits.lowerMm] : []),
  )
  const top = Math.max(
    0,
    range.upperMm,
    ...bands.map((band) => band.hi),
    ...(typeof floor.limits?.upperMm === 'number' ? [floor.limits.upperMm] : []),
  )
  const pad = (top - bottom) * SCALE_PADDING
  return { lowerMm: bottom - pad, upperMm: top + pad }
}

/** The step the ticks are at: the first round step that keeps the column to eight labels. */
export function rangeGaugeTickStep(scale: RangeGaugeScale): number {
  const span = scale.upperMm - scale.lowerMm
  return TICK_STEPS.find((each) => span / each <= 8) ?? TICK_STEPS[TICK_STEPS.length - 1]!
}

/** The tick values inside the scale, at that step: `-500`, `0`, `500`, …, `2500`. */
export function rangeGaugeTicks(scale: RangeGaugeScale): number[] {
  const step = rangeGaugeTickStep(scale)
  const ticks: number[] = []
  for (let value = Math.ceil(scale.lowerMm / step) * step; value <= scale.upperMm; value += step) {
    ticks.push(Math.round(value))
  }
  return ticks
}

export interface PlanViewRangeSectionProps {
  /** The active Plan View's Range. */
  range: PlanViewRange
  /** What the gauge has room for, from `rangeGaugeScale`. */
  scale: RangeGaugeScale
  unit: DisplayUnit
  precision: number
  /** One Edit Transaction, `Change Plan View Range`, for the active Plan View and nothing else. */
  onCommit(lowerMm: number, upperMm: number): void
}

type Stop = 'lower' | 'upper'

/** A drag in progress: which stop the pointer holds and the value it is showing. */
interface Drag {
  stop: Stop
  valueMm: number
}

export function PlanViewRangeSection(props: PlanViewRangeSectionProps): ReactNode {
  const { range, scale, unit, precision, onCommit } = props
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragging = drag !== null
  const shown = (mm: number): string => formatMm(mm, unit, precision)
  const lowerMm = drag?.stop === 'lower' ? drag.valueMm : range.lowerMm
  const upperMm = drag?.stop === 'upper' ? drag.valueMm : range.upperMm
  const ticks = rangeGaugeTicks(scale)
  const span = scale.upperMm - scale.lowerMm
  /** How far down the gauge one value sits, as a percentage: the Floor Datum is not the bottom. */
  const at = (mm: number): string => `${((scale.upperMm - mm) / span) * 100}%`
  const stopLabel = (stop: Stop, mm: number): string =>
    STRINGS.extentStop(stop === 'lower' ? STRINGS.extentLower : STRINGS.extentUpper, shown(mm))

  // Esc belongs to the drag while there is one: the number goes back and nothing is sent.
  useEffect(() => {
    if (!dragging) return
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') setDrag(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dragging])

  const commit = (lower: number, upper: number): void => {
    if (lower === range.lowerMm && upper === range.upperMm) return
    onCommit(lower, upper)
  }

  /** Where the pointer is, in millimetres. The measurement is the *track's* box, not the stop's: the
   * stop is 12 px of handle sitting at the value, and the pointer is somewhere along the whole bar.
   * The gauge is the coarse control, so a drag answers in whole millimetres, the unit the Project
   * stores in — the fields beside it are the exact ones. */
  const valueAt = (clientY: number): number => {
    const host = trackRef.current
    if (host === null) return 0
    const box = host.getBoundingClientRect()
    const fraction = box.height === 0 ? 0 : (clientY - box.top) / box.height
    return Math.round(scale.upperMm - fraction * span)
  }

  /** A stop's new value, kept inside the scale and below/above the other stop: the pair the domain
   * accepts is the only pair this control can show. */
  const stopValue = (stop: Stop, value: number): number =>
    stop === 'lower'
      ? Math.min(Math.max(value, scale.lowerMm), range.upperMm - MIN_BAND_MM)
      : Math.max(Math.min(value, scale.upperMm), range.lowerMm + MIN_BAND_MM)

  const startDrag = (stop: Stop) => (event: ReactPointerEvent<HTMLElement>): void => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({ stop, valueMm: stop === 'lower' ? range.lowerMm : range.upperMm })
  }

  const moveDrag = (stop: Stop) => (event: ReactPointerEvent<HTMLElement>): void => {
    if (drag?.stop !== stop) return
    setDrag({ stop, valueMm: stopValue(stop, valueAt(event.clientY)) })
  }

  const endDrag = (stop: Stop) => (): void => {
    if (drag?.stop !== stop) return
    const value = drag.valueMm
    setDrag(null)
    // One transaction, on release — the drag itself wrote nothing.
    commit(stop === 'lower' ? value : range.lowerMm, stop === 'upper' ? value : range.upperMm)
  }

  const nudge = (stop: Stop) => (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    const delta = (event.key === 'ArrowUp' ? 1 : -1) * rangeGaugeTickStep(scale)
    const next = stopValue(stop, (stop === 'lower' ? range.lowerMm : range.upperMm) + delta)
    commit(stop === 'lower' ? next : range.lowerMm, stop === 'upper' ? next : range.upperMm)
  }

  const stopRow = (stop: Stop): ReactNode => (
    <span
      className="bb-range-stop-label"
      data-testid={`range-stop-${stop}-label`}
      style={{ top: at(stop === 'lower' ? lowerMm : upperMm) }}
    >
      {stopLabel(stop, stop === 'lower' ? lowerMm : upperMm)}
    </span>
  )

  return (
    <section className="bb-range-section" data-testid="plan-view-range-section">
      <span className="bb-workspace-field-label" id="plan-view-range-label" data-testid="plan-view-range-title">
        {STRINGS.planViewRangeField}
      </span>
      <div className="bb-range-gauge" data-testid="range-gauge" role="group" aria-labelledby="plan-view-range-label">
        <div className="bb-range-track" data-testid="range-track" ref={trackRef}>
          <div
            className="bb-range-band"
            data-testid="range-band"
            style={{ top: at(upperMm), height: `${((upperMm - lowerMm) / span) * 100}%` }}
          />
          {(['lower', 'upper'] as const).map((stop) => (
            <button
              key={stop}
              type="button"
              className={`bb-range-stop bb-range-stop-${stop}`}
              data-testid={`range-stop-${stop}`}
              data-dragging={drag?.stop === stop ? 'true' : 'false'}
              style={{ top: at(stop === 'lower' ? lowerMm : upperMm) }}
              aria-label={stopLabel(stop, stop === 'lower' ? lowerMm : upperMm)}
              onPointerDown={startDrag(stop)}
              onPointerMove={moveDrag(stop)}
              onPointerUp={endDrag(stop)}
              onPointerCancel={() => setDrag(null)}
              onKeyDown={nudge(stop)}
            />
          ))}
        </div>
        <div className="bb-range-labels" data-testid="range-labels">
          {ticks.map((tick) => (
            <span key={tick} className="bb-range-tick" data-testid={`range-tick-${String(tick)}`} style={{ top: at(tick) }}>
              {shown(tick)}
            </span>
          ))}
          {stopRow('lower')}
          {stopRow('upper')}
        </div>
      </div>
      <ExtentNumberField
        label={STRINGS.extentLower}
        testId="range-lower-field"
        text={shown(range.lowerMm)}
        unit={unit}
        problem={(valueMm) => (valueMm < range.upperMm ? null : STRINGS.extentLowerNeedsUpper)}
        onCommit={(valueMm) => commit(valueMm, range.upperMm)}
      />
      <ExtentNumberField
        label={STRINGS.extentUpper}
        testId="range-upper-field"
        text={shown(range.upperMm)}
        unit={unit}
        problem={(valueMm) => (range.lowerMm < valueMm ? null : STRINGS.extentLowerNeedsUpper)}
        onCommit={(valueMm) => commit(range.lowerMm, valueMm)}
      />
      <p className="bb-range-legend" data-testid="plan-view-range-legend">{STRINGS.planViewRangeLegend}</p>
    </section>
  )
}
