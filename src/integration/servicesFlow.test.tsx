/**
 * Services through the real workspace (#79 acceptance criteria).
 *
 * Every criterion is answered by a person's gesture on the real `App`: the tool in the strip, the two
 * clicks that make a Run, the one click that makes a Riser, the click on the drawn body, the boxes in
 * the inspector, the delete and the Undo. The Project is read only to witness what the gesture left
 * there, because the claim is that the gesture and the record agree, and only the app can say so.
 *
 * Coordinates: the Plan View is at 0.05 px per mm with no pan, so a Floor point is its own client
 * pixel times twenty. `service-1` runs from (600, 1200) to (3600, 1200) at a centreline of 2200, so
 * its middle is (2100, 1200) — client (105, 60). jsdom lays nothing out, so the canvas box reads as
 * zeros, exactly as `beamsFlow.test.tsx` and `skirtingFlow.test.tsx` rely on.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import type { DesignOption, Project, Service, ServiceRiser, ServiceRun } from '../domain'
import { withAnnotations, withComments } from '../domain/testing'
import { PLAN_IMAGE_ACCEPT, STRINGS, WorkspaceProvider, workspaceStore, type WorkspaceServices } from '../ui'
import type { Viewport, ViewportCache } from '../ui'
import { openTestView, renderWithBindings as render, TEST_EXPORT_PORT, type TestView } from '../ui/legacy/testing'

if (!globalThis.PointerEvent) globalThis.PointerEvent = MouseEvent as typeof PointerEvent

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')

const RUN = 'service-1'
const RISER = 'service-3'
/** The Run's own middle, in client pixels at 0.05 px per mm. */
const RUN_AT = { x: 2100 * 0.05, y: 1200 * 0.05 }
/** The Riser's centre, in client pixels. */
const RISER_AT = { x: 3400 * 0.05, y: 2200 * 0.05 }

function fixtureProject(): Project {
  const text = readFileSync(join(fixturesRoot, 'domain', 'v14', 'services.json'), 'utf8')
  return withAnnotations(withComments(structuredClone((JSON.parse(text) as { domainSchemaVersion: number; project: Project }).project)))
}

/** The fixture with its Design Options taken out: five Services, all in the Existing Model. */
function sceneProject(): Project {
  const project = fixtureProject()
  project.designOptions = []
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

async function renderWorkspace(project: Project = sceneProject()): Promise<void> {
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
  act(() =>
    workspaceStore.getState().setViewport(`plan:${view.project().floors[0]?.id ?? ''}`, { zoom: 0.05, panX: 0, panY: 0 }),
  )
}

const options = (): DesignOption[] => view.project().designOptions ?? []

const stored = (id: string): Service => {
  const models = [view.project().existingModel.services ?? [], ...options().map((option) => option.proposed.services ?? [])]
  for (const model of models) {
    const found = model.find((each) => each.id === id)
    if (found !== undefined) return found
  }
  throw new Error(`no Service ${id}`)
}

const ids = (): string[] => [
  ...(view.project().existingModel.services ?? []).map((each) => each.id),
  ...options().flatMap((option) => (option.proposed.services ?? []).map((each) => each.id)),
]

/** The one Service the last create gesture added, narrowed to the shape the test asked for. */
function onlyRun(id: string): ServiceRun {
  const service = stored(id)
  if (service.shape !== 'run') throw new Error(`${id} is not a Run`)
  return service
}

function onlyRiser(id: string): ServiceRiser {
  const service = stored(id)
  if (service.shape !== 'riser') throw new Error(`${id} is not a Riser`)
  return service
}

/** The drawn Service: body and invisible click target carry the same id, as a Room's and a Beam's do. */
const serviceTarget = (id: string): HTMLElement => screen.getAllByTestId(`service-${id}`)[0] as HTMLElement

/** Select the Service by clicking the body the Plan View drew, which is how a person does it. */
async function pickService(id: string, at: { x: number; y: number }): Promise<void> {
  // A Service is documentation drawn over the Wall it passes through, so the first click takes the
  // thing on top and the next click in the same spot walks the cycle (#79 §6, #70 §8). The pointer
  // does not move: a different point starts the cycle again.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    fireEvent.pointerDown(serviceTarget(id), { button: 0, buttons: 1, clientX: at.x, clientY: at.y })
    if (screen.queryByTestId('service-inspector') !== null) return
    await new Promise((resolveAfter) => setTimeout(resolveAfter, 0))
  }
  await screen.findByTestId('service-inspector')
}

/**
 * A number box, set to a new value and left, which is what commits it: `NumberField` keeps the
 * person's text while they type and commits once on Enter or blur.
 */
function setNumber(input: HTMLElement, value: string): void {
  fireEvent.change(input, { target: { value } })
  fireEvent.blur(input)
}

/** The tool in the strip; the layer is up. */
async function pickServiceTool(): Promise<void> {
  const user = userEvent.setup()
  await user.click(screen.getByTestId('tool-service'))
  expect(await screen.findByTestId('service-tool-layer')).toBeInTheDocument()
}

describe('a Service in the workspace (#79)', () => {
  beforeEach(async () => {
    await renderWorkspace()
  })

  it('draws the Services the fixture carries, each labelled by Kind and size (#79 §Naming)', () => {
    expect(serviceTarget(RUN)).toBeInTheDocument()
    expect(serviceTarget(RISER)).toBeInTheDocument()
    // The plan label is the Kind code and the size, never an invented `Service S-1`. Labels live in
    // the text layer, which carries no test ids, so they are found by their own text.
    const painted = screen.getAllByTestId('plan-text-layer')[0].textContent ?? ''
    expect(painted).toContain('W Ø50')
    expect(painted).toContain('D Ø100')
    expect(painted).not.toMatch(/S-1/)
  })

  it('creates a Run with two clicks and no label of its own (#79 criteria 1–3)', async () => {
    await pickServiceTool()
    const before = ids()
    const layer = screen.getByTestId('service-tool-layer')
    fireEvent.pointerDown(layer, { button: 0, buttons: 1, clientX: 100, clientY: 400 })
    await waitFor(() => expect(screen.getByTestId('service-rubber')).toBeInTheDocument())
    fireEvent.pointerDown(layer, { button: 0, buttons: 1, clientX: 300, clientY: 400 })
    await waitFor(() => expect(screen.queryByTestId('service-tool-layer')).toBeNull())
    const createdId = ids().find((id) => !before.includes(id))
    if (createdId === undefined) throw new Error('the two clicks created nothing')
    const created = onlyRun(createdId)
    // The tool's placeholders: Ø50 round Water at the Datum, and no invented label.
    expect(created.section).toBe('round')
    expect(created.outsideDiameter).toBe(50)
    expect(created.centrelineElevation).toBe(0)
    expect(created.label ?? '').toBe('')
  })

  it('creates a Riser with one click, owning its height (#79 criteria 1–2)', async () => {
    await pickServiceTool()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('service-shape-riser'))
    const before = ids()
    const layer = screen.getByTestId('service-tool-layer')
    fireEvent.pointerDown(layer, { button: 0, buttons: 1, clientX: 200, clientY: 500 })
    await waitFor(() => expect(screen.queryByTestId('service-tool-layer')).toBeNull())
    const createdId = ids().find((id) => !before.includes(id))
    if (createdId === undefined) throw new Error('the click created nothing')
    const created = onlyRiser(createdId)
    expect(created.bottomElevation).toBe(0)
    expect(created.height).toBe(2600)
    // A Riser is round: it carries a diameter and no section at all.
    expect(created.outsideDiameter).toBe(50)
    expect('section' in created).toBe(false)
  })

  it('puts the tool down on Esc mid-Run and sends nothing (#79 criterion 4)', async () => {
    await pickServiceTool()
    const before = ids().length
    const layer = screen.getByTestId('service-tool-layer')
    fireEvent.pointerDown(layer, { button: 0, buttons: 1, clientX: 100, clientY: 400 })
    await waitFor(() => expect(screen.getByTestId('service-rubber')).toBeInTheDocument())
    fireEvent.keyDown(screen.getByTestId('service-tool-layer'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('service-tool-layer')).toBeNull())
    expect(ids().length).toBe(before)
  })

  it('opens the inspector from the drawn body and shows the derived extent (#79 criterion 7)', async () => {
    await pickService(RUN, RUN_AT)
    // A Run has no Height field: it stores one centreline and the extent is derived.
    expect(screen.queryByTestId('inspector-service-height')).toBeNull()
    expect(screen.getByTestId('inspector-service-extent').textContent).toBe('2,175 – 2,225 mm')
  })

  it('moves a Run when a position field is edited and keeps the section (#79 behaviour 2)', async () => {
    await pickService(RUN, RUN_AT)
    setNumber(screen.getByTestId('inspector-service-bottom'), '2000')
    // `Bottom` moves the Run and keeps the section: the centre is Bottom plus half the diameter.
    await waitFor(() => expect(onlyRun(RUN).centrelineElevation).toBe(2025))
    expect(onlyRun(RUN).section).toBe('round')
    expect(onlyRun(RUN).outsideDiameter).toBe(50)
  })

  it('keeps the centreline when a size field is edited (#79 behaviour 3)', async () => {
    await pickService(RUN, RUN_AT)
    setNumber(screen.getByTestId('inspector-service-diameter'), '100')
    await waitFor(() => expect(onlyRun(RUN).outsideDiameter).toBe(100))
    // Bottom and Top moved symmetrically; the stored centre did not move.
    expect(onlyRun(RUN).centrelineElevation).toBe(2200)
    expect(screen.getByTestId('inspector-service-extent').textContent).toBe('2,150 – 2,250 mm')
  })

  it('moves a Riser with Bottom and changes its height with Top (#79 behaviour 5)', async () => {
    await pickService(RISER, RISER_AT)
    setNumber(screen.getByTestId('inspector-service-bottom'), '300')
    await waitFor(() => expect(onlyRiser(RISER).bottomElevation).toBe(300))
    expect(onlyRiser(RISER).height).toBe(2600)
    setNumber(screen.getByTestId('inspector-service-top'), '3000')
    await waitFor(() => expect(onlyRiser(RISER).height).toBe(2700))
    expect(onlyRiser(RISER).bottomElevation).toBe(300)
  })

  it('deletes a Service and brings it back with Undo (#79 criterion 9)', async () => {
    await pickService(RUN, RUN_AT)
    const before = ids().length
    fireEvent.click(screen.getByTestId('inspector-service-delete'))
    await waitFor(() => expect(ids().length).toBe(before - 1))
    const user = userEvent.setup()
    await user.click(screen.getByTestId('undo-button'))
    await waitFor(() => expect(ids().length).toBe(before))
    expect(stored(RUN).shape).toBe('run')
  })

  it('offers the Service tool in the strip and names it (#79 criterion 1)', () => {
    expect(screen.getByTestId('tool-service')).toHaveTextContent(STRINGS.toolService)
  })
})
