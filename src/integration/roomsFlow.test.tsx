/**
 * Rooms through the whole application (#67): the toolbar, the Plan View, the inspector, the real
 * Intent port and the real Project. Every unit test in this feature asserts one boundary; this file
 * asserts the whole wire — that a click on a menu, a click on the Floor and a click on a button
 * leave the document the issue says they leave.
 *
 * The viewport is seeded from the cache rather than fitted: jsdom gives the canvas host no width,
 * so `Fit` would answer with a degenerate zoom and every click would land somewhere else in the
 * Flat. With an identity viewport a click's client coordinates *are* Floor millimetres, which is
 * what makes the assertions below readable as geometry.
 */
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { PLAN_IMAGE_ACCEPT, WorkspaceProvider, planViewKey, workspaceStore } from '../ui'
import type { Viewport, ViewportCache, WorkspaceServices } from '../ui'
import { openTestView, renderWithBindings as render, TEST_EXPORT_PORT, type TestView } from '../ui/legacy/testing'

// jsdom ships no PointerEvent in every build; the draft layers listen for pointer events only.
if (!globalThis.PointerEvent) globalThis.PointerEvent = MouseEvent as typeof PointerEvent

function testWorkspaceServices(view: TestView): WorkspaceServices {
  const cache = new Map<string, Viewport>()
  // One screen millimetre per Floor millimetre, unpanned, for every View this Project holds.
  for (const each of view.project().views) cache.set(planViewKey(each), { zoom: 1, panX: 0, panY: 0 })
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
    planCatalogue: [],
    viewportCache,
    exportDrawings: TEST_EXPORT_PORT,
  }
}

let view: TestView

async function renderWorkspace(): Promise<void> {
  render(
    <WorkspaceProvider
      session={view.session}
      services={testWorkspaceServices(view)}
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

/** One click on the Floor: press and release in place, as the draft layers count a click. */
const clickFloor = (testId: string, x: number, y: number): void => {
  const layer = screen.getByTestId(testId)
  fireEvent.pointerDown(layer, { clientX: x, clientY: y })
  fireEvent.pointerUp(layer, { clientX: x, clientY: y })
}

const rooms = (): number => view.project().existingModel.rooms.length
const walls = (): number => view.project().existingModel.walls.length
const openings = (): number => view.project().existingModel.openings.length

async function armShapesMenu(user: ReturnType<typeof userEvent.setup>, testId: string): Promise<void> {
  await user.click(screen.getByTestId('shapes-menu'))
  await user.click(screen.getByTestId(testId))
}

beforeEach(async () => {
  view = await openTestView()
  workspaceStore.getState().reset()
})

describe('drawing a Room through the Plan View', () => {
  it('commits the Outline the clicks described and selects what it made', async () => {
    const user = userEvent.setup()
    await renderWorkspace()
    await armShapesMenu(user, 'draw-line')
    clickFloor('room-draft-layer', 0, 0)
    clickFloor('room-draft-layer', 4000, 0)
    clickFloor('room-draft-layer', 0, 3000)
    await user.click(screen.getByTestId('room-draft-close'))

    const model = view.project().existingModel
    expect(model.rooms).toHaveLength(1)
    expect(model.rooms[0]?.name).toBe('Room 1')
    expect(model.rooms[0]?.floorId).toBe(view.project().floors[0]?.id)
    // Three clicks are three Edges, and the closing one is the Outline's own, not a drawn line.
    expect(model.rooms[0]?.outline.kind === 'path' ? model.rooms[0].outline.path.segments : []).toHaveLength(3)
    expect(screen.getByTestId('room-inspector')).toBeInTheDocument()
  })

  it('refuses an Outline that would take floor from the Room it overlaps', async () => {
    const user = userEvent.setup()
    await renderWorkspace()
    await armShapesMenu(user, 'draw-line')
    clickFloor('room-draft-layer', 0, 0)
    clickFloor('room-draft-layer', 4000, 0)
    clickFloor('room-draft-layer', 0, 3000)
    await user.click(screen.getByTestId('room-draft-close'))
    expect(rooms()).toBe(1)

    // A draw tool armed while a Room is selected restates that Room (#67 §7), so the canvas is
    // emptied of selection first: this draft must be a second Room, not a restatement.
    await user.click(screen.getByTestId('tool-select'))
    fireEvent.click(screen.getByTestId('floor-plan-canvas'))
    await armShapesMenu(user, 'draw-line')
    clickFloor('room-draft-layer', 500, 500)
    clickFloor('room-draft-layer', 3000, 500)
    clickFloor('room-draft-layer', 500, 2000)
    const blocked = await screen.findByTestId('room-draft-blocked')
    expect(blocked).toHaveTextContent('Overlaps Room 1 by')
    expect(screen.getByTestId('room-draft-close')).toBeDisabled()
    // Putting the draft down leaves the first Room as the only one the Project holds.
    fireEvent.keyDown(screen.getByTestId('room-draft-layer'), { key: 'Escape' })
    await user.click(screen.getByTestId('tool-select'))
    expect(rooms()).toBe(1)
  })
})

describe('placing the household shelter', () => {
  it('puts down the Room, the four Walls and the door in one click', async () => {
    const user = userEvent.setup()
    await renderWorkspace()
    const before = { rooms: rooms(), walls: walls(), openings: openings() }
    await armShapesMenu(user, 'place-household-shelter')
    clickFloor('shelter-layer', 20000, 20000)

    const model = view.project().existingModel
    expect(model.rooms.length - before.rooms).toBe(1)
    expect(model.walls.length - before.walls).toBe(4)
    expect(model.openings.length - before.openings).toBe(1)
    // The shelter's Room claims the four faces it stands against: the pack is one object.
    expect(model.rooms[0]?.wallFaceRefs).toHaveLength(4)
  })
})

describe('attaching a Room edge to a wall face', () => {
  beforeEach(async () => {
    // A Wall the test needs, put there the way a view puts anything there: through the Intent
    // port. It runs (0,0) → (4000,0), 150 mm thick and centre-justified, so its faces lie at
    // y = ±75.
    await view.dispatch('wall.createChain', {
      floorId: view.project().floors[0]?.id ?? 'floor-1',
      walls: [{
        line: { kind: 'line', start: { x: 0, y: 0 }, end: { x: 4000, y: 0 } },
        thickness: 150,
        justification: 'centre',
        baseElevation: 0,
        height: 2600,
      }],
      starts: [{ kind: 'free' }],
      ends: [{ kind: 'free' }],
    })
  })

  it('slides the edge onto the face and keeps the claim; Detach drops the claim only', async () => {
    const user = userEvent.setup()
    await renderWorkspace()
    await armShapesMenu(user, 'draw-line')
    // An Edge a few millimetres off the Wall's lower face, long enough to be a real side.
    clickFloor('room-draft-layer', 200, 80)
    clickFloor('room-draft-layer', 3000, 80)
    clickFloor('room-draft-layer', 3000, 2080)
    clickFloor('room-draft-layer', 200, 2080)
    await user.click(screen.getByTestId('room-draft-close'))

    // The row's own button opens the list of faces within reach; picking one previews it on the
    // Plan View; the Attach button inside that row is what writes the Transaction.
    await user.click(screen.getAllByTestId(/^room-edge-attach-/)[0] as HTMLElement)
    await user.click(screen.getByTestId(/^room-face-pick-(?!on-canvas)/))
    // The list names the face by the Room it borders — nobody's yet — and says what claiming it does.
    const move = screen.getByTestId(/room-face-move-/)
    expect(['Moves edge 5 mm', 'No move']).toContain(move.textContent)
    await user.click(screen.getByTestId(/^room-face-attach-/))

    const attached = view.project().existingModel.rooms[0]
    expect(attached?.wallFaceRefs).toHaveLength(1)
    expect(attached?.wallFaceRefs[0]?.wallId).toBe(view.project().existingModel.walls[0]?.id)
    // The Edge now lies on the face: y = 75, within the kernel's tolerance.
    const first = attached?.outline.kind === 'path' ? attached.outline.path.segments[0] : null
    expect(first !== null && 'to' in first ? Math.abs(first.to.y - 75) : 99).toBeLessThan(0.01)

    await user.click(screen.getByTestId(/^room-edge-detach-/))
    const detached = view.project().existingModel.rooms[0]
    expect(detached?.wallFaceRefs).toHaveLength(0)
    // Detach is a statement about the reference: the geometry stays where the attach put it.
    const still = detached?.outline.kind === 'path' ? detached.outline.path.segments[0] : null
    expect(still !== null && 'to' in still ? Math.abs(still.to.y - 75) : 99).toBeLessThan(0.01)
  })

  it('keeps Delete out of reach while a Room Edge stands on the Wall, and hands it back on Detach', async () => {
    const user = userEvent.setup()
    await renderWorkspace()
    await armShapesMenu(user, 'draw-line')
    clickFloor('room-draft-layer', 200, 80)
    clickFloor('room-draft-layer', 3000, 80)
    clickFloor('room-draft-layer', 3000, 2080)
    clickFloor('room-draft-layer', 200, 2080)
    await user.click(screen.getByTestId('room-draft-close'))
    await user.click(screen.getAllByTestId(/^room-edge-attach-/)[0] as HTMLElement)
    await user.click(screen.getByTestId(/^room-face-pick-(?!on-canvas)/))
    await user.click(screen.getByTestId(/^room-face-attach-/))

    // Select the Wall by the band the Plan View paints for it — the hit shape the pointer
    // actually answers to (a bare canvas click at its reference line hits nothing).
    const select = (element: HTMLElement): void => {
      fireEvent.pointerDown(element, { clientX: 2000, clientY: 0 })
      fireEvent.pointerUp(element, { clientX: 2000, clientY: 0 })
      fireEvent.click(element, { clientX: 2000, clientY: 0 })
    }
    const selectWall = (): void => select(screen.getByTestId(/wall-band-/))
    const selectRoom = (): void => {
      // The Room is painted twice — its fill and its hit shape share the id — and the hit shape
      // is the one that answers to the pointer.
      const shapes = screen.getAllByTestId(`room-${view.project().existingModel.rooms[0]?.id ?? ''}`)
      select(shapes[shapes.length - 1] as HTMLElement)
    }
    await user.click(screen.getByTestId('tool-select'))
    selectWall()
    const sentence = 'W-1 is referenced by Room 1 edge 1. Detach, reattach, or remove the Room delta first.'
    expect(screen.getByTestId('wall-delete-blocked').textContent).toBe(sentence)
    const del = screen.getByTestId('wall-delete')
    expect(del.getAttribute('disabled')).not.toBeNull()
    expect(del.getAttribute('title')).toBe(sentence)
    // Pressing it anyway is not a half-delete: the Wall and the claim both stand.
    fireEvent.click(del)
    expect(walls()).toBe(1)
    expect(view.project().existingModel.rooms[0]?.wallFaceRefs).toHaveLength(1)

    // Detach is the way out the sentence names: the same Delete then works, in one step.
    selectRoom()
    await user.click(screen.getByTestId(/^room-edge-detach-/))
    selectWall()
    expect(screen.queryByTestId('wall-delete-blocked')).toBeNull()
    expect(screen.getByTestId('wall-delete').getAttribute('disabled')).toBeNull()
    await user.click(screen.getByTestId('wall-delete'))
    expect(walls()).toBe(0)
    expect(view.project().existingModel.rooms[0]?.wallFaceRefs).toHaveLength(0)
  })
})
