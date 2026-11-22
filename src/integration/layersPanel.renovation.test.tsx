/**
 * The Layers list of a saved view (#71 §3, acceptance criteria 4-8).
 *
 * These run the real workspace — `App` inside a `WorkspaceProvider` over a real session — because the
 * criteria are about what one row's control writes and what it leaves alone: the checkbox in one
 * saved view, the colour in the Project, the order that belongs to the view. A component test could
 * assert the props; only this mount can assert that a click became exactly one labelled transaction
 * in the session's history and that the other three saved views of the same Project did not move.
 *
 * The fixture is `fixtures/domain/v8/layers.json`: three layers stored back-to-front as Services,
 * Furniture, Structure, and four saved views — `Floor 1` with nothing said about any of them,
 * `Option A · Proposed` with Furniture hidden and Structure recoloured, `Option A · Demolition` with
 * an order of its own, `Option B · Combined` with Structure read-only and `Snap to hidden content`
 * on. Each of those is a criterion's starting position rather than scenery.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import type { PlanView, Project } from '../domain'
import { drawingLayerById, viewLayerOrder, viewLayerSettingOverride } from '../domain'
import type { DrawingLayer } from '../domain'
import { PLAN_IMAGE_ACCEPT, WorkspaceProvider, workspaceStore, type WorkspaceServices } from '../ui'
import type { Viewport, ViewportCache } from '../ui'
import { openTestView, renderWithBindings as render, TEST_EXPORT_PORT, type TestView } from '../ui/legacy/testing'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')

const FLOOR_1 = 'seed-view-001'
const PROPOSED = 'views-view-014'
const DEMOLITION = 'views-view-015'
const COMBINED = 'views-view-016'
const FURNITURE = 'layers-001'
const SERVICES = 'layers-002'
const STRUCTURE = 'layers-003'

function sceneProject(): Project {
  const text = readFileSync(join(fixturesRoot, 'domain', 'v8', 'layers.json'), 'utf8')
  return structuredClone((JSON.parse(text) as { domainSchemaVersion: number; project: Project }).project)
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
const layer = (id: string): DrawingLayer => drawingLayerById(view.project(), id) as DrawingLayer

/** The rows as drawn, top first — the order the list promises (#71 §3). */
const rowNames = (): string[] =>
  screen.getAllByTestId(/layer-name-text-/).map((row) => (row as HTMLElement).textContent ?? '')

const swatchColor = (key: string): string => (screen.getByTestId(`layer-swatch-${key}`) as HTMLElement).style.backgroundColor

/** `#e3a857` as jsdom serialises it back out of a style property. */
const rgb = (hex: string): string => {
  const n = Number.parseInt(hex.slice(1), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}

const undoLabel = (): string | null => view.session.getSnapshot().history.undoLabel

async function openView(viewId: string): Promise<void> {
  await userEvent.setup().selectOptions(screen.getByTestId('view-picker'), [viewId])
  await waitFor(() => expect(screen.getByTestId('view-picker')).toHaveValue(viewId))
}

/** Open one row's two halves. */
async function expand(key: string): Promise<void> {
  const toggle = screen.getByTestId(`layer-toggle-${key}`)
  if (toggle.getAttribute('aria-expanded') !== 'true') await userEvent.setup().click(toggle)
}

/** A colour input commits on the way out, so dragging a picker is one transaction, not forty. */
function commitColor(testId: string, hex: string): void {
  const input = screen.getByTestId(testId) as HTMLInputElement
  fireEvent.change(input, { target: { value: hex } })
  fireEvent.blur(input)
}

const undo = async (): Promise<void> => {
  await act(async () => {
    view.session.undo()
  })
}

beforeEach(() => {
  workspaceStore.getState().reset()
})

describe('the Layers list', () => {
  it('draws the rows front first with Unlayered as its own row, and no markers where nothing is said', async () => {
    await renderWorkspace(sceneProject())
    // Stored back-to-front as Services, Furniture, Structure: the top of the drawing is Structure, and
    // the content with no layer of its own is drawn over all of them.
    expect(rowNames()).toEqual(['Unlayered', 'Structure', 'Furniture', 'Services'])
    expect(screen.queryByTestId(/layer-mark-/)).toBeNull()
    // `Unlayered` has no colour of its own, so the swatch carries none and takes the neutral token.
    expect(screen.getByTestId('layer-swatch-unlayered')).toHaveClass('bb-layer-swatch-neutral')
    expect(screen.getByTestId('layer-swatch-unlayered')).not.toHaveStyle({ backgroundColor: 'rgb(185, 185, 194)' })
    expect(screen.getByTestId('layer-swatch-layers-003')).toHaveStyle({ backgroundColor: rgb('#b9b9c2') })
    // Collapsed: the row is a checkbox, a swatch, a name — nothing else until it is opened.
    expect(screen.queryByTestId('layer-view-section-layers-003')).toBeNull()
    expect(screen.getByTestId('layer-visible-layers-003')).toBeChecked()
  })

  it('marks a row ⊘, [RO] or ◐ exactly when it is not pickable, read-only or recoloured here', async () => {
    await renderWorkspace(sceneProject())
    // `Option B · Combined` says Structure is not editable here.
    await openView(COMBINED)
    expect(screen.getByTestId('layer-mark-readonly-layers-003')).toHaveTextContent('[RO]')
    expect(screen.queryByTestId('layer-mark-override-layers-003')).toBeNull()

    // `Option A · Proposed` has a colour of its own for Structure and hides Furniture — the marker is
    // for the colour, because hiding is what the checkbox already shows.
    await openView(PROPOSED)
    expect(screen.getByTestId('layer-mark-override-layers-003')).toHaveTextContent('◐')
    expect(screen.getByTestId('layer-mark-override-layers-003')).toHaveAttribute('title', 'View style override')
    expect(screen.getByTestId('layer-visible-layers-001')).not.toBeChecked()
    expect(screen.queryByTestId('layer-mark-override-layers-001')).toBeNull()

    // Unticking Selectable is the third marker, and it is the effective answer that shows, not a
    // second copy of the stored one.
    await openView(FLOOR_1)
    await expand(SERVICES)
    await userEvent.setup().click(screen.getByTestId('layer-selectable-layers-002'))
    expect(screen.getByTestId('layer-mark-unselectable-layers-002')).toHaveTextContent('⊘')
    expect(viewLayerSettingOverride(savedView(FLOOR_1), SERVICES)?.selectable).toBe(false)
  })

  it('opens a row into the view half above the Project half, and gives Unlayered no Project half', async () => {
    await renderWorkspace(sceneProject())
    await expand(STRUCTURE)
    const viewHalf = screen.getByTestId('layer-view-section-layers-003')
    const projectHalf = screen.getByTestId('layer-project-section-layers-003')
    expect(viewHalf).toBeInTheDocument()
    // Reading order is the promise: this view first, the Project underneath it.
    expect(viewHalf.compareDocumentPosition(projectHalf) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(viewHalf).getByTestId('layer-selectable-layers-003')).toBeInTheDocument()
    expect(within(viewHalf).getByTestId('layer-editable-layers-003')).toBeInTheDocument()
    expect(within(viewHalf).getByTestId('layer-active-layers-003')).toBeChecked()
    expect(within(viewHalf).getByTestId('layer-view-colour-layers-003')).toBeInTheDocument()
    expect(within(viewHalf).getByText('View order')).toBeInTheDocument()
    expect(within(projectHalf).getByTestId('layer-name-layers-003')).toHaveValue('Structure')
    expect(within(projectHalf).getByTestId('layer-project-colour-layers-003')).toBeInTheDocument()
    expect(within(projectHalf).getByTestId('layer-up-layers-003')).toBeInTheDocument()
    expect(within(projectHalf).getByTestId('layer-delete-layers-003')).toHaveTextContent('Delete…')

    await expand('unlayered')
    expect(screen.getByTestId('layer-view-section-unlayered')).toBeInTheDocument()
    expect(screen.queryByTestId('layer-project-section-unlayered')).toBeNull()
    // `Floor 1` draws on Structure, so the Unlayered row is not the active one.
    expect(screen.getByTestId('layer-active-unlayered')).not.toBeChecked()
  })

  it('changes one saved view and no other, and the Project colour reaches every view without an override', async () => {
    await renderWorkspace(sceneProject())
    const before = structuredClone(savedView(DEMOLITION))

    await openView(PROPOSED)
    await expand(SERVICES)
    await userEvent.setup().click(screen.getByTestId('layer-visible-layers-002'))
    expect(viewLayerSettingOverride(savedView(PROPOSED), SERVICES)).toMatchObject({ visible: false })
    expect(savedView(DEMOLITION)).toEqual(before)
    // Furniture's own say in `Proposed` survives its neighbour's change.
    expect(viewLayerSettingOverride(savedView(PROPOSED), FURNITURE)).toMatchObject({ visible: false, editable: true })

    // The Project's colour is what a row shows when the view has said nothing about colour.
    await openView(FLOOR_1)
    await expand(SERVICES)
    commitColor('layer-project-colour-layers-002', '#101010')
    expect(layer(SERVICES).color).toBe('#101010')
    expect(swatchColor(SERVICES)).toBe(rgb('#101010'))
    await openView(DEMOLITION)
    expect(swatchColor(SERVICES)).toBe(rgb('#101010'))
    // …and the view with its own colour keeps it.
    await openView(PROPOSED)
    expect(swatchColor(STRUCTURE)).toBe(rgb('#7aa2ff'))
    expect(layer(STRUCTURE).color).toBe('#b9b9c2')
  })

  it('hides the Unlayered row for this view alone, in one undo step', async () => {
    await renderWorkspace(sceneProject())
    // Opened first or not: the row's own checkbox is the same control either way.
    await userEvent.setup().click(screen.getByTestId('layer-toggle-unlayered'))
    await userEvent.setup().click(screen.getByTestId('layer-visible-unlayered'))
    // The row is a row like any other: hiding it is an override on this view, written the same way.
    expect(JSON.stringify(savedView(FLOOR_1).layerSettings)).toBe('{"unlayered":{"visible":false,"selectable":true,"editable":true}}')
    expect(savedView(PROPOSED).layerSettings?.unlayered).toBeUndefined()
    expect(undoLabel()).toBe('Set layer: Unlayered — hidden')
  })

  it('offers `Use Project layer order` only to a view that has an order of its own', async () => {
    await renderWorkspace(sceneProject())
    expect(screen.queryByTestId('layer-use-project-order')).toBeNull()

    await openView(DEMOLITION)
    expect(viewLayerOrder(savedView(DEMOLITION))).not.toBeNull()
    expect(rowNames()).toEqual(['Unlayered', 'Services', 'Structure', 'Furniture'])
    await userEvent.setup().click(screen.getByTestId('layer-use-project-order'))
    expect(viewLayerOrder(savedView(DEMOLITION))).toBeNull()
    expect(undoLabel()).toBe('Reorder layers: Option A · Demolition')
    // Following the Project again means the Project's front is the front here too.
    expect(rowNames()).toEqual(['Unlayered', 'Structure', 'Furniture', 'Services'])
    expect(screen.queryByTestId('layer-use-project-order')).toBeNull()
  })

  it('moves a layer in the Project order and every view without an order of its own follows', async () => {
    await renderWorkspace(sceneProject())
    await expand(SERVICES)
    // Services is the back-most layer, so `↑` is its one move.
    expect(screen.getByTestId('layer-up-layers-002')).toBeEnabled()
    expect(screen.getByTestId('layer-down-layers-002')).toBeDisabled()
    await userEvent.setup().click(screen.getByTestId('layer-up-layers-002'))
    expect(rowNames()).toEqual(['Unlayered', 'Structure', 'Services', 'Furniture'])
    expect(undoLabel()).toBe('Reorder layer: Services → front')
    await openView(PROPOSED)
    expect(rowNames()).toEqual(['Unlayered', 'Structure', 'Services', 'Furniture'])
    // …and the view with its own order keeps it.
    await openView(DEMOLITION)
    expect(rowNames()).toEqual(['Unlayered', 'Services', 'Structure', 'Furniture'])
  })

  it('takes exactly one undo step per control and puts the previous answer back', async () => {
    await renderWorkspace(sceneProject())
    const user = userEvent.setup()

    await expand(STRUCTURE)
    await expand('unlayered')
    await expand(FURNITURE)

    await user.click(screen.getByTestId('layer-visible-layers-003'))
    expect(screen.getByTestId('layer-visible-layers-003')).not.toBeChecked()
    expect(undoLabel()).toBe('Set layer: Structure — hidden')
    await undo()
    expect(screen.getByTestId('layer-visible-layers-003')).toBeChecked()
    expect(viewLayerSettingOverride(savedView(FLOOR_1), STRUCTURE)).toBeUndefined()

    await user.click(screen.getByTestId('layer-editable-layers-003'))
    expect(undoLabel()).toBe('Set layer: Structure — read-only')
    await undo()
    expect(screen.getByTestId('layer-editable-layers-003')).toBeChecked()

    await user.click(screen.getByTestId('layer-active-unlayered'))
    expect(screen.getByTestId('layer-active-unlayered')).toBeChecked()
    expect(undoLabel()).toBe('Set active layer: Unlayered')
    await undo()
    expect(screen.getByTestId('layer-active-layers-003')).toBeChecked()

    commitColor('layer-view-colour-layers-003', '#202020')
    expect(swatchColor(STRUCTURE)).toBe(rgb('#202020'))
    expect(undoLabel()).toBe('Set layer: Structure — colour')
    await undo()
    expect(swatchColor(STRUCTURE)).toBe(rgb('#b9b9c2'))

    // Two commits are two transactions and two undos; a drag inside the picker is one, because the
    // write waits for the blur.
    commitColor('layer-view-colour-layers-003', '#303030')
    commitColor('layer-view-colour-layers-003', '#404040')
    expect(undoLabel()).toBe('Set layer: Structure — colour')
    await undo()
    expect(swatchColor(STRUCTURE)).toBe(rgb('#303030'))
    await undo()
    expect(swatchColor(STRUCTURE)).toBe(rgb('#b9b9c2'))

    await user.click(screen.getByTestId('layer-view-forward-layers-001'))
    expect(undoLabel()).toBe('Reorder layers: Furniture')
    await undo()
    expect(viewLayerOrder(savedView(FLOOR_1))).toBeNull()

    await user.click(screen.getByTestId('layer-snap-to-hidden'))
    expect(undoLabel()).toBe('Snap to hidden content: On')
    await undo()
    expect(screen.getByTestId('layer-snap-to-hidden')).not.toBeChecked()

    const name = screen.getByTestId('layer-name-layers-003') as HTMLInputElement
    await user.clear(name)
    await user.type(name, 'Walls')
    await user.tab()
    expect(layer(STRUCTURE).name).toBe('Walls')
    expect(undoLabel()).toBe('Rename layer: Walls')
    await undo()
    expect(layer(STRUCTURE).name).toBe('Structure')
  })

  it('adds `New layer` at the front of the Project layers with its name focused', async () => {
    await renderWorkspace(sceneProject())
    await userEvent.setup().click(screen.getByTestId('layer-add'))
    // The new layer is the front-most of the Project's layers — under the Unlayered row, which is
    // always the top of the drawing.
    await waitFor(() => expect(rowNames()).toEqual(['Unlayered', 'New layer', 'Structure', 'Furniture', 'Services']))
    expect(undoLabel()).toBe('New layer: New layer')
    // The row is open and its name is focused and selected, so typing replaces the name (#71 §3).
    const layers = view.project().drawingLayers ?? []
    const added = layers[layers.length - 1]!
    const field = document.activeElement as HTMLInputElement
    expect(field).toBe(screen.getByTestId(`layer-name-${added.id}`))
    expect(field).toHaveValue('New layer')
    await act(async () => {
      fireEvent.change(field, { target: { value: 'Services risers' } })
      fireEvent.blur(field)
    })
    expect(rowNames()).toContain('Services risers')
  })

  it('says so when the Project has no layers at all', async () => {
    // Nothing on the Project to layer: one line, and the Unlayered row is the only row.
    const empty = sceneProject()
    empty.drawingLayers = []
    for (const each of empty.views) {
      each.layerSettings = {}
      each.layerOrder = undefined
      each.activeLayerId = undefined
    }
    await renderWorkspace(empty)
    expect(screen.getByTestId('layers-none')).toHaveTextContent('No Drawing Layers. All content is Unlayered.')
    expect(rowNames()).toEqual(['Unlayered'])
    expect(screen.queryByTestId(/layer-delete-/)).toBeNull()
  })
})
