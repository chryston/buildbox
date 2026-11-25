/**
 * Skirting through the real workspace (#78 acceptance criteria 1–9, 12–15, 17).
 *
 * Every criterion is answered by a person's gesture on the real `App`: the tool in the strip, the
 * click on a Wall face, the click on the drawn body, the boxes in the inspector, the delete and the
 * Undo. The Project is read only to witness what the gesture left there, because the claim is that
 * the gesture and the record agree, and only the app can say so.
 *
 * Coordinates: the Plan View is at 0.05 px per mm with no pan, so a Floor point is its own client
 * pixel times twenty. `W-1` runs from (600, 600) to (9 600, 600), 200 mm thick and centred, so its
 * `left` face lies at y = 500 and the 15 mm strip stands off it at y = 485 — the strip's own middle
 * is (5 100, 492.5), which is client (255, 24.625). jsdom lays nothing out, so the canvas box reads
 * as zeros, exactly as `beamsFlow.test.tsx` relies on.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import type { DesignOption, Project, Skirting } from '../domain'
import { withAnnotations, withComments } from '../domain/testing'
import { PLAN_IMAGE_ACCEPT, STRINGS, WorkspaceProvider, workspaceStore, type WorkspaceServices } from '../ui'
import type { Viewport, ViewportCache } from '../ui'
import { openTestView, renderWithBindings as render, TEST_EXPORT_PORT, type TestView } from '../ui/legacy/testing'

if (!globalThis.PointerEvent) globalThis.PointerEvent = MouseEvent as typeof PointerEvent

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')

const STRIP = 'skirting-1'
const HOST = 'seed-wall-002'
/** The strip's own middle, in client pixels at 0.05 px per mm. */
const STRIP_AT = { x: 5100 * 0.05, y: 492.5 * 0.05 }

function fixtureProject(): Project {
  const text = readFileSync(join(fixturesRoot, 'domain', 'v13', 'skirting.json'), 'utf8')
  return withAnnotations(withComments(structuredClone((JSON.parse(text) as { domainSchemaVersion: number; project: Project }).project)))
}

/** The fixture with its Design Option taken out: one Floor, one Wall each, one Skirting. */
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

/** The Plan View of the Floor, which is where the tool and the strip live. */
const planViewId = (): string => view.project().views.find((each) => each.floorId === 'seed-001')!.id

const options = (): DesignOption[] => view.project().designOptions ?? []

const stored = (id: string): Skirting => {
  const models = [view.project().existingModel.skirting ?? [], ...options().map((option) => option.proposed.skirting ?? [])]
  for (const model of models) {
    const found = model.find((each) => each.id === id)
    if (found !== undefined) return found
  }
  throw new Error(`no Skirting ${id}`)
}

const ids = (): string[] => [
  ...(view.project().existingModel.skirting ?? []).map((each) => each.id),
  ...options().flatMap((option) => (option.proposed.skirting ?? []).map((each) => each.id)),
]

/** The drawn strip: body and invisible click target carry the same id, as a Room's and a Beam's do. */
const stripTarget = (): HTMLElement => screen.getAllByTestId(`skirting-${STRIP}`)[0] as HTMLElement

/** Select the strip by clicking the body the Plan View drew, which is how a person does it. */
async function pickStrip(): Promise<void> {
  fireEvent.pointerDown(stripTarget(), { button: 0, buttons: 1, clientX: STRIP_AT.x, clientY: STRIP_AT.y })
  await screen.findByTestId('skirting-inspector')
}

/**
 * A number box, set to a new value and left, which is what commits it: `NumberField` keeps the
 * person's text while they type and commits once on Enter or blur.
 */
function setNumber(input: HTMLElement, value: string): void {
  fireEvent.change(input, { target: { value } })
  fireEvent.blur(input)
}

/** The tool in the strip, then the face clicked: the whole create gesture. */
async function skirtFace(side: 'left' | 'right'): Promise<void> {
  const user = userEvent.setup()
  await user.click(screen.getByTestId('tool-skirting'))
  expect(await screen.findByTestId('skirting-tool-layer')).toBeInTheDocument()
  fireEvent.pointerDown(screen.getByTestId(`skirting-face-hit-${HOST}|${side}`))
  await waitFor(() => expect(screen.queryByTestId('skirting-tool-layer')).toBeNull())
}

describe('a Skirting in the workspace (#78)', () => {
  beforeEach(async () => {
    await renderWorkspace()
  })

  it('draws the strip the fixture carries and opens its inspector by the body (#78 criterion 7)', async () => {
    expect(stripTarget()).toBeInTheDocument()
    await pickStrip()
    expect(screen.getByTestId('skirting-field-wall')).toHaveTextContent('W-1')
    // The face is named, never `left` or `right`: nobody measures a skirting from a side they cannot see.
    expect(screen.getByTestId('skirting-field-side').textContent).not.toMatch(/\bleft\b|\bright\b/)
    expect(screen.getByTestId('skirting-field-start')).toHaveValue(0)
    expect(screen.getByTestId('skirting-field-end')).toHaveValue(9000)
    expect(screen.getByTestId('skirting-field-gross')).toHaveTextContent('9,000')
    expect(screen.getByTestId('skirting-field-net')).toHaveTextContent('9,000')
    expect(screen.getByTestId('skirting-field-bottom')).toHaveValue(0)
    expect(screen.getByTestId('skirting-field-height')).toHaveValue(100)
    expect(screen.getByTestId('skirting-field-thickness')).toHaveValue(15)
    // `Top` is printed and never typed: it is the sum of the two boxes above it.
    expect(screen.getByTestId('skirting-field-top')).toHaveTextContent('100')
  })

  it('skirts the whole face in one click, with the bar’s numbers and the next free label (#78 criterion 5)', async () => {
    const user = userEvent.setup()
    await user.click(screen.getByTestId('tool-skirting'))
    expect(await screen.findByTestId('skirting-tool-layer')).toBeInTheDocument()
    expect(screen.getByTestId('skirting-tool-hint')).toHaveTextContent(STRINGS.skirtingPickFace)
    // The bar's own defaults, each captioned as the guess it is.
    expect(screen.getByTestId('skirting-draft-height')).toHaveValue(100)
    expect(screen.getByTestId('skirting-draft-thickness')).toHaveValue(15)
    expect(screen.getByTestId('skirting-draft-bottom')).toHaveValue(0)
    expect(screen.getByTestId('skirting-draft-height-caption')).toHaveTextContent(STRINGS.skirtingMeasureYours)

    setNumber(screen.getByTestId('skirting-draft-height'), '120')
    setNumber(screen.getByTestId('skirting-draft-thickness'), '20')
    fireEvent.pointerDown(screen.getByTestId(`skirting-face-hit-${HOST}|right`))
    await waitFor(() => expect(screen.queryByTestId('skirting-tool-layer')).toBeNull())

    const made = ids().find((id) => id !== STRIP)
    expect(made).toBeDefined()
    expect(stored(made!).label).toBe('Skirting SK-2')
    expect(stored(made!).hostWallId).toBe(HOST)
    expect(stored(made!).side).toBe('right')
    expect([stored(made!).height, stored(made!).thickness, stored(made!).bottom]).toEqual([120, 20, 0])
    // The whole tidied face: `W-2` and `W-5` butt onto this face at its ends, so the face the strip
    // can stand on runs 100 to 8 900 of the Wall's 9 000 mm.
    expect([stored(made!).start, stored(made!).end]).toEqual([100, 8900])
    // The tool is put down with the strip, so no crosshair outlives it.
    expect(screen.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true')
  })

  it('sends nothing when the tool is put down before a face is clicked (#78 §3)', async () => {
    const user = userEvent.setup()
    await user.click(screen.getByTestId('tool-skirting'))
    expect(await screen.findByTestId('skirting-tool-layer')).toBeInTheDocument()
    await user.click(screen.getByTestId('skirting-tool-cancel'))
    await waitFor(() => expect(screen.queryByTestId('skirting-tool-layer')).toBeNull())
    expect(ids()).toEqual([STRIP])
    expect(screen.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true')
  })

  it('commits each inspector box as its own edit (#78 criterion 7)', async () => {
    await pickStrip()
    setNumber(screen.getByTestId('skirting-field-start'), '500')
    await waitFor(() => expect(stored(STRIP).start).toBe(500))
    setNumber(screen.getByTestId('skirting-field-end'), '8000')
    await waitFor(() => expect(stored(STRIP).end).toBe(8000))
    setNumber(screen.getByTestId('skirting-field-bottom'), '20')
    await waitFor(() => expect(stored(STRIP).bottom).toBe(20))
    setNumber(screen.getByTestId('skirting-field-height'), '80')
    await waitFor(() => expect(stored(STRIP).height).toBe(80))
    setNumber(screen.getByTestId('skirting-field-thickness'), '18')
    await waitFor(() => expect(stored(STRIP).thickness).toBe(18))
    expect(screen.getByTestId('skirting-field-top')).toHaveTextContent('100')
    expect(screen.getByTestId('skirting-field-gross')).toHaveTextContent('7,500')

    const label = screen.getByTestId('skirting-field-label')
    fireEvent.change(label, { target: { value: 'Kitchen skirting' } })
    fireEvent.blur(label)
    await waitFor(() => expect(stored(STRIP).label).toBe('Kitchen skirting'))
  })

  it('marks the range box whose number the record refuses, and says why (#78 §4)', async () => {
    await pickStrip()
    setNumber(screen.getByTestId('skirting-field-end'), '0')
    await screen.findByTestId('skirting-field-end-error')
    expect(stored(STRIP).end).toBe(9000)
    expect(screen.getByTestId('skirting-field-end')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByTestId('skirting-field-end-error').textContent).not.toBe('')
    // A number the record does take clears the mark: the box is not left accusing a good edit.
    setNumber(screen.getByTestId('skirting-field-end'), '8000')
    await waitFor(() => expect(stored(STRIP).end).toBe(8000))
    expect(screen.queryByTestId('skirting-field-end-error')).toBeNull()
    expect(screen.getByTestId('skirting-field-end')).not.toHaveAttribute('aria-invalid')
  })

  it('flips the strip to the other face and duplicates it there (#78 criterion 6)', async () => {
    await pickStrip()
    fireEvent.click(screen.getByTestId('skirting-duplicate-other-side'))
    await waitFor(() => expect(ids()).toHaveLength(2))
    const twin = ids().find((id) => id !== STRIP)!
    expect(stored(twin).side).toBe('right')
    expect([stored(twin).start, stored(twin).end, stored(twin).height]).toEqual([0, 9000, 100])
    expect(stored(twin).label).toBe('Skirting SK-2')

    fireEvent.click(screen.getByTestId('skirting-flip-side'))
    await waitFor(() => expect(stored(STRIP).side).toBe('right'))
  })

  it('counts the gaps in the Net length the inspector prints (#78 criterion 1)', async () => {
    // A door straight through the host Wall, created the way the tool creates it.
    await view.dispatch('opening.create', {
      floorId: 'seed-001',
      hostWallId: HOST,
      kind: 'door',
      label: 'Door to utility',
      start: 4000,
      width: 900,
      sill: 0,
      head: 2100,
      hingeSide: 'start',
      swing: 'left',
      target: { designOptionId: null, viewId: planViewId() },
    })
    await pickStrip()
    expect(screen.getByTestId('skirting-field-gross')).toHaveTextContent('9,000')
    // 9 000 mm of range less the 900 mm of doorway the strip cannot cross.
    expect(screen.getByTestId('skirting-field-net')).toHaveTextContent('8,100')
  })

  it('deletes the strip and puts it back with Undo (#78 §3)', async () => {
    const user = userEvent.setup()
    await pickStrip()
    await user.click(screen.getByTestId('skirting-delete'))
    await waitFor(() => expect(screen.queryByTestId('skirting-inspector')).toBeNull())
    expect(ids()).not.toContain(STRIP)
    await user.click(screen.getByTestId('undo-button'))
    await waitFor(() => expect(ids()).toContain(STRIP))
    expect(stored(STRIP).label).toBe('Skirting SK-1')
  })

  it('takes one Undo for one gesture (#78 criterion 6)', async () => {
    const user = userEvent.setup()
    await pickStrip()
    fireEvent.click(screen.getByTestId('skirting-flip-side'))
    await waitFor(() => expect(stored(STRIP).side).toBe('right'))
    await user.click(screen.getByTestId('undo-button'))
    await waitFor(() => expect(stored(STRIP).side).toBe('left'))
    // The strip is still on the screen after the Undo, because nothing was deleted.
    expect(screen.getAllByTestId(`skirting-${STRIP}`).length).toBeGreaterThan(0)
  })
})

describe('a Skirting in a Design Option (#78 §5)', () => {
  beforeEach(async () => {
    await renderWorkspace(fixtureProject())
    await view.dispatch('view.setDesignOption', { viewId: planViewId(), designOptionId: 'option-a' })
    await view.dispatch('view.setRenovationDisplay', { viewId: planViewId(), renovationDisplay: 'combined' })
  })

  it('creates into the Option the view is working in, not into the Existing Model (#78 §5)', async () => {
    const before = (view.project().existingModel.skirting ?? []).length
    await skirtFace('right')
    const made = ids().find((id) => !(view.project().existingModel.skirting ?? []).some((each) => each.id === id))
    expect(made).toBeDefined()
    expect((view.project().existingModel.skirting ?? []).length).toBe(before)
    expect(options()[0]!.proposed.skirting!.map((each) => each.id)).toContain(made)
  })

  it('takes down a baseline strip as a demolition of that record (#78 §5)', async () => {
    await pickStrip()
    fireEvent.click(screen.getByTestId('skirting-delete'))
    await waitFor(() =>
      expect(options()[0]!.demolishedIds).toContain(STRIP),
    )
    // The record itself is untouched: an Option removes work by naming it, never by editing it.
    expect(stored(STRIP).label).toBe('Skirting SK-1')
  })
})
