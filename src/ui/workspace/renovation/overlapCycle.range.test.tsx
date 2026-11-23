/**
 * The click-to-cycle list over the Plan View Range (#74 §6, criterion 9).
 *
 * Two cabinets stand on the identical footprint — `Base cabinet #1` on the floor, `Wall cabinet #1`
 * at 1500 — so one pixel holds both and the only thing that distinguishes them is this view's Range.
 * The Wall cabinet is drawn later, so before #74 the cycle walked it first: the topmost thing won.
 * Now the In-range one wins and the list says why, in the same words the canvas paints in.
 *
 * Coordinates: 0.1 px per mm with no pan, so the shared footprint centre (600, 600) mm is at client
 * (60, 60), and 12 CSS px is 120 mm — which is what makes the same-spot and far-apart clicks below
 * mean the 12 px the criterion states. The cycle state rides on the workspace store exactly as
 * `FloorWorkspace` wires it, so the Escape assertion is the real handler's answer.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, fireEvent, render } from '@testing-library/react'
import { useRef } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { deriveRooms, deriveWalls, effectiveFloor, effectiveModel, rangeClasses } from '../../../derive'
import type { RenovationState } from '../../../derive'
import type { Project } from '../../../domain'
import type { RangeGates } from '../../../drawing'
import { PlanViewCanvas } from '../PlanViewCanvas'
import { workspaceStore, useWorkspace } from '../workspaceStore'

// jsdom ships no PointerEvent in every build, and the canvas answers pointer events only
// (`overlapCycle.renovation.test.tsx` does the same).
if (typeof globalThis.PointerEvent === 'undefined') {
  globalThis.PointerEvent = class extends Event {
    clientX: number
    clientY: number
    button: number
    pointerId: number
    isPrimary: boolean

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, { ...init, bubbles: true })
      this.clientX = init.clientX ?? 0
      this.clientY = init.clientY ?? 0
      this.button = init.button ?? 0
      this.pointerId = init.pointerId ?? 1
      this.isPrimary = init.isPrimary ?? true
    }
  } as unknown as typeof PointerEvent
}

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../fixtures')

const project = structuredClone(
  (JSON.parse(readFileSync(join(fixturesRoot, 'domain', 'v9', 'plan-range-scene.json'), 'utf8')) as {
    project: Project
  }).project,
)

const floorId = 'pr-002'
const view = project.views.find((each) => each.id === 'pr-003')!
const model = effectiveModel(project, floorId, null)
const derivedFloor = effectiveFloor(project, 0, floorId, null)

/** Every entity of this scene is Existing: the Range, not a Design Option, is what divides them. */
const states = new Map<string, RenovationState>(
  [...model.walls, ...model.openings, ...model.rooms, ...model.placedItems].map(
    (row) => [row.entity.id, row.renovationState] as [string, RenovationState],
  ),
)

const classes = rangeClasses(model, project.itemDesigns, view.planViewRange)
const rangeGates: RangeGates = { classOf: (id) => classes.get(id) ?? 'in' }
const nameOf = (id: string): string => derivedFloor.placements.find((each) => each.id === id)?.label ?? id

/**
 * The two cabinets share one footprint. `placementLabels` numbers a design only when the Floor has
 * more than one placement of it, so the two Base cabinets are `#1` and `#2` in the schedule while
 * this one — the only placement of `Wall cabinet` — is named for its Design, exactly as the canvas
 * labels it and exactly as the overlap list names it.
 */
const onFloor = (label: string): string =>
  derivedFloor.placements.find((each) => each.label === label)?.id ?? expect.fail(`no ${label}`)
const BASE = onFloor('Base cabinet')
const WALL = onFloor('Wall cabinet')

const ZOOM = 0.1
/** The centre both footprints share, in client CSS pixels. */
const AT = { x: 600 * ZOOM, y: 600 * ZOOM }

/** What the canvas was told to select, in the order it was told. */
const picks: string[] = []

function Harness(): React.ReactNode {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const cycle = useWorkspace((state) => state.cycle)
  const cycleCandidates = useWorkspace((state) => state.cycleCandidates)
  const setCycle = useWorkspace((state) => state.setCycle)
  const select = (id: string | null): void => {
    if (id !== null) picks.push(id)
  }
  return (
    <div ref={hostRef} data-testid="host" style={{ width: 400, height: 300 }}>
      <PlanViewCanvas
        hostRef={hostRef}
        svgRef={svgRef}
        floor={derivedFloor}
        showPlanImage={false}
        imageSrc={null}
        viewport={{ zoom: ZOOM, panX: 0, panY: 0 }}
        onViewport={() => {}}
        tool="select"
        selection={null}
        onSelect={select}
        dragPreview={null}
        onDragPreview={() => {}}
        onMoveItem={() => {}}
        onRotateItem={() => {}}
        designPreview={null}
        pickingOrigin={false}
        originCandidates={[]}
        snapKinds={new Set()}
        onPickOrigin={() => {}}
        unit="mm"
        precision={0}
        angleSnap={{ enabled: false, incrementDeg: 15 }}
        walls={deriveWalls(project, floorId, null)}
        rooms={deriveRooms(project, floorId, null)}
        onSelectWall={select}
        rangeGates={rangeGates}
        renovation={{ states, pickStates: [], cycle, cycleCandidates, onCycle: setCycle, nameOf }}
      />
    </div>
  )
}

/** One click on the footprint the given Placed Item is drawn with, `dy` CSS px below its centre. */
function clickItem(container: HTMLElement, itemId: string, dy = 0): void {
  const node = container.querySelector(`[data-ref="${itemId}"][data-ref-role="placed-item"]`)
  if (node === null) throw new Error(`no drawn footprint for ${itemId}`)
  fireEvent.pointerDown(node, { clientX: AT.x, clientY: AT.y + dy, button: 0, pointerId: 1, isPrimary: true })
}

const header = (): string => document.querySelector('[data-testid="overlap-header"]')?.textContent ?? ''
const rows = (): string[] =>
  [...document.querySelectorAll('.bb-renovation-overlap-row')].map((row) => row.textContent ?? '')
const currentRow = (): string => document.querySelector('.bb-renovation-overlap-row.is-current')?.textContent ?? ''
const lastPick = (): string | undefined => picks[picks.length - 1]

describe('the cycle over the Plan View Range (#74 criterion 9)', () => {
  beforeEach(() => {
    workspaceStore.getState().reset()
    picks.length = 0
  })

  it('walks the In-range cabinet first and names the Range on every row', () => {
    const { container } = render(<Harness />)
    // The click lands on the Wall cabinet's own group — the one drawn last — and still selects the
    // standing one: the Range outranks paint order, it never outranks the click.
    clickItem(container, WALL)
    expect(lastPick()).toBe(BASE)
    expect(header()).toBe('Overlap 1/2 · click again to cycle')
    expect(rows()).toEqual([
      '▶ [Existing] 1 of 2 · Base cabinet · In range',
      '[Existing] 2 of 2 · Wall cabinet · Above range',
    ])
  })

  it('walks to the Above-range cabinet on the second click, 5 CSS px away', () => {
    const { container } = render(<Harness />)
    clickItem(container, WALL)
    clickItem(container, WALL, 5)
    expect(lastPick()).toBe(WALL)
    expect(currentRow()).toBe('▶ [Existing] 2 of 2 · Wall cabinet · Above range')
    // The rows stay in cycle order; only the marker moves.
    expect(rows()[0]).toBe('[Existing] 1 of 2 · Base cabinet · In range')
  })

  it('comes back to the In-range cabinet on the third click', () => {
    const { container } = render(<Harness />)
    clickItem(container, WALL)
    clickItem(container, WALL, 4)
    clickItem(container, WALL, 2)
    expect(lastPick()).toBe(BASE)
    expect(currentRow()).toBe('▶ [Existing] 1 of 2 · Base cabinet · In range')
  })

  it('starts again at the In-range candidate more than 12 CSS px away', () => {
    const { container } = render(<Harness />)
    clickItem(container, WALL)
    expect(lastPick()).toBe(BASE)
    clickItem(container, WALL, 15) // 15 CSS px: a different spot, so a new cycle
    expect(lastPick()).toBe(BASE)
    expect(header()).toBe('Overlap 1/2 · click again to cycle')
  })

  it('ends the cycle when Escape clears it, and the list goes with it', () => {
    const { container } = render(<Harness />)
    clickItem(container, WALL)
    expect(document.querySelector('[data-testid="overlap-cycle"]')).not.toBeNull()
    // The workspace's Escape handler calls exactly this (#70 criterion 18); the selection the click
    // made stays, because it was a real selection.
    act(() => workspaceStore.getState().clearCycle())
    expect(document.querySelector('[data-testid="overlap-cycle"]')).toBeNull()
    expect(lastPick()).toBe(BASE)
  })
})
