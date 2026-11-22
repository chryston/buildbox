/**
 * The inspector's renovation block (#70 §5), in the left rail under the card.
 *
 * It answers three questions in the order a person asks them before editing anything: what is this
 * (`W-2′`, its Renovation State, its Kind), who owns the edit (`Existing Model (shared)`, or one
 * Design Option), and what did it come from or turn into (`Replaces`, `Successor`). The links are
 * navigation: clicking one selects that entity, and if the current Renovation Display does not draw
 * it, the view switches to one that does — which is a Display change, so it is one undoable
 * transaction rather than a silent repaint.
 *
 * The Actions row is §5's table, and the issue's rule for it is absolute: an action a Display does
 * not allow is **disabled with a reason, never hidden**. Hiding would make the inspector's silence
 * ambiguous — no button could mean "not here" or "not allowed".
 */
import type { ReactNode } from 'react'
import type { RenovationDisplay } from '../../../domain'
import type { RenovationState } from '../../../derive'
import { RENOVATION_STRINGS } from '../../strings/renovation'
import { displayLabel, swatchClass } from './displayTheme'

/** One of §5's Actions. */
export type RenovationInspectorAction = 'move' | 'demolish' | 'replace' | 'restore' | 'delete' | 'correct'

/** A `Replaces` or `Successor` entry: the entity, and the Display that draws it. */
export interface RenovationInspectorLink {
  readonly id: string
  readonly ref: string
  /** The Display to switch to when the current one does not draw it. */
  readonly display: RenovationDisplay
  /** Whether the Display on screen draws it — the difference between a jump and a switch. */
  readonly drawn: boolean
}

/** What is selected, in the words the inspector prints. */
export interface RenovationInspectorTarget {
  readonly id: string
  readonly ref: string
  readonly kind: string
  readonly state: RenovationState
  readonly owner: string
  readonly replaces: readonly RenovationInspectorLink[]
  readonly successors: readonly RenovationInspectorLink[]
}

export interface RenovationInspectorProps {
  /** The selected entity, or `null` when nothing is selected. */
  target: RenovationInspectorTarget | null
  /** The Display the canvas is showing, which decides the Actions row. */
  display: RenovationDisplay
  /**
   * Whether the Project has at least one Design Option. `Correct Existing Model…` is the action that
   * says what every option does, so with no options there is nothing to say and the row is empty.
   */
  hasDesignOption: boolean
  /** Why an action is disabled here, keyed by action. An action absent from the table is not shown. */
  unavailable?: Partial<Record<RenovationInspectorAction, string>>
  onAction: (action: RenovationInspectorAction) => void
  /** Select an entity, switching Display first when the current one does not draw it. */
  onSelectEntity: (id: string, display: RenovationDisplay) => void
}

/** §5's table: which Actions each shown State gets in each Display. */
const ACTIONS: { [S in RenovationState]: { [D in RenovationDisplay]: readonly RenovationInspectorAction[] } } = {
  existing: {
    existing: ['correct'],
    demolition: ['move', 'demolish', 'replace'],
    proposed: ['move'],
    combined: ['move', 'demolish', 'replace'],
  },
  demolition: { existing: [], demolition: ['restore'], proposed: [], combined: ['restore'] },
  proposed: { existing: [], demolition: [], proposed: ['move', 'delete'], combined: ['move', 'delete'] },
}

const ACTION_LABELS: { [A in RenovationInspectorAction]: string } = {
  move: RENOVATION_STRINGS.actionMove,
  demolish: RENOVATION_STRINGS.toolMarkDemolition,
  replace: RENOVATION_STRINGS.toolReplace,
  restore: RENOVATION_STRINGS.actionRestore,
  delete: RENOVATION_STRINGS.actionDelete,
  correct: RENOVATION_STRINGS.actionCorrect,
}

/** The State's name, in the same words the mode bar, the legend and the candidate list use. */
const STATE_LABELS: { [S in RenovationState]: string } = {
  existing: RENOVATION_STRINGS.displayExisting,
  demolition: RENOVATION_STRINGS.displayDemolition,
  proposed: RENOVATION_STRINGS.displayProposed,
}

export function RenovationInspector(props: RenovationInspectorProps): ReactNode {
  const { target, display, unavailable = {}, hasDesignOption } = props
  if (target === null) {
    return (
      <p className="bb-renovation-inspector-empty" data-testid="renovation-inspector-empty">
        {RENOVATION_STRINGS.nothingSelected}
      </p>
    )
  }
  const allowed = ACTIONS[target.state][display]
  const actions = hasDesignOption ? allowed : allowed.filter((action) => action !== 'correct')
  const blocked = actions.filter((action) => unavailable[action] !== undefined)
  return (
    <section className="bb-renovation-inspector" data-testid="renovation-inspector">
      <header className="bb-renovation-inspector-head">
        <span className="bb-renovation-inspector-ref">{target.ref}</span>
        <span
          className={`bb-renovation-inspector-badge ${swatchClass(target.state)}`}
          data-testid="renovation-inspector-badge"
        >
          {STATE_LABELS[target.state]}
        </span>
      </header>
      <dl className="bb-renovation-inspector-rows">
        <div className="bb-renovation-inspector-row">
          <dt>{RENOVATION_STRINGS.inspectorKind}</dt>
          <dd data-testid="renovation-inspector-kind">{target.kind}</dd>
        </div>
        <div className="bb-renovation-inspector-row">
          <dt>{RENOVATION_STRINGS.inspectorOwner}</dt>
          <dd data-testid="renovation-inspector-owner">{target.owner}</dd>
        </div>
        {target.replaces.length > 0 && (
          <div className="bb-renovation-inspector-row">
            <dt>{RENOVATION_STRINGS.inspectorReplaces}</dt>
            <dd className="bb-renovation-inspector-links" data-testid="renovation-inspector-replaces">
              {target.replaces.map((link) => (
                <LinkButton key={link.id} link={link} onSelectEntity={props.onSelectEntity} />
              ))}
            </dd>
          </div>
        )}
        {target.successors.length > 0 && (
          <div className="bb-renovation-inspector-row">
            <dt>{RENOVATION_STRINGS.inspectorSuccessor}</dt>
            <dd className="bb-renovation-inspector-links" data-testid="renovation-inspector-successor">
              {target.successors.map((link) => (
                <LinkButton key={link.id} link={link} onSelectEntity={props.onSelectEntity} />
              ))}
            </dd>
          </div>
        )}
      </dl>
      {target.state === 'proposed' && display === 'demolition' && (
        <p className="bb-renovation-inspector-notice" data-testid="renovation-inspector-notice">
          {RENOVATION_STRINGS.proposedInDemolitionNotice}
        </p>
      )}
      {actions.length > 0 && (
        <div className="bb-renovation-inspector-actions" data-testid="renovation-inspector-actions">
          <span className="bb-renovation-inspector-actions-label">{RENOVATION_STRINGS.inspectorActions}</span>
          {actions.map((action) => (
            <button
              key={action}
              type="button"
              className="bb-renovation-inspector-action"
              data-testid={`renovation-inspector-action-${action}`}
              disabled={unavailable[action] !== undefined}
              title={unavailable[action]}
              onClick={() => {
                props.onAction(action)
              }}
            >
              {ACTION_LABELS[action]}
            </button>
          ))}
        </div>
      )}
      {blocked.map((action) => (
        <p className="bb-renovation-inspector-reason" data-testid={`renovation-inspector-reason-${action}`} key={action}>
          {ACTION_LABELS[action]} — {unavailable[action]}
        </p>
      ))}
    </section>
  )
}

/**
 * One `Replaces` / `Successor` link. When the current Display does not draw the entity, the link
 * says so in its tooltip and the click switches Display as part of selecting it.
 */
function LinkButton(props: {
  link: RenovationInspectorLink
  onSelectEntity: (id: string, display: RenovationDisplay) => void
}): ReactNode {
  const { link } = props
  return (
    <button
      type="button"
      className="bb-renovation-inspector-link"
      data-testid={`renovation-inspector-link-${link.id}`}
      title={link.drawn ? undefined : RENOVATION_STRINGS.switchDisplayToFind(link.ref, displayLabel(link.display))}
      onClick={() => {
        props.onSelectEntity(link.id, link.display)
      }}
    >
      {link.ref}
    </button>
  )
}
