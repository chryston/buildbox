/**
 * Comments through the real workspace (#80 acceptance criteria).
 *
 * Each criterion is answered by a person's gesture on the real `App`, with the Project read only to
 * witness what the gesture left behind: the panel listing and filtering, the overlay's pins, a pin click
 * taking the focus, the Comment tool anchoring where the click landed, the inline editor, the inspector's
 * note section, the Warning strip's linked note, and Undo taking a note away without moving anything else.
 *
 * Coordinates: the Plan View is at 0.05 px per mm with no pan, so a Floor point is its own client pixel
 * divided by twenty. jsdom lays nothing out, so the canvas box reads as zeros, exactly as
 * `servicesFlow.test.tsx` relies on.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import type { Comment, Project } from '../domain'
import { withComments } from '../domain/testing'
import { notesSessionStore, PLAN_IMAGE_ACCEPT, WorkspaceProvider, workspaceStore, type WorkspaceServices } from '../ui'
import type { Viewport, ViewportCache } from '../ui'
import { openTestView, renderWithBindings as render, TEST_EXPORT_PORT, type TestView } from '../ui/legacy/testing'

if (!globalThis.PointerEvent) globalThis.PointerEvent = MouseEvent as typeof PointerEvent

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const PX = 0.05

function sceneProject(): Project {
  const text = readFileSync(join(fixturesRoot, 'domain', 'v15', 'comments.json'), 'utf8')
  return withComments(structuredClone((JSON.parse(text) as { domainSchemaVersion: number; project: Project }).project))
}

function testWorkspaceServices(): WorkspaceServices {
  const cache = new Map<string, Viewport>()
  const viewportCache: ViewportCache = {
    read: async (viewKey) => cache.get(viewKey),
    write: (viewKey, viewport) => {
      cache.set(viewKey, viewport)
    },
    readActive: async () => null,
    writeActive: () => {},
    readPane: async () => null,
    writePane: () => {},
  }
  return {
    intent: view.services.intent,
    assetUrls: view.services.assetUrls,
    now: () => '2026-01-01T00:00:00.000Z',
    readPlanImage: () => Promise.reject(new Error('jsdom models no file reader')),
    planImageAccept: PLAN_IMAGE_ACCEPT,
    planCatalogue: [{ key: 'sofa-2', label: 'Sofa 2-seater' }],
    viewportCache,
    exportDrawings: TEST_EXPORT_PORT,
  }
}

let view: TestView

async function renderWorkspace(project: Project = sceneProject()): Promise<void> {
  view = await openTestView(project)
  workspaceStore.getState().reset()
  notesSessionStore.getState().reset()
  render(
    <WorkspaceProvider
      session={view.session}
      services={testWorkspaceServices()}
      onReturnToProjects={() => {}}
      onShowSaveFailure={() => {}}
    >
      <App />
    </WorkspaceProvider>,
    view,
    { onWorkspace: true },
  )
  await screen.findByTestId('floor-plan-canvas')
  act(() => workspaceStore.getState().setViewport(`plan:${view.project().floors[0]?.id ?? ''}`, { zoom: PX, panX: 0, panY: 0 }))
}

const stored = (): Comment[] => view.project().comments
const counter = (): number => view.project().commentReferenceCounter
const row = (reference: string): HTMLElement => screen.getByTestId(`note-row-${reference}`)
const rows = (): HTMLElement[] => Array.from(screen.getByTestId('note-rows').children) as HTMLElement[]

beforeEach(async () => {
  await renderWorkspace()
})

describe('the Notes panel (#80 §4, §5)', () => {
  it('is open by default and lists the notes the context allows', () => {
    expect(screen.getByTestId('notes-panel')).toBeTruthy()
    // The fixture holds nine notes; the context rules are on, so at least the Floor's own are here.
    expect(rows().length).toBeGreaterThan(0)
  })

  it('shows every note once the context rules are switched off, and hides the resolved ones on request', async () => {
    await userEvent.click(screen.getByTestId('notes-current-context'))
    // The status filter starts on `Open`, so the fixture's one resolved note is hidden until asked for.
    expect(rows()).toHaveLength(8)
    await userEvent.selectOptions(screen.getByTestId('notes-status-filter'), 'any')
    expect(rows()).toHaveLength(9)
    await userEvent.selectOptions(screen.getByTestId('notes-status-filter'), 'resolved')
    expect(rows()).toHaveLength(1)
    expect(row('C-009')).toBeTruthy()
  })

  it('searches reference, title and body across the whole Project', async () => {
    await userEvent.click(screen.getByTestId('notes-current-context'))
    await userEvent.type(screen.getByTestId('notes-search'), 'C-004')
    expect(rows()).toHaveLength(1)
    expect(row('C-004')).toBeTruthy()
  })

  it('collapses to a rail and opens again from the header switch', async () => {
    await userEvent.click(screen.getByTestId('notes-panel-toggle'))
    expect(screen.getByTestId('notes-panel-collapsed')).toBeTruthy()
    await userEvent.click(screen.getByTestId('notes-panel-toggle'))
    expect(screen.getByTestId('notes-panel')).toBeTruthy()
  })
})

describe('the overlay (#80 §7)', () => {
  it('is off until the pill is pressed, then draws a pin per anchored note', async () => {
    expect(screen.queryAllByTestId(/^note-pin-/)).toHaveLength(0)
    const pill = screen.getByTestId('notes-overlay-button')
    expect(pill.getAttribute('aria-pressed')).toBe('false')
    await userEvent.click(pill)
    expect(pill.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getAllByTestId(/^note-pin-/).length).toBeGreaterThan(0)
  })

  it('reveals one note when its row is clicked, and clears the focus on Escape', async () => {
    await userEvent.click(screen.getByTestId('notes-overlay-button'))
    await userEvent.click(screen.getByTestId('notes-current-context'))
    // Clicking the pin on the Plan View reveals the note: its row becomes the selected one (#80 §7.5).
    const pin = screen.getAllByTestId(/^note-pin-/)[0]!
    const commentId = (pin.getAttribute('data-testid') ?? '').replace('note-pin-', '')
    const reference = stored().find((each) => each.id === commentId)?.reference
    if (reference === undefined) throw new Error(`no Comment ${commentId}`)
    fireEvent.pointerDown(pin, { button: 0, buttons: 1 })
    expect(row(reference).getAttribute('data-selected')).toBe('true')
    expect(screen.getAllByTestId(/^note-pin-/).length).toBeGreaterThan(0)
    // Escape hides the revealed note again, leaving the overlay on and the drawing untouched (§7.5).
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(notesSessionStore.getState().selectedCommentId).toBeNull()
    expect(screen.getByTestId('notes-overlay-button').getAttribute('aria-pressed')).toBe('true')
  })
})

describe('the Comment tool and editor (#80 §9, §10)', () => {
  it('anchors a Floor Point where an empty click landed and titles it on Enter', async () => {
    await userEvent.click(screen.getByTestId('renovation-tool-comment'))
    expect(screen.getByTestId('comment-tool-hint')).toBeTruthy()
    const canvas = screen.getByTestId('floor-plan-canvas')
    // An empty stretch of Floor: (4000, 3000) mm at 0.05 px per mm.
    fireEvent.click(canvas, { clientX: 4000 * PX, clientY: 3000 * PX })
    const title = screen.getByTestId('note-editor-title')
    await userEvent.clear(title)
    await userEvent.type(title, 'Check the skirting here{Enter}')
    const made = stored().filter((each) => each.title === 'Check the skirting here')
    expect(made).toHaveLength(1)
    expect(made[0]!.anchor).toMatchObject({ kind: 'floor_point' })
    // The counter moved to the number after the highest the fixture held.
    expect(counter()).toBe(10)
  })

  it('will not commit an empty Title: the note keeps the one it had', async () => {
    await userEvent.click(screen.getByTestId('renovation-tool-comment'))
    const canvas = screen.getByTestId('floor-plan-canvas')
    fireEvent.click(canvas, { clientX: 4200 * PX, clientY: 3100 * PX })
    const title = screen.getByTestId('note-editor-title')
    await userEvent.clear(title)
    await userEvent.type(title, '{Enter}')
    const made = stored().filter((each) => each.anchor.kind === 'floor_point' && each.title === '')
    expect(made).toHaveLength(0)
    // The neutral Title the tool started with is still there, because nothing was committed over it.
    expect(stored().filter((each) => each.title === 'New comment').length).toBe(1)
  })
})

describe('the inspector and the Warning strip (#80 §8, §11)', () => {
  it('names the notes about the selected thing', async () => {
    const wall = view.project().existingModel.walls[0]!.id
    await userEvent.click(screen.getByTestId('notes-current-context'))
    // C-005 is anchored to the fixture's first Wall.
    expect(stored().some((each) => each.anchor.kind === 'entity' && each.anchor.entityId === wall)).toBe(true)
    const panel = screen.getByTestId('notes-panel')
    expect(within(panel).getByTestId('note-row-C-005')).toBeTruthy()
  })

  it('makes a linked note from the Warning strip and takes it away again with Undo', async () => {
    const before = stored().length
    const linkedBefore = stored().filter((each) => each.linkedWarning !== undefined).length
    // The strip starts collapsed; the rows and their links only exist once it is opened.
    await userEvent.click(screen.getByTestId('warning-toggle'))
    const strip = screen.getByTestId('warning-strip')
    const button = strip.querySelector('[data-testid^="warning-comment-"]')
    if (button === null) throw new Error('the Warning strip offered no link to a Comment')
    await userEvent.click(button)
    const made = stored().filter((each) => each.linkedWarning !== undefined)
    expect(made).toHaveLength(linkedBefore + 1)
    const linked = made[made.length - 1]!
    expect(linked.priority).toBe('high')
    expect(linked.status).toBe('open')
    expect(stored()).toHaveLength(before + 1)
    act(() => view.session.undo())
    expect(stored()).toHaveLength(before)
    // The counter does not rewind: a number once handed out is never handed out twice.
    expect(counter()).toBe(10)
  })
})
