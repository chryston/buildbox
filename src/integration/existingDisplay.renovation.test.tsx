/**
 * The Existing display, locked and unlocked (#70 §7c).
 *
 * Once a Project carries a Design Option, the Existing Model is the record every Option is drawn
 * against, so a baseline entity looked at in the Existing display is shown without its offers: no end
 * handles, no rotate grip, no editable field — until `Correct Existing Model…` says the person means
 * to change the survey itself. The edit made after that press is refused by the edit layer, and the
 * refusal is where the danger dialog asks what it does to every Option. A Project with no Design
 * Option has nothing sharing the record, so its Existing edits commit exactly as they always did
 * (criterion 24).
 *
 * The fixture is the `renovation-views` scene with its default view bound to Option A in Existing
 * display — the case the criteria are written against. W-6 (`seed-wall-013`) is the entity under the
 * pointer: a Wall joined to nothing, so its length is its own to change.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { currentSchemaOf } from '../domain/testing'
import App from '../App'
import type { Project } from '../domain'
import { PLAN_IMAGE_ACCEPT, planItemsForFloor, WorkspaceProvider, workspaceStore, type WorkspaceServices } from '../ui'
import type { Viewport, ViewportCache } from '../ui'
import { openTestView, renderWithBindings as render, TEST_EXPORT_PORT, type TestView } from '../ui/legacy/testing'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')

/** W-6: a straight 2500 mm Wall joined to nothing. */
const WALL = 'seed-wall-013'
const LOCK_NOTICE = 'Every Design Option is drawn against this record. Press Correct Existing Model… below to change it.'

function seedProject(): Project {
  const seed = JSON.parse(
    readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'renovation-views.json'), 'utf8'),
  ) as { projects: { data: Project }[] }
  return currentSchemaOf(seed.projects[0]!.data, 8)
}

/** The default view — the one the workspace opens on — bound to Option A in Existing display. */
function existingViewProject(): Project {
  const project = seedProject()
  const first = project.views[0]!
  first.designOptionId = 'option-a'
  first.renovationDisplay = 'existing'
  return project
}

/** The same Floor with no Design Option at all: nothing shares the record (criterion 24). */
function baselineOnlyProject(): Project {
  const project = existingViewProject()
  project.designOptions = []
  for (const each of project.views) {
    each.designOptionId = null
    each.renovationDisplay = 'existing'
  }
  return project
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

async function renderWorkspace(project: Project): Promise<void> {
  view = await openTestView(project)
  workspaceStore.getState().reset()
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
}

/**
 * Select the Wall by the band the Plan View paints for it — the hit shape the pointer answers to.
 * jsdom lays nothing out, so the coordinates are the ones the other Floor-workspace flows use.
 */
const selectWall = (id: string = WALL): void => {
  // The Wall is painted twice — its band and its hit shape share the id — and the hit shape is the
  // one that answers to the pointer.
  const bands = screen.getAllByTestId(`wall-band-${id}`)
  const band = bands[bands.length - 1] as HTMLElement
  fireEvent.pointerDown(band, { clientX: 2000, clientY: 0 })
  fireEvent.pointerUp(band, { clientX: 2000, clientY: 0 })
  fireEvent.click(band, { clientX: 2000, clientY: 0 })
}

const wallLength = (): number => {
  const line = view.project().existingModel.walls.find((each) => each.id === WALL)!.line
  if (line.kind !== 'line') return Number.NaN
  return Math.round(Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y))
}

const revision = (): number => view.session.getSnapshot().revision

/** Type a new length into the shut-or-open field and let it commit on the way out. */
async function commitLength(user: UserEvent, mm: string): Promise<void> {
  const field = screen.getByTestId('wall-length')
  await user.clear(field)
  await user.type(field, mm)
  await user.tab()
}

beforeEach(() => {
  workspaceStore.getState().reset()
})

describe('a baseline record in Existing display (#70 criterion 23)', () => {
  it('is shown without its offers, and says which press opens it', async () => {
    await renderWorkspace(existingViewProject())
    selectWall()

    // The selection is real — the inspector is answering it — but nothing invites an edit.
    expect(await screen.findByTestId('wall-inspector-ref')).toHaveTextContent('W-6')
    expect(screen.queryAllByTestId(/^wall-handle-/)).toHaveLength(0)
    for (const testId of ['wall-length', 'wall-thickness']) {
      expect(screen.getByTestId(testId)).toBeDisabled()
      expect(screen.getByTestId(testId)).toHaveAttribute('title', LOCK_NOTICE)
    }
    expect(screen.getByTestId('renovation-inspector-action-correct')).toBeEnabled()
  })

  it('hands the handles and fields back for one press, and asks before the edit lands', async () => {
    const user = userEvent.setup()
    await renderWorkspace(existingViewProject())
    selectWall()
    await user.click(screen.getByTestId('renovation-inspector-action-correct'))

    // Both end handles are back, and the fields take a keystroke.
    await waitFor(() => expect(screen.getAllByTestId(`wall-handle-${WALL}`)).toHaveLength(2))
    expect(screen.getByTestId('wall-length')).toBeEnabled()
    expect(screen.getByTestId('wall-length')).not.toHaveAttribute('title')

    const before = revision()
    const length = wallLength()
    await commitLength(user, '3000')

    // The edit layer refuses a baseline edit while Options share the record, and the refusal is the
    // moment to ask: the Project is exactly where it was.
    const dialog = await screen.findByTestId('correct-existing-dialog')
    expect(dialog).toHaveTextContent('Correct the shared Existing Model?')
    expect(dialog).toHaveTextContent('Option A · Open kitchen')
    expect(dialog).toHaveTextContent('Option B · Widened opening')
    expect(revision()).toBe(before)
    expect(wallLength()).toBe(length)
    expect(workspaceStore.getState().correctionUnlocked).toBeNull()

    await user.click(screen.getByTestId('correct-existing-confirm'))
    await waitFor(() => expect(revision()).toBe(before + 1))
    expect(wallLength()).toBe(3000)
    // One transaction, named for the baseline entity it moved.
    expect(view.session.getSnapshot().history?.undoLabel).toBe('Correct Existing Model: W-6')
  })

  it('puts the lock back on Escape, with nothing written', async () => {
    await renderWorkspace(existingViewProject())
    selectWall()
    await act(async () => { workspaceStore.getState().unlockCorrection(WALL) })
    await waitFor(() => expect(screen.getByTestId('wall-length')).toBeEnabled())
    const before = JSON.stringify(view.project())

    await act(async () => { fireEvent.keyDown(window, { key: 'Escape' }) })

    await waitFor(() => expect(screen.getByTestId('wall-length')).toBeDisabled())
    expect(screen.queryAllByTestId(/^wall-handle-/)).toHaveLength(0)
    expect(workspaceStore.getState().correctionUnlocked).toBeNull()
    expect(JSON.stringify(view.project())).toBe(before)
  })

  it('leaves the selection alone when a locked click lands on the Wall', async () => {
    await renderWorkspace(existingViewProject())
    selectWall()
    await screen.findByTestId('wall-inspector-ref')
    // A locked selection is still a selection: pressing the band again keeps the record inspected
    // rather than dropping it, and still writes nothing.
    const before = revision()
    selectWall()
    expect(screen.getByTestId('wall-inspector-ref')).toHaveTextContent('W-6')
    expect(revision()).toBe(before)
  })
})

describe('a survey edit of the baseline in Existing display (#70 §7e)', () => {
  it('asks what every Option will see before a baseline Wall is removed', async () => {
    const user = userEvent.setup()
    await renderWorkspace(existingViewProject())
    selectWall()
    const before = revision()
    const walls = view.project().existingModel.walls.length

    await user.click(screen.getByTestId('wall-delete'))
    // The delete keeps its own review of what falls with the Wall; the correction question is what
    // the refused answer adds.
    await user.click(screen.getByTestId('delete-wall-review-confirm'))

    const dialog = await screen.findByTestId('correct-existing-dialog')
    expect(dialog).toHaveTextContent('will see W-6 be removed:')
    expect(screen.getByTestId('correct-existing-option-option-a')).toHaveTextContent(
      'Option A · Open kitchen — retains it as Existing',
    )
    expect(screen.getByTestId('correct-existing-option-option-b')).toHaveTextContent('Option B · Widened opening')
    expect(revision()).toBe(before)
    expect(view.project().existingModel.walls).toHaveLength(walls)

    await user.click(screen.getByTestId('correct-existing-confirm'))
    await waitFor(() => expect(revision()).toBe(before + 1))
    expect(view.project().existingModel.walls).toHaveLength(walls - 1)
    expect(view.session.getSnapshot().history?.undoLabel).toBe('Correct Existing Model: W-6')
  })

  it('names a record the survey tool just drew, rather than the id it was given', async () => {
    const user = userEvent.setup()
    await renderWorkspace(existingViewProject())
    const before = revision()

    await user.click(screen.getByTestId('add-item-menu'))
    await user.click(screen.getByTestId('add-sofa-2'))

    // The new Placed Item has no reference before the correction lands, so the dialog names it by
    // the label the finished Project gives it — and asks before anything is written.
    const dialog = await screen.findByTestId('correct-existing-dialog')
    expect(dialog).toHaveTextContent('will see Sofa 2-seater appear:')
    expect(dialog).not.toHaveTextContent('will see item-')
    expect(revision()).toBe(before)

    await user.click(screen.getByTestId('correct-existing-confirm'))
    await waitFor(() => expect(revision()).toBe(before + 1))
    const placed = planItemsForFloor(view.project(), 'seed-001').filter((each) => each.label === 'Sofa 2-seater')
    expect(placed).toHaveLength(1)
    expect(view.session.getSnapshot().history?.undoLabel).toBe('Correct Existing Model: Sofa 2-seater')
  })
})

describe('Existing display with no Design Option (#70 criterion 24)', () => {
  it('commits the edit straight through, with no dialog and no lock', async () => {
    const user = userEvent.setup()
    await renderWorkspace(baselineOnlyProject())
    selectWall()

    expect(await screen.findByTestId('wall-inspector-ref')).toHaveTextContent('W-6')
    expect(screen.getByTestId('wall-length')).toBeEnabled()
    expect(screen.getByTestId('wall-length')).not.toHaveAttribute('title')
    expect(screen.getAllByTestId(`wall-handle-${WALL}`)).toHaveLength(2)

    const before = revision()
    await commitLength(user, '3000')

    await waitFor(() => expect(revision()).toBe(before + 1))
    expect(wallLength()).toBe(3000)
    expect(screen.queryByTestId('correct-existing-dialog')).not.toBeInTheDocument()
    expect(screen.queryByTestId('forced-choice-dialog')).not.toBeInTheDocument()
  })
})
