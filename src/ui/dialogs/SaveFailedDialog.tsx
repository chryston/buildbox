/**
 * The dialog #14 makes mandatory and #51 draws (§2; the archive's `failure` modal).
 *
 * It says one thing: the newest state of this Project exists only in this tab. Everything about
 * it is arranged to keep that true until the person chooses — `Esc`, the backdrop and a click
 * outside do nothing, because dismissing is not an answer, and the three actions are stacked
 * rather than lined up because each is a whole sentence.
 *
 * The order is #14's, most to least constructive: try again, take the work out of the browser,
 * throw it away. `revision-conflict` is not this dialog's to show — another tab wrote, which is
 * §5's `Changed in another tab` — and the caller routes it there.
 */
import { formatLastSave } from '../library/formatSince'
import { Modal } from '../library/Modal'
import { STRINGS } from '../strings'
import type { SaveFailureReason } from '../../session'
import type { ReactNode } from 'react'

/** The reasons this dialog speaks. A revision conflict has its own dialog (#51 §5). */
export type SaveFailedReason = Exclude<SaveFailureReason, 'revision-conflict'>

export interface SaveFailedDialogProps {
  reason: SaveFailedReason
  /** The last write the store took, or `null` when it never took one. */
  lastSavedAt: string | null
  now: string
  onRetry(): void
  onEmergencyBackup(): void
  onDiscard(): void
}

/**
 * The last-success sentence, with the time in bold.
 *
 * Three pieces rather than one formatted string, because the time is the one part a person
 * reads and `STRINGS` may not contain markup.
 */
function LastSaveSentence({ lastSavedAt, now }: { lastSavedAt: string; now: string }): ReactNode {
  const sentence = STRINGS.saveFailedBody(formatLastSave(lastSavedAt, now))
  return (
    <p>
      {sentence.before}
      <strong>{sentence.strong}</strong>
      {sentence.after}
    </p>
  )
}

export function SaveFailedDialog({
  reason,
  lastSavedAt,
  now,
  onRetry,
  onEmergencyBackup,
  onDiscard,
}: SaveFailedDialogProps): ReactNode {
  return (
    <Modal
      className="failure-modal"
      eyebrow={STRINGS.eyebrowSaveFailed}
      heading={STRINGS.saveFailedHeading}
      dismissable={false}
    >
      <div className="failure-icon" aria-hidden="true">
        !
      </div>
      {lastSavedAt === null ? (
        <p>{STRINGS.saveFailedNothingStored}</p>
      ) : (
        <LastSaveSentence lastSavedAt={lastSavedAt} now={now} />
      )}
      <div className="failure-reason">
        <strong>{STRINGS.saveFailureReason[reason]}</strong>
        <span>{STRINGS.saveFailedHeld}</span>
      </div>
      <div className="failure-actions">
        <button className="button primary" onClick={onRetry}>
          {STRINGS.retrySave}
        </button>
        <button onClick={onEmergencyBackup}>{STRINGS.downloadEmergencyBackup}</button>
        <button className="danger-text" onClick={onDiscard}>
          {STRINGS.discardUnsaved}
        </button>
      </div>
    </Modal>
  )
}
