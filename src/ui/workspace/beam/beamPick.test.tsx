/**
 * Selecting a Beam on the Plan View (#77 criteria 16, 18).
 *
 * A Beam is documentation drawn *under* the Wall it usually sits beneath, which makes it the one
 * thing in this app that a first click must not win by. So the two halves of the criterion are
 * tested as the pair they are: a Beam alone is picked by one click like anything else, and a Beam
 * under a Wall is reached by the second click in the same spot, with the list beside the pointer
 * naming it in the meantime.
 *
 * Coordinates: 0.1 px per mm with no pan, so the shared point (2 400, 2 400) mm is at client
 * (240, 240) and the far click 12 CSS px away is the 120 mm that ends the cycle (#70 §8). The cycle
 * state rides on the workspace store exactly as `FloorWorkspace` wires it.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, fireEvent, render } from '@testing-library/react'
import { useRef } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { deriveBeams, deriveWalls, effectiveFloor, effectiveModel } from '../../../derive'
import type { RenovationState } from '../../../derive'
import type { Project } from '../../../domain'
import { beamsOf } from '../../../domain'
import { PlanViewCanvas } from '../PlanViewCanvas'
import { workspaceStore, useWorkspace } from '../workspaceStore'

// jsdom ships no PointerEvent in every build, and the canvas answers pointer events only.
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
const seeded = structuredClone(
  (JSON.parse(readFileSync(join(fixturesRoot, 'domain', 'v12', 'beams.json'), 'utf8')) as {
    project: Project
  }).project,
)

const floorId = 'seed-001'
const BEAM = 'beam-1'
/** The Wall laid on the same line as the Beam, which is the ordinary case in a real survey. */
const WALL = 'wall-over-beam'

/**
 * The Beam and a Wall on the identical line, both Existing. The fixture's Beam runs at y = −400,
 * off the top of a positive client box, so it is moved to y = 2 400 and the Wall follows it: the
 * geometry that matters is that the two bodies cover the same point.
 */
const project: Project = {
  ...seeded,
  existingModel: {
    ...seeded.existingModel,
    beams: beamsOf(seeded.existingModel).map((beam) => ({
      ...beam,
      line: { start: { x: 900, y: 2400 }, end: { x: 5900, y: 2400 } },
    })) ?? [],
    walls: [
      ...seeded.existingModel.walls,
      {
        id: WALL,
        floorId,
        ref: 'W-OVER',
        line: { kind: 'line', start: { x: 800, y: 2400 }, end: { x: 4000, y: 2400 } },
        thickness: 200,
        justification: 'centre',
        baseElevation: 0,
        height: 2600,
      },
    ],
  },
}

const model = effectiveModel(project, floorId, null)
const derivedFloor = effectiveFloor(project, 0, floorId, null)
const beams = deriveBeams(project, floorId, null)
const walls = deriveWalls(project, floorId, null)

/** Every entity is Existing, so the Display shows all of them and the cycle can walk all of them. */
const states = new Map<string, RenovationState>([
  ...model.walls.map((row) => [row.entity.id, row.renovationState] as [string, RenovationState]),
  ...model.placedItems.map((row) => [row.entity.id, row.renovationState] as [string, RenovationState]),
  ...beamsOf(seeded.existingModel).map((beam) => [beam.id, 'existing'] as [string, RenovationState]),
])

const nameOf = (id: string): string =>
  beams.byId.get(id)?.label ?? walls.walls.find((wall) => wall.id === id)?.ref ?? id

const ZOOM = 0.1
/** The point both bodies cover, in client CSS pixels. */
const AT = { x: 2400 * ZOOM, y: 2400 * ZOOM }
/** Past the Wall's end (4 000 mm) and clear of `seed-wall-010`: the Beam lies here alone. */
const BEAM_ONLY = { x: 4900 * ZOOM, y: 2400 * ZOOM }
/** Inside the Wall (from 800 mm) and before the Beam (from 900 mm): the Wall lies here alone. */
const WALL_ONLY = { x: 850 * ZOOM, y: 2400 * ZOOM }
/** Far enough away that the next click is a different place, which ends the cycle (#70 §8). */
const FAR = { x: AT.x, y: AT.y + 120 }

/** What the canvas was told to select, in the order it was told, split the way the workspace splits. */
let beamPicks: string[]
let wallPicks: string[]

function Harness(): React.ReactNode {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const cycle = useWorkspace((state) => state.cycle)
  const cycleCandidates = useWorkspace((state) => state.cycleCandidates)
  const setCycle = useWorkspace((state) => state.setCycle)
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
        onSelect={() => {}}
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
        walls={walls}
        beams={beams}
        onSelectWall={(id) => wallPicks.push(id)}
        onSelectBeam={(id) => beamPicks.push(id)}
        renovation={{ states, pickStates: [], cycle, cycleCandidates, onCycle: setCycle, nameOf }}
      />
    </div>
  )
}

/**
 * One click on a drawn entity's own group, which is the only thing the canvas answers: a click on
 * the background is a deselect, never a cycle step (#70 §8).
 */
const pressRef = (id: string, role: string, at: { x: number; y: number } = AT): void => {
  const node = document.querySelector(`[data-ref="${id}"][data-ref-role="${role}"]`)
  expect(node, `${id} is drawn as ${role} on the Plan View`).not.toBeNull()
  fireEvent.pointerDown(node as Element, { clientX: at.x, clientY: at.y, button: 0, pointerId: 1, isPrimary: true })
}

const cycleState = (): unknown => workspaceStore.getState().cycle
const cycleRows = (): string[] => (workspaceStore.getState().cycleCandidates ?? []).map((row) => row.entityId)

beforeEach(() => {
  beamPicks = []
  wallPicks = []
  act(() => workspaceStore.getState().setCycle(null, []))
  render(<Harness />)
})

describe('a Beam answers the pointer on the Plan View (#77 criteria 16, 18)', () => {
  // Where the Beam lies alone, one click is enough — it is a drawn, selectable thing like any other.
  // Where a Wall covers it the cycle owns the answer, which is the next case.
  it('is selected by one click where nothing is drawn over it', () => {
    pressRef(BEAM, 'beam', BEAM_ONLY)
    expect(beamPicks).toEqual([BEAM])
    expect(wallPicks).toEqual([])
  })

  it('answers the invisible width target too, so a 200 mm band is easy to aim at', () => {
    pressRef(BEAM, 'beam-hit', BEAM_ONLY)
    expect(beamPicks).toEqual([BEAM])
  })

  it('is reached by the second click where a Wall is drawn over it, and named by the list', () => {
    // The Wall is painted later, so it is on top: the first click is the Wall's, as it must be.
    pressRef(WALL, 'wall')
    expect(wallPicks).toEqual([WALL])
    expect(beamPicks).toEqual([])
    // The list beside the pointer holds both, top first, so the person can see what else is there.
    expect(cycleRows()).toEqual([WALL, BEAM])
    // The second click in the same spot walks to the next candidate: the Beam.
    pressRef(WALL, 'wall')
    expect(beamPicks).toEqual([BEAM])
  })

  it('ends the cycle when the next click is somewhere else (#70 criterion 18)', () => {
    pressRef(WALL, 'wall')
    expect(cycleState()).not.toBeNull()
    pressRef(WALL, 'wall', FAR)
    expect(cycleState()).toBeNull()
  })

  it('is not a candidate where it was not drawn, so a click there cannot reach it', () => {
    // 850 mm is inside the Wall and before the Beam: the list holds the Wall and nothing else, so
    // no number of clicks in this spot can land on the Beam.
    pressRef(WALL, 'wall', WALL_ONLY)
    expect(beamPicks).toEqual([])
    expect(wallPicks).toEqual([WALL])
    expect(cycleRows()).toEqual([WALL])
  })
})
