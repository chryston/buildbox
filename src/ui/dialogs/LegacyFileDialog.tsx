/**
 * A file picked from `Restore Backup` that is not a Backup at all (#52 criterion 17).
 *
 * The old exports and a Backup share nothing but an extension, and the honest sentence is short:
 * this is old data, and there is a place for it. The dialog is the one step between a picker that
 * accepted `.json` and a review that will adopt those bytes — without it, a reader who picked the
 * wrong thing would land in a flow they did not ask for with no way to say so.
 *
 * Nothing here decides whether the file is readable. `legacyFileKind` only routes on the shape of
 * the JSON; whether the bytes convert is `package`'s judgement, made one step later, and a dialog
 * that claimed to have checked would be lying about a check that has not happened.
 */
import { Modal } from '../library/Modal'
import { STRINGS } from '../strings'
import type { ReactNode } from 'react'

export interface LegacyFileDialogProps {
  onReview(): void
  onClose(): void
}

export function LegacyFileDialog({ onReview, onClose }: LegacyFileDialogProps): ReactNode {
  return (
    <Modal className="legacy-file-modal" eyebrow={STRINGS.migrationEyebrow} heading={STRINGS.migrationFileDetected} onClose={onClose}>
      <div className="modal-actions">
        <button onClick={onClose}>{STRINGS.cancel}</button>
        <button className="button primary" onClick={onReview}>
          {STRINGS.migrationReviewTheFile}
        </button>
      </div>
    </Modal>
  )
}
