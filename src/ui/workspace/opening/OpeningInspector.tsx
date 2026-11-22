/**
 * The Opening inspector (#65 §11): one Opening's own numbers, in the Project's display unit.
 *
 * `Width` and the distance are Intents and nothing else — one number, one Edit Transaction
 * (#26) — and both are refused by the same fit rule that refused the ghost while placing, so
 * the inspector cannot get an Opening into a position the tool would not have offered.
 *
 * `Distance from` is a toggle rather than two fields because it is one stored number read two
 * ways: the near jamb, or the same Opening seen from the other end of the host. The mirror is
 * taken against the host reference line's own length and the Opening's derived far jamb, which
 * is the arithmetic the Plan View drew with — on an arc Wall the two jambs are an arc length
 * apart while `Width` stays the chord, and a field that assumed otherwise would type a number
 * the plan does not show.
 *
 * Sill and Head are read-only here: a Vertical Extent is edited in #74, and a number that is
 * shown but not editable says so by being a line of text rather than a greyed-out box.
 *
 * Nothing says `left` or `right` (#64 D6). Which face a door opens toward is a fact about the
 * host's own direction, which a person reading a plan does not have, so it reads
 * `Opens toward this side of W-3` / `Opens toward W-3's other side`.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { DisplayUnit, Opening, Wall } from '../../../domain'
import { STRINGS } from '../../strings'
import { NumberField } from '../SelectionInspector'
import { useFieldsLocked } from '../fieldsLock'
import { readoutMm } from '../displayUnits'

/** Grouped thousands, as the issue writes a sill: `1,050 mm`. */
const grouped = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 })

const KIND_WORDS: Record<Opening['kind'], string> = {
  door: STRINGS.kindDoor,
  window: STRINGS.kindWindow,
  removed_section: STRINGS.kindRemovedSection,
}

/** Which face the leaf swings toward, in the words a plan reader has. */
export const swingSentence = (swing: 'left' | 'right', hostRef: string): string =>
  swing === 'left' ? STRINGS.opensThisSide(hostRef) : STRINGS.opensOtherSide(hostRef)

export interface OpeningInspectorProps {
  opening: Opening
  /** The one Wall it is cut into. */
  host: Wall
  /** The far jamb along the host's reference line — arc length on an arc Wall. */
  end: number
  /** That reference line's own length, which is what `Distance from end` counts to. */
  hostLength: number
  unit: DisplayUnit
  precision: number
  onRename: (label: string) => void
  onSetWidth: (width: number) => void
  onSetStart: (start: number) => void
  onFlipHinge: () => void
  onFlipSwing: () => void
  onSelectHost: () => void
  onDelete: () => void
  /** The renovation action for this Opening (#69 §13), when there is an Option to move it to. */
  renovationAction?: ReactNode
}

function Row(props: { testId: string; label: string; value: string }): ReactNode {
  return (
    <>
      <span className="bb-workspace-field-label" data-testid={`${props.testId}-label`}>{props.label}</span>
      <span className="bb-workspace-static-value" data-testid={props.testId}>{props.value}</span>
    </>
  )
}

export function OpeningInspector(props: OpeningInspectorProps): ReactNode {
  const {
    opening, host, end, hostLength, unit, precision,
    onRename, onSetWidth, onSetStart, onFlipHinge, onFlipSwing, onSelectHost, onDelete, renovationAction,
  } = props
  const { locked, notice } = useFieldsLocked()
  const [labelText, setLabelText] = useState(opening.label)
  const [from, setFrom] = useState<'start' | 'end'>('start')
  // Another Opening selected, or this one renamed by the Intent: the field reads the Project.
  useEffect(() => { setLabelText(opening.label) }, [opening.id, opening.label])

  const span = end - opening.start
  const fromEnd = hostLength - end
  const shown = from === 'start' ? opening.start : fromEnd
  const commitDistance = (value: number): void => {
    onSetStart(from === 'start' ? value : hostLength - value - span)
  }
  // A sliding door has neither: no leaf to hang and no face to swing toward (#65 §1).
  const hinged = opening.swing !== undefined && opening.swing !== 'sliding' && opening.hingeSide !== undefined
  const commitLabel = (): void => {
    const next = labelText.trim()
    if (next === '' || next === opening.label) {
      setLabelText(opening.label)
      return
    }
    onRename(next)
  }

  return (
    <section className="bb-workspace-card" data-testid="opening-inspector">
      <h3 className="bb-workspace-card-title" data-testid="opening-inspector-title">{opening.label}</h3>
      <label className="bb-workspace-field-label" htmlFor="opening-inspector-label-field">{STRINGS.openingLabel}</label>
      <input
        id="opening-inspector-label-field"
        className="bb-workspace-input"
        data-testid="opening-inspector-label"
        type="text"
        disabled={locked}
        title={notice === '' ? undefined : notice}
        value={labelText}
        onChange={(event) => setLabelText(event.target.value)}
        onBlur={commitLabel}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commitLabel()
        }}
      />
      <Row testId="opening-inspector-kind" label={STRINGS.openingKind} value={KIND_WORDS[opening.kind]} />
      <span className="bb-workspace-field-label">{STRINGS.openingHost}</span>
      <button
        type="button"
        className="bb-workspace-tool-button"
        data-testid="opening-inspector-host"
        onClick={onSelectHost}
      >
        {host.ref}
      </button>
      <NumberField
        label={STRINGS.openingWidth}
        testId="opening-inspector-width"
        value={opening.width}
        kind="mm"
        unit={unit}
        precision={precision}
        min={1}
        onCommit={onSetWidth}
      />
      <span className="bb-workspace-field-label">{STRINGS.openingDistanceFrom}</span>
      <div className="flex items-center gap-2" data-testid="opening-inspector-from">
        <button
          type="button"
          className="bb-workspace-tool-button"
          data-testid="opening-inspector-from-start"
          aria-pressed={from === 'start'}
          onClick={() => setFrom('start')}
        >
          {STRINGS.openingFromStart}
        </button>
        <button
          type="button"
          className="bb-workspace-tool-button"
          data-testid="opening-inspector-from-end"
          aria-pressed={from === 'end'}
          onClick={() => setFrom('end')}
        >
          {STRINGS.openingFromEnd}
        </button>
      </div>
      <NumberField
        label={from === 'start' ? STRINGS.openingFromTheStart : STRINGS.openingFromTheEnd}
        testId="opening-inspector-distance"
        value={shown}
        kind="mm"
        unit={unit}
        precision={precision}
        min={0}
        onCommit={commitDistance}
      />
      <Row testId="opening-inspector-sill" label={STRINGS.openingSill} value={`${grouped.format(opening.sill)} mm`} />
      <Row testId="opening-inspector-head" label={STRINGS.openingHead} value={`${grouped.format(opening.head)} mm`} />
      {hinged && (
        <>
          <span className="bb-workspace-static-value" data-testid="opening-inspector-swing">
            {swingSentence(opening.swing === 'right' ? 'right' : 'left', host.ref)}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="bb-workspace-tool-button"
              data-testid="opening-inspector-flip-hinge"
              onClick={onFlipHinge}
            >
              {STRINGS.openingFlipHinge}
            </button>
            <button
              type="button"
              className="bb-workspace-tool-button"
              data-testid="opening-inspector-flip-swing"
              onClick={onFlipSwing}
            >
              {STRINGS.openingFlipSide}
            </button>
          </div>
        </>
      )}
      {/* The distance is read in the Project's unit; the read-out beside it is the same number
          grouped, so a person typing in metres still sees the millimetres the plan holds. */}
      <span className="bb-workspace-unit-suffix" data-testid="opening-inspector-readout">
        {readoutMm(shown, unit, precision)}
      </span>
      {renovationAction}
      <button
        type="button"
        className="bb-workspace-tool-button"
        data-testid="opening-inspector-delete"
        onClick={onDelete}
      >
        {STRINGS.delete}
      </button>
    </section>
  )
}
