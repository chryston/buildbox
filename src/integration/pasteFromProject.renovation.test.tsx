//>ff
/**
 * Copy in one Project, paste into another, in the same tab (#72 criteria 1, 2, 3, 5, 6, 11, 12).
 *
 * The two Projects are the pair `scripts/make-paste-seed.ts` wrote: `Unit 4 Fitout`, whose four
 * named Placed Items stand on `Furniture`, on `Services`, and Unlayered, and `14 Elm St`, which has
 * `Furniture` by name and no `Services` at all. They are opened one after the other through the real
 * workspace — a new session, `workspaceStore` reset the way a Project switch resets it — because the
 * promise under test is partly about what survives that switch: the copy does, the selection does
 * not, and the paste button's answer to "can I be pressed here" changes with the Project it is in.
 *
 * Everything is reached the way a person reaches it: a press on the drawing, Ctrl+C, the footer
 * button, the mapping review, `Paste with this mapping`, and the undo button. What is asserted is the
 * Project the second session committed — that the copy landed on the layer the answer named, on a
 * layer the answer created, or on none, that the pasted record is the one now selected, and that one
 * undo takes the whole paste back rather than half of it.
 *
 * The workspace has one selection, not a set, so a copy is one record and everything that record
 * brings with it; the multi-record copy the issue's criterion 1 sketches is exercised at the edit
 * layer, where it is the same code path with a longer list.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import type { EntityId, Project } from '../domain'
import { entityLayerId } from '../domain'
import { withComments } from '../domain/testing'
import { pasteClipboardStore, PLAN_IMAGE_ACCEPT, WorkspaceProvider, workspaceStore, type WorkspaceServices } from '../ui'
import { openTestView, renderWithBindings as render, TEST_EXPORT_PORT, type TestView } from '../ui/legacy/testing'

// jsdom ships no PointerEvent, and the canvas picks through pointer events.
if (!globalThis.PointerEvent) globalThis.PointerEvent = MouseEvent as typeof PointerEvent

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')

const FITOUT = 'paste-fitout.json'
const ELM = 'paste-elm.json'
/** `Option A · Combined` of 14 Elm St — a Display a paste is allowed into. */
const COMBINED = 'views-view-014'
const FURNITURE = 'layers-001'
const SERVICES = 'layers-002'
const TALL_PANTRY = 'seed-003'
const GPO = 'seed-item-028'
const DINING_CHAIR = 'fp-sofa'

const readProject = (name: string): Project => {
  const text = readFileSync(join(fixturesRoot, 'domain', 'v9', name), 'utf8')
  return withComments(structuredClone((JSON.parse(text) as { domainSchemaVersion: number; project: Project }).project))
}

let view: TestView
let mounted: RenderResult | null = null

function testWorkspaceServices(): WorkspaceServices {
  return {
    intent: view.services.intent,
    assetUrls: view.services.assetUrls,
    readPlanImage: () => Promise.reject(new Error('jsdom models no file reader')),
    planImageAccept: PLAN_IMAGE_ACCEPT,
    planCatalogue: [{ key: 'sofa-2', label: 'Sofa 2-seater' }],
    viewportCache: { read: async () => undefined, write: () => {}, readActive: async () => null, writeActive: () => {}, readPane: async () => null, writePane: () => {} },
    exportDrawings: TEST_EXPORT_PORT,
  }
}

/** Open a Project the way the Library does: a fresh session, and the workspace state emptied. */
async function openProject(name: string): Promise<void> {
  mounted?.unmount()
  view = await openTestView(readProject(name))
  workspaceStore.getState().reset()
  mounted = render(
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

async function openView(viewId: string): Promise<void> {
  await userEvent.setup().selectOptions(screen.getByTestId('view-picker'), [viewId])
  await waitFor(() => expect(screen.getByTestId('view-picker')).toHaveValue(viewId))
}

/** Stand on that record. A press at the canvas's synthetic point reaches whatever the cycle says is
 * under it (#74 §6), and these fixtures' Items do not stand under that point — so the selection the
 * copy needs is made through the store's own action, which is the action the canvas takes. What a
 * press reaches is the cycle's own tests to settle, not this file's. */
function select(itemId: string): void {
  act(() => workspaceStore.getState().select(itemId))
}

const pasteButton = (): HTMLButtonElement => screen.getByTestId('renovation-paste-button') as HTMLButtonElement

/** Copy one record in `Unit 4 Fitout`, then stand in `14 Elm St` with the review open. */
async function copyInFitoutAndOpenReview(itemId: string): Promise<void> {
  await openProject(FITOUT)
  const before = JSON.stringify(view.project())
  select(itemId)
  expect(workspaceStore.getState().selection).toBe(itemId)
  fireEvent.keyDown(window, { key: 'c', ctrlKey: true })
  // A copy reads: the source Project is exactly what it was, revision included.
  expect(JSON.stringify(view.project())).toBe(before)
  // …and here, where the copy was made, the footer button has nothing to offer (#72 criterion 12).
  expect(pasteButton().disabled).toBe(true)

  await openProject(ELM)
  await openView(COMBINED)
  expect(pasteButton().disabled).toBe(false)
  await userEvent.setup().click(pasteButton())
  await screen.findByTestId('paste-dialog')
}

const confirm = (): HTMLButtonElement => screen.getByTestId('paste-dialog-confirm') as HTMLButtonElement
const targetOf = (sourceLayerId: string): HTMLSelectElement =>
  screen.getByTestId(`paste-row-target-${sourceLayerId}`) as HTMLSelectElement

/**
 * The Placed Items of the open Project that read under `name`, wherever they stand. A paste into a
 * view that carries a Design Option lands in that Option, not in the Existing Model, so both
 * collections are the record of what came across.
 */
function named(name: string): EntityId[] {
  const project = view.project()
  const designName = (itemDesignId: EntityId): string | undefined =>
    project.itemDesigns.find((design) => design.id === itemDesignId)?.name
  const rows = [
    ...project.existingModel.placedItems,
    ...(project.designOptions ?? []).flatMap((option) => option.proposed.placedItems),
  ]
  return rows.filter((item) => designName(item.itemDesignId) === name).map((item) => item.id)
}

const layerNameOf = (itemId: EntityId): string | null => {
  const project = view.project()
  const item = [...project.existingModel.placedItems, ...(project.designOptions ?? []).flatMap((option) => option.proposed.placedItems)].find(
    (row) => row.id === itemId,
  )
  if (item === undefined) throw new Error(`no Placed Item is ${itemId}`)
  return project.drawingLayers?.find((layer) => layer.id === entityLayerId(item))?.name ?? null
}

beforeEach(() => {
  // A tab that opens with nothing copied: the clipboard is a module singleton, so without this the
  // copy of one test would be the next test's clipboard.
  pasteClipboardStore.getState().clear()
  workspaceStore.getState().reset()
})

describe('a copy that crosses into another Project (#72 criteria 1, 2, 3, 11, 12)', () => {
  it('survives the Project switch and asks one question, answered by nobody in advance', async () => {
    await copyInFitoutAndOpenReview(TALL_PANTRY)
    expect(screen.getByTestId('paste-dialog-title').textContent).toBe('Paste from “Unit 4 Fitout” — map Drawing Layers')
    expect(screen.getByTestId('paste-dialog-intro').textContent).toContain('1 entity from “Unit 4 Fitout”')
    // One row: the copy brought one layer. Its name matches a layer here, and that is offered, not taken.
    const select = targetOf(FURNITURE)
    expect(select.value).toBe('')
    expect(Array.from(select.options).map((option) => option.textContent)).toContain('Furniture (name match)')
    expect(confirm().disabled).toBe(true)
  })

  it('pastes onto the layer the answer named, selects what landed, and one undo takes it back', async () => {
    await copyInFitoutAndOpenReview(TALL_PANTRY)
    await userEvent.setup().click(screen.getByTestId(`paste-row-use-${FURNITURE}`))
    expect(targetOf(FURNITURE).value).toBe(`existing:${FURNITURE}`)
    await userEvent.setup().click(confirm())
    await waitFor(() => expect(screen.queryByTestId('paste-dialog')).toBeNull())

    const pasted = named('Tall pantry')
    // One, and not the source's own id: 14 Elm St never had a `Tall pantry`, and the copy arrived
    // under ids of its own.
    expect(pasted).toHaveLength(1)
    const landed = pasted[0]!
    expect(landed).not.toBe(TALL_PANTRY)
    expect(layerNameOf(landed)).toBe('Furniture')
    // The pasted record is drawn, and is the one the inspector is now about (#72 criterion 5).
    await waitFor(() => expect(screen.getByTestId(`placed-object-${landed}`)).toBeVisible())
    await waitFor(() => expect(workspaceStore.getState().selection).toBe(landed))

    await userEvent.setup().click(screen.getByTestId('undo-button'))
    expect(named('Tall pantry')).toHaveLength(0)
    expect(screen.queryByTestId(`placed-object-${landed}`)).toBeNull()
  })

  it('creates the layer the copy needs when the answer says to create it', async () => {
    await copyInFitoutAndOpenReview(GPO)
    // `Services` exists in the source and not here, so the only answer that is not a lie is a new one.
    expect(Array.from(targetOf(SERVICES).options).map((option) => option.textContent)).not.toContain('Services (name match)')
    fireEvent.change(targetOf(SERVICES), { target: { value: 'new' } })
    await userEvent.setup().click(confirm())
    await waitFor(() => expect(screen.queryByTestId('paste-dialog')).toBeNull())

    const pasted = named('GPO-9')
    expect(pasted).toHaveLength(1)
    expect(layerNameOf(pasted[0]!)).toBe('Services')
    expect(view.project().drawingLayers?.map((layer) => layer.name)).toContain('Services')
    await waitFor(() => expect(workspaceStore.getState().selection).toBe(pasted[0]))
  })

  it('pastes an Unlayered copy without asking anything, and leaves it Unlayered', async () => {
    await copyInFitoutAndOpenReview(DINING_CHAIR)
    expect(screen.getByTestId('paste-dialog-intro').textContent).toContain('1 Unlayered entity stays Unlayered.')
    expect(screen.queryByTestId(`paste-row-target-${FURNITURE}`)).toBeNull()
    // Nothing to answer means the primary is open from the start.
    expect(confirm().disabled).toBe(false)
    await userEvent.setup().click(confirm())
    await waitFor(() => expect(screen.queryByTestId('paste-dialog')).toBeNull())
    const pasted = named('Dining chair')
    expect(pasted).toHaveLength(1)
    expect(layerNameOf(pasted[0]!)).toBeNull()
  })

  it('stops offering the paste once the copy is this Project’s own', async () => {
    await openProject(ELM)
    await openView(COMBINED)
    expect(pasteButton().disabled).toBe(true)
    select('fp-island')
    fireEvent.keyDown(window, { key: 'c', ctrlKey: true })
    expect(pasteButton().disabled).toBe(true)
    // The copy is real — it just came from here, so there is nowhere to paste it to.
    await openProject(FITOUT)
    expect(pasteButton().disabled).toBe(false)
  })
})
