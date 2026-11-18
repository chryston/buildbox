/**
 * The composition seam between the app and the legacy views (#49, #53).
 *
 * `app` opens a Project session and hands it here with the browser services; this provides the
 * two contexts the legacy views read. One session per mount: a Project's session holds its Web
 * Lock, its undo stack and its unsaved work, so another Project is a different mount of this
 * root — which is why the editor has no Project switcher and asks the app to go back to the
 * Library instead.
 *
 * It holds no state of its own: selection, module and tool live in the UI store, the document
 * in the session, the list of Projects in the Library.
 */
import { useCallback, useMemo, type ReactNode } from 'react'
import type { ProjectSession } from '../../session'
import { SessionContext } from './contexts'
import { LegacyBindingsContext } from './bindings'
import { useSessionBindings, type SessionHost, type SessionViewServices } from './sessionBindings'

export interface LegacyViewRootProps {
  readonly session: ProjectSession
  readonly services: SessionViewServices
  /**
   * What sits above the editor and outside it (#51 §5's read-only strip).
   *
   * A slot rather than a flag, because the legacy views have no vocabulary for a state that only
   * the composition above them knows about — and the strip must not be scrolled away with the Plan.
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
  readonly onSaveFailure: () => void
  /**
   * Leave this Project and show the Project Library (#53).
   *
   * Closing the session is `app`'s, not this root's: the guard that may refuse it is answered by
   * the dialog above, and the Library has to be told the Project is free to open.
   */
  readonly onReturnToProjects: () => void
  readonly children: ReactNode
}

export function LegacyViewRoot({
  session,
  services,
  banner,
  onSaveFailure,
  onReturnToProjects,
  children,
}: LegacyViewRootProps) {
  const showSaveFailure = useCallback(() => {
    onSaveFailure()
  }, [onSaveFailure])

  const host = useMemo<SessionHost>(
    () => ({ returnToProjects: onReturnToProjects, showSaveFailure }),
    [onReturnToProjects, showSaveFailure],
  )

  // There is deliberately no close-on-unmount here. The last session's Web Lock belongs to this
  // document: the browser releases it when the tab goes. Closing on unmount would also fire on
  // React's StrictMode remount in development, which would leave the view rendering a session it
  // had just closed.
  return (
    <>
      {banner}
      <SessionContext.Provider value={session}>
        <SessionBindings services={services} host={host}>{children}</SessionBindings>
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
