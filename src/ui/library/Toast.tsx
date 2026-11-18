/**
 * The Library's one toast (#50 §2).
 *
 * `role="status"` so it is announced without stealing focus — a Backup that finished downloading
 * must not yank the keyboard out of a dialog the user is reading. It carries at most one action
 * (`View Trash`, `Dismiss`) and nothing else: every Library toast reports something that has
 * already happened, so there is never a second choice to make here.
 */
import { STRINGS } from '../strings'
import type { ReactNode } from 'react'

export interface ToastMessage {
  text: string
  /** The one thing worth offering from here, such as `View Trash`. */
  action?: { label: string; run: () => void }
}

export const Toast = ({ message, onDismiss }: { message: ToastMessage; onDismiss: () => void }): ReactNode => (
  <div className="toast" role="status">
    <span>{message.text}</span>
    {message.action !== undefined && (
      <button type="button" onClick={message.action.run}>
        {message.action.label}
      </button>
    )}
    <button type="button" onClick={onDismiss}>
      {STRINGS.dismiss}
    </button>
  </div>
)
