/**
 * Drawing a Custom Path, wired to a real session (#59 behaviour 9).
 *
 * `edgesEditor.test.tsx` checks what a field holds and `draftPath.test.ts` what the state machine
 * does. What only a session can show is the promise the whole feature rests on: that a draft is
 * invisible until it closes, and that closing it is exactly one undo step.
 *
 * The canvas gestures come from `shapeEditorFlow.test.tsx`'s trick — jsdom lays nothing out, but
 * it will dispatch a pointer wherever it is told to land, and the viewBox the component chose says
 * where that is in millimetres.
 */
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import type { ItemDesign, ItemFootprint, PlacedItem, Project } from '../domain'
import type { ClosedPath } from '../derive'
import { workspaceStore } from '../ui'
import { openTestView, renderWithBindings as render, type TestView } from '../ui/legacy/testing'
import { testProject } from '../session/testing'

const DESIGN = 'p-1-sofa'
const PLACE = 'p-1-sofa-place'

/** A generic Item Design of `footprint`, placed once on the Project's one Floor. */
function withSofa(project: Project, footprint: ItemFootprint): Project {
  const design: ItemDesign = {
    id: DESIGN,
    kind: 'generic',
    name: 'Sofa',
    footprint,
    origin: { x: 0, y: 0 },
    height: 850,
    heightIsTypical: true,
    color: '#7a8b99',
  }
  const placed: PlacedItem = {
    id: PLACE,
    itemDesignId: DESIGN,
    floorId: 'p-1-floor',
    translation: { x: 0, y: 0 },
    rotationDeg: 0,
    baseElevation: 0,
  }
  return {
    ...project,
    itemDesigns: [...project.itemDesigns, design],
    existingModel: { ...project.existingModel, placedItems: [...project.existingModel.placedItems, placed] },
  }
}

/** The Kitchen outline, which is both the shape being drawn on and the corners to snap to. */
const KITCHEN: ClosedPath = {
  start: { x: 1200, y: 1300 },
  segments: [
    { kind: 'line', to: { x: 4800, y: 1300 } },
    { kind: 'line', to: { x: 4800, y: 4000 } },
    { kind: 'line', to: { x: 3300, y: 4000 } },
    { kind: 'line', to: { x: 3300, y: 5600 } },
    { kind: 'line', to: { x: 1200, y: 5600 } },
    { kind: 'line', to: { x: 1200, y: 1300 } },
  ],
}

const KITCHEN_FOOTPRINT: ItemFootprint = { kind: 'path', path: KITCHEN }

async function openShapeEditor(project: Project): Promise<TestView> {
  const view = await openTestView(project)
  render(<App />, view, { onWorkspace: true })
  await screen.findByTestId('floor-plan-canvas')
  act(() => workspaceStore.getState().select(PLACE))
  await userEvent.click(await screen.findByTestId('open-item-detail'))
  await screen.findByTestId('shape-editor')
  return view
}

/** The footprint the Project's Sofa holds now. */
function footprintOf(project: Project): ItemFootprint {
  const design = project.itemDesigns.find((candidate) => candidate.id === DESIGN)
  if (design === undefined || design.kind !== 'generic') throw new Error('the Sofa design is gone')
  return design.footprint
}

function pathOf(project: Project): ClosedPath {
  const footprint = footprintOf(project)
  if (footprint.kind !== 'path') throw new Error('the Sofa is not a Custom Path any more')
  return footprint.path
}

interface ScreenBox { left: number; top: number; width: number; height: number }

/**
 * Give the canvas a size and report the millimetres in a pixel. jsdom lays nothing out, so every
 * element is a zero-by-zero box; this is the one thing a jsdom test has to supply for itself, and
 * `mmPerPx` is what turns "11 px away" into a distance the canvas will agree with.
 */
function drawCanvas(widthPx: number, heightPx: number): { canvas: HTMLElement; mmPerPx: number } {
  const canvas = screen.getByTestId('footprint-canvas')
  const box: ScreenBox = { left: 0, top: 0, width: widthPx, height: heightPx }
  canvas.getBoundingClientRect = () => ({
    ...box, right: box.left + box.width, bottom: box.top + box.height, x: box.left, y: box.top, toJSON: () => ({}),
  }) as DOMRect
  const [minX = 0, minY = 0, w = 1, h = 1] = (canvas.getAttribute('viewBox') ?? '').split(' ').map(Number)
  void minX
  void minY
  return { canvas, mmPerPx: Math.max(w / box.width, h / box.height) }
}

function clientFor(canvas: HTMLElement, mm: { x: number; y: number }): { x: number; y: number } {
  const [minX = 0, minY = 0, w = 1, h = 1] = (canvas.getAttribute('viewBox') ?? '').split(' ').map(Number)
  const box = canvas.getBoundingClientRect()
  const mmPerPx = Math.max(w / box.width, h / box.height)
  return {
    x: box.left + (box.width - w / mmPerPx) / 2 + (mm.x - minX) / mmPerPx,
    y: box.top + (box.height - h / mmPerPx) / 2 + (mm.y - minY) / mmPerPx,
  }
}

function pointerAt(canvas: HTMLElement, type: string, mm: { x: number; y: number }, buttons = 0): void {
  const at = clientFor(canvas, mm)
  act(() => {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: at.x,
      clientY: at.y,
      button: 0,
      buttons,
    })
    Object.defineProperty(event, 'pointerId', { value: 1 })
    canvas.dispatchEvent(event)
  })
}

function clickCanvas(canvas: HTMLElement, at: { x: number; y: number }): void {
  pointerAt(canvas, 'pointerdown', at, 1)
  pointerAt(canvas, 'pointerup', at, 0)
}

/** Arm the Line tool and start a draft at `at`. */
async function startLine(canvas: HTMLElement, at: { x: number; y: number }): Promise<void> {
  await userEvent.click(screen.getByTestId('draw-line'))
  clickCanvas(canvas, at)
}

describe('drawing a Custom Path', () => {
  beforeEach(() => {
    workspaceStore.getState().reset()
  })

  it('closes on the start marker, commits once, and is one undo step (criterion 4)', async () => {
    const view = await openShapeEditor(withSofa(testProject('p-1'), KITCHEN_FOOTPRINT))
    const revision = view.session.getSnapshot().revision
    const { canvas } = drawCanvas(640, 340)
    await startLine(canvas, { x: 0, y: 0 })
    clickCanvas(canvas, { x: 3000, y: 0 })
    clickCanvas(canvas, { x: 3000, y: 2000 })
    expect(screen.getByTestId('shape-draft')).toBeInTheDocument()
    // Coming back within reach of the start offers the close rather than a fourth vertex.
    clickCanvas(canvas, { x: 0, y: 0 })
    await waitFor(() => expect(footprintOf(view.project()).kind).toBe('path'))
    const path = pathOf(view.project())
    expect(path.segments.length).toBe(3)
    expect(view.session.getSnapshot().revision).toBe(revision + 1)
    // One step back, and the Kitchen is whole again — the whole draft was one transaction.
    await act(async () => { view.session.undo() })
    expect(pathOf(view.project()).segments.length).toBe(6)
  })
})
