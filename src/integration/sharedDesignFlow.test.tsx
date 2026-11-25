/**
 * The shared-height preview panel and the dashed outlines of #76 §1, driven through the real
 * workspace, and the Clearance Envelope display of #76 §4.
 *
 * The scene is the #76 clearance fixture: a `Base cabinet` Item Design — shared by two Placed
 * Items on the one Floor — whose Clearance Envelope intrudes on a neighbour, and whose Floor's
 * upper limit is 2600 mm. Typing 2700 into the panel therefore opens a `floor_limit_above`
 * warning on both placements, which is the `+ new` the table has to promise before `Apply`
 * commits anything. Cross-Floor and Design Option rows are added to the scene in code, because
 * the criteria are about the table reaching every placement, wherever it stands.
 */
import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import App from '../App'
import { designHeight } from '../domain'
import { withAnnotations, withComments } from '../domain/testing'
import type { Project } from '../domain'
import { PLAN_IMAGE_ACCEPT, WorkspaceProvider, type WorkspaceServices } from '../ui'
import { workspaceStore } from '../ui'
import type { Viewport, ViewportCache } from '../ui'
import { openTestView, renderWithBindings as render, TEST_EXPORT_PORT, type TestView } from '../ui/legacy/testing'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')

const scene = withAnnotations(
  withComments(
    (
      JSON.parse(readFileSync(join(fixturesRoot, 'domain', 'v11', 'clearance.json'), 'utf8')) as {
        project: Project
      }
    ).project,
  ),
)

const design = (name: string) => scene.itemDesigns.find((each) => each.name === name) ?? expect.fail(`no ${name}`)
const cabinet = () => design('Base cabinet')
/** The fixture's two placements of the shared `Base cabinet`. */
const placements = (project: Project) =>
  project.existingModel.placedItems.filter((each) => each.itemDesignId === cabinet().id)

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
    planCatalogue: [],
    viewportCache,
    exportDrawings: TEST_EXPORT_PORT,
  }
}

let view: TestView

/** Mount the workspace over `project` with one placement selected. */
async function open(selectId: string | null, project: Project = scene): Promise<void> {
  view = await openTestView(structuredClone(project))
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
  if (selectId !== null) {
    await act(async () => {
      workspaceStore.getState().select(selectId)
      await Promise.resolve()
    })
  }
}

const settle = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
  })
}

/** Open the panel of the selected placement's shared design. */
const openPanel = async (): Promise<void> => {
  await userEvent.click(screen.getByTestId('edit-shared-design'))
  expect(screen.getByTestId('shared-design-panel')).toBeInTheDocument()
}

const typeHeight = async (value: string): Promise<void> => {
  const field = screen.getByTestId('shared-design-height')
  await userEvent.clear(field)
  await userEvent.type(field, value)
  await settle()
}

const project = () => view.project()
const cabinetHeight = () => designHeight(project().itemDesigns.find((each) => each.id === cabinet().id)!)

describe('the shared-height preview panel (#76 §1)', () => {
  it('opens from the inspector and lists every placement of the shared design', async () => {
    await open(placements(scene)[0]!.id)
    await openPanel()
    expect(screen.getByTestId('shared-design-title').textContent).toBe('Edit shared design · Base cabinet')
    const rows = placements(scene)
    for (const placed of rows) {
      expect(screen.getByTestId(`shared-design-row-existing-model-${placed.id}`)).toBeInTheDocument()
    }
    // The table says what the height is now and what it would become — nothing typed yet means
    // no new number, so no promise and no Apply.
    expect(screen.getByTestId('shared-design-table').textContent).toContain('Existing Model')
    expect(screen.getByTestId('shared-design-apply')).toBeDisabled()
  })

  it('promises `+ new` warnings before it commits any of them, and draws the dashed outlines', async () => {
    await open(placements(scene)[0]!.id)
    await openPanel()
    expect(screen.queryByTestId('plan-preview-outlines')).not.toBeInTheDocument()
    await typeHeight('2700')
    for (const placed of placements(scene)) {
      expect(screen.getByTestId(`shared-design-change-existing-model-${placed.id}`).textContent).toBe('+ new')
      const row = screen.getByTestId(`shared-design-row-existing-model-${placed.id}`)
      expect(row.textContent).toContain('2700')
    }
    // The dashed preview outlines are on the canvas while the panel holds the number…
    expect(screen.getByTestId('plan-preview-outlines').querySelectorAll('path')).toHaveLength(2)
    // …and nothing has been written: the design still stands at its own height.
    expect(cabinetHeight()).toBe(designHeight(scene.itemDesigns.find((each) => each.id === cabinet().id)!))
  })

  it('applies one labelled transaction to every placement, and the outlines vanish', async () => {
    await open(placements(scene)[0]!.id)
    await openPanel()
    await typeHeight('2700')
    expect(screen.getByTestId('shared-design-apply').textContent).toBe('Apply to 2 Placed Items')
    await userEvent.click(screen.getByTestId('shared-design-apply'))
    await settle()
    expect(cabinetHeight()).toBe(2700)
    expect(screen.queryByTestId('shared-design-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('plan-preview-outlines')).not.toBeInTheDocument()
    // One Transaction: one Undo takes the shared height back.
    await act(async () => {
      view.session.undo()
    })
    await settle()
    expect(cabinetHeight()).toBe(designHeight(scene.itemDesigns.find((each) => each.id === cabinet().id)!))
  })

  it('changes nothing on Cancel, and the outlines vanish', async () => {
    await open(placements(scene)[0]!.id)
    await openPanel()
    await typeHeight('2700')
    expect(screen.getByTestId('plan-preview-outlines')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('shared-design-cancel'))
    await settle()
    expect(cabinetHeight()).toBe(designHeight(scene.itemDesigns.find((each) => each.id === cabinet().id)!))
    expect(screen.queryByTestId('shared-design-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('plan-preview-outlines')).not.toBeInTheDocument()
  })

  it('changes nothing on Escape, which is Cancel', async () => {
    await open(placements(scene)[0]!.id)
    await openPanel()
    await typeHeight('2700')
    await userEvent.keyboard('{Escape}')
    await settle()
    expect(cabinetHeight()).toBe(designHeight(scene.itemDesigns.find((each) => each.id === cabinet().id)!))
    expect(screen.queryByTestId('shared-design-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('plan-preview-outlines')).not.toBeInTheDocument()
  })

  it('marks a height that is not one and disables Apply', async () => {
    await open(placements(scene)[0]!.id)
    await openPanel()
    await typeHeight('0')
    expect(screen.getByTestId('shared-design-height-error')).toBeInTheDocument()
    expect(screen.getByTestId('shared-design-height')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByTestId('shared-design-apply')).toBeDisabled()
    expect(screen.queryByTestId('plan-preview-outlines')).not.toBeInTheDocument()
  })

  it('reaches across Floors and Design Options, each row naming its own warning change', async () => {
    // The same scene, with the shared cabinet also standing on a second Floor and inside a
    // Design Option: the table has to hold a row for each, and each row answers for its own
    // (Floor, Option) warnings.
    const wide = structuredClone(scene)
    const floor2 = { ...wide.floors[0]!, id: 'floor-2', name: 'Floor 2' }
    wide.floors.push(floor2)
    wide.views.push({ ...wide.views[0]!, id: 'pv-2', floorId: 'floor-2', name: 'Floor 2' })
    wide.existingModel.placedItems.push({ ...placements(wide)[0]!, id: 'place-f2', floorId: 'floor-2' })
    wide.designOptions = [
      {
        id: 'opt-1',
        name: 'Option X',
        demolishedIds: [],
        proposed: {
          openings: [],
          placedItems: [{ ...placements(wide)[1]!, id: 'place-opt' }],
          rooms: [],
          beams: [],
          wallJunctions: [],
          walls: [],
        },
      },
    ]
    await open(placements(wide)[0]!.id, wide)
    await openPanel()
    await typeHeight('2700')
    // Existing Model rows: Floor 1 (two placements) and Floor 2 (one).
    const floor2Row = await screen.findByTestId('shared-design-row-existing-model-place-f2')
    expect(floor2Row.textContent).toContain('Floor 2')
    expect(floor2Row.textContent).toContain('+ new')
    // The Option row: the Option proposes a twin of `pr-016` at the same spot. Raising the
    // shared height clears the overlap warning that named the twin — the engine keeps one
    // warning for identical twins — while the twin's own row gains the limit warning. Each row
    // answers for its own (Floor, Option) context, not its neighbour's.
    const table = screen.getByTestId('shared-design-table')
    expect(table.textContent).toContain('Option X')
    const optionRow = within(table).getByTestId('shared-design-row-opt-1-place-opt')
    expect(optionRow.textContent).toContain('Option X')
    expect(within(table).getByTestId('shared-design-change-opt-1-place-opt').textContent).toBe('− cleared')
    expect(within(table).getByTestId('shared-design-change-opt-1-pr-016').textContent).toContain('+ new')
  })

  it('offers the fork line as the only route to one placement’s own height', async () => {
    await open(placements(scene)[0]!.id)
    await openPanel()
    expect(screen.getByTestId('shared-design-fork-line').textContent).toContain('Different height for one placement?')
    await userEvent.click(screen.getByTestId('shared-design-fork'))
    expect(screen.getByTestId('fork-design-dialog')).toBeInTheDocument()
  })
})

describe('the Clearance Envelope display (#76 §4)', () => {
  it('draws the selected placement’s envelope dashed, and nothing for one that has none', async () => {
    await open(placements(scene)[0]!.id)
    // The selected Base cabinet owns the fixture’s envelope: one dashed Clearance outline shows.
    expect(screen.getByTestId('plan-clearance-outlines').querySelectorAll('path')).toHaveLength(1)
    // The Wall cabinet’s design owns no envelope, and no open warning names it: nothing shows.
    const wallCabinet = scene.existingModel.placedItems.find(
      (each) => each.itemDesignId === design('Wall cabinet').id,
    )!
    await act(async () => {
      workspaceStore.getState().select(wallCabinet.id)
      await Promise.resolve()
    })
    expect(screen.queryByTestId('plan-clearance-outlines')).not.toBeInTheDocument()
  })

  it('keeps the envelope of every placement an open warning names', async () => {
    // The same scene with the Tall cupboard moved into the Base cabinet’s envelope: the
    // intrusion warning names its owner, and the owner’s envelope is drawn with nothing at all
    // selected — and stays drawn while an unrelated placement holds the selection.
    const warned = structuredClone(scene)
    const cupboard = warned.existingModel.placedItems.find((each) => each.id === 'el-002')!
    cupboard.translation = { x: 700, y: 800 }
    await open(null, warned)
    expect(screen.getByTestId('plan-clearance-outlines').querySelectorAll('path')).toHaveLength(1)
    const sump = warned.existingModel.placedItems.find((each) => each.itemDesignId === design('Sump box').id)!
    await act(async () => {
      workspaceStore.getState().select(sump.id)
      await Promise.resolve()
    })
    expect(screen.getByTestId('plan-clearance-outlines').querySelectorAll('path')).toHaveLength(1)
  })
})
