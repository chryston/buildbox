/**
 * Drawing Annotations through the real workspace (#81 acceptance criteria).
 *
 * Each criterion is a person's gesture on the real `App`: the five rows appearing after `✎ Comment`
 * and refusing to arm while the Notes overlay is off, a Text placed by one click through the
 * first-Annotation prompt with one undo removing layer and Annotation together, a Leader spending
 * two clicks on endpoint and position, a Revision Cloud taking its default rectangle from a click
 * without a drag, a Reference Marker defaulting to the next number and the other view, Esc backing
 * out of a half-made placement with nothing written, and a read-only layer refusing with its
 * sentence and changing nothing.
 *
 * Coordinates: the Plan View sits at a fixed zoom with no pan, so a click's client pixel maps to a
 * Floor point; jsdom lays nothing out, exactly as `commentsFlow.test.tsx` relies on. The assertions
 * read structure (type, endpoint shape, the cloud's 1200 × 600 mm rectangle) rather than absolute
 * Floor millimetres, so they hold whatever zoom the canvas settles on.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import type { Annotation, Project } from '../domain'
import { withAnnotations, withComments } from '../domain/testing'
import { flush } from '../session/testing'
import { notesSessionStore, PLAN_IMAGE_ACCEPT, WorkspaceProvider, workspaceStore, type WorkspaceServices } from '../ui'
import type { Viewport, ViewportCache } from '../ui'
import { openTestView, renderWithBindings as render, TEST_EXPORT_PORT, type TestView } from '../ui/legacy/testing'

if (!globalThis.PointerEvent) globalThis.PointerEvent = MouseEvent as unknown as typeof PointerEvent

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const PX = 0.05

function load(name: string): Project {
  const text = readFileSync(join(fixturesRoot, 'domain', 'v16', name), 'utf8')
  return structuredClone((JSON.parse(text) as { domainSchemaVersion: number; project: Project }).project)
}

/**
 * The Comments scene (one Floor, one Plan View, no layers, no Annotations) with one Annotation
 * already on it and a second Plan View of the same Floor. The pre-existing Annotation means the
 * first-Annotation prompt does not fire, so placement tests see the ordinary path; the second view
 * gives a Reference Marker a target (#81 §3.9).
 */
function placedScene(): Project {
  const base = withAnnotations(withComments(load('comments.json')))
  return {
    ...base,
    annotationReferenceCounter: 1,
    annotations: [
      { id: 'a-seed', reference: 'A-001', type: 'text', viewId: 'seed-view-001', position: { x: 100, y: 100 }, text: 'seed', layerId: null, scope: 'all' } as Annotation,
    ],
    views: [
      ...base.views,
      { id: 'seed-view-002', kind: 'plan', floorId: 'seed-001', name: 'Upper part', isDefault: false, planViewRange: { lowerMm: 0, upperMm: 2600 }, showPlanImage: true },
    ],
  }
}

/** The Comments scene as written: no layers, no Annotations — the prompt's own ground (#81 §4.2). */
function promptScene(): Project {
  return withAnnotations(withComments(load('comments.json')))
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
  for (const f of view.project().floors)
    act(() => workspaceStore.getState().setViewport(`plan:${f.id}`, { zoom: PX, panX: 0, panY: 0 }))
}

const stored = (): Annotation[] => view.project().annotations
const canvas = (): HTMLElement => screen.getByTestId('floor-plan-canvas')
const click = (xMm: number, yMm: number): void => {
  fireEvent.click(canvas(), { clientX: xMm * PX, clientY: yMm * PX })
}

/** The Notes overlay on: the gate every Annotation tool stands behind (#81 §3.2). */
async function overlayOn(): Promise<void> {
  if (screen.getByTestId('notes-overlay-button').getAttribute('aria-pressed') !== 'true')
    await userEvent.click(screen.getByTestId('notes-overlay-button'))
}

async function arm(tool: string): Promise<void> {
  await overlayOn()
  await userEvent.click(screen.getByTestId(`renovation-tool-${tool}`))
}

async function flushAll(): Promise<void> {
  await act(async () => {
    await flush()
  })
}

describe('the Annotation tool group (#81 §3.1, §3.2)', () => {
  beforeEach(async () => {
    await renderWorkspace(placedScene())
  })

  it('gates the five rows out of the strip until the overlay is on, then shows them enabled', async () => {
    // A default-off overlay reserves no layout: the rows are absent, not merely disabled, so the
    // Plan View keeps the height it had before Annotations existed (#81 §3.2).
    for (const id of ['annotationText', 'annotationLeader', 'annotationArrow', 'annotationCloud', 'annotationMarker'])
      expect(screen.queryByTestId(`renovation-tool-${id}`)).toBeNull()
    await overlayOn()
    for (const id of ['annotationText', 'annotationLeader', 'annotationArrow', 'annotationCloud', 'annotationMarker'])
      expect((screen.getByTestId(`renovation-tool-${id}`) as HTMLButtonElement).disabled).toBe(false)
  })

  it('arms from its row and says its piece in the hint pill', async () => {
    await arm('annotationText')
    expect(screen.getByTestId('annotation-tool-hint').textContent).toContain('Click to place Text.')
    await userEvent.click(screen.getByTestId('renovation-tool-annotationLeader'))
    expect(screen.getByTestId('annotation-tool-hint').textContent).toContain('Click an entity to anchor it.')
  })
})

describe('placement (#81 §3.5–3.9, §3.11)', () => {
  beforeEach(async () => {
    await renderWorkspace(placedScene())
  })

  it('places a Leader from two clicks: a free endpoint first, the position second', async () => {
    await arm('annotationLeader')
    click(2000, 2000)
    // The first click only settles the endpoint: nothing is written and the tool stays in hand.
    expect(stored()).toHaveLength(1)
    click(5000, 4000)
    const made = stored()[1]
    expect(made?.type).toBe('leader')
    expect(made?.reference).toBe('A-002')
    expect(made?.endpoint).toHaveProperty('free')
    expect(made?.position).toHaveProperty('x')
    // The endpoint and the position are two different points: the first click and the second.
    const free = (made?.endpoint as { free: { x: number; y: number } }).free
    expect(free.x).not.toBe((made?.position as { x: number }).x)
    await flushAll()
  })

  it('places a Revision Cloud of the default size from a click without a drag', async () => {
    await arm('annotationCloud')
    fireEvent.pointerDown(canvas(), { button: 0, clientX: 6000 * PX, clientY: 3000 * PX, pointerId: 1 })
    fireEvent.pointerUp(canvas(), { pointerId: 1 })
    const made = stored()[1]
    expect(made?.type).toBe('revision_cloud')
    const rect = made?.position as { a: { x: number; y: number }; b: { x: number; y: number } }
    // A click without a drag is the default 1200 × 600 mm cloud, whatever the zoom (#81 §3.8).
    expect(rect.b.x - rect.a.x).toBeCloseTo(1200, 6)
    expect(rect.b.y - rect.a.y).toBeCloseTo(600, 6)
    await flushAll()
  })

  it('draws a Revision Cloud rectangle from a drag', async () => {
    await arm('annotationCloud')
    fireEvent.pointerDown(canvas(), { button: 0, clientX: 1000 * PX, clientY: 1000 * PX, pointerId: 1 })
    fireEvent.pointerMove(canvas(), { clientX: 3000 * PX, clientY: 2500 * PX, pointerId: 1 })
    fireEvent.pointerUp(canvas(), { pointerId: 1 })
    const rect = stored()[1]?.position as { a: { x: number; y: number }; b: { x: number; y: number } }
    // The dragged rectangle is wider and taller than it is wide, and not the default size.
    expect(rect.b.x - rect.a.x).toBeGreaterThan(rect.b.y - rect.a.y)
    expect(rect.b.x - rect.a.x).not.toBeCloseTo(1200, 6)
    await flushAll()
  })

  it('defaults a Reference Marker to the next number and the first other view', async () => {
    await arm('annotationMarker')
    click(1500, 1500)
    const made = stored()[1]
    expect(made?.type).toBe('reference_marker')
    expect(made?.text).toBe('1')
    expect(made?.targetViewId).toBe('seed-view-002')
    await flushAll()
  })

  it('Esc mid-placement creates nothing and returns to Select', async () => {
    await arm('annotationLeader')
    click(2500, 2500)
    expect(stored()).toHaveLength(1)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('annotation-tool-hint')).toBeNull()
    expect(stored()).toHaveLength(1)
    await flushAll()
  })

  it('skips the prompt and takes the view active layer, or Unlayered', async () => {
    // The scene already has an Annotation and the view names no active layer: no prompt, Unlayered.
    await arm('annotationText')
    click(7000, 3000)
    expect(screen.queryByTestId('annotation-layer-prompt')).toBeNull()
    expect(stored()[1]?.layerId).toBeNull()
    await flushAll()
  })
})

describe('a read-only layer (#81 §3.4)', () => {
  beforeEach(async () => {
    // A `Notes` layer that the view has locked: placement names the refusal and writes nothing.
    const base = placedScene()
    await renderWorkspace({
      ...base,
      drawingLayers: [{ id: 'layer-notes', name: 'Notes', color: '#ffb547' }],
      views: base.views.map((each) =>
        each.id === 'seed-view-001' ? { ...each, layerSettings: { 'layer-notes': { visible: true, selectable: true, editable: false } } } : each,
      ),
    })
  })

  it('refuses a layer that is read-only in this view, saying its sentence', async () => {
    await arm('annotationText')
    click(3000, 3000)
    expect(screen.getByTestId('hidden-tool-notice').textContent).toBe('Notes is read-only in this view')
    expect(stored()).toHaveLength(1)
    await flushAll()
  })
})

describe('the first Annotation on a Project (#81 §4.2, §4.3)', () => {
  beforeEach(async () => {
    await renderWorkspace(promptScene())
  })

  it('asks once, creates the layer with the Annotation in one Intent, and one undo removes both', async () => {
    await arm('annotationText')
    click(4000, 3000)
    const prompt = screen.getByTestId('annotation-layer-prompt')
    expect(prompt.textContent).toContain('First Annotation on this Project')
    expect(prompt.textContent).toContain('No “Notes” layer exists.')
    // `Create layer “Notes”` is the preselected answer.
    expect((screen.getByTestId('annotation-layer-create').querySelector('input') as HTMLInputElement).checked).toBe(true)
    await userEvent.click(screen.getByTestId('annotation-layer-place'))
    const made = stored()[0]
    expect(made?.type).toBe('text')
    expect(made?.reference).toBe('A-001')
    const notes = view.project().drawingLayers?.find((layer) => layer.name === 'Notes')
    expect(notes).toBeTruthy()
    expect(made?.layerId).toBe(notes?.id)
    // One undo step: the layer and the Annotation both go, because one Intent made them (§4.3).
    act(() => view.session.undo())
    await flushAll()
    expect(stored()).toHaveLength(0)
    expect((view.project().drawingLayers ?? []).some((layer) => layer.name === 'Notes')).toBe(false)
  })
})

describe('a Project with a layer but no Annotations (#81 §4.2)', () => {
  beforeEach(async () => {
    // The prompt still asks (no Annotations yet), but a `Use existing` answer has a name to give.
    await renderWorkspace({ ...promptScene(), drawingLayers: [{ id: 'layer-a', name: 'Sketching', color: '#74d99f' }] })
  })

  it('answers the prompt with an existing layer when asked, and Cancel writes nothing', async () => {
    await arm('annotationText')
    click(4200, 3100)
    await userEvent.click(screen.getByTestId('annotation-layer-cancel'))
    expect(stored()).toHaveLength(0)
    expect(screen.queryByTestId('annotation-layer-prompt')).toBeNull()
    // Arm again and answer with the existing layer.
    await arm('annotationText')
    click(4200, 3100)
    await userEvent.click(screen.getByTestId('annotation-layer-use-layer-a'))
    await userEvent.click(screen.getByTestId('annotation-layer-place'))
    expect(stored()[0]?.layerId).toBe('layer-a')
    await flushAll()
  })
})
