/**
 * The Skirting inspector (#78 §4).
 *
 * Seven fields in the issue's order: `Label`, `Wall`, `Side`, `Start`, `End`, the two lengths, then
 * `Bottom`, `Height` and `Thickness`. Two of them are printed and never typed:
 *
 * - `Gross length` is `End − Start`, and `Net length` is what is left after the corner clips, the
 *   T-junction gaps and the Openings — the number the Skirting table publishes. A box that could
 *   disagree with the Wall it is measured on is not a field.
 * - `Side` is a name, not a number: `Kitchen side`, never `left`.
 *
 * `Bottom` moves the strip and keeps `Height`; `Height` changes the top. Both write exact
 * millimetres, and an unparseable box marks itself and sends nothing — the same rule every other
 * number field follows.
 */
import type { ReactNode } from 'react'
import type { DerivedSkirting } from '../../../derive'
import type { DisplayUnit, Skirting } from '../../../domain'
import { skirtingTop } from '../../../domain'
import { STRINGS } from '../../strings'
import { NumberField } from '../SelectionInspector'
import { useFieldsLocked } from '../fieldsLock'

export interface SkirtingInspectorProps {
  skirting: Skirting
  /** The derived body, or `null` when its host Wall does not stand in what is being shown. */
  derived: DerivedSkirting | null
  /** `W-1`, the host's display name. */
  hostRef: string
  /** `Kitchen side`, or `side 1` when no Room adjoins the face (#78 §3 step 1). */
  sideName: string
  unit: DisplayUnit
  precision: number
  /** Clicking `Wall` selects the host, the way an Opening's inspector reaches its Wall. */
  onSelectHost: () => void
  onSetLabel: (label: string) => void
  onSetStart: (start: number) => void
  onSetEnd: (end: number) => void
  /** `Bottom` moves the Skirting and keeps its `Height`. */
  onSetBottom: (bottom: number) => void
  /** `Height` changes the top. */
  onSetHeight: (height: number) => void
  onSetThickness: (thickness: number) => void
  onFlipSide: () => void
  onDuplicateOtherSide: () => void
  onDelete: () => void
  /** The renovation action for this Skirting (#69 §13), when there is an Option to move it to. */
  renovationAction?: ReactNode
}

/** Grouped thousands, as the issue writes a height: `2,600 mm`. */
const grouped = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 })

function Row(props: { testId: string; label: string; value: string }): ReactNode {
  return (
    <>
      <span className="bb-workspace-field-label" data-testid={`${props.testId}-label`}>{props.label}</span>
      <span className="bb-workspace-static-value" data-testid={props.testId}>{props.value}</span>
    </>
  )
}

export function SkirtingInspector(props: SkirtingInspectorProps): ReactNode {
  const { skirting, derived, hostRef, sideName, unit, precision } = props
  const { locked } = useFieldsLocked()
  const mm = (value: number): string => `${grouped.format(value)} mm`

  return (
    <section className="bb-skirting-inspector" data-testid="skirting-inspector" aria-label={STRINGS.skirtingSectionTitle}>
      <span className="bb-workspace-field-label" data-testid="skirting-inspector-name">
        {skirting.label ?? STRINGS.skirtingSectionTitle}
      </span>

      <label className="bb-workspace-field">
        <span className="bb-workspace-field-label">{STRINGS.skirtingLabelField}</span>
        <input
          type="text"
          data-testid="skirting-field-label"
          defaultValue={skirting.label ?? ''}
          disabled={locked}
          onBlur={(event) => {
            if (event.target.value !== (skirting.label ?? '')) props.onSetLabel(event.target.value)
          }}
        />
      </label>

      <label className="bb-workspace-field">
        <span className="bb-workspace-field-label">{STRINGS.skirtingWall}</span>
        <button
          type="button"
          data-testid="skirting-field-wall"
          className="bb-workspace-link"
          onClick={props.onSelectHost}
        >
          {hostRef}
        </button>
      </label>

      <Row testId="skirting-field-side" label={STRINGS.skirtingSide} value={sideName} />

      <NumberField
        testId="skirting-field-start"
        label={STRINGS.skirtingStart}
        value={skirting.start}
        unit={unit}
        precision={precision}
        kind="mm"
        onCommit={props.onSetStart}
      />
      <NumberField
        testId="skirting-field-end"
        label={STRINGS.skirtingEnd}
        value={skirting.end}
        unit={unit}
        precision={precision}
        kind="mm"
        onCommit={props.onSetEnd}
      />

      {/* Read-only on purpose: both lengths are answered by the Wall the strip stands on, and the
          Net one counts gaps that only the model knows about (#78 §2). */}
      <Row testId="skirting-field-gross" label={STRINGS.skirtingGrossLength} value={mm(derived?.grossLength ?? skirting.end - skirting.start)} />
      <Row testId="skirting-field-net" label={STRINGS.skirtingNetLength} value={derived === null ? '—' : mm(derived.netLength)} />

      <NumberField
        testId="skirting-field-bottom"
        label={STRINGS.skirtingBottom}
        value={skirting.bottom}
        unit={unit}
        precision={precision}
        kind="mm"
        onCommit={props.onSetBottom}
      />
      <NumberField
        testId="skirting-field-height"
        label={STRINGS.skirtingHeight}
        value={skirting.height}
        unit={unit}
        precision={precision}
        kind="mm"
        min={1}
        onCommit={props.onSetHeight}
      />
      <NumberField
        testId="skirting-field-thickness"
        label={STRINGS.skirtingThickness}
        value={skirting.thickness}
        unit={unit}
        precision={precision}
        kind="mm"
        min={1}
        onCommit={props.onSetThickness}
      />
      <Row testId="skirting-field-top" label={STRINGS.beamTop} value={mm(skirtingTop(skirting))} />

      <div className="bb-skirting-inspector-actions flex items-center gap-2">
        <button
          type="button"
          data-testid="skirting-flip-side"
          className="bb-workspace-secondary-button"
          disabled={locked}
          onClick={props.onFlipSide}
        >
          {STRINGS.skirtingFlipSide}
        </button>
        <button
          type="button"
          data-testid="skirting-duplicate-other-side"
          className="bb-workspace-secondary-button"
          disabled={locked}
          onClick={props.onDuplicateOtherSide}
        >
          {STRINGS.skirtingDuplicateOtherSide}
        </button>
      </div>

      {props.renovationAction ?? null}

      <button
        type="button"
        data-testid="skirting-delete"
        className="bb-workspace-danger"
        disabled={locked}
        onClick={props.onDelete}
      >
        {STRINGS.skirtingDelete}
      </button>
    </section>
  )
}
