/**
 * The `Design Options` section of Project settings (#69 §15).
 *
 * The list is the Project's own order, and every control is one Intent as it is used — the rule
 * `Manage Floors…` set: a Project is never half-applied, and each step can be undone on its own.
 * There is no Save button here because an Option is not a draft of a Project; it is a drawing that
 * exists the moment it is named.
 *
 * A name is refused before it is sent, in the same words the handler would answer with: an Option
 * is chosen by name on every card #70 draws, so two Options called the same thing are two cards
 * nobody can tell apart. The rule is `edit`'s exact-name one, read here against the Project rather
 * than guessed at.
 *
 * `Delete…` asks first. The counts and the promise that the Existing Model is untouched come from
 * the Intent's own preview, so the dialog cannot drift from what the write will do.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { DeleteDesignOptionReview, IntentType, PayloadOf } from '../../../edit'
import type { DesignOption } from '../../../domain'
import { designOptionsOf, nameKey } from '../../../domain'
import { RENOVATION_STRINGS } from '../../strings/renovation'
import { useWorkspaceDispatch, useWorkspaceProject, useWorkspaceRoot } from '../WorkspaceRoot'
import { DeleteDesignOptionDialog } from './DeleteDesignOptionDialog'

/** The longest name `edit` and the validator accept for an Option (#69 §4). */
const OPTION_NAME_MAX_LENGTH = 60

/** The plain words for a name this Project cannot hold, or `null` when it may have it. */
export function designOptionNameProblem(
  options: readonly DesignOption[],
  optionId: string | null,
  name: string,
): string | null {
  const trimmed = name.trim()
  if (trimmed === '') return RENOVATION_STRINGS.designOptionNameRequired
  if (trimmed.length > OPTION_NAME_MAX_LENGTH) return RENOVATION_STRINGS.designOptionNameTooLong
  // The same fold the validator makes: an Option called `Option A` blocks `option a` too, because
  // both are the words a person reads off a card and cannot tell apart.
  const key = nameKey(trimmed)
  const taken = options.find((option) => option.id !== optionId && nameKey(option.name) === key)
  if (taken !== undefined) return RENOVATION_STRINGS.designOptionNameTaken(taken.name.trim())
  return null
}

/**
 * The name a new Option takes: the first letter still free (#69 criterion 9 — create gives
 * `Option A`, then `Option B`). A Project with more than twenty-six Options runs past the alphabet,
 * which is rare enough to count rather than to invent a second naming scheme for.
 */
export function nextDesignOptionName(options: readonly DesignOption[]): string {
  const taken = new Set(options.map((option) => nameKey(option.name)))
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  for (const letter of letters) {
    const name = RENOVATION_STRINGS.designOptionSuggested(letter)
    if (!taken.has(nameKey(name))) return name
  }
  let index = letters.length + 1
  while (taken.has(nameKey(RENOVATION_STRINGS.designOptionSuggested(String(index))))) index += 1
  return RENOVATION_STRINGS.designOptionSuggested(String(index))
}

export function DesignOptionsSection(): ReactNode {
  const { session, services } = useWorkspaceRoot()
  const project = useWorkspaceProject(session)
  const dispatch = useWorkspaceDispatch()
  const options = designOptionsOf(project)
  const [deleteReview, setDeleteReview] = useState<DeleteDesignOptionReview | null>(null)

  const send = <T extends IntentType>(type: T, payload: PayloadOf<T>): void => {
    dispatch(services.intent.build(type, payload))
  }

  const add = (): void => send('designOption.create', { name: nextDesignOptionName(options) })

  /** The delete is asked before it is answered: the counts are the preview's, not a second count. */
  const askDelete = (optionId: string): void => {
    const { review } = services.intent.preview(project, services.intent.build('designOption.delete', { optionId }))
    if (review?.kind === 'delete-design-option') {
      setDeleteReview(review)
      return
    }
    send('designOption.delete', { optionId })
  }

  const confirmDelete = (): void => {
    if (deleteReview === null) return
    send('designOption.delete', { optionId: deleteReview.optionId })
    setDeleteReview(null)
  }

  return (
    <section className="bb-workspace-settings-section" data-testid="design-options-section">
      <h3 className="bb-workspace-card-title">{RENOVATION_STRINGS.designOptions}</h3>
      {options.length === 0 ? (
        <p className="bb-workspace-dialog-note" data-testid="design-options-none">
          {RENOVATION_STRINGS.designOptionNone}
        </p>
      ) : (
        <ul className="bb-workspace-floor-list" data-testid="design-options-list">
          {options.map((option) => (
            <li key={option.id} className="bb-workspace-floor-row" data-testid={`design-option-row-${option.id}`}>
              <DesignOptionRow
                option={option}
                options={options}
                onRename={(name) => send('designOption.rename', { optionId: option.id, name })}
                onDelete={() => askDelete(option.id)}
              />
            </li>
          ))}
        </ul>
      )}
      <div className="bb-workspace-dialog-actions">
        <button
          type="button"
          data-testid="design-option-add"
          className="bb-workspace-primary-button"
          onClick={add}
        >
          {RENOVATION_STRINGS.designOptionAdd}
        </button>
      </div>
      {deleteReview !== null && (
        <DeleteDesignOptionDialog
          review={deleteReview}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteReview(null)}
        />
      )}
    </section>
  )
}

function DesignOptionRow(props: {
  option: DesignOption
  options: readonly DesignOption[]
  onRename: (name: string) => void
  onDelete: () => void
}): ReactNode {
  const { option, options, onRename, onDelete } = props
  const [name, setName] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)

  const commitName = (): void => {
    if (name === null) return
    const problem = designOptionNameProblem(options, option.id, name)
    if (problem !== null) {
      setNameError(problem)
      return
    }
    setNameError(null)
    onRename(name.trim())
    setName(null)
  }

  return (
    <>
      <input
        className="bb-workspace-input"
        data-testid={`design-option-name-${option.id}`}
        aria-label={RENOVATION_STRINGS.designOptionName}
        type="text"
        value={name ?? option.name}
        onChange={(event) => setName(event.target.value)}
        onBlur={commitName}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commitName()
        }}
      />
      <span className="bb-workspace-spacer" />
      <button
        type="button"
        data-testid={`design-option-delete-${option.id}`}
        className="bb-workspace-danger-button"
        onClick={onDelete}
      >
        {RENOVATION_STRINGS.designOptionDelete}
      </button>
      {nameError !== null && (
        <p className="bb-workspace-field-error" data-testid={`design-option-name-error-${option.id}`} role="alert">
          {nameError}
        </p>
      )}
    </>
  )
}
