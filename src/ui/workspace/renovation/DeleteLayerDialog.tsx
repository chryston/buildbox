/**
 * `Delete Services?` (#71 §5): what a layer holds, and what happens to it.
 *
 * Deleting a layer destroys nothing, and the dialog exists to say so before the click rather than
 * after: the counts come from `services.intent.preview` — the same answer `applyIntent` consults when
 * it writes — so the numbers here are the numbers the transaction makes, and Cancel is the only
 * button that can still be honoured exactly.
 *
 * Two shapes, because the question is different in each. A layer with content on it is asked with the
 * table — Model entities, Annotations, saved views, each with what becomes of it — and the first
 * eight records by name, because `12 items` and `W-3, W-4, the island…` are two different pieces of
 * news. A layer with nothing on it is asked in one line: there is nothing to move, and a table of
 * zeroes would be a ceremony around a rename.
 *
 * The line the dialog cannot leave out is the one about the Unlayered row. Content that comes back
 * Unlayered is governed by that row from then on, and in a view that has hidden it the honest answer
 * is that the content stops being drawn *here* — which is not the same promise as "nothing is lost",
 * and both are said.
 */
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import type { DeleteLayerReview } from '../../../edit'
import { RENOVATION_STRINGS } from '../../strings/renovation'

export interface DeleteLayerDialogProps {
  review: DeleteLayerReview
  /** Why the last confirm was refused — a layer deleted while the question was open (#65 §8). */
  problem?: string
  onConfirm: () => void
  onCancel: () => void
}

export function DeleteLayerDialog(props: DeleteLayerDialogProps): ReactNode {
  const { review, problem, onConfirm, onCancel } = props
  // Escape changes nothing, which is what the Cancel button says it does (#71 §5).
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const str = RENOVATION_STRINGS
  const rows = [
    { key: 'model', dependency: str.deleteLayerModel(review.counts.model), count: review.counts.model, result: str.deleteLayerResultUnlayered },
    {
      key: 'annotations',
      dependency: str.deleteLayerAnnotations(review.counts.annotations),
      count: review.counts.annotations,
      result: str.deleteLayerResultUnlayered,
    },
    {
      key: 'overrides',
      dependency: str.deleteLayerOverrides(review.counts.overrides),
      count: review.counts.overrides,
      result: str.deleteLayerResultOverrides(review.counts.overrides),
    },
  ]
  const more = review.counts.model - review.members.length

  return (
    <div className="bb-workspace-dialog-backdrop" data-testid="delete-layer-dialog">
      <div role="dialog" aria-modal="true" aria-label={review.message} className="bb-workspace-dialog">
        <h2>{review.message}</h2>

        {!review.unused && (
          <>
            <table className="bb-layer-review-table" data-testid="delete-layer-table">
              <thead>
                <tr>
                  <th scope="col">{str.deleteLayerColumnDependency}</th>
                  <th scope="col">{str.deleteLayerColumnCount}</th>
                  <th scope="col">{str.deleteLayerColumnResult}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} data-testid={`delete-layer-row-${row.key}`}>
                    <td>{row.dependency}</td>
                    <td>{row.count}</td>
                    <td>{row.result}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p className="bb-workspace-field-label" data-testid="delete-layer-members-label">
              {str.deleteLayerOnIt}
            </p>
            <ul className="bb-workspace-dependency-list" data-testid="delete-layer-members">
              {review.members.map((member) => (
                <li key={member.id} className="bb-workspace-dependency-text" data-testid={`delete-layer-member-${member.id}`}>
                  {member.label}
                </li>
              ))}
              {more > 0 && (
                <li className="bb-workspace-dependency-text" data-testid="delete-layer-more">
                  {str.deleteLayerMore(more)}
                </li>
              )}
            </ul>
          </>
        )}

        <p
          className="bb-workspace-dialog-note"
          data-testid={review.unlayeredHidden ? 'delete-layer-hidden-note' : 'delete-layer-note'}
        >
          {review.unlayeredHidden ? str.deleteLayerHidden : str.deleteLayerBecomes}
        </p>
        {review.counts.overrides > 0 && (
          <p className="bb-workspace-dialog-note" data-testid="delete-layer-views">
            {review.viewNames.join(', ')}
          </p>
        )}

        {problem !== undefined && (
          <p className="bb-workspace-field-error" data-testid="delete-layer-problem" role="alert">
            {problem}
          </p>
        )}

        <div className="bb-workspace-dialog-actions">
          <button type="button" data-testid="delete-layer-confirm" className="bb-workspace-danger-button" onClick={onConfirm}>
            {str.deleteLayerConfirm}
          </button>
          <button type="button" data-testid="delete-layer-cancel" className="bb-workspace-secondary-button" onClick={onCancel}>
            {str.deleteLayerCancel}
          </button>
        </div>
      </div>
    </div>
  )
}
