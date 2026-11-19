/**
 * The Edges tab (#58 §4, #59 §3 and §4): the Item Footprint read as the Edges it is made of,
 * and the place those Edges are edited.
 *
 * Two rules shape the whole file.
 *
 * **A field holds the exact number, not the displayed one.** A length typed as `2700.25` is
 * stored as `2700.25` and shown in the table as `2,700`; blurring the field without touching it
 * therefore writes the same number back, which is the difference between a quiet editor and one
 * that leaves an undo step behind every click elsewhere (#59 criterion 11). Display rounding is
 * a readout concern and never reaches the model.
 *
 * **Nothing here commits.** Every change goes to the shared controller as a gesture, final only
 * on Enter or blur, so a design with more than one placement still goes through `Affects N
 * placements`, a bad edit is previewed red rather than applied, and Esc restores what was there.
 * A preset's Edges are read for the same reason its handles are absent: there is no chain to
 * move without deciding what the preset was.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  distance,
  directionDeg,
  editArc,
  editEllipticalArc,
  editLineEdge,
  fillet,
  isTangentFillet,
  lengthOf,
  roundAllCorners,
  segmentStart,
  setFilletRadius,
} from '../../../derive'
import type { ClosedPath, KeepFixed, Segment } from '../../../derive'
import type { ItemFootprint } from '../../../domain'
import type { DisplayFormat } from '../../../domain'
import { parseToMm, readoutMm } from '../displayUnits'
import type { ShapeFieldId } from './parameters'
import type { ShapeSelection } from '../workspaceStore'

/** What one edge is called in the table, in the words the issue uses. */
const EDGE_KIND_NAMES: Record<Segment['kind'], string> = {
  line: 'Line',
  arc: 'Arc',
  ellipticalArc: 'Elliptical arc',
}

export interface EdgesTabProps {
  /** The Edges as they are on screen: the proposal while one is up, the committed shape after. */
  readonly path: ClosedPath
  readonly format: DisplayFormat
  /** One Edge, one vertex, or nothing. Lives in the workspace store so the canvas agrees. */
  readonly selection?: ShapeSelection
  /** The field the controller says is at fault, or `null` when the problem has no field. */
  readonly invalidField?: string | null
  /** The one message, or `null`. It sits under the field at fault and nowhere else. */
  readonly invalidMessage?: string | null
  /** A cabinet's Item Footprint, or a design the person may not edit. */
  readonly readOnly?: boolean
  /**
   * Whether the Edges may be written at all: only a Custom Path has a chain to move. Everything
   * below it is optional for the same reason — a preset's Edges are a readout, and a readout
   * needs no selection, no controller and nothing to discard.
   */
  readonly editable?: boolean
  readonly onSelect?: (selection: ShapeSelection) => void
  /** `null` field is a control with no field of its own — `Flip`, `Round all corners`. */
  readonly onGesture?: (footprint: ItemFootprint, field: ShapeFieldId | null, final: boolean) => void
  /** Esc: put back what was there. */
  readonly onDiscard?: () => void
}

/** A number a field can hold: exact to the nanometre, no grouping, no unit. */
const exact = (mm: number): string => String(Number(mm.toFixed(6)))

const NOTHING = (): void => undefined

export function EdgesTab(props: EdgesTabProps): ReactNode {
  const {
    path,
    format,
    selection = null,
    invalidField = null,
    invalidMessage = null,
    readOnly = false,
    editable = false,
    onSelect = NOTHING,
    onGesture = NOTHING,
    onDiscard = NOTHING,
  } = props
  const read = (mm: number): string => readoutMm(mm, format.unit, format.precision)

  const [keepFixed, setKeepFixed] = useState<KeepFixed>('start')
  const selectedEdge = selection !== null && 'edge' in selection ? selection.edge : null
  const selectedVertex = selection !== null && 'vertex' in selection ? selection.vertex : null
  const segment = selectedEdge === null ? null : path.segments[selectedEdge - 1] ?? null
  /** A tangent fillet is a corner being worn as an arc: it is edited as a corner, not as an arc. */
  const filletEdge = selectedEdge !== null && isTangentFillet(path, selectedEdge) ? selectedEdge : null

  /**
   * The corner field's subject: the vertex a vertex selection names, or the corner a selected
   * tangent fillet is sitting in. One field for both because they are the same question — "how
   * round is this corner" — and answering it for a fillet re-trims its neighbours instead of
   * cutting a second arc into a corner that is already round.
   */
  const corner = filletEdge === null
    ? selectedVertex === null
      ? null
      : { prefill: 0, edge: null as number | null, vertex: selectedVertex }
    : { prefill: curveRadius(path.segments[filletEdge - 1]), edge: filletEdge, vertex: null as number | null }

  const apply = (result: { path: ClosedPath }, field: ShapeFieldId | null, final: boolean): void => {
    onGesture({ kind: 'path', path: result.path }, field, final)
  }

  return (
    <div className="bb-edges-tab" data-testid="edges-tab">
      {corner !== null && editable && (
        <NumberField
          label="Corner radius"
          testId="edge-corner-radius"
          format={format}
          initial={corner.prefill}
          invalid={invalidField === 'cornerRadius'}
          message={invalidField === 'cornerRadius' ? invalidMessage : null}
          disabled={readOnly}
          onGesture={(mm, final) => apply(
            corner.edge === null
              ? fillet(path, corner.vertex ?? 1, mm)
              : setFilletRadius(path, corner.edge, mm),
            'cornerRadius',
            final,
          )}
          onDiscard={onDiscard}
        />
      )}
      {editable && (
        <RoundAllCorners path={path} format={format} readOnly={readOnly} onGesture={onGesture} />
      )}
      <table className="bb-edges-table">
        <caption className="bb-edges-caption">
          {editable ? 'Select an Edge to edit it, or a vertex to round its corner.' : 'Edges are read-only on a preset Item Footprint.'}
        </caption>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Kind</th>
            <th scope="col">Length</th>
            <th scope="col">{path.segments.some(isCurved) ? 'Radius' : 'Direction'}</th>
          </tr>
        </thead>
        <tbody>
          {path.segments.map((each, index) => {
            const from = segmentStart(path, index)
            const row = index + 1
            const isSelected = selectedEdge === row
            return (
              <tr
                key={index}
                data-testid={`edge-row-${row}`}
                data-selected={isSelected ? 'true' : 'false'}
                aria-selected={isSelected ? 'true' : 'false'}
                tabIndex={editable ? 0 : -1}
                onClick={() => onSelect(isSelected ? null : { edge: row })}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  onSelect(isSelected ? null : { edge: row })
                }}
              >
                <td>{row}</td>
                <td data-testid={`edge-kind-${row}`}>{EDGE_KIND_NAMES[each.kind]}</td>
                <td data-testid={`edge-length-${row}`}>{read(lengthOf(each, from))}</td>
                <td data-testid={`edge-measure-${row}`}>
                  {each.kind === 'line'
                    ? `${trimDeg(directionDeg(each, from))}°`
                    : read(curveRadius(each))}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {selectedEdge !== null && segment !== null && (
        <div className="bb-edge-editor" data-testid={`edge-editor-${selectedEdge}`}>
          <p className="bb-edge-editor-heading">
            {`Edge ${selectedEdge} · ${EDGE_KIND_NAMES[segment.kind]}`}
          </p>
          {segment.kind === 'line' && (
            <LineEditor
              path={path}
              edge={selectedEdge}
              format={format}
              keepFixed={keepFixed}
              onKeepFixed={setKeepFixed}
              invalidField={invalidField}
              invalidMessage={invalidMessage}
              readOnly={readOnly}
              onGesture={onGesture}
              onDiscard={onDiscard}
            />
          )}
          {segment.kind === 'arc' && (
            <ArcEditor
              path={path}
              edge={selectedEdge}
              format={format}
              invalidField={invalidField}
              invalidMessage={invalidMessage}
              readOnly={readOnly}
              onGesture={onGesture}
              onDiscard={onDiscard}
            />
          )}
          {segment.kind === 'ellipticalArc' && (
            <EllipticalEditor
              path={path}
              edge={selectedEdge}
              format={format}
              invalidField={invalidField}
              invalidMessage={invalidMessage}
              readOnly={readOnly}
              onGesture={onGesture}
              onDiscard={onDiscard}
            />
          )}
        </div>
      )}
    </div>
  )
}

const isCurved = (segment: Segment): boolean => segment.kind !== 'line'

/** The radius of a curved edge: an Arc has one, an elliptical arc has two and the X one leads. */
function curveRadius(segment: Segment): number {
  if (segment.kind === 'arc') return distance(segment.center, segment.to)
  if (segment.kind === 'ellipticalArc') return segment.rx
  return 0
}

/** `37.5` reads `37.5`, `90` reads `90` — a direction is not a distance, so no unit dp. */
function trimDeg(value: number): string {
  return String(Math.round(((value % 360) + 360) % 360 * 10) / 10)
}

/**
 * One numeric field: exact millimetres in the box, a gesture out.
 *
 * It re-seeds itself from `initial` whenever the shape underneath it changes, which is what lets
 * Esc restore a value the component never had to remember — the controller drops the proposal,
 * `initial` comes back the old number, and the box follows.
 */
function NumberField(props: {
  readonly label: string
  readonly testId: string
  readonly format: DisplayFormat
  readonly initial: number
  readonly invalid: boolean
  readonly message: string | null
  readonly disabled: boolean
  readonly onGesture: (mm: number, final: boolean) => void
  readonly onDiscard: () => void
  readonly suffix?: boolean
}): ReactNode {
  const { label, testId, initial, invalid, message, disabled, onGesture, onDiscard } = props
  const [text, setText] = useState(exact(initial))
  const [seed, setSeed] = useState(initial)
  if (seed !== initial) {
    setSeed(initial)
    setText(exact(initial))
  }

  /**
   * Enter and blur send what is in the box; a box that parses to the number it already holds
   * sends nothing at all, so clicking away from a field cannot leave an undo step behind.
   */
  const commit = (): void => {
    const mm = parseToMm(Number(text), 'mm')
    if (!Number.isFinite(mm)) return
    onGesture(mm, true)
  }

  return (
    <div className="bb-edge-field" data-testid={`${testId}-row`}>
      <label className="bb-edge-field-label" htmlFor={testId}>{label}</label>
      <input
        id={testId}
        className="bb-edge-field-input"
        data-testid={testId}
        type="text"
        inputMode="decimal"
        value={text}
        disabled={disabled}
        aria-invalid={invalid ? 'true' : 'false'}
        onChange={(event) => {
          setText(event.target.value)
          const mm = parseToMm(Number(event.target.value), 'mm')
          if (Number.isFinite(mm)) onGesture(mm, false)
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
            return
          }
          if (event.key === 'Escape') {
            event.stopPropagation()
            setText(exact(initial))
            onDiscard()
          }
        }}
      />
      {message !== null && <p className="bb-edge-field-message" data-testid={`${testId}-message`}>{message}</p>}
    </div>
  )
}

/** A degrees field: the same box, without the display unit's millimetre scaling. */
function AngleField(props: {
  readonly label: string
  readonly testId: string
  readonly initial: number
  readonly invalid: boolean
  readonly message: string | null
  readonly disabled: boolean
  readonly onGesture: (deg: number, final: boolean) => void
  readonly onDiscard: () => void
}): ReactNode {
  const { label, testId, initial, invalid, message, disabled, onGesture, onDiscard } = props
  const [text, setText] = useState(exact(initial))
  const [seed, setSeed] = useState(initial)
  if (seed !== initial) {
    setSeed(initial)
    setText(exact(initial))
  }
  const value = (): number => Number(text)
  return (
    <div className="bb-edge-field" data-testid={`${testId}-row`}>
      <label className="bb-edge-field-label" htmlFor={testId}>{label}</label>
      <input
        id={testId}
        className="bb-edge-field-input"
        data-testid={testId}
        type="text"
        inputMode="decimal"
        value={text}
        disabled={disabled}
        aria-invalid={invalid ? 'true' : 'false'}
        onChange={(event) => {
          setText(event.target.value)
          if (Number.isFinite(Number(event.target.value))) onGesture(Number(event.target.value), false)
        }}
        onBlur={() => {
          if (Number.isFinite(value())) onGesture(value(), true)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            if (Number.isFinite(value())) onGesture(value(), true)
            return
          }
          if (event.key === 'Escape') {
            event.stopPropagation()
            setText(exact(initial))
            onDiscard()
          }
        }}
      />
      {message !== null && <p className="bb-edge-field-message" data-testid={`${testId}-message`}>{message}</p>}
    </div>
  )
}

/** `Keep fixed: start | end`, a segmented control rather than a select: two choices, both visible. */
function KeepFixedControl(props: {
  readonly value: KeepFixed
  readonly disabled: boolean
  readonly onChange: (value: KeepFixed) => void
}): ReactNode {
  return (
    <div className="bb-edge-segmented" role="group" aria-label="Keep fixed" data-testid="edge-keep-fixed">
      <span className="bb-edge-field-label" aria-hidden="true">Keep fixed</span>
      {(['start', 'end'] as const).map((choice) => (
        <button
          key={choice}
          type="button"
          data-testid={`edge-keep-fixed-${choice}`}
          className="bb-workspace-tool-button"
          aria-pressed={props.value === choice ? 'true' : 'false'}
          disabled={props.disabled}
          onClick={() => props.onChange(choice)}
        >
          {choice}
        </button>
      ))}
    </div>
  )
}

/** `Flip` is a command, not a value: it mirrors the bulge across the chord and leaves nothing typed. */
function FlipButton(props: {
  readonly disabled: boolean
  readonly onFlip: () => void
}): ReactNode {
  return (
    <button
      type="button"
      data-testid="edge-flip"
      className="bb-workspace-secondary-button"
      disabled={props.disabled}
      onClick={props.onFlip}
    >
      Flip
    </button>
  )
}

interface EditorProps {
  readonly path: ClosedPath
  readonly edge: number
  readonly format: DisplayFormat
  readonly invalidField: string | null
  readonly invalidMessage: string | null
  readonly readOnly: boolean
  readonly onGesture: (footprint: ItemFootprint, field: ShapeFieldId | null, final: boolean) => void
  readonly onDiscard: () => void
}

function LineEditor(props: EditorProps & {
  readonly keepFixed: KeepFixed
  readonly onKeepFixed: (value: KeepFixed) => void
}): ReactNode {
  const { path, edge, format, invalidField, invalidMessage, readOnly, onGesture, onDiscard, keepFixed } = props
  const segment = path.segments[edge - 1]
  if (segment.kind !== 'line') return null
  const from = segmentStart(path, edge - 1)
  const say = (field: ShapeFieldId, change: { length?: number; directionDeg?: number }, final: boolean): void => {
    onGesture({ kind: 'path', path: editLineEdge(path, edge, change, keepFixed).path }, field, final)
  }
  return (
    <>
      <NumberField
        label="Length"
        testId="edge-length-field"
        format={format}
        initial={lengthOf(segment, from)}
        invalid={invalidField === 'edgeLength'}
        message={invalidField === 'edgeLength' ? invalidMessage : null}
        disabled={readOnly}
        onGesture={(mm, final) => say('edgeLength', { length: mm }, final)}
        onDiscard={onDiscard}
      />
      <AngleField
        label="Direction"
        testId="edge-direction-field"
        initial={directionDeg(segment, from)}
        invalid={invalidField === 'edgeDirection'}
        message={invalidField === 'edgeDirection' ? invalidMessage : null}
        disabled={readOnly}
        onGesture={(deg, final) => say('edgeDirection', { directionDeg: deg }, final)}
        onDiscard={onDiscard}
      />
      <KeepFixedControl value={keepFixed} disabled={readOnly} onChange={props.onKeepFixed} />
    </>
  )
}

function ArcEditor(props: EditorProps): ReactNode {
  const { path, edge, format, invalidField, invalidMessage, readOnly, onGesture, onDiscard } = props
  const segment = path.segments[edge - 1]
  if (segment.kind !== 'arc') return null
  const say = (field: ShapeFieldId | null, change: { radius?: number; sweepDeg?: number; flip?: boolean }, final: boolean): void => {
    onGesture({ kind: 'path', path: editArc(path, edge, change).path }, field, final)
  }
  return (
    <>
      <NumberField
        label="Radius"
        testId="edge-radius-field"
        format={format}
        initial={distance(segment.center, segment.to)}
        invalid={invalidField === 'arcRadius'}
        message={invalidField === 'arcRadius' ? invalidMessage : null}
        disabled={readOnly}
        onGesture={(mm, final) => say('arcRadius', { radius: mm }, final)}
        onDiscard={onDiscard}
      />
      <AngleField
        label="Sweep"
        testId="edge-sweep-field"
        initial={segment.sweepDeg}
        invalid={invalidField === 'arcSweep'}
        message={invalidField === 'arcSweep' ? invalidMessage : null}
        disabled={readOnly}
        onGesture={(deg, final) => say('arcSweep', { sweepDeg: deg }, final)}
        onDiscard={onDiscard}
      />
      <FlipButton disabled={readOnly} onFlip={() => say(null, { flip: true }, true)} />
    </>
  )
}

function EllipticalEditor(props: EditorProps): ReactNode {
  const { path, edge, format, invalidField, invalidMessage, readOnly, onGesture, onDiscard } = props
  const segment = path.segments[edge - 1]
  if (segment.kind !== 'ellipticalArc') return null
  const say = (field: ShapeFieldId | null, change: { rx?: number; ry?: number; rotationDeg?: number; sweepDeg?: number; flip?: boolean }, final: boolean): void => {
    onGesture({ kind: 'path', path: editEllipticalArc(path, edge, change).path }, field, final)
  }
  return (
    <>
      <NumberField
        label="Semi-axis A"
        testId="edge-semi-axis-a"
        format={format}
        initial={segment.rx}
        invalid={invalidField === 'semiAxisA'}
        message={invalidField === 'semiAxisA' ? invalidMessage : null}
        disabled={readOnly}
        onGesture={(mm, final) => say('semiAxisA', { rx: mm }, final)}
        onDiscard={onDiscard}
      />
      <NumberField
        label="Semi-axis B"
        testId="edge-semi-axis-b"
        format={format}
        initial={segment.ry}
        invalid={invalidField === 'semiAxisB'}
        message={invalidField === 'semiAxisB' ? invalidMessage : null}
        disabled={readOnly}
        onGesture={(mm, final) => say('semiAxisB', { ry: mm }, final)}
        onDiscard={onDiscard}
      />
      <AngleField
        label="Axis rotation"
        testId="edge-axis-rotation"
        initial={segment.rotationDeg}
        invalid={invalidField === 'axisRotation'}
        message={invalidField === 'axisRotation' ? invalidMessage : null}
        disabled={readOnly}
        onGesture={(deg, final) => say('axisRotation', { rotationDeg: deg }, final)}
        onDiscard={onDiscard}
      />
      <AngleField
        label="Sweep"
        testId="edge-sweep-field"
        initial={segment.sweepDeg}
        invalid={invalidField === 'arcSweep'}
        message={invalidField === 'arcSweep' ? invalidMessage : null}
        disabled={readOnly}
        onGesture={(deg, final) => say('arcSweep', { sweepDeg: deg }, final)}
        onDiscard={onDiscard}
      />
      <FlipButton disabled={readOnly} onFlip={() => say(null, { flip: true }, true)} />
    </>
  )
}

/**
 * `Round all corners`: one radius, one transaction.
 *
 * `roundAllCorners` either rounds every corner or returns the shape untouched with its problem,
 * so the field only ever proposes a whole rounding — a partial one would leave a person cleaning
 * up arcs they never asked for.
 */
function RoundAllCorners(props: {
  readonly path: ClosedPath
  readonly format: DisplayFormat
  readonly readOnly: boolean
  readonly onGesture: (footprint: ItemFootprint, field: ShapeFieldId | null, final: boolean) => void
}): ReactNode {
  const { path, format, readOnly, onGesture } = props
  const [text, setText] = useState('250')
  const radius = (): number => parseToMm(Number(text), format.unit)
  const run = (): void => {
    const mm = radius()
    if (!Number.isFinite(mm) || !(mm > 0)) return
    onGesture({ kind: 'path', path: roundAllCorners(path, mm).path }, 'cornerRadius', true)
  }
  return (
    <div className="bb-edge-field bb-edge-round-all" data-testid="edge-round-all-row">
      <label className="bb-edge-field-label" htmlFor="edge-round-all">Round all corners</label>
      <input
        id="edge-round-all"
        className="bb-edge-field-input"
        data-testid="edge-round-all"
        type="text"
        inputMode="decimal"
        value={text}
        disabled={readOnly}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          run()
        }}
      />
      <button
        type="button"
        data-testid="edge-round-all-apply"
        className="bb-workspace-secondary-button"
        disabled={readOnly}
        onClick={run}
      >
        Round all corners
      </button>
    </div>
  )
}
