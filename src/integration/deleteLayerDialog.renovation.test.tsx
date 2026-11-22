/**
 * `Delete Services?` (#71 §5, acceptance criteria 14-16).
 *
 * The dialog is the only way a layer leaves a Project, so what it says has to be what the write does.
 * The counts are not composed here: they are read from `services.intent.preview`, the same answer
 * `applyIntent` consults, which is why these tests press the real `Delete…` in the real rail and read
 * the real table rather than handing the component a review of their own invention.
 *
 * The scene is `fixtures/domain/v8/layers.json` with content moved onto Services — four Existing
 * Walls and Option B's proposed record, five in all — and an override of its own in two saved views.
 * That is criterion 14's shape: counts `5`, `0`, `2`, both view names, and the line about the
 * Unlayered row, which is the one consequence a person would otherwise discover afterwards.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import type { PlanView, Project, Wall } from '../domain'
import { drawingLayerById, viewLayerSettingOverride } from '../domain'
import { PLAN_IMAGE_ACCEPT, WorkspaceProvider, workspaceStore, type WorkspaceServices } from '../ui'
import type { Viewport, ViewportCache } from '../ui'
import { openTestView, renderWithBindings as render, TEST_EXPORT_PORT, type TestView } from '../ui/legacy/testing'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')

const FLOOR_1 = 'seed-view-001'
const PROPOSED = 'views-view-014'
const SERVICES = 'layers-002'
const FURNITURE = 'layers-001'

function sceneProject(): Project {
  const text = readFileSync(join(fixturesRoot, 'domain', 'v8', 'layers.json'), 'utf8')
  return structuredClone((JSON.parse(text) as { domainSchemaVersion: number; project: Project }).project)
}

/** `on` Existing Walls onto Services, which is what the review then has to count. */
function withServicesContent(on: number): Project {
  const project = sceneProject()
  project.existingModel.walls.slice(0, on).forEach((wall: Wall) => {
    wall.drawingLayerId = SERVICES
  })
  // Two saved views have an opinion of Services of their own: one says it outright, the other has an
  // order of its own that names it. Both are undone by the delete, which is what the count means.
  project.views.forEach((view) => {
    if (view.id === PROPOSED) view.layerSettings = { ...view.layerSettings, [SERVICES]: { visible: false, selectable: true, editable: true } }
  })
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
  }
  return {
    intent: view.services.intent,
    assetUrls: view.services.assetUrls,
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

const savedView = (id: string): PlanView => view.project().views.find((each) => each.id === id)!
const onServices = (): string[] =>
  view
    .project()
    .existingModel.walls.filter((wall) => wall.drawingLayerId === SERVICES)
    .map((wall) => wall.id)

const revision = (): number => view.session.getSnapshot().revision

/** Press `Delete…` in the row of one layer, with the row opened first. */
async function askToDelete(layerKey: string): Promise<void> {
  const toggle = screen.getByTestId(`layer-toggle-${layerKey}`)
  if (toggle.getAttribute('aria-expanded') !== 'true') await userEvent.setup().click(toggle)
  await userEvent.setup().click(screen.getByTestId(`layer-delete-${layerKey}`))
  await screen.findByTestId('delete-layer-dialog')
}

const undo = async (): Promise<void> => {
  await act(async () => {
    view.session.undo()
  })
}

beforeEach(() => {
  workspaceStore.getState().reset()
})

describe('the Delete Layer review', () => {
  it('counts what is on the layer, what it becomes, and which saved views lose their own settings', async () => {
    await renderWorkspace(withServicesContent(5))
    await askToDelete(SERVICES)

    const dialog = screen.getByTestId('delete-layer-dialog')
    expect(dialog).toHaveTextContent('Delete Services? 5 items are on it and will become Unlayered.')
    const table = screen.getByTestId('delete-layer-table')
    expect(within(table).getByTestId('delete-layer-row-model')).toHaveTextContent('Model entities')
    expect(within(table).getByTestId('delete-layer-row-model')).toHaveTextContent('5')
    expect(within(table).getByTestId('delete-layer-row-model')).toHaveTextContent('Becomes Unlayered')
    expect(within(table).getByTestId('delete-layer-row-annotations')).toHaveTextContent('0')
    expect(within(table).getByTestId('delete-layer-row-overrides')).toHaveTextContent('2')
    expect(within(table).getByTestId('delete-layer-row-overrides')).toHaveTextContent('2 lose their own settings')

    // Every record by name, because `5 items` and a list of them are two different pieces of news.
    expect(within(screen.getByTestId('delete-layer-members')).getAllByRole('listitem')).toHaveLength(5)
    expect(screen.queryByTestId('delete-layer-more')).toBeNull()
    expect(screen.getByTestId('delete-layer-views')).toHaveTextContent('Option A · Proposed')
    expect(screen.getByTestId('delete-layer-views')).toHaveTextContent('Option A · Demolition')
    expect(screen.getByTestId('delete-layer-note')).toHaveTextContent('The content becomes Unlayered and stays drawn.')
    expect(screen.queryByTestId('delete-layer-hidden-note')).toBeNull()
  })

  it('lists the first eight records and says how many more there are', async () => {
    await renderWorkspace(withServicesContent(5))
    // Furniture carries the seed's twelve Placed Items, which is more than the list will name.
    await askToDelete(FURNITURE)
    expect(within(screen.getByTestId('delete-layer-members')).getAllByRole('listitem')).toHaveLength(9)
    expect(screen.getByTestId('delete-layer-more')).toHaveTextContent('and 4 more')
  })

  it('asks in one line for a layer nothing is on', async () => {
    await renderWorkspace(withServicesContent(5))
    await userEvent.setup().click(screen.getByTestId('layer-add'))
    const layers = view.project().drawingLayers ?? []
    const added = layers[layers.length - 1]!
    await askToDelete(added.id)
    expect(screen.getByTestId('delete-layer-dialog')).toHaveTextContent('Unused. Nothing else changes.')
    expect(screen.queryByTestId('delete-layer-table')).toBeNull()
    expect(screen.queryByTestId('delete-layer-members')).toBeNull()
  })

  it('says when the content that comes back Unlayered stops being drawn in this view', async () => {
    // The line the dialog cannot leave out: with the Unlayered row hidden in the view the question is
    // asked from, the honest answer is that the content stops being drawn here.
    const project = withServicesContent(5)
    const floor1 = project.views.find((each) => each.id === FLOOR_1)!
    floor1.layerSettings = { ...floor1.layerSettings, unlayered: { visible: false, selectable: true, editable: true } }
    await renderWorkspace(project)
    await askToDelete(SERVICES)
    expect(screen.getByTestId('delete-layer-hidden-note')).toHaveTextContent('currently HIDDEN in this view')
    expect(screen.getByTestId('delete-layer-hidden-note')).toHaveTextContent('stops being drawn here')
    expect(screen.queryByTestId('delete-layer-note')).toBeNull()
  })

  it('changes nothing on Cancel, and one undo puts the layer, its content and the view settings back', async () => {
    const project = withServicesContent(5)
    await renderWorkspace(project)
    const before = revision()
    const members = onServices()

    await askToDelete(SERVICES)
    await userEvent.setup().click(screen.getByTestId('delete-layer-cancel'))
    expect(screen.queryByTestId('delete-layer-dialog')).toBeNull()
    expect(revision()).toBe(before)
    expect(onServices()).toEqual(members)
    expect(drawingLayerById(view.project(), SERVICES)).not.toBeNull()

    await askToDelete(SERVICES)
    await userEvent.setup().click(screen.getByTestId('delete-layer-confirm'))
    expect(screen.queryByTestId('delete-layer-dialog')).toBeNull()
    expect(drawingLayerById(view.project(), SERVICES)).toBeNull()
    expect(onServices()).toEqual([])
    expect(viewLayerSettingOverride(savedView(PROPOSED), SERVICES)).toBeUndefined()
    expect(view.session.getSnapshot().history.undoLabel).toBe('Delete Layer: Services')

    await undo()
    expect(drawingLayerById(view.project(), SERVICES)?.name).toBe('Services')
    expect(onServices()).toEqual(members)
    expect(viewLayerSettingOverride(savedView(PROPOSED), SERVICES)).toMatchObject({ visible: false })
  })
})
