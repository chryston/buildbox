/**
 * The two strips that say something is wrong outside a dialog (#51 §5, §6; deviation 17).
 *
 * Neither exists in the prototype, so neither has a look of its own to keep: both borrow the
 * failure palette and the inset radius, and the read-only one borrows the chosen-row blue,
 * because being read-only is a fact about this tab rather than a fault.
 *
 * Both are `role="status"` rather than `role="alert"`. Neither is an emergency — the app keeps
 * working underneath them — and an alert would interrupt a screen reader mid-sentence to say
 * something the person can read when they look up.
 */
import { STRINGS } from '../strings'
import { Toast } from './Toast'
import type { ReactNode } from 'react'

/**
 * The strip under the toolbar while another tab holds the lock.
 *
 * It is not dismissable, because it is not a message: it is the state. It goes away when the
 * other tab lets go, at which point the session takes over and says so in a toast.
 */
export function ReadOnlyStrip(): ReactNode {
  return (
    <div className="read-only-strip" role="status">
      <span className="status-dot" aria-hidden="true" />
      <p>{STRINGS.readOnlyStrip}</p>
    </div>
  )
}

/**
 * The sentence for the moment the other tab lets go (#51 §5, criterion 11).
 *
 * A toast and not a strip, because it reports an event rather than a state — the state is simply
 * "editable", which needs no words of its own — and a `ui` component rather than a string handed
 * down from `app`, because the wording belongs to `ui/strings` and not to the composition.
 */
export function NowEditableToast({ name, onDismiss }: { name: string; onDismiss: () => void }): ReactNode {
  return <Toast message={{ text: STRINGS.toastNowEditable(name) }} onDismiss={onDismiss} />
}

/** The strip above the Library while the whole browser has no storage to keep Projects in. */
export function StorageNotice(): ReactNode {
  return (
    <div className="storage-notice" role="status">
      <span className="status-dot" aria-hidden="true" />
      <p>{STRINGS.storageUnavailableNotice}</p>
    </div>
  )
}
