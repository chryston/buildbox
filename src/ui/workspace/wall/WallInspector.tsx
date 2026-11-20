/**
 * The Wall inspector (#64 §14): one Wall's own numbers, in the Project's display unit.
 *
 * Length, Radius and Thickness commit as they stand — each is one Intent, one Edit Transaction
 * (#26). Height is read-only: a Wall's Vertical Extent is edited in S9 (#74), and saying so next
 * to a number that cannot be changed is honest in a way a disabled field with no explanation is
 * not.
 *
 * Nothing here says `L`, `R`, `left` or `right` (#64 D6). Justification is a fact about the
 * reference line's own direction, which a person reading a plan does not have, so it is shown in
 * the words the issue gives it — `Centre`, `Face on this side`, `Face on the other side` — and
 * the offset asks for its side the same way.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { DerivedWall } from '../../../derive'
import type { DisplayUnit, EntityId, Wall } from '../../../domain'
import { NumberField } from '../SelectionInspector'
import { ToolbarMenu } from '../WorkspaceToolbar'
import { circleThrough } from './wallDraft'

export interface WallInspectorProps {
  wall: Wall
  /** The same Wall after clean-up: the length the plan actually shows. */
  derived: DerivedWall
  /** The Wall a two-end Junction joins to this one in a straight line, if any. */
  mergeableWith: { id: EntityId; ref: string } | null
  unit: DisplayUnit
  precision: number
  onSetLength: (length: number) => void
  onSetRadius: (radius: number) => void
  onSetThickness: (thickness: number) => void
  onOffset: (distance: number, side: 'left' | 'right') => void
  onSplit: () => void
  onMerge: (otherId: EntityId) => void
  onDelete: () => void
}

/** Grouped thousands, as the issue writes a height: `2,600 mm`. */
const grouped = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 })

/** The justification in the words a plan reader has, never the data's own names. */
const JUSTIFICATION_WORDS: Record<Wall['justification'], string> = {
  centre: 'Centre',
  left: 'Face on this side',
  right: 'Face on the other side',
}

const CLASSIFICATION_WORDS: Record<NonNullable<Wall['classification']>, string> = {
  external: 'External',
  internal: 'Internal',
  partition: 'Partition',
}

function Row(props: { testId: string; label: string; value: string }): ReactNode {
  return (
    <>
      <span className="bb-workspace-field-label" data-testid={`${props.testId}-label`}>{props.label}</span>
      <span className="bb-workspace-static-value" data-testid={props.testId}>{props.value}</span>
    </>
  )
}

export function WallInspector(props: WallInspectorProps): ReactNode {
  const {
    wall, derived, mergeableWith, unit, precision,
    onSetLength, onSetRadius, onSetThickness, onOffset, onSplit, onMerge, onDelete,
  } = props
  const [offsetText, setOffsetText] = useState('')
  const [offsetSide, setOffsetSide] = useState<'left' | 'right'>('left')
  const line = wall.line
  const isArc = line.kind === 'arc'
  const radius = isArc ? circleThrough(line.start, line.through, line.end)?.radius ?? null : null

  return (
    <section className="bb-workspace-card" data-testid="wall-inspector">
      <h3 className="bb-workspace-card-title" data-testid="wall-inspector-ref">{wall.ref}</h3>
      <Row testId="wall-shape" label="Shape" value={isArc ? 'Arc' : 'Straight'} />
      <NumberField
        label="Length"
        testId="wall-length"
        value={derived.length}
        kind="mm"
        unit={unit}
        precision={precision}
        min={1}
        onCommit={onSetLength}
      />
      {isArc && radius !== null && (
        <NumberField
          label="Radius"
          testId="wall-radius"
          value={radius}
          kind="mm"
          unit={unit}
          precision={precision}
          min={1}
          onCommit={onSetRadius}
        />
      )}
      <NumberField
        label="Thickness"
        testId="wall-thickness"
        value={wall.thickness}
        kind="mm"
        unit={unit}
        precision={precision}
        min={1}
        onCommit={onSetThickness}
      />
      <Row testId="wall-height" label="Height" value={`${grouped.format(wall.height)} mm`} />
      <ToolbarMenu label="More options" testId="wall-inspector-more">
        <Row testId="wall-justification" label="Justification" value={JUSTIFICATION_WORDS[wall.justification]} />
        <Row
          testId="wall-classification"
          label="Classification"
          value={wall.classification === undefined ? 'None' : CLASSIFICATION_WORDS[wall.classification]}
        />
        <Row
          testId="wall-construction-label"
          label="Construction label"
          value={wall.constructionLabel ?? 'None'}
        />
        <div data-testid="wall-offset">
          <label className="bb-workspace-field-label" htmlFor="wall-offset-field">
            Offset wall by <span className="bb-workspace-unit-suffix">(mm)</span>
          </label>
          <input
            id="wall-offset-field"
            data-testid="wall-offset-field"
            type="number"
            value={offsetText}
            onChange={(event) => setOffsetText(event.target.value)}
          />
          <select
            data-testid="wall-offset-side"
            aria-label="Which side to offset toward"
            value={offsetSide}
            onChange={(event) => setOffsetSide(event.target.value as 'left' | 'right')}
          >
            <option value="left">Toward this side</option>
            <option value="right">Toward the other side</option>
          </select>
          <button
            type="button"
            data-testid="wall-offset-apply"
            className="bb-workspace-tool-button"
            disabled={offsetText === '' || !Number.isFinite(Number(offsetText))}
            onClick={() => {
              onOffset(Number(offsetText), offsetSide)
              setOffsetText('')
            }}
          >
            Offset
          </button>
        </div>
      </ToolbarMenu>
      <div className="flex items-center gap-2">
        <button type="button" data-testid="wall-split" className="bb-workspace-tool-button" onClick={onSplit}>
          Split
        </button>
        <button
          type="button"
          data-testid="wall-merge"
          className="bb-workspace-tool-button"
          disabled={mergeableWith === null}
          title={mergeableWith === null ? 'No Wall to merge with here' : undefined}
          onClick={() => {
            if (mergeableWith !== null) onMerge(mergeableWith.id)
          }}
        >
          {mergeableWith === null ? 'Merge with…' : `Merge with ${mergeableWith.ref}`}
        </button>
        <button type="button" data-testid="wall-delete" className="bb-workspace-tool-button" onClick={onDelete}>
          Delete
        </button>
      </div>
    </section>
  )
}
