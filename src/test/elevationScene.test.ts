/**
 * The #75 Elevation View scene (`fixtures/domain/v10/elevation-scene.json`).
 *
 * Two jobs, the way `planRangeScene.test.ts` splits them: the **committed bytes** are held to the
 * issue's Fixture scene, and the **criteria the scene exists for** — which content a band holds
 * (criterion 9), that content reaching past the ends of the view line is clipped there (criterion 10),
 * that a Wall the view line runs through is cut (criterion 13), and that a line at an angle to the
 * plan axes behaves the same way — are run against it.
 *
 * The scene, in the criteria's words: one Floor with an upper limit of 2 600 and no lower one; W-1…W-4
 * at 0–2 600 with `Window 1` in W-1 at 900–2 100; `Base cabinet #1` and `#2` at Base 0, `Wall cabinet
 * #1` at 1 500 over `#1`, `Sump box` at −150, and a `Tall cupboard` at (3 000, 2 400) standing behind
 * the viewer; `Kitchen elevation` on (0, 1 400) → (4 000, 1 400) looking `left` 2 000 deep, and `Angled
 * elevation` on (400, 200) → (2 598, 1 460) — 29.86° to the plan axes — looking `right` 2 400 deep.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { designOutline, effectiveModel, worldPoint } from '../derive'
import { elevationScene } from '../derive/testing'
import { validateProject } from '../domain'
import type { ElevationView, Opening, Project, Wall } from '../domain'
import {
  elevationFrame,
  faceOffsets,
  projectElevationOutline,
  wallBodyOutline,
  type ElevationProjection,
  type ElevationFrame,
  type Pt,
} from '../geometry'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const committed = readFileSync(join(fixturesRoot, 'domain', 'v10', 'elevation-scene.json'), 'utf8')
const envelope = JSON.parse(committed) as { domainSchemaVersion: number; project: Project }

const scene = elevationScene()
const floor = scene.floors[0]!
const model = effectiveModel(scene, floor.id, null)

const viewNamed = (name: string): ElevationView =>
  (scene.elevationViews ?? []).find((view) => view.name === name) ?? (() => { throw new Error(`no ${name}`) })()

const frameOf = (name: string): ElevationView & { frame: ElevationFrame } => {
  const view = viewNamed(name)
  return { ...view, frame: elevationFrame(view.line, view.side, view.depth) }
}

/** The Wall whose reference line starts at `start`; the scene's Walls are named by where they stand. */
const wallFrom = (x: number, y: number): Wall =>
  model.standingWalls.find((wall) => wall.line.kind === 'line' && wall.line.start.x === x && wall.line.start.y === y) ??
  (() => { throw new Error(`no Wall starting at ${x},${y}`) })()

/** The band answer for one Wall: its body, not its reference line (#75 criterion 13). */
const seenWall = (frame: ElevationFrame, wall: Wall): ElevationProjection =>
  projectElevationOutline(frame, wallBodyOutline(wall.line, faceOffsets(wall.thickness, wall.justification)))

/** The band answer for an Opening: the strip of host Wall it occupies, at the host's thickness. */
const seenOpening = (frame: ElevationFrame, opening: Opening): ElevationProjection => {
  const host = model.standingWalls.find((wall) => wall.id === opening.hostWallId) ?? (() => { throw new Error('no host') })()
  if (host.line.kind !== 'line') throw new Error('this scene holds straight Walls only')
  const length = Math.hypot(host.line.end.x - host.line.start.x, host.line.end.y - host.line.start.y)
  const ux = (host.line.end.x - host.line.start.x) / length
  const uy = (host.line.end.y - host.line.start.y) / length
  const at = (t: number): Pt => ({ x: host.line.start.x + ux * t, y: host.line.start.y + uy * t })
  return projectElevationOutline(
    frame,
    wallBodyOutline({ kind: 'line', start: at(opening.start), end: at(opening.start + opening.width) }, faceOffsets(host.thickness, host.justification)),
  )
}

/** The band answer for a placement: its footprint pushed into world coordinates. */
const seenItem = (frame: ElevationFrame, designName: string, index = 0): ElevationProjection => {
  const design = scene.itemDesigns.find((candidate) => candidate.name === designName) ?? (() => { throw new Error(`no ${designName}`) })()
  const placements = model.standingPlacedItems.filter((item) => item.itemDesignId === design.id)
  const item = placements[index] ?? (() => { throw new Error(`no ${designName} #${index}`) })()
  const outline = designOutline(design)
  const ring = [outline.start, ...outline.segments.map((segment) => segment.to)]
  return projectElevationOutline(frame, ring.map((point) => worldPoint(design, item, point)))
}

const kitchen = frameOf('Kitchen elevation')
const angled = frameOf('Angled elevation')

describe('the committed scene (#75, the Fixture scene)', () => {
  it('is a v10 Project the validator accepts', () => {
    // The bytes stay at v10 forever as compatibility evidence, so what the validator judges is the
    // Project the app actually holds after reading them forward to the current schema (#80).
    expect(envelope.domainSchemaVersion).toBe(10)
    expect(validateProject(scene).ok).toBe(true)
  })

  it('stands one Floor whose limits have an upper end and no lower one', () => {
    expect(scene.floors).toHaveLength(1)
    expect(floor.limits).toEqual({ upperMm: 2600 })
  })

  it('holds the two Elevation Views of the issue, and no Plan View fields', () => {
    expect((scene.elevationViews ?? []).map((view) => view.name)).toEqual(['Kitchen elevation', 'Angled elevation'])
    expect(kitchen).toMatchObject({
      kind: 'elevation',
      floorId: floor.id,
      line: { start: { x: 0, y: 1400 }, end: { x: 4000, y: 1400 } },
      side: 'left',
      depth: 2000,
    })
    expect(angled).toMatchObject({
      kind: 'elevation',
      line: { start: { x: 400, y: 200 }, end: { x: 2598, y: 1460 } },
      side: 'right',
      depth: 2400,
    })
    expect(scene.views.some((view) => view.kind === 'plan')).toBe(true)
  })

  it('stands a Tall cupboard behind the Kitchen elevation’s viewer, and nothing else there', () => {
    const tall = model.standingPlacedItems.find((item) => scene.itemDesigns.some((d) => d.id === item.itemDesignId && d.name === 'Tall cupboard'))
    expect(tall?.translation).toEqual({ x: 3000, y: 2400 })
    expect(tall?.baseElevation).toBe(0)
  })
})

describe('the Kitchen elevation (#75 criteria 9, 10, 13)', () => {
  it('looks into the room along −y from a line 4 000 long', () => {
    expect(kitchen.frame.length).toBe(4000)
    expect(kitchen.frame.u).toEqual({ x: 1, y: 0 })
    expect(kitchen.frame.n).toEqual({ x: 0, y: -1 })
  })

  it('holds the Wall it faces, 1 300 in front of the line, end to end', () => {
    const seen = seenWall(kitchen.frame, wallFrom(0, 0))
    expect(seen).toMatchObject({ inside: true, sMin: 0, sMax: 4000, distance: 1300, crossesLine: false })
  })

  it('holds the window in that Wall at the same distance, between its jambs', () => {
    const opening = model.standingOpenings[0] as Opening
    expect(seenOpening(kitchen.frame, opening)).toMatchObject({
      inside: true,
      sMin: 1500,
      sMax: 2700,
      distance: 1300,
      crossesLine: false,
    })
  })

  it('holds the four near placements 550 in front, and not the Tall cupboard behind', () => {
    expect(seenItem(kitchen.frame, 'Base cabinet', 0)).toMatchObject({ inside: true, sMin: 300, sMax: 900, distance: 550 })
    expect(seenItem(kitchen.frame, 'Wall cabinet')).toMatchObject({ inside: true, sMin: 300, sMax: 900, distance: 550 })
    expect(seenItem(kitchen.frame, 'Sump box')).toMatchObject({ inside: true, sMin: 1900, sMax: 2500, distance: 550 })
    expect(seenItem(kitchen.frame, 'Base cabinet', 1)).toMatchObject({ inside: true, sMin: 1100, sMax: 1700, distance: 550 })
    expect(seenItem(kitchen.frame, 'Tall cupboard').inside).toBe(false)
  })

  it('leaves the Wall behind the viewer out entirely', () => {
    const seen = seenWall(kitchen.frame, wallFrom(4000, 3000))
    expect(seen.inside).toBe(false)
    expect(seen.distance).toBe(Number.POSITIVE_INFINITY)
  })

  it('cuts the two side Walls the line runs through, and reports the cut', () => {
    const right = seenWall(kitchen.frame, wallFrom(4000, 0))
    expect(right).toMatchObject({ inside: true, sMin: 3900, sMax: 4000, distance: 0, crossesLine: true })
    const left = seenWall(kitchen.frame, wallFrom(0, 3000))
    expect(left).toMatchObject({ inside: true, sMin: 0, sMax: 100, distance: 0, crossesLine: true })
  })

  it('clips what reaches past the ends of the line to those ends (#75 criterion 10)', () => {
    // W-2 runs to y = 3 000, far past the line's end at (4 000, 1 400); its band stops at s = L.
    expect(seenWall(kitchen.frame, wallFrom(4000, 0)).sMax).toBe(kitchen.frame.length)
    // …and W-4 starts at y = 3 000 behind the viewer's shoulder, so it begins at s = 0.
    expect(seenWall(kitchen.frame, wallFrom(0, 3000)).sMin).toBe(0)
  })
})

describe('the Angled elevation (#75 criterion 9, a line at an angle)', () => {
  it('stands 29.86° to the plan axes with its normal into the room', () => {
    expect(angled.frame.length).toBeCloseTo(2533.5, 1)
    expect(angled.frame.u.x).toBeCloseTo(0.86756, 4)
    expect(angled.frame.u.y).toBeCloseTo(0.49734, 4)
    expect(angled.frame.n.x).toBeCloseTo(-0.49734, 4)
    expect(angled.frame.n.y).toBeCloseTo(0.86756, 4)
  })

  it('holds the two Walls in front of it and neither of the two behind', () => {
    expect(seenWall(angled.frame, wallFrom(4000, 3000)).inside).toBe(true)
    expect(seenWall(angled.frame, wallFrom(0, 3000)).inside).toBe(true)
    expect(seenWall(angled.frame, wallFrom(0, 0)).inside).toBe(false)
    expect(seenWall(angled.frame, wallFrom(4000, 0)).inside).toBe(false)
  })

  it('keeps the distances it measures independent of the axes', () => {
    expect(seenWall(angled.frame, wallFrom(0, 3000)).distance).toBeCloseTo(603.2, 1)
    expect(seenWall(angled.frame, wallFrom(4000, 3000)).distance).toBeCloseTo(1659.8, 1)
    expect(seenItem(angled.frame, 'Base cabinet', 1).distance).toBeCloseTo(0, 6)
  })

  it('cuts the placements the line runs through, and leaves the sump behind', () => {
    expect(seenItem(angled.frame, 'Base cabinet', 0).crossesLine).toBe(true)
    expect(seenItem(angled.frame, 'Wall cabinet').crossesLine).toBe(true)
    expect(seenItem(angled.frame, 'Sump box').inside).toBe(false)
    expect(seenItem(angled.frame, 'Tall cupboard').inside).toBe(false)
  })
})
