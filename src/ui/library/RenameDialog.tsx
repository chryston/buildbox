/**
 * The Rename dialog (#50 §2, criterion 13; part of named deviation 7).
 *
 * The archive's `•••` button opened nothing, so there is no prototype pixel to match and the box
 * is built from the same tokens as the dialogs that do have one. It is the only dialog here with
 * a field, which makes it the only one where `Cancel` has to discard something the user typed —
 * the reason the draft name lives in this component and nowhere else.
 *
 * `Cancel`, `Esc` and a backdrop click all reach `onClose`, which drops the draft. Saving an
 * unchanged name is not offered: it would write a revision to say nothing happened.
 */
import { useState } from 'react'
import { STRINGS } from '../strings'
import { Modal } from './Modal'
import type { FormEvent, ReactNode } from 'react'

export interface RenameDialogProps {
  /** The name the Project carries when the dialog opens. */
  name: string
  /** An empty or unchanged name is not a rename, and the button says so by being unavailable. */
  onSave: (name: string) => void
  onClose: () => void
}

export const RenameDialog = ({ name, onSave, onClose }: RenameDialogProps): ReactNode => {
  const [draft, setDraft] = useState(name)
  const trimmed = draft.trim()
  const changed = trimmed !== '' && trimmed !== name

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    // Enter in the field is the same act as pressing Save; nothing else about the dialog moves.
    if (changed) onSave(trimmed)
  }

  return (
    <Modal heading={STRINGS.renameHeading} onClose={onClose}>
      <form className="rename-field" onSubmit={submit}>
        <label htmlFor="rename-project-name">{STRINGS.renameLabel}</label>
        <input
          id="rename-project-name"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
          }}
        />
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            {STRINGS.cancel}
          </button>
          <button type="submit" className="button primary" disabled={!changed}>
            {STRINGS.renameSave}
          </button>
        </div>
      </form>
    </Modal>
  )
}
