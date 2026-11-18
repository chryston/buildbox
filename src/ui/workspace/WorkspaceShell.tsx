/**
 * The workspace layout (#55 criteria 1, 2, 4, 7): header, one fixed-height toolbar row,
 * then a body of left rail (view card above selection inspector), canvas host, and a
 * notes slot. The shell is slot-driven so the layout tests can pin the geometry with
 * plain content, and so #61's notes and #58's draft bar arrive as new slot contents
 * rather than new layout.
 *
 * The rail is static at 300 px from 1024 px up and a drawer below; the notes slot is
 * zero-width while empty, a static 380 px column from 1280 px, and a fixed overlay
 * below — the canvas host is never resized by either.
 */
import type { ReactNode, RefObject } from 'react'
import './workspace.css'

export interface WorkspaceShellProps {
  header: ReactNode
  toolbar: ReactNode
  viewCard: ReactNode
  inspector: ReactNode
  canvas: ReactNode
  /** Anchored to the top of the canvas; empty while nothing is being drafted (#58). */
  draftBar?: ReactNode
  /** The strip along the bottom edge of the canvas; its content is #66. */
  warningStrip?: ReactNode
  /** The Notes slot: zero-width until #61 gives it content. */
  notes?: ReactNode
  /** The rail's drawer state below 1024 px; ignored above it. */
  railOpen: boolean
  /** The canvas host element, so `Fit` can measure it without owning its layout. */
  canvasHostRef?: RefObject<HTMLDivElement | null>
  children?: never
}

export function WorkspaceShell(props: WorkspaceShellProps): ReactNode {
  const { header, toolbar, viewCard, inspector, canvas, draftBar, warningStrip, notes, railOpen, canvasHostRef } = props
  return (
    <div className="bb-workspace" data-testid="floor-workspace">
      <header className="bb-workspace-header">{header}</header>
      {toolbar}
      <div className="bb-workspace-body">
        <aside className="bb-workspace-rail" data-open={railOpen ? 'true' : 'false'} data-testid="workspace-rail">
          <section className="bb-workspace-card" data-testid="workspace-view-card">{viewCard}</section>
          {inspector}
        </aside>
        <div className="bb-workspace-canvas-host" data-testid="workspace-canvas-host" ref={canvasHostRef}>
          {canvas}
          {draftBar !== undefined && draftBar !== null && (
            <div className="bb-workspace-draft-bar" data-testid="workspace-draft-bar">{draftBar}</div>
          )}
          {warningStrip !== undefined && warningStrip !== null && (
            <div className="bb-workspace-warning-strip" data-testid="workspace-warning-strip">{warningStrip}</div>
          )}
        </div>
        {notes !== null && notes !== undefined && notes !== false && (
          <aside className="bb-workspace-notes" data-testid="workspace-notes">{notes}</aside>
        )}
      </div>
    </div>
  )
}
