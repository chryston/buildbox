/**
 * The Beam inspector (#77 §3, criteria 3, 4, 6).
 *
 * Four numbers and a name. `Width`, `Depth` and `Underside` are what a person standing under the
 * thing can answer for; `Top` is printed and never typed, because it is the sum of the other two
 * and a number a reader could make disagree with its own arithmetic is a number nobody trusts.
 * `Length` is read off the reference line for the same reason.
 *
 * The words are the issue's own: `Underside` and `Top`, never the stored field's name and never a
 * word about what the Beam holds up. Justification follows the Wall inspector's house rule (#64
 * D6) — the reference line's own direction is not something a plan reader has, so it is named in
 * the words that describe what the reader can see.
 */
import type { ReactNode } from 'react'
import type { Beam, DisplayUnit, WallJustification } from '../../../domain'
import { beamTop } from '../../../domain'
import { STRINGS } from '../../strings'
import { NumberField } from '../SelectionInspector'
import { useFieldsLocked } from '../fieldsLock'

export interface BeamInspectorProps {
  beam: Beam
  /** Millimetres along the reference line, which is the length the plan shows. */
  length: number
  unit: DisplayUnit
  precision: number
  onSetLabel: (label: string) => void
  onSetWidth: (width: number) => void
  /** The `Depth` box: the stored `height`, which is what the Intent is named for. */
  onSetDepth: (height: number) => void
  onSetUnderside: (underside: number) => void
  onSetLength: (length: number) => void
  onSetJustification: (justification: WallJustification) => void
  onDelete: () => void
  /** The renovation action for this Beam (#69 §13), when there is an Option to move it to. */
  renovationAction?: ReactNode
}

/** Grouped thousands, as the issue writes a height: `2,600 mm`. */
const grouped = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 })

/** The justification in the words a plan reader has, never the data's own names (#64 D6). */
const JUSTIFICATION_WORDS: Record<WallJustification, string> = {
  centre: STRINGS.originCentre,
  left: STRINGS.justificationThisSide,
  right: STRINGS.justificationOtherSide,
}

const JUSTIFICATIONS: readonly WallJustification[] = ['left', 'centre', 'right']

function Row(props: { testId: string; label: string; value: string }): ReactNode {
  return (
    <>
      <span className="bb-workspace-field-label" data-testid={`${props.testId}-label`}>{props.label}</span>
      <span className="bb-workspace-static-value" data-testid={props.testId}>{props.value}</span>
    </>
  )
}

export function BeamInspector(props: BeamInspectorProps): ReactNode {
  const { beam, length, unit, precision } = props
  const { locked } = useFieldsLocked()
  const mm = (value: number): string => `${grouped.format(value)} mm`

  return (
    <section className="bb-beam-inspector" data-testid="beam-inspector" aria-label={STRINGS.beamSectionTitle}>
      <span className="bb-workspace-field-label" data-testid="beam-inspector-name">{beam.label ?? STRINGS.beamSectionTitle}</span>

      <label className="bb-workspace-field">
        <span className="bb-workspace-field-label">{STRINGS.beamLabelField}</span>
        <input
          type="text"
          data-testid="beam-field-label"
          defaultValue={beam.label ?? ''}
          disabled={locked}
          onBlur={(event) => {
            if (event.target.value !== (beam.label ?? '')) props.onSetLabel(event.target.value)
          }}
        />
      </label>

      <Row testId="beam-field-length-static" label={STRINGS.beamLength} value={mm(length)} />
      <NumberField
        testId="beam-field-length"
        label={STRINGS.beamLength}
        value={length}
        unit={unit}
        precision={precision}
        kind="mm"
        min={1}
        onCommit={props.onSetLength}
      />
      <NumberField
        testId="beam-field-width"
        label={STRINGS.beamWidth}
        value={beam.width}
        unit={unit}
        precision={precision}
        kind="mm"
        min={1}
        onCommit={props.onSetWidth}
      />
      <NumberField
        testId="beam-field-depth"
        label={STRINGS.beamDepth}
        value={beam.height}
        unit={unit}
        precision={precision}
        kind="mm"
        min={1}
        onCommit={props.onSetDepth}
      />
      <NumberField
        testId="beam-field-underside"
        label={STRINGS.beamUnderside}
        value={beam.underside}
        unit={unit}
        precision={precision}
        kind="mm"
        onCommit={props.onSetUnderside}
      />
      {/* Read-only on purpose: `Top` is `Underside` plus `Depth`, and the two boxes above already
          write it. A field that could disagree with its own sum is not a field. */}
      <Row testId="beam-field-top" label={STRINGS.beamTop} value={mm(beamTop(beam))} />

      <label className="bb-workspace-field">
        <span className="bb-workspace-field-label">{STRINGS.beamJustification}</span>
        <select
          data-testid="beam-field-justification"
          value={beam.justification}
          disabled={locked}
          onChange={(event) => props.onSetJustification(event.target.value as WallJustification)}
        >
          {JUSTIFICATIONS.map((each) => (
            <option key={each} value={each}>
              {JUSTIFICATION_WORDS[each]}
            </option>
          ))}
        </select>
      </label>

      {props.renovationAction ?? null}

      <button
        type="button"
        data-testid="beam-delete"
        className="bb-workspace-danger"
        disabled={locked}
        onClick={props.onDelete}
      >
        {STRINGS.beamDelete}
      </button>
    </section>
  )
}
