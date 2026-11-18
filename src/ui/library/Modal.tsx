/**
 * The dialog chrome every Library dialog is built from (#50 §3, §4; deviation 4).
 *
 * The archive drew the backdrop and the box and stopped there: nothing trapped focus, nothing
 * closed on `Esc`, and no dialog told a screen reader what it was. Production keeps the pixels
 * and adds the behaviour, which is the whole of deviation 4 — "there is no change at rest".
 *
 * Three things close a dialog and they mean the same thing: `Cancel`, `Esc`, and a click on the
 * backdrop rather than on the box. All three route to `onClose`, which for every dialog in this
 * folder means "change nothing", so the equivalence is real and not merely an affordance.
 */
import { useEffect, useId, useRef } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'

/** Everything in the box the keyboard can reach, in DOM order. */
const FOCUSABLE =
  'button:not([disabled]):not([aria-disabled="true"]), input, [href], select, textarea, [tabindex]:not([tabindex="-1"])'

export interface ModalProps {
  /** The small uppercase line above the heading: `Project Backup`, `Restore Backup`. */
  eyebrow?: string
  /**
   * Red eyebrow, for the three dialogs whose subject is that something has gone wrong (#51).
   *
   * A tone rather than a class name, because the archive colours exactly one element of these
   * dialogs — the eyebrow above the heading — and nothing else may reach in and colour the rest.
   */
  eyebrowDanger?: boolean
  heading: string
  /** Absent for a dialog with no way out but an answer (#51's Save failed and conflict dialogs). */
  onClose?: () => void
  children: ReactNode
  /** `false` for a dialog the user must answer rather than escape from (#51). */
  dismissable?: boolean
  /** `.failure-modal` for the dialogs that report something going wrong (#51). */
  className?: string
}

export function Modal({ eyebrow, eyebrowDanger, heading, onClose, children, dismissable = true, className }: ModalProps): ReactNode {
  const box = useRef<HTMLDivElement>(null)
  const headingId = useId()

  useEffect(() => {
    if (!dismissable) return
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose?.()
    }
    // Captured, so a dialog opened over a dialog closes only the top one: the listener stops
    // the event before the one underneath can see it.
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
    }
  }, [dismissable, onClose])

  useEffect(() => {
    // Focus lands inside the box on open. Leaving it there when the box has nothing focusable
    // is deliberate: focus outside a modal would leak Tab to the Library behind it.
    const first = box.current?.querySelector<HTMLElement>(FOCUSABLE)
    if (first !== null && first !== undefined) first.focus()
    else box.current?.focus()
  }, [])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Tab' || box.current === null) return
    const focusable = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement
    if (event.shiftKey && (active === first || active === box.current)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      className="modal-backdrop bb-dialog-scope"
      role="presentation"
      onMouseDown={(event) => {
        if (dismissable && event.target === event.currentTarget) onClose?.()
      }}
    >
      <div
        ref={box}
        className={className === undefined ? 'modal' : `modal ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        {eyebrow !== undefined && (
          <p className={eyebrowDanger ? 'eyebrow danger' : 'eyebrow'}>{eyebrow}</p>
        )}
        <h2 id={headingId}>{heading}</h2>
        {children}
      </div>
    </div>
  )
}
