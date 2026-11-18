/**
 * Delete a Project for good (#51 §3; the archive's `delete` modal).
 *
 * Two things make this dialog safe without making it a lecture, and #28 is explicit that
 * safeguard parity is a hard requirement — no extra "are you sure", and none removed. The first
 * is the summary box: it names the Project and counts what is about to be destroyed, so the
 * person is never confirming an abstraction. The second is that `Download Backup before deleting`
 * is a button rather than a warning, because the way out of a permanent delete is a file.
 *
 * `Delete permanently` is the only red box in the app, and it sits at the far end of the action
 * row from `Cancel` — the archive's separation, which is what stops a stray Enter from landing on
 * it. The dialog itself is dismissable: opening it decides nothing.
 */
import { Modal } from '../library/Modal'
import { STRINGS } from '../strings'
import type { ProjectSummary } from '../../domain'
import type { ReactNode } from 'react'

export interface PermanentDeleteDialogProps {
  /** The Project being deleted, named in the box (#51 deviation 14). */
  name: string
  summary: ProjectSummary
  /** How many Recovery Points go with it, which is what makes the delete total. */
  recoveryPoints: number
  onDownloadBackup(): void
  onDelete(): void
  onClose(): void
}

export function PermanentDeleteDialog({
  name,
  summary,
  recoveryPoints,
  onDownloadBackup,
  onDelete,
  onClose,
}: PermanentDeleteDialogProps): ReactNode {
  return (
    <Modal eyebrow={STRINGS.eyebrowPermanentDeletion} heading={STRINGS.permanentDeleteHeading} onClose={onClose}>
      <p>{STRINGS.permanentDeleteBody}</p>
      <div className="summary-box">
        <strong>{name}</strong>
        <span>{STRINGS.permanentDeleteSummary(summary.floorCount, summary.designOptionCount, recoveryPoints)}</span>
      </div>
      <button className="backup-before-delete" onClick={onDownloadBackup}>
        {STRINGS.backupBeforeDelete}
      </button>
      <div className="modal-actions">
        <button onClick={onClose}>{STRINGS.cancel}</button>
        <button className="button danger-button" onClick={onDelete}>
          {STRINGS.deletePermanently}
        </button>
      </div>
    </Modal>
  )
}
