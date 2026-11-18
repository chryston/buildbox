/**
 * The composition seam of the flagged app (#49).
 *
 * `app` opens the first Project session and hands it here with the Library and the browser
 * services; this provides the three contexts the legacy views read and keeps the *current*
 * session in React state, because switching Projects means rendering a different session —
 * which is also what gives the new one an empty undo stack (#49 criterion 3).
 *
 * It holds no state of its own beyond that: selection, module and tool live in the UI store,
 * the document in the session, the list of Projects in the Library.
 */
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import type { LibraryStore, ProjectSession } from '../../session'
import { LibraryContext, SessionContext } from './contexts'
import { LegacyBindingsContext } from './bindings'
import { useSessionBindings, type SessionHost, type SessionViewServices } from './sessionBindings'

export interface LegacyViewRootProps {
  readonly library: LibraryStore
  readonly session: ProjectSession
  readonly services: SessionViewServices
  /**
   * What sits above the editor and outside it (#51 §5's read-only strip).
   *
   * A slot rather than a flag, because the legacy views have no vocabulary for a state that only
   * the flagged composition knows about — and the strip must not be scrolled away with the Plan.
   */
  readonly banner?: ReactNode
  /**
   * Open the Save failed dialog (#51 §2, criterion 10).
   *
   * The dialog is `app`'s — it needs the services that retry, download and discard — so the view
   * only ever asks. Two things reach it: the red status in the toolbar, and an attempt to leave a
   * Project whose unsaved work is holding this tab, which the guard refused and which is the
   * person saying they want to leave anyway.
   */
  readonly onSaveFailure?: () => void
  /**
   * The view moved to another Project's session (#51 §2).
   *
   * The composition above needs to know which Project this tab is showing — the read-only strip
   * and the Save failed dialog are both about *this* tab's session, and after a switch the one it
   * was mounted with is history. It is a report, not a request: this root still owns the session.
   */
  readonly onSessionChange?: (session: ProjectSession) => void
  readonly children: ReactNode
}

export function LegacyViewRoot({
  library,
  session,
  services,
  banner,
  onSaveFailure,
  onSessionChange,
  children,
}: LegacyViewRootProps) {
  const [current, setCurrent] = useState(session)

  const goto = useCallback(
    (projectId: string) => {
      // `switchTo` closes this session before it opens the other, so the lock moves rather
      // than being held twice (#14). A Project that will not open — trashed in another tab,
      // its lock held elsewhere — leaves the view where it was.
      void current.switchTo(projectId).then((opened) => {
        if (opened.ok) {
          setCurrent(opened.value)
          onSessionChange?.(opened.value)
          return
        }
        // The guard is the only refusal that is this tab's own doing: there is work here that
        // has not been stored. The person who clicked the tab has just tried to leave it behind,
        // so the dialog that names the three ways out comes back up (#51 §2).
        if (opened.error === 'guarded') onSaveFailure?.()
      })
    },
    [current, onSaveFailure, onSessionChange],
  )

  const showSaveFailure = useCallback(() => {
    onSaveFailure?.()
  }, [onSaveFailure])

  const host = useMemo<SessionHost>(() => ({ goto, showSaveFailure }), [goto, showSaveFailure])

  // There is deliberately no close-on-unmount here. `switchTo` above closes every session it
  // replaces, and the last one's Web Lock belongs to this document: the browser releases it
  // when the tab goes. Closing on unmount would also fire on React's StrictMode remount in
  // development, which would leave the view rendering a session it had just closed.
  return (
    <>
      {banner}
      <SessionContext.Provider value={current}>
        <LibraryContext.Provider value={library}>
          <SessionBindings services={services} host={host}>{children}</SessionBindings>
        </LibraryContext.Provider>
      </SessionContext.Provider>
    </>
  )
}

/** The bindings have to be built *inside* the session context, so they get their own node. */
function SessionBindings({
  services,
  host,
  children,
}: {
  services: SessionViewServices
  host: SessionHost
  children: ReactNode
}) {
  const bindings = useSessionBindings(services, host)
  return <LegacyBindingsContext.Provider value={bindings}>{children}</LegacyBindingsContext.Provider>
}
