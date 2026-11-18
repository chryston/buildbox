/**
 * Another tab wrote, and this one's newest state is not stored (#51 §5).
 *
 * This is what a `revision-conflict` commit failure means to the person editing: the other tab
 * has no Web Lock to respect, because `navigator.locks` is missing or was released when that tab
 * closed. #14's rule still holds — the newer state is only in memory, so nothing may be closed or
 * switched away from until it is resolved — which is why this dialog is not dismissable either.
 *
 * The three answers are ordered by how much work they keep. Reloading throws this tab's edits
 * away; importing as a copy keeps them under a new identity, which is the only way two tabs can
 * both keep their work; the emergency backup takes it out of the browser altogether.
 */
import { Modal } from '../library/Modal'
import { STRINGS } from '../strings'
import type { ReactNode } from 'react'

export interface ConflictDialogProps {
  name: string
  /** Re-read the stored record and make it this tab's state, dropping these edits. */
  onReload(): void
  /** Commit this tab's in-memory Project as `{name} — Copy` and open the copy. */
  onImportCopy(): void
  onEmergencyBackup(): void
}

export function ConflictDialog({ name, onReload, onImportCopy, onEmergencyBackup }: ConflictDialogProps): ReactNode {
  return (
    <Modal
      className="failure-modal"
      eyebrow={STRINGS.eyebrowChangedInAnotherTab}
      eyebrowDanger
      heading={STRINGS.conflictHeading}
      dismissable={false}
      lead={
        <div className="failure-icon" aria-hidden="true">
          !
        </div>
      }
    >
      <p>{STRINGS.conflictBody(name)}</p>
      <div className="failure-actions">
        <button className="button primary" onClick={onReload}>
          {STRINGS.conflictReload}
        </button>
        <button onClick={onImportCopy}>{STRINGS.conflictImportCopy}</button>
        <button className="danger-text" onClick={onEmergencyBackup}>
          {STRINGS.downloadEmergencyBackup}
        </button>
      </div>
    </Modal>
  )
}
