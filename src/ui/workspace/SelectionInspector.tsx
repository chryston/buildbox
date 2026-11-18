/**
 * The selection inspector (#55 criterion 5): the properties of the selected Placed
 * Item, in the Project's display unit.
 *
 * Sizes are shown through `displayUnits` — a 605.5 mm width reads `606` at mm / 0 dp —
 * and a typed number is read back through the same pair, so `60.55` cm is exactly
 * 605.5 mm. The display never rewrites the Project: the field keeps the person's text
 * while they type and dispatches one `plan.updateObject` on commit.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { DisplayUnit } from '../../domain'
import { PLAN_SWATCHES } from './planColors'
import { formatMm, parseToMm } from './displayUnits'
import type { PlanItemView } from './planModel'

/** The smallest footprint the handlers accept (`MIN_PLAN_SIZE_MM`). */
const MIN_SIZE_MM = 50

export interface PlanObjectPatch {
  label?: string
  w?: number
  h?: number
  rotation?: number
  color?: string
}

export interface SelectionInspectorProps {
  item: PlanItemView | null
  unit: DisplayUnit
  precision: number
  onUpdate: (patch: PlanObjectPatch) => void
  onDelete: () => void
}

export function SelectionInspector(props: SelectionInspectorProps): ReactNode {
  const { item, unit, precision } = props
  // No selection: the rail simply has no inspector, per the issue's layout.
  if (item === null) return null
  return <ItemEditor key={item.id} {...props} item={item} unit={unit} precision={precision} />
}

/** One size field: the person's text while typing, the Project's value otherwise. */
function SizeField(props: {
  label: string
  testId: string
  mm: number
  unit: DisplayUnit
  precision: number
  onCommit: (mm: number) => void
}): ReactNode {
  const { label, testId, mm, unit, precision, onCommit } = props
  const shown = formatMm(mm, unit, precision)
  const [text, setText] = useState<string | null>(null)

  useEffect(() => { setText(null) }, [mm])

  const commit = (): void => {
    if (text === null) return
    const parsed = Number(text)
    if (Number.isFinite(parsed)) {
      const mmValue = Math.max(MIN_SIZE_MM, parseToMm(parsed, unit))
      onCommit(mmValue)
      if (formatMm(mmValue, unit, precision) === shown) setText(null)
    } else {
      setText(null)
    }
  }

  return (
    <>
      <label className="bb-workspace-field-label" htmlFor={`${testId}-label`}>
        {label} <span className="bb-workspace-unit-suffix">({unit})</span>
      </label>
      <input
        id={`${testId}-label`}
        data-testid={testId}
        className="bb-workspace-input"
        type="number"
        step="any"
        value={text ?? shown}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
        }}
      />
    </>
  )
}

function ItemEditor(props: SelectionInspectorProps & { item: PlanItemView }): ReactNode {
  const { item, unit, precision, onUpdate, onDelete } = props
  return (
    <section className="bb-workspace-card" data-testid="selection-inspector">
      <h3 className="bb-workspace-card-title">Selection</h3>
      <label className="bb-workspace-field-label" htmlFor="inspector-label-input">Label</label>
      <input
        id="inspector-label-input"
        data-testid="inspector-label"
        className="bb-workspace-input"
        type="text"
        value={item.label}
        onChange={(event) => onUpdate({ label: event.target.value })}
      />
      <SizeField
        label="Width"
        testId="inspector-width"
        mm={item.w}
        unit={unit}
        precision={precision}
        onCommit={(w) => onUpdate({ w })}
      />
      <SizeField
        label="Depth"
        testId="inspector-depth"
        mm={item.h}
        unit={unit}
        precision={precision}
        onCommit={(h) => onUpdate({ h })}
      />
      <label className="bb-workspace-field-label">Rotation: {item.rotationDeg}°</label>
      <button
        type="button"
        data-testid="rotate-90"
        className="bb-workspace-tool-button"
        onClick={() => onUpdate({ rotation: (item.rotationDeg + 90) % 360 })}
      >
        Rotate 90°
      </button>
      <label className="bb-workspace-field-label">Colour</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {PLAN_SWATCHES.map((color) => (
          <button
            key={color}
            type="button"
            data-testid={`swatch-${color}`}
            aria-label={`Colour ${color}`}
            aria-pressed={item.color === color ? 'true' : 'false'}
            className="bb-workspace-swatch"
            style={{ background: color }}
            onClick={() => onUpdate({ color })}
          />
        ))}
      </div>
      <div style={{ marginTop: 12 }}>
        <button
          type="button"
          data-testid="delete-object"
          className="bb-workspace-danger-button"
          onClick={onDelete}
        >
          Delete
        </button>
      </div>
    </section>
  )
}
