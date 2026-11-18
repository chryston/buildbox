/**
 * The import collision dialog (#50 §4 step 8, criterion 18; named deviation 8).
 *
 * The prototype never reached this state — it had no real file to restore — so the box is new,
 * built from the same tokens, with one text action and two equal-weight choices.
 *
 * The two choices are deliberately not styled as primary and secondary. Both answers are right
 * and they are not reversible in the same way: `Replace` keeps the identity and keeps a copy of
 * what was there as a Recovery Point, `Import as a copy` mints new IDs and leaves the original
 * alone. A dialog that shaded one of them blue would be making the decision for the person who
 * has to live with it.
 *
 * `Cancel—change nothing` is the third answer and the widest thing in the box, because the
 * archive's own copy is the promise this dialog is able to keep: nothing has been written yet.
 */
import { STRINGS } from '../strings'
import { Modal } from './Modal'
import type { ReactNode } from 'react'

export interface CollisionDialogProps {
  /** The name inside the Backup. */
  name: string
  /** The name a copy would take, already settled on by `copyNameFor`. */
  copyName: string
  onReplace: () => void
  onCopy: () => void
  onClose: () => void
}

export const CollisionDialog = ({ name, copyName, onReplace, onCopy, onClose }: CollisionDialogProps): ReactNode => {
  const body = STRINGS.collisionBody(name)
  return (
    <Modal eyebrow={STRINGS.eyebrowRestore} heading={STRINGS.collisionHeading} onClose={onClose}>
      <p>
        {body.before}
        <strong>{body.strong}</strong>
        {body.after}
      </p>
      <div className="choice-grid">
        <button type="button" onClick={onReplace}>
          {STRINGS.collisionReplace}
          <span>{STRINGS.collisionReplaceBody}</span>
        </button>
        <button type="button" onClick={onCopy}>
          {STRINGS.collisionCopy}
          <span>{STRINGS.collisionCopyBody(copyName)}</span>
        </button>
      </div>
      <button type="button" className="full-cancel" onClick={onClose}>
        {STRINGS.collisionCancel}
      </button>
    </Modal>
  )
}
