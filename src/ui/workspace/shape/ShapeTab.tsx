/**
 * The Shape tab (#58 §4): every parameter of the Item Footprint, in the Project's display unit.
 *
 * The form is a description of the eight presets, not a switch over field widgets: each preset
 * gets exactly the fields the issue names for it, in that order, and nothing else. A Rectangle
 * with a `Corner radius` row would be a lie about the shape in hand, which is the same mistake
 * the Convert warning goes out of its way not to make.
 *
 * Every field previews as it is typed and commits on Enter or blur, and Esc reverts it — but
 * "commits" here means *proposes*. The field hands the new footprint to the controller, and the
 * controller decides whether anything may be written. That is why a field can hold `-5` and
 * still be marked invalid rather than refusing the keystroke: refusing it would leave the
 * person wondering what happened, which is exactly what §6 is about.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { PRESET_NAMES, footprintCentre } from '../../../domain'
import { STRINGS } from '../../strings'
import { formatMm, parseToMm } from '../displayUnits'
import type { DisplayFormat, ItemFootprint } from '../../../domain'
import { regularPolygonMetrics } from '../../../derive'
import type { Preset, RoundedRectanglePreset } from '../../../derive'
import { apexOffsetOf, endRadiusOf, radiiOf, withParameter, withPerCornerRadii, withUniformRadius } from './parameters'
import type { ShapeFieldId } from './parameters'

export interface ShapeTabProps {
  /** The footprint the fields read: the proposal while one is up, the committed shape otherwise. */
  readonly footprint: ItemFootprint
  readonly format: DisplayFormat
  /** The field the controller has marked, or `null` (#58 criterion 8). */
  readonly invalidField: string | null
  /**
   * The one sentence, shown under the marked field. A canvas gesture has no field, so its
   * sentence goes to the draft bar instead and this is `null` — there is never a second one.
   */
  readonly invalidMessage: string | null
  /** A cabinet's footprint is derived: the fields are shown and read-only (#58 criterion 18). */
  readonly readOnly: boolean
  /**
   * Put a footprint on screen as a proposal, naming the field that produced it so the message
   * can be shown under that field. `null` for a structural edit — the corner-radius toggle —
   * which has no one field to mark. `final` is Enter, a blur or a click, as opposed to a
   * keystroke: only a final gesture is allowed to reach the model, and only if the controller
   * accepts the shape.
   */
  readonly onGesture: (footprint: ItemFootprint, field: ShapeFieldId | null, final: boolean) => void
  readonly onDiscard: () => void
  readonly onConvert: () => void
}

export function ShapeTab(props: ShapeTabProps): ReactNode {
  const { footprint, format, invalidField, invalidMessage, readOnly } = props
  const preset = footprint.kind === 'preset' ? footprint.preset : null
  const centre = footprintCentre(footprint)
  const orientationDeg = footprint.kind === 'preset' ? footprint.orientationDeg : 0

  /** One field, proposed through the controller rather than written. */
  const propose = (field: ShapeFieldId, value: number, final: boolean): void => {
    props.onGesture(withParameter(footprint, field, value), field, final)
  }

  /** The sentence, once, under whichever row is marked. */
  const problem = (id: ShapeFieldId): ReactNode =>
    invalidField === id && invalidMessage !== null ? <Problem message={invalidMessage} /> : null

  return (
    <div className="bb-shape-tab" data-testid="shape-tab">
      <p className="bb-shape-kind" data-testid="shape-kind">
        {preset === null ? STRINGS.customPath : PRESET_NAMES[preset.kind]}
      </p>

      {/* A read-only Shape tab reports the shape, not where it is. Position belongs to the Placed
          Item and Orientation to the design, and the hosts that show these tabs read-only — the
          Floor inspector, a cabinet's Item Detail — already say both elsewhere. */}
      {!readOnly && (
        <>
          <ShapeField label={STRINGS.positionX} testId="shape-position-x" kind="mm" value={centre.x}
            format={format} invalid={invalidField === 'positionX'} readOnly={readOnly} problem={problem('positionX')}
            onPropose={(value, final) => propose('positionX', value, final)} onDiscard={props.onDiscard} />
          <ShapeField label={STRINGS.positionY} testId="shape-position-y" kind="mm" value={centre.y}
            format={format} invalid={invalidField === 'positionY'} readOnly={readOnly} problem={problem('positionY')}
            onPropose={(value, final) => propose('positionY', value, final)} onDiscard={props.onDiscard} />
        </>
      )}
      {preset !== null && !readOnly && (
        <ShapeField label={STRINGS.orientation} testId="shape-orientation" kind="deg" value={orientationDeg}
          format={format} invalid={invalidField === 'orientation'} readOnly={readOnly} problem={problem('orientation')}
          onPropose={(value, final) => propose('orientation', value, final)} onDiscard={props.onDiscard} />
      )}

      {preset !== null && (
        <PresetFields
          preset={preset}
          format={format}
          invalidField={invalidField}
          readOnly={readOnly}
          propose={propose}
          problem={problem}
          onDiscard={props.onDiscard}
          onToggleRadii={(perCorner) => {
            const next = perCorner ? withPerCornerRadii(footprint) : withUniformRadius(footprint, radiiOf(preset).topLeft)
            props.onGesture(next, null, true)
          }}
        />
      )}

      <button
        type="button"
        className="bb-shape-convert"
        data-testid="shape-convert"
        disabled={readOnly || preset === null}
        onClick={props.onConvert}
      >
        Convert to Custom Path…
      </button>
    </div>
  )
}

/** One row builder, so a preset's field list reads as a list. */
type FieldRow = (label: string, id: ShapeFieldId, value: number, kind?: 'mm' | 'count') => ReactNode

/** The preset's own parameters, in the order §4 lists them. */
function PresetFields(props: {
  preset: Preset
  format: DisplayFormat
  invalidField: string | null
  readOnly: boolean
  propose: (field: ShapeFieldId, value: number, final: boolean) => void
  problem: (field: ShapeFieldId) => ReactNode
  onDiscard: () => void
  onToggleRadii: (perCorner: boolean) => void
}): ReactNode {
  const { preset, format, invalidField, readOnly, propose, problem, onDiscard, onToggleRadii } = props
  const field = ((label: string, id: ShapeFieldId, value: number, kind: 'mm' | 'count' = 'mm') => (
    <ShapeField
      key={id}
      label={label}
      testId={`shape-${id}`}
      kind={kind}
      value={value}
      format={format}
      invalid={invalidField === id}
      readOnly={readOnly}
      problem={problem(id)}
      onPropose={(next, final) => propose(id, next, final)}
      onDiscard={onDiscard}
    />
  )) satisfies FieldRow

  switch (preset.kind) {
    case 'square':
      return field(STRINGS.side, 'side', preset.side)
    case 'rectangle':
      return (
        <>
          {field(STRINGS.width, 'width', preset.width)}
          {field(STRINGS.depth, 'depth', preset.depth)}
        </>
      )
    case 'roundedRectangle':
      return <RoundedRectangleFields preset={preset} field={field} onToggle={onToggleRadii} />
    case 'circle':
      return field(STRINGS.diameter, 'diameter', preset.diameter)
    case 'ellipse':
      return (
        <>
          {field(STRINGS.width, 'width', preset.width)}
          {field(STRINGS.depth, 'depth', preset.depth)}
        </>
      )
    case 'capsule':
      return (
        <>
          {field(STRINGS.length, 'length', preset.length)}
          {field(STRINGS.width, 'width', preset.width)}
          <ReadOnlyField label={STRINGS.endRadius} testId="shape-end-radius" value={endRadiusOf(preset)} format={format} />
        </>
      )
    case 'triangle':
      return (
        <>
          {field(STRINGS.baseWidth, 'baseWidth', preset.baseWidth)}
          {field(STRINGS.depth, 'depth', preset.depth)}
          {field(STRINGS.apexOffset, 'apexOffset', apexOffsetOf(preset))}
        </>
      )
    case 'regularPolygon': {
      const spread = regularPolygonMetrics(preset.sideCount, preset.sideLength)
      return (
        <>
          {field(STRINGS.sides, 'sides', preset.sideCount, 'count')}
          {field(STRINGS.sideLength, 'sideLength', preset.sideLength)}
          <ReadOnlyField label={STRINGS.acrossCorners} testId="shape-across-corners" value={spread.acrossCorners} format={format} />
          <ReadOnlyField label={STRINGS.acrossFlats} testId="shape-across-flats" value={spread.acrossFlats} format={format} />
        </>
      )
    }
  }
}

/**
 * The Rounded Rectangle's radii: one shared field, or four, on a toggle.
 *
 * Turning the toggle off sets all four to the top-left, which is what the issue asks for and
 * what the eye expects — the top-left is the field that was still showing a number. Turning it
 * on keeps the four the shape already had, so the toggle is reversible rather than destructive.
 * It is a structural edit rather than a value, so it proposes the footprint directly and marks
 * no field.
 */
function RoundedRectangleFields(props: {
  preset: RoundedRectanglePreset
  field: FieldRow
  onToggle: (perCorner: boolean) => void
}): ReactNode {
  const { preset, field, onToggle } = props
  const radii = radiiOf(preset)
  const perCorner = preset.radii !== undefined
  return (
    <>
      {field(STRINGS.width, 'width', preset.width)}
      {field(STRINGS.depth, 'depth', preset.depth)}
      {perCorner ? (
        <>
          {field(STRINGS.originTopLeft, 'topLeft', radii.topLeft)}
          {field(STRINGS.originTopRight, 'topRight', radii.topRight)}
          {field(STRINGS.originBottomRight, 'bottomRight', radii.bottomRight)}
          {field(STRINGS.originBottomLeft, 'bottomLeft', radii.bottomLeft)}
        </>
      ) : (
        field(STRINGS.cornerRadius, 'radius', preset.radius ?? 0)
      )}
      <label className="bb-shape-toggle" htmlFor="shape-per-corner-radii">
        <input
          id="shape-per-corner-radii"
          type="checkbox"
          data-testid="shape-per-corner-radii"
          checked={perCorner}
          onChange={(event) => onToggle(event.target.checked)}
        />
        <span>{STRINGS.perCornerRadii}</span>
      </label>
    </>
  )
}

/**
 * One number field: the person's text while typing, the footprint's value otherwise.
 *
 * A keystroke previews and an Enter, a blur or a Tab commits — which is the difference between
 * watching a shape change and being asked to accept one. Both go through the controller, so
 * neither can write to the model on its own.
 */
function ShapeField(props: {
  label: string
  testId: string
  kind: 'mm' | 'deg' | 'count'
  value: number
  format: DisplayFormat
  invalid: boolean
  readOnly: boolean
  /** The sentence, when this is the marked row; `null` for every other row. */
  problem: ReactNode
  onPropose: (value: number, final: boolean) => void
  onDiscard: () => void
}): ReactNode {
  const { label, testId, kind, value, format, invalid, readOnly, problem } = props
  const [text, setText] = useState<string | null>(null)
  useEffect(() => { setText(null) }, [value])

  const shown = kind === 'mm'
    ? formatMm(value, format.unit, format.precision)
    : String(Math.round(value * 100) / 100)

  /** The number in the box, or `null` when it does not hold one yet — `""`, `-`, `1.`. */
  const parse = (raw: string): number | null => {
    if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(raw.trim())) return null
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return null
    // Only millimetres are rescaled. A count is passed through as typed rather than rounded to
    // the nearest whole one, because 3.5 sides is a mistake to be told about, not a 4 to be
    // given — and the kernel is the thing that says so, in the same sentence as 2 sides.
    return kind === 'mm' ? parseToMm(parsed, format.unit) : parsed
  }

  return (
    <div className="bb-shape-row" data-testid={`${testId}-row`} data-invalid={invalid ? 'true' : 'false'}>
      <label className="bb-shape-row-label" htmlFor={`${testId}-input`} data-testid={`${testId}-label`}>
        {label}
        {kind === 'mm' && <> <span className="bb-workspace-unit-suffix">({format.unit})</span></>}
      </label>
      <input
        id={`${testId}-input`}
        data-testid={testId}
        className="bb-workspace-input"
        type="number"
        step={kind === 'count' ? '1' : 'any'}
        readOnly={readOnly}
        aria-invalid={invalid ? 'true' : 'false'}
        value={text ?? shown}
        onChange={(event) => {
          setText(event.target.value)
          const parsed = parse(event.target.value)
          if (parsed !== null) props.onPropose(parsed, false)
        }}
        onBlur={(event) => {
          const parsed = parse(event.target.value)
          if (parsed !== null) props.onPropose(parsed, true)
          setText(null)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            const parsed = parse(event.currentTarget.value)
            if (parsed !== null) props.onPropose(parsed, true)
            setText(null)
          }
          if (event.key === 'Escape') {
            setText(null)
            props.onDiscard()
          }
        }}
      />
      {problem}
    </div>
  )
}

/**
 * The one sentence about a proposal that will not commit.
 *
 * It carries no coordinates: the canvas marks the place, and a sentence that repeats them
 * differently is a second thing to disagree about. `shape-problem-message` is the same test id
 * the draft bar uses, because there is exactly one of them on screen and a test that counts
 * them is the cheapest way to keep it that way.
 */
function Problem(props: { message: string }): ReactNode {
  return (
    <p className="bb-shape-problem" data-testid="shape-problem-message">
      {props.message}
    </p>
  )
}

/** A derived number the person can read but not set: `End radius`, `Across flats`. */
function ReadOnlyField(props: { label: string; testId: string; value: number; format: DisplayFormat }): ReactNode {
  return (
    <div className="bb-shape-row" data-readonly="true">
      <span className="bb-shape-row-label" data-testid={`${props.testId}-label`}>
        {props.label} <span className="bb-workspace-unit-suffix">({props.format.unit})</span>
      </span>
      <span className="bb-shape-static" data-testid={props.testId}>
        {formatMm(props.value, props.format.unit, props.format.precision)}
      </span>
    </div>
  )
}
