/**
 * The Vertical Extent boxes of the inspector (#74 §5), drawn from the rows
 * `verticalExtentFields` describes.
 *
 * This file is the one place a height, a base or a top is typed. A Wall, an Opening and a Placed Item
 * differ in *which* boxes they show — that answer is the view-model's — and every one of them behaves
 * the same way here: the box holds the Project's number until the person types, commits on Enter or
 * blur, gives the text back on Esc, and refuses a number that cannot describe a band without sending
 * anything.
 *
 * The refusal is local on purpose. The edit layer refuses the same three things with the same three
 * sentences (`requireExtentValue`), and it stays the backstop; marking the box before dispatching is
 * what keeps the failed edit from becoming an undo step the person has to unwind.
 *
 * `Base` is never checked against zero: a Sump box stands at −150 mm and is right to, because the
 * Floor Datum is a reference plane and not a floor to sit on.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { DisplayUnit } from '../../domain'
import { STRINGS } from '../strings'
import { parseMmInput } from './displayUnits'
import { useFieldsLocked } from './fieldsLock'
import type { ExtentField, VerticalExtentView } from './verticalExtentFields'

/**
 * One Vertical Extent box: the record's text until the person types, then their text.
 *
 * `problem` answers why a parsed number cannot be applied to this entity — the edit layer's three
 * sentences, before anything is sent. It is a function rather than three booleans because each kind
 * knows which of its own numbers the box has to be measured against.
 */
export function ExtentNumberField(props: {
  label: string
  testId: string
  /** The record's number in the Project's display unit — what the box holds when nobody is typing. */
  text: string
  unit: DisplayUnit
  /** The line under the box: `moves item` on a Placed Item's `Top`. */
  caption?: string
  problem?: (valueMm: number) => string | null
  onCommit: (valueMm: number) => void
}): ReactNode {
  const { label, testId, text, unit, caption, problem, onCommit } = props
  const { locked, notice } = useFieldsLocked()
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // The record is the truth again as soon as it moves — including when a commit was refused and the
  // number in the box was never written anywhere.
  useEffect(() => {
    setDraft(null)
    setError(null)
  }, [text])

  const commit = (): void => {
    if (draft === null) return
    const parsed = parseMmInput(draft, unit)
    if (parsed === null) {
      setError(STRINGS.extentEnterNumber)
      return
    }
    const why = problem?.(parsed) ?? null
    if (why !== null) {
      setError(why)
      return
    }
    setError(null)
    setDraft(null)
    onCommit(parsed)
  }

  return (
    <>
      <label className="bb-workspace-field-label" htmlFor={`${testId}-field`}>
        {label} <span className="bb-workspace-unit-suffix">({unit})</span>
      </label>
      <input
        id={`${testId}-field`}
        data-testid={testId}
        className="bb-workspace-input"
        type="number"
        step="any"
        disabled={locked}
        title={notice === '' ? undefined : notice}
        aria-invalid={error === null ? undefined : 'true'}
        value={draft ?? text}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
          if (event.key === 'Escape') {
            setDraft(null)
            setError(null)
          }
        }}
      />
      {caption !== undefined && caption !== '' && (
        <span className="bb-workspace-field-hint" data-testid={`${testId}-caption`}>{caption}</span>
      )}
      {error !== null && (
        <p className="bb-workspace-field-error" data-testid={`${testId}-error`} role="alert">{error}</p>
      )}
    </>
  )
}

export interface VerticalExtentRowsProps {
  /** The rows, in the §5 order, from `wallExtentView`, `openingExtentView` or `placementExtentView`. */
  view: VerticalExtentView
  unit: DisplayUnit
  /** Where the boxes and their messages are addressed from: `wall`, `opening`, `placed`. */
  testId: string
  onCommit: (field: ExtentField, valueMm: number) => void
  /** `Fork design…`, under the Height line (#74 §5). Only a Placed Item has a line to sit under. */
  fork?: ReactNode
}

/**
 * The §5 block: the boxes in the kind's own order, a Placed Item's read-only Height line with
 * `Fork design…` under it, and the one line that says what this Plan View's Range makes of the entity.
 *
 * The Height line is read-only because there is nothing on this record to write: the number belongs to
 * the Item Design and is shared, which is what the line itself says.
 */
export function VerticalExtentRows(props: VerticalExtentRowsProps): ReactNode {
  const { view, unit, testId, onCommit, fork } = props
  const stored = (field: ExtentField): number =>
    view.rows.find((each) => each.field === field)?.valueMm ?? 0

  // The edit layer's two checks and no others (`requireExtentValue`): a height has to be more than 0,
  // a top has to sit above the base it is measured from. `base` is checked only for being a number,
  // because a Sump box stands at −150 mm and is right to.
  const problem = (field: ExtentField, valueMm: number): string | null => {
    if (field === 'height' && !(valueMm > 0)) return STRINGS.extentHeightNeedsPositive
    if (field === 'top' && !(valueMm > stored('base'))) return STRINGS.extentTopNeedsBase
    return null
  }

  return (
    <div className="bb-workspace-extent" data-testid={`${testId}-extent`}>
      {view.rows.map((each) => (
        <ExtentNumberField
          key={each.field}
          label={each.label}
          testId={`${testId}-extent-${each.field}`}
          text={each.text}
          unit={unit}
          caption={each.caption}
          problem={(valueMm) => problem(each.field, valueMm)}
          onCommit={(valueMm) => onCommit(each.field, valueMm)}
        />
      ))}
      {view.heightLine !== null && (
        <span className="bb-workspace-static-value" data-testid={`${testId}-extent-height-line`}>
          {view.heightLine}
        </span>
      )}
      {view.heightLine !== null && fork !== undefined && (
        <div className="bb-workspace-button-row" data-testid={`${testId}-extent-fork`}>{fork}</div>
      )}
      <span className="bb-workspace-field-hint" data-testid={`${testId}-extent-shown-as`}>{view.shownAs}</span>
    </div>
  )
}
