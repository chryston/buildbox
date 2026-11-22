/**
 * Click-to-cycle over overlapping Renovation States (#70 §8, criteria 15–18).
 *
 * The scene is the saved view `Option B · Combined`: W-2 marked for demolition and its successor
 * W-2′ standing on the identical reference line, so one pixel holds two candidates and the canvas
 * has to say which one a click meant. The clicks are real pointer events on the rendered Wall band,
 * the assertions are the real selection callbacks and the real candidate list — the ordering itself
 * is `overlapCycle`'s own, which these tests drive rather than reimplement.
 *
 * Coordinates: the viewport is 0.05 px per mm with no pan, so the middle of W-2 — (9600, 3000) mm —
 * is at client (480, 150). Twelve CSS px is 240 mm at that zoom, which is what makes the same-spot
 * and far-apart clicks in criterion 18 mean what they say.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fireEvent, render } from '@testing-library/react'
import { useCallback, useRef, useState } from 'react'
import { describe, expect, it } from 'vitest'
import {
  deriveRooms,
  deriveWalls,
  displayModel,
  effectiveFloor,
  effectiveModel,
} from '../../../derive'
import type { RenovationState } from '../../../derive'
import type { Project, RenovationDisplay } from '../../../domain'
import { designOptionsOf } from '../../../domain'
import { workspaceStore } from '../workspaceStore'
import { clampOverlay } from '../selection/overlapCycle'
import type { CycleCandidate, CycleState } from '../selection/overlapCycle'
import { PlanViewCanvas } from '../PlanViewCanvas'

// jsdom ships no PointerEvent in every build, and the canvas answers pointer events only — without
// this the click arrives with no coordinates at all (`RoomDraftOverlay.test.tsx` does the same).
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
  (JSON.parse(readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'renovation-views.json'), 'utf8')) as {
    projects: { data: Project }[]
  }).projects[0]!.data,
) as Project

const floorId = project.floors[0]!.id
const OPTION_B = 'option-b'
const DISPLAY: RenovationDisplay = 'combined'

const wallByRef = (ref: string): string =>
  [...project.existingModel.walls, ...designOptionsOf(project).flatMap((option) => option.proposed.walls)]
    .find((wall) => wall.ref === ref)!.id

const W2 = wallByRef('W-2')
const W2_PRIME = wallByRef('W-2′')
const refOf = new Map<string, string>(
  [...project.existingModel.walls, ...designOptionsOf(project).flatMap((option) => option.proposed.walls)].map((wall) => [
    wall.id,
    wall.ref,
  ]),
)

/** What `Option B · Combined` draws, as the canvas sees it. */
const states = new Map<string, RenovationState>(
  (() => {
    const model = displayModel(effectiveModel(project, floorId, OPTION_B), DISPLAY)
    return [...model.walls, ...model.openings, ...model.rooms, ...model.placedItems].map(
      (row) => [row.entity.id, row.renovationState] as [string, RenovationState],
    )
  })(),
)

/** The Project the geometry comes from: the Option's demolitions set aside, as `FloorWorkspace` does. */
const drawingProject: Project = {
  ...project,
  designOptions: designOptionsOf(project).map((option) =>
    option.id === OPTION_B ? { ...option, demolishedIds: [] } : option,
  ),
}

const ZOOM = 0.05
/** The middle of W-2's band, in client CSS pixels. */
const AT = { x: 9600 * ZOOM, y: 3000 * ZOOM }
const client = (dx: number, dy: number): { clientX: number; clientY: number } => ({
  clientX: AT.x + dx,
  clientY: AT.y + dy,
})

/** What the canvas was told to select, in the order it was told. */
const picks: string[] = []
/** What the canvas reported back from each click. */
const cycles: (CycleState | null)[] = []
const reset = (): void => {
  picks.length = 0
  cycles.length = 0
}

function Harness(props: { pickStates?: readonly RenovationState[]; pan?: { x: number; y: number } }): React.ReactNode {
  const pickStates = props.pickStates ?? []
  const pan = props.pan ?? { x: 0, y: 0 }
  const hostRef = useRef<HTMLDivElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [cycle, setCycleState] = useState<CycleState | null>(null)
  const [candidates, setCandidates] = useState<readonly CycleCandidate[]>([])
  const onCycle = useCallback((next: CycleState | null, rows: readonly CycleCandidate[]): void => {
    cycles.push(next)
    setCycleState(next)
    setCandidates(rows)
  }, [])
  const select = (id: string | null): void => {
    if (id !== null) picks.push(id)
  }
  return (
    <div ref={hostRef} data-testid="host" style={{ width: 400, height: 300 }}>
      <PlanViewCanvas
        hostRef={hostRef}
        svgRef={svgRef}
        floor={effectiveFloor(drawingProject, 0, floorId, OPTION_B)}
        showPlanImage={false}
        imageSrc={null}
        viewport={{ zoom: ZOOM, panX: pan.x, panY: pan.y }}
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
        walls={deriveWalls(drawingProject, floorId, OPTION_B)}
        rooms={deriveRooms(drawingProject, floorId, OPTION_B)}
        onSelectWall={select}
        renovation={{
          states,
          pickStates,
          cycle,
          cycleCandidates: candidates,
          onCycle,
          nameOf: (id: string): string => refOf.get(id) ?? id,
        }}
      />
    </div>
  )
}

/** One click on the band the given Wall is drawn with, `pan` CSS px from its middle. */
function clickWall(container: HTMLElement, wallId: string, dx = 0, dy = 0, pan = { x: 0, y: 0 }): void {
  const node = container.querySelector(`[data-ref="${wallId}"][data-ref-role="wall"]`)
  if (node === null) throw new Error(`no drawn band for ${wallId}`)
  const { clientX, clientY } = client(dx + pan.x, dy + pan.y)
  fireEvent.pointerDown(node, { clientX, clientY, button: 0, pointerId: 1, isPrimary: true })
}

const header = (): string => document.querySelector('[data-testid="overlap-header"]')?.textContent ?? ''
const rows = (): string[] =>
  [...document.querySelectorAll('.bb-renovation-overlap-row')].map((row) => row.textContent ?? '')
const currentRow = (): string => document.querySelector('.bb-renovation-overlap-row.is-current')?.textContent ?? ''

const lastPick = (): string | undefined => picks[picks.length - 1]
const lastCycle = (): CycleState | null | undefined => cycles[cycles.length - 1]

describe('click-to-cycle over overlapping states (#70 criteria 15–18)', () => {
  it('picks the Proposed successor first, walks to the Demolition, and wraps', () => {
    reset()
    const { container } = render(<Harness />)
    clickWall(container, W2)
    expect(lastPick()).toBe(W2_PRIME)
    clickWall(container, W2, 0, 5) // 5 CSS px away: the same spot
    expect(lastPick()).toBe(W2)
    clickWall(container, W2, 0, 2)
    expect(lastPick()).toBe(W2_PRIME)
  })

  it('lists the stack beside the pointer, current row first and bold', () => {
    reset()
    const { container } = render(<Harness />)
    expect(document.querySelector('[data-testid="overlap-cycle"]')).toBeNull()
    clickWall(container, W2)
    expect(header()).toBe('Overlap 1/2 · click again to cycle')
    expect(rows()).toEqual(['▶ [Proposed] W-2′', '[Demolition] W-2'])
    expect(currentRow()).toBe('▶ [Proposed] W-2′')
    clickWall(container, W2, 0, 3)
    expect(header()).toBe('Overlap 2/2 · click again to cycle')
    // The rows stay in cycle order; only the marker moves.
    expect(rows()).toEqual(['[Proposed] W-2′', '▶ [Demolition] W-2'])
    expect(currentRow()).toBe('▶ [Demolition] W-2')
  })

  it('keeps the list inside the canvas bounds', () => {
    reset()
    // jsdom reports an 800 × 600 host (src/test/setup.ts). Panning puts the middle of W-2 at
    // client (800, 610) — past the bottom-right corner — so the list has to be pulled back.
    const pan = { x: 320, y: 460 }
    const { container } = render(<Harness pan={pan} />)
    clickWall(container, W2, 0, 0, pan)
    expect(lastPick()).toBe(W2_PRIME)
    const list = document.querySelector<HTMLElement>('[data-testid="overlap-cycle"]')
    expect(list).not.toBeNull()
    const left = Number.parseFloat(list!.style.left)
    const top = Number.parseFloat(list!.style.top)
    expect(left).toBeGreaterThanOrEqual(0)
    expect(top).toBeGreaterThanOrEqual(0)
    expect(left).toBeLessThanOrEqual(800 - 4)
    expect(top).toBeLessThanOrEqual(600 - 4)
  })

  it('selects the Demolition directly when `Pick:` allows only Demolition', () => {
    reset()
    const { container } = render(<Harness pickStates={['demolition']} />)
    clickWall(container, W2)
    expect(lastPick()).toBe(W2)
    // One reachable candidate is not an overlap: no list.
    expect(document.querySelector('[data-testid="overlap-cycle"]')).toBeNull()
    clickWall(container, W2, 0, 4)
    expect(lastPick()).toBe(W2)
  })

  it('starts a new cycle at the top candidate more than 12 CSS px away', () => {
    reset()
    const { container } = render(<Harness />)
    clickWall(container, W2)
    expect(lastPick()).toBe(W2_PRIME)
    clickWall(container, W2, 0, 15) // 15 CSS px: a different spot
    expect(lastPick()).toBe(W2_PRIME)
    expect(header()).toBe('Overlap 1/2 · click again to cycle')
  })

  it('ends the cycle when Esc clears it, and the list goes with it', () => {
    reset()
    const { container } = render(<Harness />)
    clickWall(container, W2)
    expect(document.querySelector('[data-testid="overlap-cycle"]')).not.toBeNull()
    // The workspace's Escape handler calls exactly this (#70 criterion 18); the selection it made
    // stays, because the click that made it was a real selection.
    workspaceStore.getState().setCycle({ point: AT, candidateIds: [W2_PRIME, W2], index: 1 }, [])
    workspaceStore.getState().clearCycle()
    expect(workspaceStore.getState().cycle).toBeNull()
    expect(workspaceStore.getState().cycleCandidates).toEqual([])
    expect(lastPick()).toBe(W2_PRIME)
  })

  it('clears the cycle on a click that lands on nothing', () => {
    reset()
    const { container } = render(<Harness />)
    clickWall(container, W2)
    const svg = container.querySelector('svg')!
    fireEvent.pointerDown(svg, { clientX: 10, clientY: 10, button: 0, pointerId: 1, isPrimary: true })
    fireEvent.click(svg, { clientX: 10, clientY: 10 })
    expect(lastCycle()).toBeNull()
    expect(document.querySelector('[data-testid="overlap-cycle"]')).toBeNull()
  })
})

describe('the candidate list’s place (#70 criterion 16)', () => {
  it('sits beside the pointer and is pulled back at the edges', () => {
    const size = { width: 180, height: 60 }
    const bounds = { width: 400, height: 300 }
    expect(clampOverlay({ x: 100, y: 100 }, size, bounds)).toEqual({ x: 112, y: 112 })
    expect(clampOverlay({ x: 395, y: 295 }, size, bounds)).toEqual({ x: 216, y: 236 })
    // Never negative, even when the list is bigger than the canvas.
    const small = clampOverlay({ x: 390, y: 290 }, { width: 500, height: 400 }, bounds)
    expect(small.x).toBeGreaterThanOrEqual(0)
    expect(small.y).toBeGreaterThanOrEqual(0)
  })
})
