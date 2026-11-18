/**
 * Return a Project to an earlier state (#51 §1; the archive's `recovery` modal).
 *
 * The list is `persistence`'s own metadata, newest first, handed over by `app` — `ui` may not
 * read a repository (#42 §2), and a Recovery Point is only ever *chosen* here, never decoded.
 * Restoring is the session's `restoreRecoveryPoint`, which writes a `pre-restore` Point for the
 * state about to be replaced before it replaces it. That is what makes the body's promise true,
 * so the dialog says it in the present tense and means it.
 *
 * Nothing here is destructive on its own terms: opening this dialog writes nothing, and `Cancel`,
 * `Esc` and a click outside all leave the Project exactly as it was.
 */
import { useState } from 'react'
import { formatPointTime } from '../library/formatSince'
import { Modal } from '../library/Modal'
import { STRINGS } from '../strings'
import type { RecoveryPointMeta } from '../../session'
import type { ReactNode } from 'react'

export interface RecoveryDialogProps {
  /** The Project being returned, named in the heading (#51 deviation 14). */
  name: string
  /** Newest first, as `recovery.list` returns them. */
  points: readonly RecoveryPointMeta[]
  /** The tree's own clock, so the screenshot comparison can pin every row's day word. */
  now: string
  onRestore(pointId: string): void
  onClose(): void
}

/**
 * The Point the dialog opens on: the newest, unless the newest is a `pre-restore` Point.
 *
 * A `pre-restore` Point is the state that a *previous* restore replaced. Offering it as the
 * default would make the obvious Enter undo the last thing the person did by accident, which is
 * the opposite of what a picker is for. When it is the only Point there is nothing to choose,
 * and the restore button says so by being disabled.
 */
export function defaultRecoveryPoint(points: readonly RecoveryPointMeta[]): RecoveryPointMeta | null {
  const [newest, second] = points
  if (newest === undefined) return null
  if (newest.kind !== 'pre-restore') return newest
  return second ?? null
}

/** One row: when it was, why BuildBox kept it, and what shape the Project had then. */
function pointLine(point: RecoveryPointMeta, now: string): { time: string; detail: string } {
  const { floorCount, designOptionCount, itemCount } = point.summary
  return {
    time: formatPointTime(point.createdAt, now),
    detail: `${STRINGS.recoveryReason[point.kind]} · ${STRINGS.recoverySummary(floorCount, designOptionCount, itemCount)}`,
  }
}

export function RecoveryDialog({ name, points, now, onRestore, onClose }: RecoveryDialogProps): ReactNode {
  const [selected, setSelected] = useState<string | null>(() => defaultRecoveryPoint(points)?.id ?? null)
  const chosen = points.find((point) => point.id === selected) ?? null

  return (
    <Modal className="recovery-modal" eyebrow={STRINGS.eyebrowRecoveryPoints} heading={STRINGS.recoveryHeading(name)} onClose={onClose}>
      <p>{STRINGS.recoveryBody}</p>
      {points.length === 0 ? (
        <div className="empty-state">{STRINGS.recoveryEmpty}</div>
      ) : (
        <div className="recovery-list" role="radiogroup" aria-label={STRINGS.eyebrowRecoveryPoints}>
          {points.map((point) => {
            const line = pointLine(point, now)
            return (
              <label key={point.id} className={point.id === selected ? 'selected' : ''}>
                <input
                  type="radio"
                  name="recovery"
                  value={point.id}
                  checked={point.id === selected}
                  onChange={() => {
                    setSelected(point.id)
                  }}
                />
                <span>
                  <strong>{line.time}</strong>
                  <small>{line.detail}</small>
                </span>
              </label>
            )
          })}
        </div>
      )}
      <div className="modal-actions">
        <button onClick={onClose}>{STRINGS.cancel}</button>
        <button
          className="button primary"
          disabled={chosen === null}
          onClick={() => {
            if (chosen !== null) onRestore(chosen.id)
          }}
        >
          {STRINGS.recoveryRestore}
        </button>
      </div>
    </Modal>
  )
}
