/**
 * `Paste from “Unit 4 Fitout” — map Drawing Layers` (#72 §5): the mapping review.
 *
 * One row per Drawing Layer the copy brings, and one question per row: where does this layer's work
 * land here? The review comes from the paste Intent's own preview, so the rows, the counts and the
 * two loss lists are what the write will really do rather than what this file guesses.
 *
 * A name match is offered and never assumed. The `Paste` button stays disabled until every layer has
 * an answer a person actually chose — the suggestion button exists precisely so the suggested layer
 * can be chosen out loud instead of quietly applied — because pasting work onto a layer nobody
 * picked moves it in front of someone else's filters and read-only settings.
 *
 * Where the copy would land in the shared Existing Model while Design Options exist, the danger line
 * says so and the primary button becomes the correction: one transaction either way, one undo.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { EntityId } from '../../../domain'
import type { CopySet, PasteLayerResolution, PasteLayerTarget, PasteReview } from '../../../edit'
import { RENOVATION_STRINGS } from '../../strings/renovation'

/** One of this Project's own Drawing Layers, as far as the picker needs it. */
export interface PasteDestinationLayer {
  readonly id: EntityId
  readonly name: string
}

export interface PasteDialogProps {
  /** The paste Intent's own review of this copy against this Project and saved view. */
  review: PasteReview
  /** The copy itself, for the refs the row lists next to each source layer. */
  copySet: CopySet
  /** This Project's layers, in the order the Project keeps them. */
  destinations: readonly PasteDestinationLayer[]
  /** Run the paste. `correct` asks for the wrapper that corrects the Existing Model first. */
  onConfirm: (resolutions: readonly PasteLayerResolution[], correct: boolean) => void
  onCancel: () => void
  /** Why the last paste was refused. The dialog stays open and says it in plain words. */
  problem?: string
}

/**
 * A row's answer, carried through a `<select>` as one string: the empty value is the question, and
 * an existing layer is named by prefix so it cannot be confused with the two answers that name no
 * layer at all.
 */
const encodeTarget = (target: PasteLayerTarget | null): string =>
  target === null ? '' : target.kind === 'existing' ? `existing:${target.layerId}` : target.kind

const decodeTarget = (value: string): PasteLayerTarget | null => {
  if (value === '') return null
  if (value === 'new') return { kind: 'new' }
  if (value === 'unlayered') return { kind: 'unlayered' }
  return { kind: 'existing', layerId: value.slice('existing:'.length) }
}

/** A record seen far enough to say which of the copy's layers it stood on and what it is called. */
interface Filed {
  readonly id: EntityId
  readonly drawingLayerId?: EntityId | null
  readonly ref?: string
}

/** The refs of the records the copy brings that stood on `layerId` — the row's own list. */
function refsOn(copySet: CopySet, layerId: EntityId): string[] {
  const { walls, openings, rooms, placedItems } = copySet.entities
  // The four collections share only these three fields, and the copy is read, never narrowed by
  // hand: what is asked of each record is what every one of them carries.
  const records = [...walls, ...openings, ...rooms, ...placedItems] as readonly Filed[]
  return records.filter((record) => (record.drawingLayerId ?? null) === layerId).map((record) => record.ref ?? record.id)
}

export function PasteFromOtherProjectDialog(props: PasteDialogProps): ReactNode {
  const { review, copySet, destinations, onConfirm, onCancel, problem } = props
  const [answers, setAnswers] = useState<Partial<Record<EntityId, PasteLayerTarget | null>>>({})

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const resolutions = review.rows
    .map((row) => ({ sourceLayerId: row.sourceLayerId, target: answers[row.sourceLayerId] ?? null }))
    .filter((row): row is PasteLayerResolution => row.target !== null)
  // Every layer the copy brings has to have been answered (#72 criterion 3): an unanswered row would
  // be the handler's refusal, and a dialog that offers a button it knows will be refused is noise.
  const ready = resolutions.length === review.rows.length
  const destination = review.destination
  const blocked = destination.kind === 'blocked'
  const correct = destination.kind === 'correct-existing'

  return (
    <div className="bb-workspace-dialog-backdrop" data-testid="paste-dialog">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={RENOVATION_STRINGS.pasteTitle(review.sourceProjectName)}
        className="bb-workspace-dialog"
      >
        <h2 data-testid="paste-dialog-title">{RENOVATION_STRINGS.pasteTitle(review.sourceProjectName)}</h2>
        <p data-testid="paste-dialog-intro">
          {RENOVATION_STRINGS.pasteIntro(review.entityCount, review.sourceProjectName)}
          {review.unlayeredCount > 0 && (
            <>
              {' '}
              {RENOVATION_STRINGS.pasteUnlayered(review.unlayeredCount)}
            </>
          )}
        </p>
        {blocked && (
          <p className="bb-workspace-field-error" role="alert" data-testid="paste-dialog-blocked">
            {destination.reason}
          </p>
        )}
        {correct && (
          <p className="bb-workspace-dialog-danger" data-testid="paste-dialog-danger">
            {RENOVATION_STRINGS.pasteExistingDanger}
          </p>
        )}
        <table className="bb-workspace-table" data-testid="paste-dialog-rows">
          <thead>
            <tr>
              <th>{RENOVATION_STRINGS.pasteColSource}</th>
              <th>{RENOVATION_STRINGS.pasteColItems}</th>
              <th>{RENOVATION_STRINGS.pasteColDestination}</th>
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {review.rows.map((row) => {
              const answer = answers[row.sourceLayerId] ?? null
              const suggested = row.suggestedLayerId
              return (
                <tr key={row.sourceLayerId} data-testid={`paste-row-${row.sourceLayerId}`}>
                  <td>
                    <span
                      className="bb-renovation-swatch"
                      style={{ background: row.sourceLayerColor }}
                      data-testid={`paste-row-swatch-${row.sourceLayerId}`}
                    />
                    {row.sourceLayerName}
                  </td>
                  <td data-testid={`paste-row-items-${row.sourceLayerId}`}>{refsOn(copySet, row.sourceLayerId).join(', ')}</td>
                  <td>
                    <select
                      className="bb-workspace-select"
                      data-testid={`paste-row-target-${row.sourceLayerId}`}
                      value={encodeTarget(answer)}
                      onChange={(event) => {
                        setAnswers((current) => ({ ...current, [row.sourceLayerId]: decodeTarget(event.target.value) }))
                      }}
                    >
                      <option value="">{RENOVATION_STRINGS.pasteChoose}</option>
                      {destinations.map((layer) => (
                        <option key={layer.id} value={`existing:${layer.id}`}>
                          {layer.id === suggested ? RENOVATION_STRINGS.pasteNameMatch(layer.name) : layer.name}
                        </option>
                      ))}
                      <option value="new">{RENOVATION_STRINGS.pasteCreateHere(row.sourceLayerName)}</option>
                      <option value="unlayered">{RENOVATION_STRINGS.layerUnlayered}</option>
                    </select>
                  </td>
                  <td>
                    {suggested !== null && encodeTarget(answer) !== `existing:${suggested}` && (
                      <button
                        type="button"
                        className="bb-workspace-secondary-button"
                        data-testid={`paste-row-use-${row.sourceLayerId}`}
                        onClick={() => {
                          setAnswers((current) => ({ ...current, [row.sourceLayerId]: { kind: 'existing', layerId: suggested } }))
                        }}
                      >
                        {RENOVATION_STRINGS.pasteUseSuggested(row.suggestedLayerName ?? '')}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {review.notComingAcross.length > 0 && (
          <div data-testid="paste-dialog-not-coming">
            <p className="bb-workspace-field-label">{RENOVATION_STRINGS.pasteNotComingAcross}</p>
            <ul className="bb-workspace-dependency-list">
              {review.notComingAcross.map((loss) => (
                <li key={`${loss.ref}-${loss.reason}`}>
                  {loss.ref} — {loss.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
        {review.detached.length > 0 && (
          <div data-testid="paste-dialog-detached">
            <p className="bb-workspace-field-label">{RENOVATION_STRINGS.pasteWillDetach}</p>
            <ul className="bb-workspace-dependency-list">
              {review.detached.map((loss) => (
                <li key={`${loss.ref}-${loss.reason}`}>
                  {loss.ref} — {loss.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
        {problem !== undefined && (
          <p className="bb-workspace-field-error" role="alert" data-testid="paste-dialog-problem">
            {problem}
          </p>
        )}
        <div className="bb-workspace-dialog-actions">
          <button
            type="button"
            data-testid="paste-dialog-confirm"
            className="bb-workspace-danger-button"
            disabled={blocked || !ready}
            onClick={() => {
              onConfirm(resolutions, correct)
            }}
          >
            {correct ? RENOVATION_STRINGS.pasteCorrectAndPaste : RENOVATION_STRINGS.pasteConfirm}
          </button>
          <button type="button" data-testid="paste-dialog-cancel" className="bb-workspace-secondary-button" onClick={onCancel}>
            {RENOVATION_STRINGS.cancel}
          </button>
        </div>
      </div>
    </div>
  )
}
