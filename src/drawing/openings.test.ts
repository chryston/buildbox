/**
 * Openings as they are drawn (#65 §12): the Wall band cut into the pieces its gaps leave, the
 * leaf and swing of a door square to the chord, a window's three lines, a removed section's two
 * dashed ones. Every coordinate here is the same number the fit rule checked, so these tests are
 * also the proof that a plan and a rejection cannot disagree.
 */
import { describe, expect, it } from 'vitest'
import { deriveWalls } from '../derive'
import { domainFixture } from '../derive/testing'
import type { Opening, Project, Wall, WallJunction } from '../domain'
import { drawWalls } from './walls'
import { STYLES } from './styles'
import { openingItems, wallOpenings } from './openings'
import type { OpeningSymbol } from './openings'
import type { DisplayItem, PathCommand } from './types'

const sizing = { kind: 'screen', pxPerMm: 1 } as const

const projectWith = (
  walls: readonly Wall[],
  openings: readonly Opening[],
  junctions: readonly WallJunction[] = [],
): Project => {
  const base = domainFixture('v4/project-basic.json')
  return {
    ...base,
    existingModel: { ...base.existingModel, walls: [...walls], wallJunctions: [...junctions], openings: [...openings] },
  }
}

/** A straight Wall, centre-justified, from `start` (the origin unless given). */
const wall = (
  id: string,
  thickness: number,
  end: { x: number; y: number },
  start: { x: number; y: number } = { x: 0, y: 0 },
): Wall => ({
  id,
  ref: `W-${id}`,
  floorId: 'floor-main',
  line: { kind: 'line', start, end },
  thickness,
  justification: 'centre',
  baseElevation: 0,
  height: 2600,
})

/** A half-circle Wall: centre (2000, 0), radius 2000, arc length 6283 mm. */
const arcWall = (id: string, thickness = 200): Wall => ({
  id,
  ref: `W-${id}`,
  floorId: 'floor-main',
  line: { kind: 'arc', start: { x: 0, y: 0 }, through: { x: 2000, y: 2000 }, end: { x: 4000, y: 0 } },
  thickness,
  justification: 'centre',
  baseElevation: 0,
  height: 2600,
})

const opening = (
  id: string,
  hostWallId: string,
  kind: Opening['kind'],
  start: number,
  width: number,
  extra: Partial<Opening> = {},
): Opening => ({
  id,
  floorId: 'floor-main',
  hostWallId,
  kind,
  label: kind === 'door' ? 'Door 1' : kind === 'window' ? 'Window 1' : 'Removed section 1',
  start,
  width,
  sill: kind === 'door' ? 0 : 1050,
  head: 2300,
  ...(kind === 'door' ? { swing: 'left', hingeSide: 'start' } : {}),
  ...extra,
} as Opening)

const itemsOf = (items: readonly DisplayItem[], role: string): readonly DisplayItem[] =>
  items.filter((item) => item.ref?.role === role)

/**
 * The marks an Opening is drawn with, in the order they are drawn.
 *
 * The invisible footprint each committed Opening carries is not a mark and has none of the
 * geometry these tests are about — its corners are the Wall's own faces — so it is left out here
 * and asserted on its own below.
 */
const paths = (items: readonly DisplayItem[]): readonly { role: string; style: string; segments: readonly PathCommand[] }[] =>
  items.flatMap((item) => item.kind === 'path' && item.ref?.role !== 'opening-hit'
    ? [{ role: item.ref?.role ?? '', style: item.style, segments: item.segments }]
    : [])

/** Every endpoint of every command of every path, which is where a coordinate shows up. */
const pointsOf = (items: readonly DisplayItem[]): readonly { x: number; y: number }[] =>
  paths(items).flatMap((path) => path.segments.map((command) => command.to))

/** What `drawWalls` puts on the two Wall layers for a Project built out of these arrays. */
function drawn(
  walls: readonly Wall[],
  openings: readonly Opening[],
  junctions: readonly WallJunction[] = [],
): { band: readonly DisplayItem[]; symbols: readonly DisplayItem[] } {
  const list = drawWalls(deriveWalls(projectWith(walls, openings, junctions), 'floor-main'), {
    sizing,
    openings: wallOpenings(walls, junctions, openings),
  })
  const of = (key: string): readonly DisplayItem[] => list.layers.find((entry) => entry.key === key)?.items ?? []
  return { band: of('walls'), symbols: of('wall-openings') }
}

describe('wallOpenings — the band the gaps leave', () => {
  it('says nothing about a Wall with no Openings', () => {
    const walls = [wall('a', 200, { x: 4000, y: 0 })]
    expect(wallOpenings(walls, [], [])).toEqual([])
  })

  it('cuts the band at both jambs, leaving the gap the Opening is', () => {
    const walls = [wall('a', 200, { x: 4000, y: 0 })]
    const [entry] = wallOpenings(walls, [], [opening('o1', 'a', 'door', 1000, 1000)])
    expect(entry.pieces.map((piece) => [piece.from, piece.to])).toEqual([[0, 1000], [2000, 4000]])
  })

  it('keeps the pieces inside the tidied band where a Junction trimmed the Wall', () => {
    // A right-angle corner at W-a's far end: the clean-up pulls that end of the band back by
    // half the thickness, so the last piece must stop there and not at the raw endpoint.
    const walls = [wall('a', 200, { x: 4000, y: 0 }), wall('b', 200, { x: 4000, y: 3000 }, { x: 4000, y: 0 })]
    const junction: WallJunction = {
      id: 'j1',
      floorId: 'floor-main',
      ends: [{ wallId: 'a', end: 'end' }, { wallId: 'b', end: 'start' }],
    }
    const [entry] = wallOpenings(walls, [junction], [opening('o1', 'a', 'door', 1500, 1000)])
    expect(entry.pieces[0].from).toBe(0)
    expect(entry.pieces[entry.pieces.length - 1].to).toBeCloseTo(3900, 6)
  })
})

describe('drawWalls — the Wall behind an Opening', () => {
  it('draws one whole band when the Wall has no Openings', () => {
    const walls = [wall('a', 200, { x: 4000, y: 0 })]
    const { band, symbols } = drawn(walls, [])
    expect(itemsOf(band, 'wall')).toHaveLength(1)
    expect(itemsOf(band, 'wall-face')).toHaveLength(2)
    expect(symbols).toHaveLength(0)
  })

  it('draws the band as the pieces the gap leaves, and no face line across the gap', () => {
    const walls = [wall('a', 200, { x: 4000, y: 0 })]
    const { band } = drawn(walls, [opening('o1', 'a', 'door', 1000, 1000)])
    expect(itemsOf(band, 'wall')).toHaveLength(2)
    // Two pieces, two stretches of each face: nothing is drawn between x = 1000 and x = 2000.
    expect(itemsOf(band, 'wall-face')).toHaveLength(4)
    const xs = pointsOf(band).map((point) => point.x)
    expect(xs.filter((x) => x > 1000 && x < 2000)).toEqual([])
  })
})

describe('the door symbol', () => {
  const one = (extra: Partial<Opening> = {}): readonly DisplayItem[] =>
    drawn([wall('a', 200, { x: 4000, y: 0 })], [opening('o1', 'a', 'door', 1000, 1000, extra)]).symbols

  it('stands the leaf on the hinge jamb, square to the Wall, as long as the Opening is wide', () => {
    const leaf = paths(one())[0]
    expect(leaf.role).toBe('opening-leaf')
    expect(leaf.segments.map((command) => command.to)).toEqual([{ x: 1000, y: 0 }, { x: 1000, y: -1000 }])
  })

  it('swings a quarter circle of the same radius from the far jamb to the leaf tip', () => {
    const swing = paths(one())[1]
    expect(swing.role).toBe('opening-swing')
    const [start, arc] = swing.segments
    expect(start.to).toEqual({ x: 2000, y: 0 })
    expect(arc).toMatchObject({ k: 'A', r: 1000, largeArc: false, to: { x: 1000, y: -1000 } })
  })

  it('mirrors the leaf along the Wall when the hinge moves to the other jamb', () => {
    const leaf = paths(one({ hingeSide: 'end' }))[0]
    expect(leaf.segments.map((command) => command.to)).toEqual([{ x: 2000, y: 0 }, { x: 2000, y: -1000 }])
  })

  it('mirrors the leaf across the Wall when the opening side flips', () => {
    const leaf = paths(one({ swing: 'right' }))[0]
    expect(leaf.segments.map((command) => command.to)).toEqual([{ x: 1000, y: 0 }, { x: 1000, y: 1000 }])
    const arc = paths(one({ swing: 'right' }))[1].segments[1]
    expect(arc).toMatchObject({ k: 'A', sweep: true })
  })

  it('draws two overlapping panels and the way they slide', () => {
    const items = paths(one({ swing: 'sliding', hingeSide: undefined }))
    expect(items.map((item) => item.role)).toEqual(['opening-panel', 'opening-panel', 'opening-arrow'])
    // The panels overlap past the middle of the gap, which is what a sliding door looks like.
    const ends = items.slice(0, 2).map((item) => item.segments.map((command) => command.to.x))
    expect(ends[0][1]).toBeGreaterThan(ends[1][0])
  })
})

describe('the footprint an Opening is clicked by', () => {
  it('covers the gap the Opening cut, from face to face, under the marks', () => {
    const items = drawn([wall('a', 200, { x: 4000, y: 0 })], [opening('o1', 'a', 'door', 1000, 900)]).symbols
    const ring = items[0]
    expect(ring.ref).toEqual({ id: 'o1', role: 'opening-hit' })
    expect(ring.kind === 'path' && ring.closed && ring.style === 'opening-hit').toBe(true)
    // One closed ring: the far face from jamb to jamb, then back along the near face. It is the
    // gap itself, so a click anywhere in the space the door took answers, and a click on the Wall
    // beside it still finds the Wall.
    expect(ring.kind === 'path'
      ? ring.segments.map((command) => command.to)
      : []).toEqual([
      { x: 1000, y: 100 }, { x: 1900, y: 100 }, { x: 1900, y: -100 }, { x: 1000, y: -100 },
    ])
  })

  it('is painted with a colour, not with nothing, so the pointer lands on it', () => {
    // Browsers hit-test a shape whose fill is a colour, however see-through, and refuse one whose
    // fill is `none`. `transparent` is the first of those, which is the whole reason this item
    // exists: the marks are hairlines, and Firefox does not carry a click on one to the app.
    expect(STYLES['opening-hit'].fill).toBe('transparent')
    expect(STYLES['opening-hit'].hit).toBeUndefined()
  })

  it('leaves the ghost unclickable, footprint and marks alike', () => {
    // The preview under the pointer has nothing to select, so every style it draws in refuses the
    // pointer, and only a committed Opening gets a footprint at all (#65 §10).
    expect(STYLES['opening:preview'].hit).toBe('none')
    expect(STYLES['opening:preview-blocked'].hit).toBe('none')
    expect(drawn([wall('a', 200, { x: 4000, y: 0 })], []).symbols).toHaveLength(0)
  })
})

describe('the window and the removed section', () => {
  it('draws a window as three lines across the gap, one on the reference line', () => {
    const items = paths(drawn([wall('a', 200, { x: 4000, y: 0 })], [opening('o1', 'a', 'window', 1000, 1200)]).symbols)
    expect(items).toHaveLength(3)
    expect(items.map((item) => item.role)).toEqual(['opening-window', 'opening-window', 'opening-window'])
    expect(items.map((item) => item.style)).toEqual(['opening-window-line', 'opening-window-line', 'opening-window-line'])
    // The three lines are the two faces and the reference line between the jambs.
    expect(items.map((item) => item.segments[0].to.y).sort()).toEqual([-100, 0, 100])
    expect(items.every((item) => item.segments[0].to.x === 1000 && item.segments[1].to.x === 2200)).toBe(true)
  })

  it('draws a removed section as two dashed lines and nothing across the middle', () => {
    const items = paths(drawn([wall('a', 200, { x: 4000, y: 0 })], [opening('o1', 'a', 'removed_section', 1000, 900)]).symbols)
    expect(items.map((item) => item.role)).toEqual(['opening-removed', 'opening-removed'])
    expect(items.map((item) => item.segments[0].to.y).sort()).toEqual([-100, 100])
    expect(items.every((item) => item.segments[0].to.x === 1000)).toBe(true)
  })
})

describe('an Opening on an arc Wall', () => {
  const symbol = (start: number, width: number): OpeningSymbol =>
    wallOpenings([arcWall('a')], [], [opening('o1', 'a', 'door', start, width)])[0].symbols[0]

  it('gives the footprint two curved sides', () => {
    // The ring follows both faces of the arc, so a click anywhere in a curved Wall's gap finds the
    // door in it — a straight quad across an arc would miss the middle of the gap.
    const ring = openingItems(symbol(1000, 1000), 'opening')[0]
    expect(ring.kind === 'path' ? ring.segments.map((command) => command.k) : []).toEqual(['M', 'A', 'L', 'A'])
  })

  it('measures the gap along the arc and draws the leaf on the chord', () => {
    const found = symbol(1000, 1000)
    // The reference arc runs from angle π to 0 about (2000, 0), so arc length `s` sits at
    // π − s/R. Both jambs lie on it, and the straight line between them is the width.
    const on = (at: number): { x: number; y: number } => ({
      x: 2000 + 2000 * Math.cos(Math.PI - at / 2000),
      y: 2000 * Math.sin(Math.PI - at / 2000),
    })
    const near = on(found.start)
    const far = on(found.end)
    expect(Math.hypot(near.x - 2000, near.y)).toBeCloseTo(2000, 6)
    expect(found.end).toBeGreaterThan(found.start)
    expect(Math.hypot(far.x - near.x, far.y - near.y)).toBeCloseTo(1000, 6)
  })

  it('keeps the leaf as long as the Opening is wide, square to the chord', () => {
    const walls = [arcWall('a')]
    const openings = [opening('o1', 'a', 'door', 1000, 1000)]
    const items = paths(drawn(walls, openings).symbols)
    const leaf = items[0]
    const [hinge, tip] = leaf.segments.map((command) => command.to)
    expect(Math.hypot(tip.x - hinge.x, tip.y - hinge.y)).toBeCloseTo(1000, 6)
    const arc = items[1].segments[1]
    expect(arc).toMatchObject({ k: 'A', r: 1000, largeArc: false })
  })
})
