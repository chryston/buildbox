/**
 * The **Elevation View** definition block of the saved-view card (#75 §3): the view's name, the side
 * of its view line it stands on, how far it sees, and the two ends of that line.
 *
 * It is drawn only while an Elevation View is active, under the picker that chose it, so the card
 * reads as one block about the view it names. Every control here commits exactly one Edit
 * Transaction and nothing else: the name on Enter or blur — never on a keystroke — the `⇄` press on
 * click, and the depth and the four line coordinates on Enter or blur. A coordinate edit sends the
 * WHOLE line it completes, so one press moves one endpoint and no transaction ever carries half a
 * line.
 *
 * The refusals are local, exactly as `ExtentNumberField`'s are: a name the Floor already has, a
 * depth of zero or less and a line whose ends have met are each said under the box before anything
 * is sent, and the edit layer stays the backstop. The duplicate-name question is asked of the
 * caller, because only the caller owns the Project the other names live in; it answers
 * case-insensitively for the one Floor.
 *
 * Numbers are typed in the Project's display unit and committed in millimetres, the unit the domain
 * stores. `useFieldsLocked()` shuts every box here exactly as it shuts the Vertical Extent boxes.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { DisplayUnit, ElevationView } from '../../domain'
import { STRINGS } from '../strings'
import { formatMm } from './displayUnits'
import { ExtentNumberField } from './VerticalExtentFields'
import { useFieldsLocked } from './fieldsLock'

/** One committed change to the active Elevation View: the payload of the one Edit Transaction. */
export interface ElevationDefinition {
  name?: string
  side?: 'left' | 'right'
  /** How far the view sees, in millimetres — the unit the domain stores. */
  depth?: number
  line?: { start: { x: number; y: number }; end: { x: number; y: number } }
}

/** The view line as this block commits it: the same four millimetre numbers the domain stores. */
interface Line {
  start: { x: number; y: number }
  end: { x: number; y: number }
}

type Corner = keyof Line
type Axis = 'x' | 'y'

export interface ElevationDefinitionSectionProps {
  view: ElevationView
  /** Case-insensitive duplicate-name check on the same Floor, done by the caller (it owns the Project). */
  nameTaken(name: string): boolean
  unit: DisplayUnit
  precision: number
  /** Exactly one call per committed change. */
  onCommit(change: ElevationDefinition): void
  children?: never
}

/** The words for a name this Floor cannot hold — blank, or already worn by another view of it. */
export function elevationNameProblem(nameTaken: (name: string) => boolean, name: string): string | null {
  const trimmed = name.trim()
  if (trimmed === '') return STRINGS.elevationNameRequired
  if (nameTaken(trimmed)) return STRINGS.elevationNameTaken(trimmed)
  return null
}

/** The words for a depth that bounds no band: the prism has to have room in it. */
export function elevationDepthProblem(mm: number): string | null {
  return mm > 0 ? null : STRINGS.elevationDepthProblem
}

/** The words for a line whose ends have met: it bounds nothing and projects everything onto a point. */
export function elevationLineProblem(line: Line): string | null {
  return line.start.x === line.end.x && line.start.y === line.end.y ? STRINGS.elevationLineProblem : null
}

/** The line with one coordinate replaced — the whole line a single box's edit completes. */
const withAxis = (line: Line, corner: Corner, axis: Axis, mm: number): Line => {
  const moved = { ...line[corner] }
  moved[axis] = mm
  return corner === 'start'
    ? { start: moved, end: { ...line.end } }
    : { start: { ...line.start }, end: moved }
}

export function ElevationDefinitionSection(props: ElevationDefinitionSectionProps): ReactNode {
  const { view, nameTaken, unit, precision, onCommit } = props
  const { locked, notice } = useFieldsLocked()
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)

  // The record is the truth again as soon as it moves — including when a commit was refused and the
  // word in the box was never written anywhere.
  useEffect(() => {
    setNameDraft(null)
    setNameError(null)
  }, [view.id, view.name])

  const shown = (mm: number): string => formatMm(mm, unit, precision)

  /** Enter or blur: the trimmed word, or the sentence that says why the Floor cannot hold it. */
  const commitName = (): void => {
    if (nameDraft === null || locked) return
    const problem = elevationNameProblem(nameTaken, nameDraft)
    if (problem !== null) {
      setNameError(problem)
      return
    }
    setNameError(null)
    setNameDraft(null)
    const name = nameDraft.trim()
    if (name !== view.name) onCommit({ name })
  }

  /** One box's number, sent as the whole line it completes — never as half of one. */
  const commitLine = (corner: Corner, axis: Axis, mm: number): void => {
    const line = withAxis(view.line, corner, axis, mm)
    if (elevationLineProblem(line) !== null) return
    const same = line.start.x === view.line.start.x && line.start.y === view.line.start.y
      && line.end.x === view.line.end.x && line.end.y === view.line.end.y
    if (same) return
    onCommit({ line })
  }

  const lineFields = ([
    { corner: 'start', axis: 'x', label: STRINGS.elevationStartX },
    { corner: 'start', axis: 'y', label: STRINGS.elevationStartY },
    { corner: 'end', axis: 'x', label: STRINGS.elevationEndX },
    { corner: 'end', axis: 'y', label: STRINGS.elevationEndY },
  ] as const).map(({ corner, axis, label }) => (
    <ExtentNumberField
      key={`${corner}-${axis}`}
      label={label}
      testId={`elevation-line-${corner}-${axis}`}
      text={shown(view.line[corner][axis])}
      unit={unit}
      problem={(mm) => elevationLineProblem(withAxis(view.line, corner, axis, mm))}
      onCommit={(mm) => commitLine(corner, axis, mm)}
    />
  ))

  return (
    <section className="bb-workspace-extent" data-testid="elevation-definition">
      <h3 className="bb-workspace-card-title" data-testid="elevation-definition-title">{STRINGS.elevationView}</h3>
      <label className="bb-workspace-field-label" htmlFor="elevation-name-field">{STRINGS.name}</label>
      <input
        id="elevation-name-field"
        data-testid="elevation-name-field"
        className="bb-workspace-input"
        type="text"
        disabled={locked}
        title={notice === '' ? undefined : notice}
        aria-invalid={nameError === null ? undefined : 'true'}
        value={nameDraft ?? view.name}
        onChange={(event) => setNameDraft(event.target.value)}
        onBlur={commitName}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commitName()
          if (event.key === 'Escape') {
            setNameDraft(null)
            setNameError(null)
          }
        }}
      />
      {nameError !== null && (
        <p className="bb-workspace-field-error" data-testid="elevation-name-field-error" role="alert">{nameError}</p>
      )}
      <div className="bb-workspace-view-actions" data-testid="elevation-direction-row">
        <label className="bb-workspace-field-label" htmlFor="elevation-flip-side">{STRINGS.elevationDirection}</label>
        <button
          type="button"
          id="elevation-flip-side"
          data-testid="elevation-flip-side"
          className="bb-workspace-tool-button"
          title={STRINGS.flipDirection}
          disabled={locked}
          onClick={() => onCommit({ side: view.side === 'left' ? 'right' : 'left' })}
        >
          ⇄
        </button>
      </div>
      <ExtentNumberField
        label={STRINGS.depthMm}
        testId="elevation-depth-field"
        text={shown(view.depth)}
        unit={unit}
        problem={elevationDepthProblem}
        onCommit={(mm) => {
          if (mm !== view.depth) onCommit({ depth: mm })
        }}
      />
      {lineFields}
    </section>
  )
}
