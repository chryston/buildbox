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
import { STRINGS } from '../../strings'
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
  /**
   * Why Delete is out of action — a Room Edge stands on this Wall (#67 §12) — in the same words
   * the refused Intent answers with; nothing when the Wall may be deleted.
   */
  deleteBlocked: string | null
}

/** Grouped thousands, as the issue writes a height: `2,600 mm`. */
const grouped = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 })

/** The justification in the words a plan reader has, never the data's own names. */
const JUSTIFICATION_WORDS: Record<Wall['justification'], string> = {
  centre: STRINGS.originCentre,
  left: STRINGS.justificationThisSide,
  right: STRINGS.justificationOtherSide,
}

const CLASSIFICATION_WORDS: Record<NonNullable<Wall['classification']>, string> = {
  external: STRINGS.classificationExternal,
  internal: STRINGS.classificationInternal,
  partition: STRINGS.classificationPartition,
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
    onSetLength, onSetRadius, onSetThickness, onOffset, onSplit, onMerge, onDelete, deleteBlocked,
  } = props
  const [offsetText, setOffsetText] = useState('')
  const [offsetSide, setOffsetSide] = useState<'left' | 'right'>('left')
  const line = wall.line
  const isArc = line.kind === 'arc'
  const radius = isArc ? circleThrough(line.start, line.through, line.end)?.radius ?? null : null

  return (
    <section className="bb-workspace-card" data-testid="wall-inspector">
      <h3 className="bb-workspace-card-title" data-testid="wall-inspector-ref">{wall.ref}</h3>
      <Row testId="wall-shape" label={STRINGS.shape} value={isArc ? STRINGS.arc : STRINGS.wallStraight} />
      <NumberField
        label={STRINGS.length}
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
          label={STRINGS.radius}
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
        label={STRINGS.wallThickness}
        testId="wall-thickness"
        value={wall.thickness}
        kind="mm"
        unit={unit}
        precision={precision}
        min={1}
        onCommit={onSetThickness}
      />
      <Row testId="wall-height" label={STRINGS.wallHeight} value={`${grouped.format(wall.height)} mm`} />
      <ToolbarMenu label={STRINGS.moreOptions} testId="wall-inspector-more">
        <Row testId="wall-justification" label={STRINGS.wallJustification} value={JUSTIFICATION_WORDS[wall.justification]} />
        <Row
          testId="wall-classification"
          label={STRINGS.wallClassification}
          value={wall.classification === undefined ? STRINGS.wallClassificationNone : CLASSIFICATION_WORDS[wall.classification]}
        />
        <Row
          testId="wall-construction-label"
          label={STRINGS.wallConstructionLabel}
          value={wall.constructionLabel ?? STRINGS.wallClassificationNone}
        />
        <div data-testid="wall-offset">
          <label className="bb-workspace-field-label" htmlFor="wall-offset-field">
            {STRINGS.wallOffsetBy} <span className="bb-workspace-unit-suffix">(mm)</span>
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
            aria-label={STRINGS.wallOffsetSide}
            value={offsetSide}
            onChange={(event) => setOffsetSide(event.target.value as 'left' | 'right')}
          >
            <option value="left">{STRINGS.wallOffsetToward}</option>
            <option value="right">{STRINGS.wallOffsetAway}</option>
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
            {STRINGS.wallOffset}
          </button>
        </div>
      </ToolbarMenu>
      <div className="flex items-center gap-2">
        <button type="button" data-testid="wall-split" className="bb-workspace-tool-button" onClick={onSplit}>
          {STRINGS.wallSplit}
        </button>
        <button
          type="button"
          data-testid="wall-merge"
          className="bb-workspace-tool-button"
          disabled={mergeableWith === null}
          title={mergeableWith === null ? STRINGS.wallMergeNoTarget : undefined}
          onClick={() => {
            if (mergeableWith !== null) onMerge(mergeableWith.id)
          }}
        >
          {mergeableWith === null ? STRINGS.wallMerge : STRINGS.wallMergeWith(mergeableWith.ref)}
        </button>
        <button
          type="button"
          data-testid="wall-delete"
          className="bb-workspace-tool-button"
          disabled={deleteBlocked !== null}
          title={deleteBlocked ?? undefined}
          onClick={() => {
            if (deleteBlocked === null) onDelete()
          }}
        >
          {STRINGS.delete}
        </button>
      </div>
      {/* The Room's claim on this Wall, read out before the Intent is refused (#67 §12). */}
      {deleteBlocked !== null && (
        <p className="bb-workspace-field-error" data-testid="wall-delete-blocked">{deleteBlocked}</p>
      )}
    </section>
  )
}
