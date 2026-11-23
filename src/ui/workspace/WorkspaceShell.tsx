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
import type { SplitPanesProps } from './SplitPanes'
import { SplitPanes } from './SplitPanes'
import './workspace.css'

export interface WorkspaceShellProps {
  header: ReactNode
  toolbar: ReactNode
  /**
   * The mode bar (#70 §3): a full-width row between the toolbar and the body, coloured by Renovation
   * Display. It is a row of the shell rather than a child of the canvas host, because the host sizes
   * its `<svg>` to its own full height and an in-flow band there would shift the canvas for every
   * Project. Absent with the renovation flag off, which leaves the #55 layout untouched.
   */
  renovationBar?: ReactNode
  /**
   * The legend under the canvas (#70 §4): a row of the shell below the body, for the same reason the
   * mode bar is one above it — the canvas host sizes its `<svg>` to its own height. Absent with the
   * renovation flag off, which leaves the #55 layout untouched.
   */
  renovationLegend?: ReactNode
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
  /**
   * The split workspace (#75 §2): the two panes and the rule between them, rendered inside the canvas
   * host in place of the bare canvas. The shell keeps composing the Plan pane's body out of `canvas`,
   * `draftBar` and `warningStrip`, because where those three sit is the shell's business; which pane
   * is open, how wide each is, and what closes one is the workspace's. Absent leaves the #55 layout —
   * one canvas filling the host — exactly as it was.
   */
  split?: SplitPanesProps | null
  children?: never
}

export function WorkspaceShell(props: WorkspaceShellProps): ReactNode {
  const { header, toolbar, renovationBar, renovationLegend, viewCard, inspector, canvas, draftBar, warningStrip, notes, railOpen, canvasHostRef, split } = props
  /** What the Plan pane shows: the canvas, with the two bars anchored to it and not to the split. */
  const planBody = (
    <>
      {canvas}
      {draftBar !== undefined && draftBar !== null && (
        <div className="bb-workspace-draft-bar" data-testid="workspace-draft-bar">{draftBar}</div>
      )}
      {warningStrip !== undefined && warningStrip !== null && (
        <div className="bb-workspace-warning-strip" data-testid="workspace-warning-strip">{warningStrip}</div>
      )}
    </>
  )
  return (
    <div className="bb-workspace" data-testid="floor-workspace">
      <header className="bb-workspace-header">{header}</header>
      {toolbar}
      {renovationBar}
      <div className="bb-workspace-body">
        <aside className="bb-workspace-rail" data-open={railOpen ? 'true' : 'false'} data-testid="workspace-rail">
          <section className="bb-workspace-card" data-testid="workspace-view-card">{viewCard}</section>
          {inspector}
        </aside>
        <div className="bb-workspace-canvas-host" data-testid="workspace-canvas-host" ref={canvasHostRef} tabIndex={-1}>
          {split !== undefined && split !== null ? (
            <SplitPanes {...split} plan={{ ...split.plan, body: planBody }} />
          ) : (
            planBody
          )}
        </div>
        {notes !== null && notes !== undefined && notes !== false && (
          <aside className="bb-workspace-notes" data-testid="workspace-notes">{notes}</aside>
        )}
      </div>
      {renovationLegend !== undefined && renovationLegend !== null && renovationLegend !== false && (
        <div className="bb-renovation-legend-row">{renovationLegend}</div>
      )}
    </div>
  )
}
