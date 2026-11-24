/**
 * What the prism holds, and where it puts it (#75 §4, criteria 6, 9, 10, 13).
 *
 * The scene is the committed Elevation View fixture — the #74 Plan View Range scene with a `Tall
 * cupboard` added outside the prism and two Elevation Views of the one Floor. Every number below is
 * either read off the issue's own arithmetic, recomputed here from the view line's endpoints, or a
 * number the fixture stores.
 *
 * The issue's definition is what is being tested, not this module's: `u` is the unit vector
 * start→end, `n` the unit normal on the chosen side, the prism is the closed set
 * `0 ≤ (p − start)·u ≤ L, 0 ≤ (p − start)·n ≤ depth`, and the horizontal coordinate is `(p − start)·u`.
 * So the expectations spell that arithmetic out rather than calling the function that implements it.
 */
import { describe, expect, it } from 'vitest'
import type { ElevationView, ItemDesign, Opening, PlacedItem, Project } from '../domain'
import type { Pt } from '../geometry'
import { elevationRowDepth, elevationScene } from './index'
import { designOutline, worldPoint } from './placement'
import { domainFixture, elevationScene as elevationSceneFixture } from './testing'

const project = elevationSceneFixture()
const view = (id: string): ElevationView => {
  const found = (project.elevationViews ?? []).find((candidate) => candidate.id === id)
  if (found === undefined) throw new Error('the fixture lost its Elevation View')
  return found
}
const kitchen = (): ElevationView => view('el-004')
const angled = (): ElevationView => view('el-005')

/** The issue's arithmetic, spelled out for one view line and side. */
function axes(at: Pt, to: Pt, side: 'left' | 'right'): { readonly s: (p: Pt) => number; readonly d: (p: Pt) => number; readonly length: number } {
  const dx = to.x - at.x
  const dy = to.y - at.y
  const length = Math.hypot(dx, dy)
  const u = { x: dx / length, y: dy / length }
  const n = side === 'left' ? { x: u.y, y: -u.x } : { x: -u.y, y: u.x }
  return { length, s: (p) => (p.x - at.x) * u.x + (p.y - at.y) * u.y, d: (p) => (p.x - at.x) * n.x + (p.y - at.y) * n.y }
}

/** The footprint corners of one Placement, in Floor millimetres, as the plan places them. */
const cornersOf = (design: ItemDesign, placed: PlacedItem): Pt[] => {
  const path = designOutline(design)
  return [path.start, ...path.segments.map((segment) => segment.to)].map((corner) => worldPoint(design, placed, corner))
}

type Row = { readonly id: string; readonly kind: string; readonly name: string }

const row = <T extends Row>(rows: readonly T[], id: string): T => {
  const found = rows.find((candidate) => candidate.id === id)
  if (found === undefined) throw new Error(`no row for ${id}`)
  return found
}
const has = (rows: readonly Row[], id: string): boolean => rows.some((candidate) => candidate.id === id)

describe('elevationScene (#75 criteria 6, 9, 10, 13)', () => {
  it('projects the Kitchen elevation onto the axes the issue defines', () => {
    const shown = elevationScene(project, kitchen())
    expect(shown.length).toBe(4000)
    expect(shown.frame.u).toEqual({ x: 1, y: 0 })
    expect(shown.frame.n).toEqual({ x: 0, y: -1 })
    expect(shown.floor?.id).toBe('pr-002')

    // W-1 runs the whole width, 1 300 mm beyond the line, and is not crossed by it.
    const wall = row(shown.rows, 'pr-017')
    expect([wall.sMin, wall.sMax, wall.distance, wall.crossesLine]).toEqual([0, 4000, 1300, false])
    expect([wall.zMin, wall.zMax]).toEqual([0, 2600])
    expect(wall.kind).toBe('wall')
    expect(wall.name).toBe('W-1')

    // The window sits in that Wall, at its own height, and belongs to it.
    const opening = row(shown.rows, 'pr-021')
    expect([opening.sMin, opening.sMax, opening.distance]).toEqual([1500, 2700, 1300])
    expect([opening.zMin, opening.zMax, opening.kind, opening.hostWallId]).toEqual([900, 2100, 'opening', 'pr-017'])
    expect(opening.name).toBe('Window 1')
  })

  it('holds the Placements at their own distance and clips nothing they do not cross', () => {
    const shown = elevationScene(project, kitchen())
    const base = row(shown.rows, 'pr-005')
    expect([base.sMin, base.sMax, base.distance, base.zMin, base.zMax, base.name]).toEqual([300, 900, 550, 0, 860, 'Base cabinet #1'])
    expect([row(shown.rows, 'pr-016').sMin, row(shown.rows, 'pr-016').sMax, row(shown.rows, 'pr-016').name]).toEqual([1100, 1700, 'Base cabinet #2'])
    expect([row(shown.rows, 'pr-011').sMin, row(shown.rows, 'pr-011').zMin, row(shown.rows, 'pr-011').zMax]).toEqual([300, 1500, 2200])
    // A Placement below the Floor Datum keeps its negative height: the view has no section plane.
    expect([row(shown.rows, 'pr-014').zMin, row(shown.rows, 'pr-014').zMax]).toEqual([-150, -50])
  })

  it('marks the content the view line runs through, and only that (#75 criterion 13)', () => {
    const shown = elevationScene(project, kitchen())
    // W-2 and W-4 stand across the two ends of the line: their bodies straddle d = 0.
    const east = row(shown.rows, 'pr-018')
    const west = row(shown.rows, 'pr-020')
    expect([east.crossesLine, east.distance, east.sMin, east.sMax]).toEqual([true, 0, 3900, 4000])
    expect([west.crossesLine, west.distance, west.sMin, west.sMax]).toEqual([true, 0, 0, 100])
    expect(row(shown.rows, 'pr-017').crossesLine).toBe(false)
    expect(row(shown.rows, 'pr-005').crossesLine).toBe(false)
  })

  it('leaves out what the prism does not hold, and takes it back when the prism moves (#75 criterion 9)', () => {
    const shown = elevationScene(project, kitchen())
    // W-3 and the Tall cupboard stand on the far side of the line, which is behind the viewer.
    expect(has(shown.rows, 'pr-019')).toBe(false)
    expect(has(shown.rows, 'el-002')).toBe(false)
    expect(shown.rows.filter((each) => each.kind === 'item')).toHaveLength(4)

    // The same line moved 1 200 mm into the room holds the Tall cupboard 200 mm beyond it and
    // leaves W-1 — now 2 600 mm away, past the depth — out. Nothing else about the view changed.
    const moved = elevationScene(project, { ...kitchen(), line: { start: { x: 0, y: 2900 }, end: { x: 4000, y: 2900 } } })
    const cupboard = row(moved.rows, 'el-002')
    const placed = project.existingModel.placedItems.find((each) => each.id === 'el-002')!
    const design = project.itemDesigns.find((each) => each.id === placed.itemDesignId)!
    const { d } = axes({ x: 0, y: 2900 }, { x: 4000, y: 2900 }, 'left')
    expect(cupboard.distance).toBeCloseTo(Math.min(...cornersOf(design, placed).map(d)), 2)
    expect(cupboard.crossesLine).toBe(false)
    expect(has(moved.rows, 'pr-017')).toBe(false)
  })

  it('includes content touching the far edge exactly, and clips at the view edge (#75 criterion 10)', () => {
    // W-1 is 1 300 mm from the line: a depth of exactly 1 300 holds it, a micron less does not.
    expect(has(elevationScene(project, { ...kitchen(), depth: 1300 }).rows, 'pr-017')).toBe(true)
    expect(has(elevationScene(project, { ...kitchen(), depth: 1299.999 }).rows, 'pr-017')).toBe(false)

    // A view line that stops short of W-1's ends draws the part of it it stands in front of.
    const short = elevationScene(project, { ...kitchen(), line: { start: { x: 1000, y: 1400 }, end: { x: 3000, y: 1400 } } })
    expect([short.length, row(short.rows, 'pr-017').sMin, row(short.rows, 'pr-017').sMax]).toEqual([2000, 0, 2000])
    // The window is 1 500–2 700 along the Wall, so 500–1 700 along this shorter line.
    expect([row(short.rows, 'pr-021').sMin, row(short.rows, 'pr-021').sMax]).toEqual([500, 1700])
  })

  it('projects a view line at 29.86° to the plan axes to a hundredth of a millimetre (#75 criterion 6)', () => {
    const shown = elevationScene(project, angled())
    const at = { x: 400, y: 200 }
    const to = { x: 2598, y: 1460 }
    const { s, length } = axes(at, to, 'right')
    expect(shown.length).toBeCloseTo(length, 6)

    // `Base cabinet #2` stands at (1 400, 600). Its band is the issue's own arithmetic over the
    // footprint the plan places there: the least and greatest of (p − start)·u over its corners,
    // and its distance the least of (p − start)·n.
    const placed = project.existingModel.placedItems.find((each) => each.id === 'pr-016')!
    const design = project.itemDesigns.find((each) => each.id === placed.itemDesignId)!
    const along = cornersOf(design, placed).map(s)
    const item = row(shown.rows, 'pr-016')
    expect(item.sMin).toBeCloseTo(Math.max(0, Math.min(...along)), 2)
    expect(item.sMax).toBeCloseTo(Math.min(shown.length, Math.max(...along)), 2)
    expect(item.sMin).toBeGreaterThanOrEqual(0)
    expect(item.sMax).toBeLessThanOrEqual(shown.length)
    // Its distance is the least of (p − start)·n over the part of it the prism holds, which is 0
    // for a Placement the view line runs through and never less than 0 for anything it does not.
    expect(item.distance).toBeGreaterThanOrEqual(0)

    // The two Walls the angled prism holds are the two it stands in front of.
    expect(has(shown.rows, 'pr-019')).toBe(true)
    expect(has(shown.rows, 'pr-020')).toBe(true)
    expect(has(shown.rows, 'pr-017')).toBe(false)
    expect(has(shown.rows, 'pr-018')).toBe(false)
    // W-3 is the Wall along y = 3 000, 200 mm thick. Its nearest face would be 1 500 mm from this
    // line at x = 4 000, but that corner lies beyond the end of the view line (s = 4 465 > 2 533),
    // so the nearest point the prism holds is where the face crosses s = L: 1 659.82 mm.
    expect(row(shown.rows, 'pr-019').distance).toBeCloseTo(1659.8233173336532, 6)
  })

  it('flipping the side looks the other way and sees the Wall behind the viewer', () => {
    const shown = elevationScene(project, kitchen())
    const flipped = elevationScene(project, { ...kitchen(), side: 'right' })
    expect(has(shown.rows, 'pr-017')).toBe(true)
    expect(has(flipped.rows, 'pr-017')).toBe(false)
    expect(has(flipped.rows, 'pr-019')).toBe(true)
    expect(row(flipped.rows, 'pr-019').distance).toBeCloseTo(1500, 6)
    // The four Placements stood in front of the old side; the Tall cupboard stood behind it.
    expect(flipped.rows.filter((each) => each.kind === 'item').map((each) => each.id)).toEqual(['el-002'])
  })

  it('draws no Room and no Plan Image, whatever the Floor holds', () => {
    const shown = elevationScene(project, kitchen())
    const roomIds = new Set((project.existingModel.rooms ?? []).map((room) => room.id))
    expect(shown.rows.filter((each) => roomIds.has(each.id))).toEqual([])
    expect(shown.rows.every((each) => each.kind === 'wall' || each.kind === 'opening' || each.kind === 'item')).toBe(true)
    expect(shown.rows.every((each) => Number.isFinite(each.sMin) && Number.isFinite(each.sMax) && each.sMin <= each.sMax)).toBe(true)
  })

  it('answers the same rows twice, and no rows for a line with nothing beside it', () => {
    expect(elevationScene(project, kitchen()).rows).toEqual(elevationScene(project, kitchen()).rows)
    const away = elevationScene(project, { ...kitchen(), line: { start: { x: 5000, y: 5000 }, end: { x: 6000, y: 5000 } }, depth: 1000 })
    expect(away.rows).toEqual([])
    expect(away.length).toBe(1000)
  })
})

/**
 * A Beam projected into a Section (#77 §4, criterion 17).
 *
 * The fixture's view line runs along y = 1 400 across Floor `pr-002`, 20 mm of depth in front of it.
 * A Beam laid along that line is inside the prism and does not cross it; one run across the line
 * does, which is the content the pane draws with the heavier outline.
 */
describe('elevationScene with a Beam (#77 §4)', () => {
  const withBeams = (beams: Parameters<typeof Object.assign>[1][]): typeof project => ({
    ...project,
    existingModel: { ...project.existingModel, beams: beams as never },
  })
  const beam = (id: string, start: Pt, end: Pt, underside: number, height: number) => ({
    id,
    floorId: 'pr-002',
    line: { start, end },
    justification: 'centre' as const,
    width: 200,
    underside,
    height,
    label: `Beam B-${id.slice(-1)}`,
  })

  const scene = elevationScene(
    withBeams([
      beam('bm-cross', { x: 2000, y: 400 }, { x: 2000, y: 2400 }, 2160, 300),
    ]),
    kitchen(),
  )

  it('projects a Beam as its own band, Underside to Top', () => {
    const cross = row(scene.rows, 'bm-cross')
    expect(cross.kind).toBe('beam')
    expect(cross.zMin).toBe(2160)
    expect(cross.zMax).toBe(2460)
    // The view line runs straight through its body, which is the content drawn with the heavier
    // outline — the same rule that makes a Wall the Section cuts heavier (#75 §4).
    expect(cross.crossesLine).toBe(true)
  })

  it('draws a Beam standing in front of the line without crossing it', () => {
    const front = elevationScene(withBeams([beam('bm-front', { x: 1000, y: 800 }, { x: 3000, y: 800 }, 2300, 300)]), kitchen())
    const row2 = row(front.rows, 'bm-front')
    expect(row2.crossesLine).toBe(false)
    expect(row2.zMin).toBe(2300)
    expect(row2.zMax).toBe(2600)
    // The band runs the length of the reference line, measured along the view line from its start.
    expect(row2.sMin).toBeCloseTo(1000, 6)
    expect(row2.sMax).toBeCloseTo(3000, 6)
  })

  it('leaves a Beam wholly behind the prism out (#75 criterion 9)', () => {
    // `el-004` looks at −y from its line at y = 1 400, so a Beam whose whole 200 mm body lies at
    // y = 2 000 stands behind the observer and belongs to no Section.
    const behind = elevationScene(withBeams([beam('bm-behind', { x: 1000, y: 2000 }, { x: 3000, y: 2000 }, 2300, 300)]), kitchen())
    expect(behind.rows.some((entry) => entry.id === 'bm-behind')).toBe(false)
  })
})

/**
 * A Skirting's rows in the prism (#78 §4, §7).
 *
 * The v13 Skirting fixture is the scene: `Skirting SK-1` stands on `W-1`'s left face — the face a
 * view looking from that side sees — for 0 to 9 000 mm at 0 to 100 mm. The strip owns its height, so
 * its band is Bottom to Top, and it is broken wherever the derivation cuts a gap: an Opening whose
 * sill is below its top is a hole in the strip, exactly the hole the Plan View paints and the one
 * `net_length_mm` counts.
 */
describe('the Skirting rows of an Elevation View (#78 §4)', () => {
  const skirtingProject = domainFixture('v13/skirting.json')
  /** Looking along `W-1` from its kitchen side: the prism covers y 600 down to y −400. */
  const kitchenSide = (over: Partial<ElevationView> = {}): ElevationView => ({
    id: 'el-skirting',
    name: 'Kitchen side elevation',
    kind: 'elevation',
    floorId: 'seed-001',
    designOptionId: null,
    line: { start: { x: 600, y: 600 }, end: { x: 9600, y: 600 } },
    side: 'left',
    depth: 1000,
    renovationDisplay: 'existing',
    ...over,
  })
  /** A door straight through the Wall at 4 000 to 4 900, sill on the floor. */
  const door: Opening = {
    id: 'el-door',
    floorId: 'seed-001',
    hostWallId: 'seed-wall-002',
    kind: 'door',
    label: 'Door to utility',
    start: 4000,
    width: 900,
    sill: 0,
    head: 2100,
    hingeSide: 'start',
    swing: 'left',
  }
  const withDoor: Project = {
    ...skirtingProject,
    existingModel: { ...skirtingProject.existingModel, openings: [...skirtingProject.existingModel.openings, door] },
  }

  it('stands at its own bottom and top, on the face the view looks at', () => {
    const rows = elevationScene(skirtingProject, kitchenSide()).rows.filter((each) => each.kind === 'skirting')
    expect(rows).toHaveLength(1)
    const strip = rows[0]!
    expect([strip.id, strip.name, strip.hostWallId]).toEqual(['skirting-1', 'Skirting SK-1', 'seed-wall-002'])
    expect([strip.zMin, strip.zMax]).toEqual([0, 100])
    // The view line runs along the Wall's reference line, so the strip's 15 mm of body sits at the
    // host face: 100 mm of the 1 000 mm prism, and nearer than the Wall's far face.
    expect(strip.distance).toBeCloseTo(100, 6)
    expect(strip.crossesLine).toBe(false)
  })

  it('breaks into one row per run where an Opening cuts it', () => {
    const rows = elevationScene(withDoor, kitchenSide()).rows.filter(
      (each) => each.kind === 'skirting' && each.id === 'skirting-1',
    )
    expect(rows).toHaveLength(2)
    const sMin = Math.min(...rows.map((each) => each.sMin))
    expect(sMin).toBeCloseTo(0, 6)
    // The door is 4 000 to 4 900 along the Wall, which is the same distance along the view line: the
    // two rows meet its two jambs and nothing else.
    expect(Math.max(...rows.map((each) => each.sMax))).toBeCloseTo(9000, 6)
    expect(rows.map((each) => each.sMax).sort((a, b) => a - b)[0]).toBeCloseTo(4000, 6)
    expect(rows.map((each) => each.sMin).sort((a, b) => a - b)[1]).toBeCloseTo(4900, 6)
  })

  it('is absent when the view looks at the other face', () => {
    // The strip stands on the left face; a view from the right side has the Wall's 200 mm of body in
    // front of it and the strip itself beyond the prism's far plane.
    const rows = elevationScene(skirtingProject, kitchenSide({ side: 'right' })).rows.filter(
      (each) => each.kind === 'skirting',
    )
    expect(rows).toEqual([])
  })

  it('is painted and picked at its host Wall’s depth, not its own', () => {
    // The strip's own `distance` is the face it stands off — 100 mm in front of the Wall it is skirted
    // to. A Skirting is a finish on that Wall, so the Section puts it where the Wall is and lifts it
    // above the Wall in the stack: the same rule the Plan View paints by, one helper for both (#78 §7).
    const rows = elevationScene(skirtingProject, kitchenSide()).rows
    const depthOf = elevationRowDepth(rows)
    const host = rows.find((each) => each.kind === 'wall' && each.id === 'seed-wall-002')!
    const strip = rows.find((each) => each.kind === 'skirting' && each.id === 'skirting-1')!
    expect(depthOf(strip)).toBe(depthOf(host))
    expect(depthOf(strip)).not.toBe(strip.distance)
    // A Wall keeps its own distance: the helper widens nothing that is not a Skirting.
    expect(depthOf(host)).toBe(host.distance)
  })
})
