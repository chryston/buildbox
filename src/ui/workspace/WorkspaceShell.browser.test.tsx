/**
 * The workspace layout, measured in a real browser (#55 criteria 1, 2, 4, 7).
 *
 * jsdom lays nothing out, so the geometry the issue pins — the 300 px rail with the
 * view card above the inspector, the canvas filling the centre, the notes drawer that
 * never resizes the canvas, the rail drawer below 1024, the draft bar as an overlay —
 * can only be asserted where CSS actually applies. These tests render the shell with
 * plain slot content and read bounding boxes at the widths the criteria name.
 */
import { cleanup, render } from '@testing-library/react'
import { page } from '@vitest/browser/context'
import { afterEach, describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import '../../index.css' // Tailwind preflight: the app's `box-sizing: border-box`.
import '../theme/tokens.css'
import { WorkspaceShell } from './WorkspaceShell'

afterEach(() => {
  cleanup()
})

interface ShellOptions {
  notes?: ReactNode
  draftBar?: ReactNode
  railOpen?: boolean
}

function openShell(options: ShellOptions = {}) {
  return render(
    // `position: fixed` gives the shell the viewport box outright: no body margin, and
    // a definite height for the shell's own `height: 100%`.
    <div style={{ position: 'fixed', inset: 0 }}>
      <WorkspaceShell
        header={<span>header</span>}
        toolbar={<div data-testid="toolbar-row" style={{ height: 44, flex: 'none' }} />}
        viewCard={<div data-testid="view-card-body">view</div>}
        inspector={<div data-testid="inspector-body">inspector</div>}
        canvas={<div data-testid="canvas-body" style={{ width: '100%', height: '100%' }} />}
        draftBar={options.draftBar ?? null}
        notes={options.notes ?? null}
        railOpen={options.railOpen ?? false}
      />
    </div>,
  )
}

const boxOf = (testId: string): DOMRect => {
  const element = document.querySelector(`[data-testid="${testId}"]`)
  if (element === null) throw new Error(`no element with testid ${testId}`)
  return element.getBoundingClientRect()
}

// The layout is viewport-driven, so each test resizes the browser viewport through
// Vitest's own page API and waits for the media queries to see it.
async function viewport(width: number): Promise<void> {
  await page.viewport(width, 1000)
  await expect.poll(() => window.innerWidth).toBe(width)
}

describe('the workspace layout at desktop widths', () => {
  it('stacks the view card above the inspector in a 300 px rail and fills the centre with the canvas', async () => {
    await viewport(1440)
    openShell()
    const rail = boxOf('workspace-rail')
    const viewCard = boxOf('workspace-view-card')
    const inspector = boxOf('inspector-body')
    const canvas = boxOf('workspace-canvas-host')

    // Criterion 1: the saved-view card is the top block of a 300 px rail…
    expect(rail.width).toBe(300)
    expect(viewCard.top).toBeGreaterThanOrEqual(rail.top)
    // …and the selection inspector is directly below it.
    expect(inspector.top).toBeGreaterThanOrEqual(viewCard.bottom)
    expect(inspector.left).toBeGreaterThanOrEqual(rail.left)
    expect(inspector.right).toBeLessThanOrEqual(rail.right)
    // The canvas fills the centre: it starts where the rail ends and runs to the
    // window edge — with the Notes slot empty, nothing renders to its right.
    expect(canvas.left).toBeCloseTo(rail.right, 0)
    expect(canvas.right).toBeCloseTo(window.innerWidth, 0)
    expect(document.querySelector('[data-testid="workspace-notes"]')).toBeNull()
  })

  it('keeps the inspector left of the canvas at 1440 and 1280', async () => {
    for (const width of [1440, 1280]) {
      await viewport(width)
      openShell()
      const inspector = boxOf('inspector-body')
      const canvas = boxOf('workspace-canvas-host')
      // Criterion 2: the inspector never renders in a right column.
      expect(inspector.right, `inspector at ${width} px`).toBeLessThanOrEqual(canvas.left)
      cleanup()
    }
  })

  it('shows a 380 px notes column at 1440 with the inspector still left', async () => {
    await viewport(1440)
    openShell({ notes: <div data-testid="notes-body">notes</div> })
    const notes = boxOf('workspace-notes')
    const canvas = boxOf('workspace-canvas-host')
    const inspector = boxOf('inspector-body')
    expect(notes.width).toBe(380)
    expect(notes.left).toBeGreaterThanOrEqual(canvas.right - 1)
    expect(inspector.right).toBeLessThanOrEqual(canvas.left)
  })
})

describe('the workspace drawers', () => {
  it('renders the notes slot as an overlay below 1280 that never resizes the canvas', async () => {
    await viewport(1279)
    openShell()
    const withoutNotes = boxOf('workspace-canvas-host')
    cleanup()

    openShell({ notes: <div data-testid="notes-body">notes</div> })
    const withNotes = boxOf('workspace-canvas-host')
    const notes = boxOf('workspace-notes')
    // Criterion 4: the drawer overlays the canvas; the canvas box is identical.
    expect(withNotes).toEqual(withoutNotes)
    expect(notes.left).toBeLessThan(withNotes.right)
  })

  it('turns the rail into a drawer below 1024 that overlays without resizing', async () => {
    await viewport(1023)
    openShell()
    const canvasClosed = boxOf('workspace-canvas-host')
    const railClosed = boxOf('workspace-rail')
    // Closed: the rail sits fully off the left edge and the canvas owns the row.
    expect(railClosed.right).toBeLessThanOrEqual(0)
    expect(canvasClosed.left).toBeCloseTo(0, 0)
    cleanup()

    openShell({ railOpen: true })
    const canvasOpen = boxOf('workspace-canvas-host')
    const railOpen = boxOf('workspace-rail')
    // Open: the rail overlays the canvas; the canvas box has not moved.
    expect(canvasOpen).toEqual(canvasClosed)
    expect(railOpen.right).toBeGreaterThan(canvasOpen.left)
    expect(railOpen.width).toBe(300)
  })
})

describe('the draft bar overlay', () => {
  it('anchors to the top centre of the canvas without changing its box', async () => {
    await viewport(1440)
    openShell()
    const bare = boxOf('workspace-canvas-host')
    cleanup()

    openShell({ draftBar: <div data-testid="draft-body">drafting</div> })
    const withDraft = boxOf('workspace-canvas-host')
    const draft = boxOf('workspace-draft-bar')
    // Criterion 7: an overlay — the canvas box is unchanged…
    expect(withDraft).toEqual(bare)
    // …anchored to the top centre of the canvas.
    expect(draft.top).toBeGreaterThanOrEqual(withDraft.top)
    expect(draft.top).toBeLessThan(withDraft.top + 60)
    expect(draft.left + draft.width / 2).toBeCloseTo(withDraft.left + withDraft.width / 2, 0)
  })
})
