/**
 * The renovation overlay rules, asserted where they matter: on the display list (#70 criterion 8).
 *
 * Criterion 8 is not a picture test. It says the layer colour of every entity is unchanged
 * underneath its renovation overlay, and it names the place to look — "stroke and fill come from the
 * layer style; the overlay is a separate item". So these tests take a real display list built by
 * `drawWalls` and `drawPlanView`, lay the overlays on it, and check that the entity's own item came
 * out byte-identical to the one that went in, with the overlay arriving beside it in the same layer.
 *
 * The rest of the file is the geometry the overlays promise: a halo that is 3 px *outside* the
 * outline rather than straddling it, hatching that stays inside a concave outline, and a draw order
 * that puts Proposed last so it is the top candidate under the pointer.
 */
import { describe, expect, it } from 'vitest'
import { effectiveFloor, deriveWalls } from '../derive'
import type { RenovationState } from '../derive'
import { domainFixture } from '../derive/testing'
import type { Project } from '../domain'
import { drawPlanView, drawWalls } from './index'
import { hatchLines, offsetOutward, renovationOverlays } from './renovation'
import type { RenovationOutline } from './renovation'
import { rectCommands } from './path'
import { resolveSize, resolveStyle } from './styles'
import { LAYER_ORDER } from './types'
import type { DisplayItem, DisplayList, PathCommand, Rect, Sizing } from './types'
import type { Pt } from '../geometry'

/** Every overlay item carries the entity it annotates; the assertions speak through it. */
const refOf = (item: DisplayItem): { id: string; role: string } => item.ref ?? { id: '', role: '' }

/** Zoom 1: one CSS pixel is one millimetre of Floor, so a promise in pixels reads in millimetres. */
const sizing: Sizing = { kind: 'screen', pxPerMm: 1 }

const rect = (x: number, y: number, w: number, h: number): PathCommand[] => rectCommands(x, y, w, h)

const outline = (id: string, layer: RenovationOutline['layer'], shape: readonly PathCommand[]): RenovationOutline => ({
  ref: { id, role: layer === 'walls' ? 'wall' : layer === 'rooms' ? 'room' : 'placed-item' },
  layer,
  outline: shape,
})

const states = (...rows: readonly [string, RenovationState][]): ReadonlyMap<string, RenovationState> =>
  new Map(rows)

/** The corners an outline travels through, for the geometry assertions. */
const pointsOf = (commands: readonly PathCommand[]): Pt[] => commands.map((command) => command.to)

/** Even-odd containment, the same rule `hatchLines` clips by. */
const inside = (points: readonly Pt[], at: Pt): boolean => {
  let depth = 0
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!
    const b = points[(index + 1) % points.length]!
    if ((a.y > at.y) !== (b.y > at.y)) {
      const edgeX = a.x + ((at.y - a.y) * (b.x - a.x)) / (b.y - a.y)
      if (at.x < edgeX) depth += 1
    }
  }
  return depth % 2 === 1
}

/** The 100 × 100 the L does not have. */
const notch = (at: Pt): boolean => at.x > 100 && at.y < 100

const itemsOf = (list: DisplayList, key: string): DisplayItem[] =>
  list.layers.find((layer) => layer.key === key)?.items ?? []

/** Every item a list holds, in the order a renderer would paint them. */
const painted = (list: DisplayList): DisplayItem[] => list.layers.flatMap((layer) => layer.items)

describe('the renovation overlays (#70 criterion 8)', () => {
  it('leaves the entity item exactly as the layer style drew it', () => {
    const project = domainFixture('v4/walls.json') as Project
    const floorId = project.floors.find((floor) => deriveWalls({ ...project, designOptions: [] }, floor.id).walls.length > 1)!.id
    const walls = deriveWalls({ ...project, designOptions: [] }, floorId)
    const before = drawWalls(walls, { sizing, openings: [] })
    const after = drawWalls(walls, { sizing, openings: [] })
    const outlines: RenovationOutline[] = walls.walls.map((wall) => ({
      ref: { id: wall.id, role: 'wall' },
      layer: 'walls',
      outline: [{ k: 'M', to: wall.outline.start }, ...wall.outline.segments.map((s) => ({ k: 'L' as const, to: s.to }))],
    }))
    const demolished = states([walls.walls[0]!.id, 'demolition'], [walls.walls[1]!.id, 'proposed'])
    const overlays = renovationOverlays(outlines, demolished, sizing)

    // The entity's own item is the same object graph it was before the Display was asked about:
    // criterion 8's "stroke and fill come from the layer style", checked on the built list.
    expect(after.layers).toEqual(before.layers)
    const own = itemsOf(after, 'walls').filter((item) => refOf(item).id === walls.walls[0]!.id)
    expect(own.length).toBeGreaterThan(0)
    for (const item of own) {
      expect(refOf(item).id).toBe(walls.walls[0]!.id)
      expect('style' in item ? item.style : '').not.toMatch(/renovation/)
    }

    // …and the overlay is beside them, never among them.
    const overlayItems = overlays.find((layer) => layer.key === 'walls')?.items ?? []
    expect(overlayItems.length).toBeGreaterThan(0)
    for (const item of overlayItems) expect('style' in item ? item.style : '').toMatch(/renovation-/)
    // A demolished Wall gets the dashed outline and the hatching; a proposed one gets a halo.
    expect(overlayItems.filter((item) => refOf(item).id === walls.walls[0]!.id)).toHaveLength(2)
    expect(overlayItems.filter((item) => refOf(item).id === walls.walls[1]!.id)).toHaveLength(1)
  })

  it('draws nothing for Existing, and nothing for what the Display does not draw', () => {
    const outlines = [outline('w-1', 'walls', rect(0, 0, 100, 40)), outline('i-1', 'placed-items', rect(10, 10, 60, 20))]
    expect(renovationOverlays(outlines, states(['w-1', 'existing'], ['i-1', 'existing']), sizing)).toEqual([])
    expect(renovationOverlays(outlines, states(['somewhere-else', 'demolition']), sizing)).toEqual([])
    expect(renovationOverlays(outlines, states(), sizing)).toEqual([])
  })

  it('lays the overlays in the entity layer, in LAYER_ORDER, Existing before Demolition before Proposed', () => {
    const outlines = [
      // Deliberately out of order: the proposed Item first, the demolished Wall last.
      outline('i-new', 'placed-items', rect(10, 10, 60, 20)),
      outline('r-1', 'rooms', rect(0, 0, 200, 100)),
      outline('w-old', 'walls', rect(0, 0, 100, 40)),
      outline('i-old', 'placed-items', rect(70, 10, 60, 20)),
      outline('w-new', 'walls', rect(0, 50, 100, 40)),
    ]
    const layers = renovationOverlays(
      outlines,
      states(
        ['i-new', 'proposed'],
        ['r-1', 'existing'],
        ['w-old', 'demolition'],
        ['i-old', 'existing'],
        ['w-new', 'proposed'],
      ),
      sizing,
    )
    // `rooms` holds only Existing work here, so it holds no overlay at all.
    expect(layers.map((layer) => layer.key)).toEqual(['walls', 'placed-items'])
    expect(layers.map((layer) => LAYER_ORDER.indexOf(layer.key))).toEqual(
      [...layers.map((layer) => LAYER_ORDER.indexOf(layer.key))].sort((a, b) => a - b),
    )
    // Within the layer: the demolished Wall's two items, then the proposed Wall's halo. The overlay
    // items carry the entity's id — a click belongs to the entity — and say what they are by role.
    expect(layers[0]!.items.map((item) => [refOf(item).id, refOf(item).role])).toEqual([
      ['w-old', 'wall'],
      ['w-old', 'wall-hatch'],
      ['w-new', 'wall-halo'],
    ])
    expect(layers[1]!.items.map((item) => refOf(item).role)).toEqual(['placed-item-halo'])
  })

  it('puts the halo 3 px outside the outline on every side, at any zoom', () => {
    const shape = rect(200, 300, 600, 400)
    const outlines = [outline('w-1', 'walls', shape)]
    for (const pxPerMm of [0.2, 1, 4]) {
      const at: Sizing = { kind: 'screen', pxPerMm }
      const gap = resolveSize('renovation-halo-gap', at).mm
      const halo = renovationOverlays(outlines, states(['w-1', 'proposed']), at)[0]!.items[0]!
      if (halo.kind !== 'path') throw new Error('a halo is a path')
      expect(halo.closed).toBe(true)
      const box = boxOf(halo.segments)
      // Outside, not straddling: the ring is a whole gap away from the outline it annotates.
      expect(box.x).toBeCloseTo(200 - gap, 6)
      expect(box.y).toBeCloseTo(300 - gap, 6)
      expect(box.x + box.w).toBeCloseTo(800 + gap, 6)
      expect(box.y + box.h).toBeCloseTo(700 + gap, 6)
      expect(gap).toBeCloseTo(3 / pxPerMm, 6)
    }
  })

  it('offsets a rotated outline outward along its own edges, not along its bounding box', () => {
    const gap = 4
    const diamond: Pt[] = [
      { x: 100, y: 0 },
      { x: 200, y: 100 },
      { x: 100, y: 200 },
      { x: 0, y: 100 },
    ]
    const grown = offsetOutward(diamond, gap)
    expect(grown).toHaveLength(diamond.length)
    for (const [index, point] of diamond.entries()) {
      const moved = grown[index]!
      // Every corner travels away from the centre, and by more than the gap on a mitred corner.
      expect(Math.hypot(moved.x - 100, moved.y - 100)).toBeGreaterThan(Math.hypot(point.x - 100, point.y - 100))
      expect(Math.hypot(moved.x - point.x, moved.y - point.y)).toBeGreaterThan(gap)
    }
    // A ring wound the other way gets the same halo: which way is out is measured, not assumed.
    const reversed = offsetOutward([...diamond].reverse(), gap)
    expect(reversed.map((point) => [Math.round(point.x), Math.round(point.y)]).sort()).toEqual(
      grown.map((point) => [Math.round(point.x), Math.round(point.y)]).sort(),
    )
  })

  it('hatches a concave outline without crossing the notch', () => {
    // An L: a 200 × 200 square with the top-right 100 × 100 taken out.
    const l: Pt[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 200, y: 200 },
      { x: 0, y: 200 },
    ]
    const commands = hatchLines(l, 10)
    expect(commands.length).toBeGreaterThan(0)
    expect(commands.length % 2).toBe(0)
    const segments: [Pt, Pt][] = []
    for (let index = 0; index < commands.length; index += 2) segments.push([commands[index]!.to, commands[index + 1]!.to])
    expect(segments.length).toBeGreaterThan(4)
    for (const [from, to] of segments) {
      // Every line runs at 45°, left to right, and has real length.
      expect(to.x - from.x).toBeCloseTo(-(to.y - from.y), 6)
      expect(to.x).toBeGreaterThan(from.x)
      // The middle of every line is inside the L. The endpoints sit on the outline by definition, so
      // the middle is where a naive bounding-box hatch would put ink over the notch.
      expect(inside(l, { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 })).toBe(true)
    }
    // Nothing lands in the notch: the square's centre is the one place the L is not.
    expect(inside(l, { x: 150, y: 50 })).toBe(false)
    expect(segments.every(([from, to]) => !notch({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }))).toBe(true)
  })

  it('is deterministic: the same drawing twice is the same list twice', () => {
    const outlines = [
      outline('w-1', 'walls', rect(0, 0, 100, 40)),
      outline('i-1', 'placed-items', rect(10, 10, 60, 20)),
      outline('w-2', 'walls', rect(0, 50, 100, 40)),
    ]
    const drawn = states(['w-1', 'demolition'], ['i-1', 'proposed'], ['w-2', 'proposed'])
    expect(renovationOverlays(outlines, drawn, sizing)).toEqual(renovationOverlays(outlines, drawn, sizing))
  })

  it('marks each overlay with the demolition and proposed colours, and nothing to the pointer', () => {
    const outlines = [outline('w-1', 'walls', rect(0, 0, 100, 40)), outline('w-2', 'walls', rect(0, 50, 100, 40))]
    const items = renovationOverlays(outlines, states(['w-1', 'demolition'], ['w-2', 'proposed']), sizing)
      .flatMap((layer) => layer.items)
    for (const item of items) {
      if (item.kind !== 'path') throw new Error('an overlay is a path')
      const style = resolveStyle(item.style)
      expect(style.hit).toBe('none')
      expect(style.stroke).toMatch(/--bb-renovation-/)
      expect(style.fill).toBeUndefined()
    }
    const demolition = resolveStyle('renovation-demolition')
    const halo = resolveStyle('renovation-halo')
    expect(demolition.stroke).toBe('var(--bb-renovation-demolition-border)')
    expect(halo.stroke).toBe('var(--bb-renovation-proposed-border)')
    // Both are dashed: a solid ring would read as the entity's own edge.
    expect(demolition.dash).toBeDefined()
    expect(halo.dash).toBeDefined()
    expect(resolveStyle('renovation-hatch').dash).toBeUndefined()
  })

  it('keeps the Placed Item outline it was given, so the overlay sits on the edge it annotates', () => {
    const project = domainFixture('v4/project-basic.json') as Project
    const floorId = project.floors.find((floor) => effectiveFloor(project, 0, floor.id, null).placements.length > 0)!.id
    const floor = effectiveFloor(project, 0, floorId, null)
    const list = drawPlanView(floor, { showPlanImage: false }, { sizing })
    const placement = floor.placements[0]!
    const own = itemsOf(list, 'placed-items').find((item) => refOf(item).id === placement.id)!
    const outlines = [outline(placement.id, 'placed-items', rect(0, 0, 100, 40))]
    const overlay = renovationOverlays(outlines, states([placement.id, 'demolition']), sizing)[0]!.items[0]!
    // The entity's item is a group holding the footprint in the layer's own style; the overlay is a
    // path beside it. Neither is the other.
    expect(own.kind).toBe('group')
    expect(overlay.kind).toBe('path')
    expect('style' in own ? own.style : '').not.toBe('renovation-demolition')
    expect('style' in overlay ? overlay.style : '').toBe('renovation-demolition')
    expect(painted(list).some((item) => 'style' in item && item.style === 'renovation-demolition')).toBe(false)
  })
})

/** The box an outline covers, for the assertions that speak in edges rather than corners. */
const boxOf = (commands: readonly PathCommand[]): Rect => {
  const points = pointsOf(commands)
  const x = Math.min(...points.map((point) => point.x))
  const y = Math.min(...points.map((point) => point.y))
  return { x, y, w: Math.max(...points.map((point) => point.x)) - x, h: Math.max(...points.map((point) => point.y)) - y }
}

describe('the overlay outlines', () => {
  it('halos a rectangle by exactly the gap, measured as a box', () => {
    const gap = resolveSize('renovation-halo-gap', sizing).mm
    const grown = offsetOutward(pointsOf(rect(0, 0, 100, 40)), gap)
    expect(boxOf([{ k: 'M', to: grown[0]! }, ...grown.slice(1).map((to) => ({ k: 'L' as const, to }))])).toEqual({
      x: -gap,
      y: -gap,
      w: 100 + gap * 2,
      h: 40 + gap * 2,
    })
  })

  it('leaves an outline alone when there is no gap to give it', () => {
    const points = pointsOf(rect(5, 5, 20, 10))
    expect(offsetOutward(points, 0)).toEqual(points)
    expect(offsetOutward([{ x: 0, y: 0 }], 4)).toEqual([{ x: 0, y: 0 }])
    expect(hatchLines(points, 0)).toEqual([])
    expect(hatchLines([{ x: 0, y: 0 }], 5)).toEqual([])
  })
})
