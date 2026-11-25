/**
 * The dependency review through the real workspace (#82 criteria 2, 3, 4, 9, 10, 13).
 *
 * Each criterion is a person's gesture on the real `App`: select the thing, press Delete, and the
 * question that comes back is the review — one row per note, `Apply and continue` unreachable until
 * every row is answered, and the answer travelling inside the same Intent that was refused, so the
 * transaction that runs is the one that was approved and one Undo takes all of it back.
 *
 * Criteria 1, 5, 6, 7, 8, 11, 12, 14, 15 and 16 are answered where their decision is actually made: the
 * report and the re-check in `src/edit/notesDependencies.test.ts`, the row and the single-modal
 * composition in `src/ui/workspace/notes/NotesReviewDialog.test.tsx` and
 * `src/ui/workspace/wall/DeleteWallReviewDialog.test.tsx`, and the property in
 * `src/edit/notesDependencies.property.test.ts`. What is below is the part only a rendered workspace
 * can show — that the refusal is intercepted, the dialog is opened, and the answer round-trips.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import type { Project } from '../domain'
import { flush } from '../session/testing'
import { notesSessionStore, PLAN_IMAGE_ACCEPT, WorkspaceProvider, workspaceStore, type WorkspaceServices } from '../ui'
import type { Viewport, ViewportCache } from '../ui'
import { openTestView, renderWithBindings as render, TEST_EXPORT_PORT, type TestView } from '../ui/legacy/testing'

if (!globalThis.PointerEvent) globalThis.PointerEvent = MouseEvent as typeof PointerEvent

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const PX = 0.05

function sceneProject(): Project {
  const text = readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'notes-review-scene.json'), 'utf8')
  const envelope = JSON.parse(text) as { projects: { data: Project }[] }
  return structuredClone(envelope.projects[0]!.data)
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

beforeEach(async () => {
  await renderWorkspace()
})

/** Every test that fires an Intent ends here: the write settles inside `act`, or CI reads it as a warning. */
const settle = async (): Promise<void> => {
  await act(async () => {
    await flush()
  })
}

const review = async (): Promise<HTMLElement> => screen.findByTestId('notes-review')
const confirm = (): HTMLElement => screen.getByTestId('notes-review-confirm')
const comment = (reference: string): NonNullable<Project['comments'][number]> => {
  const found = view.project().comments.find((entry) => entry.reference === reference)
  if (found === undefined) throw new Error(`${reference} is no longer in the Project`)
  return found
}

/** Select the placement and press its inspector's Delete — the gesture criterion 2 is written as. */
async function deletePlacement(placedItemId: string): Promise<void> {
  await userEvent.click(screen.getByTestId(`placed-object-${placedItemId}`))
  await screen.findByTestId('delete-object')
  await userEvent.click(screen.getByTestId('delete-object'))
}

describe('deleting a placement that a Comment speaks for (#82 criteria 2, 3, 4, 13)', () => {
  it('asks one question with C-004 undecided and Apply disabled (criterion 2)', async () => {
    await deletePlacement('seed-item-029')
    const dialog = await review()
    expect(dialog.textContent).toContain('Dependency review')
    const rows = screen.getAllByTestId('notes-review-row')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.textContent).toContain('C-004')
    expect(rows[0]!.textContent).toContain('Shift 50 mm for dishwasher')
    expect(confirm().hasAttribute('disabled')).toBe(true)
    await settle()
  })

  it('moves C-004 to Base 600 #1 in the same transaction, and one undo brings both back (criterion 3)', async () => {
    const before = view.session.getSnapshot().revision
    await deletePlacement('seed-item-029')
    await review()
    await userEvent.click(screen.getByTestId('notes-review-choice-reanchor'))
    expect(confirm().hasAttribute('disabled')).toBe(true)
    const picker = screen.getByTestId('notes-review-target') as HTMLSelectElement
    // The surviving placement is the only `Base 600` left, so the plan's label for it carries no
    // ordinal — the option is picked by the target it names, not by words two targets can share.
    const target = Array.from(picker.options).find((option) => option.value === '{"kind":"entity","entityId":"seed-item-028"}')
    if (target === undefined) throw new Error('the review offered the other Base 600 placement as nowhere to move the note to')
    await userEvent.selectOptions(picker, target!.value)
    expect(confirm().hasAttribute('disabled')).toBe(false)
    await userEvent.click(confirm())
    await settle()

    const project = view.project()
    expect(project.existingModel.placedItems.some((item) => item.id === 'seed-item-029')).toBe(false)
    expect(comment('C-004').anchor).toEqual({ kind: 'entity', entityId: 'seed-item-028' })
    // One transaction: the revision moved once, not twice.
    expect(view.session.getSnapshot().revision).toBe(before + 1)

    act(() => view.session.undo())
    await settle()
    const restored = view.project()
    expect(restored.existingModel.placedItems.some((item) => item.id === 'seed-item-029')).toBe(true)
    expect(restored.comments.find((entry) => entry.reference === 'C-004')?.anchor).toEqual({
      kind: 'entity',
      entityId: 'seed-item-029',
    })
  })

  it('turns C-004 into a Floor Point at the placement with All Options (criterion 4)', async () => {
    const placement = view.project().existingModel.placedItems.find((item) => item.id === 'seed-item-029')!
    await deletePlacement('seed-item-029')
    await review()
    await userEvent.click(screen.getByTestId('notes-review-choice-floor_point'))
    await userEvent.click(confirm())
    await settle()
    const note = comment('C-004')
    expect(note.anchor).toEqual({
      kind: 'floor_point',
      floorId: placement.floorId,
      point: placement.translation,
    })
    expect(note.scope).toBe('all')
  })

  it('changes nothing on Cancel, and nothing on Escape either (criterion 13)', async () => {
    const before = view.session.getSnapshot().revision
    await deletePlacement('seed-item-029')
    await review()
    await userEvent.click(screen.getByTestId('notes-review-cancel'))
    await settle()
    expect(screen.queryByTestId('notes-review')).toBeNull()
    expect(view.session.getSnapshot().revision).toBe(before)
    expect(view.project().existingModel.placedItems.some((item) => item.id === 'seed-item-029')).toBe(true)

    await deletePlacement('seed-item-029')
    await review()
    await userEvent.keyboard('{Escape}')
    await settle()
    expect(screen.queryByTestId('notes-review')).toBeNull()
    expect(view.session.getSnapshot().revision).toBe(before)
    expect(view.project().existingModel.placedItems.some((item) => item.id === 'seed-item-029')).toBe(true)
  })
})

describe('deleting the Floor a Comment is anchored to (#82 criterion 10)', () => {
  it('lists C-008 preset to Delete, and Keep turns it into a Project Comment', async () => {
    await userEvent.click(screen.getByTestId('manage-floors'))
    await screen.findByTestId('manage-floors-dialog')
    await userEvent.click(screen.getByTestId('floor-delete-seed-floor-002'))
    await screen.findByTestId('delete-floor-dialog')
    await userEvent.click(screen.getByTestId('delete-floor-confirm'))
    const dialog = await review()
    expect(dialog.textContent).toContain('C-008')
    expect(confirm().hasAttribute('disabled')).toBe(false)

    await userEvent.click(screen.getByTestId('notes-review-choice-keep'))
    await userEvent.click(confirm())
    await settle()

    const project = view.project()
    expect(project.floors.some((floor) => floor.id === 'seed-floor-002')).toBe(false)
    expect(comment('C-008').anchor).toEqual({ kind: 'project' })
  })
})

/**
 * A Wall with nothing leaning on it except a Comment pinned to its face (#82 criterion 9). The Wall's
 * Openings review (#78) is the dialog these rows usually sit inside; with no Openings there is no such
 * dialog, and the ask has to arrive anyway rather than the button turning into a no-op.
 */
describe('deleting the Wall a Comment is pinned to (#82 criterion 9)', () => {
  const selectW2 = async (): Promise<void> => {
    act(() => workspaceStore.getState().selectWall('seed-wall-003'))
    await screen.findByTestId('wall-inspector')
    await userEvent.click(screen.getByTestId('wall-delete'))
  }

  it('asks, and Cancel takes the Wall and its Comment back unchanged', async () => {
    const before = view.session.getSnapshot().revision
    await selectW2()
    const dialog = await review()
    expect(dialog.textContent).toContain('C-006')
    expect(confirm().hasAttribute('disabled')).toBe(true)
    await userEvent.click(screen.getByTestId('notes-review-cancel'))
    await settle()
    expect(view.project().existingModel.walls.some((wall) => wall.id === 'seed-wall-003')).toBe(true)
    expect(comment('C-006').anchor).toMatchObject({ kind: 'feature', ownerId: 'seed-wall-003' })
    expect(view.session.getSnapshot().revision).toBe(before)
  })

  it('deletes Wall and Comment as one transaction when Delete is answered', async () => {
    const before = view.session.getSnapshot().revision
    await selectW2()
    await review()
    await userEvent.click(screen.getByTestId('notes-review-choice-delete'))
    await userEvent.click(confirm())
    await settle()
    expect(view.project().existingModel.walls.some((wall) => wall.id === 'seed-wall-003')).toBe(false)
    expect(view.project().comments.some((entry) => entry.reference === 'C-006')).toBe(false)
    expect(view.session.getSnapshot().revision).toBe(before + 1)
  })
})
