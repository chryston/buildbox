/**
 * The `Delete Floor…` dialog (#56 criterion 9): what leans on this Floor, counted.
 *
 * The counts come from `summarizeFloorDependencies`, the one registry of floor-local kinds
 * — Placed Items, the Plan Image, named Plan Views today, and Walls, Rooms and Annotations
 * when those issues register themselves. Nothing here deletes on the Floor's behalf: there
 * is no cascade and nothing is reassigned, so `Delete Floor` stays disabled while any count
 * is above zero and each row carries the `Show` that takes the person to the thing they
 * have to deal with first.
 *
 * The Floor's own default Plan View is deliberately absent from the list. It is not a
 * dependant — it is the Floor being seen — and it goes with the Floor in the same
 * transaction.
 */
import type { ReactNode } from 'react'
import type { Floor, FloorDependency } from '../../domain'

export interface DeleteFloorDialogProps {
  floor: Floor
  rows: readonly FloorDependency[]
  onShow(kindId: string): void
  onDelete: () => void
  onClose: () => void
}

export function deleteFloorIsBlocked(rows: readonly FloorDependency[]): boolean {
  return rows.some((row) => row.count > 0)
}

export function DeleteFloorDialog(props: DeleteFloorDialogProps): ReactNode {
  const { floor, rows, onShow, onDelete, onClose } = props
  const blocked = deleteFloorIsBlocked(rows)

  return (
    <div className="bb-workspace-dialog-backdrop" data-testid="delete-floor-dialog">
      <div role="dialog" aria-modal="true" aria-label={`Delete Floor ${floor.name}`} className="bb-workspace-dialog">
        <h2>Delete Floor</h2>
        <p className="bb-workspace-dialog-note">
          {blocked
            ? 'Delete what is on this Floor first. Nothing is deleted or moved for you.'
            : 'Nothing is left on this Floor. Deleting it also deletes its default Plan View.'}
        </p>
        <ul className="bb-workspace-dependency-list" data-testid="floor-dependencies">
          {rows.map((row) => (
            <li key={row.kind.id} data-testid={`dependency-${row.kind.id}`}>
              <span className="bb-workspace-dependency-text">{row.text}</span>
              <button
                type="button"
                data-testid={`dependency-show-${row.kind.id}`}
                className="bb-workspace-tool-button"
                disabled={row.count === 0}
                onClick={() => onShow(row.kind.id)}
              >
                Show
              </button>
            </li>
          ))}
        </ul>
        <div className="bb-workspace-dialog-actions">
          <button
            type="button"
            data-testid="delete-floor-confirm"
            className="bb-workspace-danger-button"
            disabled={blocked}
            onClick={onDelete}
          >
            Delete Floor
          </button>
          <button
            type="button"
            data-testid="delete-floor-cancel"
            className="bb-workspace-secondary-button"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
