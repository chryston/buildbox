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
  readonly children: ReactNode
}

export function LegacyViewRoot({ library, session, services, banner, children }: LegacyViewRootProps) {
  const [current, setCurrent] = useState(session)

  const goto = useCallback((projectId: string) => {
    // `switchTo` closes this session before it opens the other, so the lock moves rather
    // than being held twice (#14). A Project that will not open — trashed in another tab,
    // its lock held elsewhere — leaves the view where it was.
    void current.switchTo(projectId).then((opened) => {
      if (opened.ok) setCurrent(opened.value)
    })
  }, [current])

  const host = useMemo<SessionHost>(() => ({ goto }), [goto])

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
