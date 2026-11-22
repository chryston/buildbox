/**
 * The four Renovation Displays, rendered (#70 criterion 7).
 *
 * Criterion 7 names the entities: Existing draws `W-2` and `Base 600 #1` and neither the replacement
 * nor the Island; Demolition puts the demolition overlay on those two; Proposed hides both and draws
 * `Base 600 #1′` and the Island with the proposed halo; Combined draws all four, hatched and haloed
 * as each one's State says.
 *
 * It is asserted through the real canvas rather than through `displayModel` alone, because the
 * promise is about what is *on the canvas*: `FloorWorkspace` hands `PlanViewCanvas` the Display's
 * states, the canvas filters what it draws and lays `drawing`'s overlays on it, and the renderer
 * stamps every node with the entity it came from. Those stamps are what this reads — a Display that
 * drew the wrong set, or drew the right set without its overlay, would show up here and nowhere else.
 *
 * The scene is the committed fixture, so the Walls, the Placed Items and the two Options are the ones
 * the Intents built, not ones this test invented.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { deriveRooms, deriveWalls, displayModel, effectiveFloor, effectiveModel } from '../../../derive'
import type { RenovationState } from '../../../derive'
import type { Project, RenovationDisplay } from '../../../domain'
import { designOptionsOf } from '../../../domain'
import { PlanViewCanvas } from '../PlanViewCanvas'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../fixtures')

const project = structuredClone(
  (JSON.parse(readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'renovation-views.json'), 'utf8')) as {
    projects: { data: Project }[]
  }).projects[0]!.data,
) as Project

const floorId = project.floors[0]!.id
const optionA = designOptionsOf(project)[0]!

/** The four entities criterion 7 names, found by the words the issue uses, not by id. */
const wallRef = (ref: string): string => project.existingModel.walls.find((wall) => wall.ref === ref)!.id
const designName = (name: string): string => project.itemDesigns.find((design) => design.name === name)!.id
const placementOf = (designId: string): string =>
  project.existingModel.placedItems.find((item) => item.itemDesignId === designId)!.id
const proposedOf = (designId: string): string[] =>
  optionA.proposed.placedItems.filter((item) => item.itemDesignId === designId).map((item) => item.id)

const W2 = wallRef('W-2')
const BASE_DESIGN = designName('Base 600')
const BASE_EXISTING = placementOf(BASE_DESIGN)
const [BASE_SUCCESSOR] = proposedOf(BASE_DESIGN)
const [ISLAND] = proposedOf(designName('Kitchen island'))

/** What the Display draws, as the canvas sees it: the State map `FloorWorkspace` builds. */
const statesOf = (display: RenovationDisplay): ReadonlyMap<string, RenovationState> => {
  const model = displayModel(effectiveModel(project, floorId, optionA.id), display)
  return new Map(
    [...model.walls, ...model.openings, ...model.rooms, ...model.placedItems].map((row) => [row.entity.id, row.renovationState]),
  )
}

/**
 * The Project the canvas's geometry comes from: the same one with the open Option's `demolishedIds`
 * set aside, which is what lets a Wall marked for demolition still be drawn (#70 §The four Renovation
 * Displays). `FloorWorkspace` derives from exactly this.
 */
const drawingProject = (optionId: string): Project => ({
  ...project,
  designOptions: designOptionsOf(project).map((option) =>
    option.id === optionId ? { ...option, demolishedIds: [] } : option,
  ),
})

/** Every `data-ref` the rendered canvas carries, with the role each node was stamped as. */
const rendered = (display: RenovationDisplay): Map<string, string[]> => {
  const states = statesOf(display)
  const source = drawingProject(optionA.id)
  const floor = effectiveFloor(source, 0, floorId, optionA.id)
  const walls = deriveWalls(source, floorId, optionA.id)
  const rooms = deriveRooms(source, floorId, optionA.id)
  const { container } = render(
    <PlanViewCanvas
      hostRef={createRef<HTMLDivElement>()}
      svgRef={createRef<SVGSVGElement>()}
      floor={floor}
      showPlanImage={false}
      imageSrc={null}
      viewport={{ zoom: 0.05, panX: 0, panY: 0 }}
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
      rooms={rooms}
      renovation={{ states }}
    />,
  )
  const rows = new Map<string, string[]>()
  for (const node of Array.from(container.querySelectorAll('[data-ref]'))) {
    const id = node.getAttribute('data-ref')!
    const role = node.getAttribute('data-ref-role') ?? ''
    rows.set(id, [...(rows.get(id) ?? []), role])
  }
  return rows
}

const drawn = (rows: Map<string, string[]>, id: string | undefined): boolean => id !== undefined && rows.has(id)
const hatched = (rows: Map<string, string[]>, id: string): boolean => (rows.get(id) ?? []).some((role) => role.endsWith('-hatch'))
const haloed = (rows: Map<string, string[]>, id: string): boolean => (rows.get(id) ?? []).some((role) => role.endsWith('-halo'))

describe('the four Renovation Displays on the canvas (#70 criterion 7)', () => {
  it('draws the Existing Model as itself, with no renovation graphics at all', () => {
    const rows = rendered('existing')
    expect(drawn(rows, W2)).toBe(true)
    expect(drawn(rows, BASE_EXISTING)).toBe(true)
    expect(drawn(rows, BASE_SUCCESSOR)).toBe(false)
    expect(drawn(rows, ISLAND)).toBe(false)
    const roles = [...rows.values()].flat()
    expect(roles.filter((role) => role.includes('renovation') || role.endsWith('-hatch') || role.endsWith('-halo'))).toEqual([])
  })

  it('puts the demolition overlay on W-2 and Base 600 #1, and shows no proposed work', () => {
    const rows = rendered('demolition')
    expect(drawn(rows, W2)).toBe(true)
    expect(drawn(rows, BASE_EXISTING)).toBe(true)
    expect(hatched(rows, W2)).toBe(true)
    expect(hatched(rows, BASE_EXISTING)).toBe(true)
    expect(haloed(rows, W2)).toBe(false)
    expect(drawn(rows, BASE_SUCCESSOR)).toBe(false)
    expect(drawn(rows, ISLAND)).toBe(false)
  })

  it('hides W-2 and Base 600 #1 and halos the replacement and the Island', () => {
    const rows = rendered('proposed')
    expect(drawn(rows, W2)).toBe(false)
    expect(drawn(rows, BASE_EXISTING)).toBe(false)
    expect(drawn(rows, BASE_SUCCESSOR)).toBe(true)
    expect(drawn(rows, ISLAND)).toBe(true)
    expect(haloed(rows, BASE_SUCCESSOR!)).toBe(true)
    expect(haloed(rows, ISLAND!)).toBe(true)
    expect(hatched(rows, BASE_SUCCESSOR!)).toBe(false)
    expect(hatched(rows, ISLAND!)).toBe(false)
  })

  it('draws everything in Combined, each entity in its own State', () => {
    const rows = rendered('combined')
    expect(hatched(rows, W2)).toBe(true)
    expect(hatched(rows, BASE_EXISTING)).toBe(true)
    expect(haloed(rows, BASE_SUCCESSOR!)).toBe(true)
    expect(haloed(rows, ISLAND!)).toBe(true)
    // The hatched Wall is still drawn as a Wall: the overlay is a separate node, not a repaint.
    expect((rows.get(W2) ?? []).some((role) => role === 'wall')).toBe(true)
  })

  it('leaves Option B seeing none of Option A', () => {
    const optionB = designOptionsOf(project)[1]!
    const rows = new Map<string, string[]>()
    const model = displayModel(effectiveModel(project, floorId, optionB.id), 'combined')
    for (const row of [...model.walls, ...model.placedItems]) rows.set(row.entity.id, [...(rows.get(row.entity.id) ?? []), row.renovationState])
    expect(drawn(rows, ISLAND)).toBe(false)
    expect(drawn(rows, BASE_EXISTING)).toBe(true)
    expect(rows.get(BASE_EXISTING)).toEqual(['existing'])
    expect(rows.get(W2)).toEqual(['demolition'])
  })
})
