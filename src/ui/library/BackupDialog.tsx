/**
 * The Download Backup dialog (#50 §3, criterion 15).
 *
 * It says four things and nothing more: what the file is, how big it will be, that it holds the
 * complete property record unencrypted, and that BuildBox cannot verify where the copy ends up.
 * The last of those is the reason the dialog exists at all — without it, a tick in a card would
 * read as a promise #14 refuses to make.
 *
 * `Cancel` sits left of the primary action and is a word rather than a box, matching the
 * archive. Confirming is the only loud button.
 */
import { STRINGS } from '../strings'
import { Modal } from './Modal'
import type { ReactNode } from 'react'

/** `12.4 MB`, or the archive's `< 0.1 MB` for anything that would round to zero. */
export function formatSize(sizeBytes: number): string {
  const megabytes = sizeBytes / 1_000_000
  if (megabytes < 0.05) return STRINGS.backupSizeUnknown
  return `${megabytes.toFixed(1)} MB`
}

export interface BackupDialogProps {
  fileName: string
  sizeBytes: number
  /** Disabled while the codec is running, so a second click cannot start a second download. */
  busy: boolean
  onConfirm: () => void
  onClose: () => void
}

export const BackupDialog = ({
  fileName,
  sizeBytes,
  busy,
  onConfirm,
  onClose,
}: BackupDialogProps): ReactNode => (
  <Modal eyebrow={STRINGS.eyebrowProjectBackup} heading={STRINGS.backupHeading} onClose={onClose}>
    <p>{STRINGS.backupBody}</p>
    <div className="summary-box">
      <strong>{fileName}</strong>
      <span>{STRINGS.backupSize(formatSize(sizeBytes))}</span>
    </div>
    <p className="helper">{STRINGS.backupHelper}</p>
    <div className="modal-actions">
      <button type="button" onClick={onClose}>
        {STRINGS.cancel}
      </button>
      <button type="button" className="button primary" disabled={busy} onClick={onConfirm}>
        {STRINGS.downloadBackup}
      </button>
    </div>
  </Modal>
)
