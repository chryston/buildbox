/**
 * The Elevation View's display list (#75 §4, criteria 12–15).
 *
 * The projection is tested where it happens (`derive/elevation.test.ts`); what is tested here is the
 * picture: which way round it faces, what paints over what, what a hidden layer removes, what the
 * heights are called, and where the ruler stands. The goldens next door pin the bytes; these pin the
 * reasons, so a golden that moves says which decision moved with it.
 */
import { describe, expect, it } from 'vitest'
import { elevationScene } from '../derive'
import type { ElevationRow } from '../derive'
import { elevationScene as fixture } from '../derive/testing'
import type { Project } from '../domain'
import { measureRect } from './font/layoutText'
import { drawElevationView } from './elevationView'
import type { LayerGates } from './floorView'
import { resolveStyle } from './styles'
import type { DisplayItem, DisplayList, Rect, Sizing } from './types'

const SCREEN: Sizing = { kind: 'screen', pxPerMm: 0.2 }

const PROJECT = fixture()
const view = (project: Project, id: string) => (project.elevationViews ?? []).find((each) => each.id === id)!
const KITCHEN = elevationScene(PROJECT, view(PROJECT, 'el-004'))
const ANGLED = elevationScene(PROJECT, view(PROJECT, 'el-005'))

/** The gates of a view that hides the given entities and recolours nothing. */
const gatesHiding = (hidden: readonly string[], order = 0): LayerGates => ({
  drawn: (id) => !hidden.includes(id),
  pickable: (id) => !hidden.includes(id),
  modifiable: (id) => !hidden.includes(id),
  colorOf: () => null,
  orderOf: (id) => (id === 'pr-021' ? order : order + 1),
  readOnlyLayerOf: () => null,
})

/** The gates of a view that paints everything in one colour, which is what a layer focus does. */
const gatesTinting = (colour: string): LayerGates => ({
  drawn: () => true,
  pickable: () => true,
  modifiable: () => true,
  colorOf: () => colour,
  orderOf: () => 0,
  readOnlyLayerOf: () => null,
})

const items = (list: DisplayList): DisplayItem[] => list.layers.flatMap((layer) => layer.items)
const band = (list: DisplayList, key: string): DisplayItem[] =>
  list.layers.find((layer) => layer.key === key)?.items ?? []
const texts = (list: DisplayList): string[] =>
  items(list).flatMap((item) => (item.kind === 'text' ? [item.text] : []))
const paths = (list: DisplayList, style: string): DisplayItem[] =>
  items(list).filter((item) => item.kind === 'path' && item.style === style)

/** The box one item covers, in the drawing's millimetres. */
function boxOf(item: DisplayItem): Rect {
  if (item.kind === 'text') return measureRect(item.layout, item.at, item.anchor)
  if (item.kind !== 'path') throw new Error(`unexpected ${item.kind}`)
  const xs = item.segments.map((command) => command.to.x)
  const ys = item.segments.map((command) => command.to.y)
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
}

const encloses = (outer: Rect, inner: Rect): boolean =>
  outer.x <= inner.x && outer.y <= inner.y && outer.x + outer.w >= inner.x + inner.w && outer.y + outer.h >= inner.y + inner.h

const rowOf = (rows: readonly ElevationRow[], id: string): ElevationRow => rows.find((row) => row.id === id)!

describe('drawElevationView: the painter (#75 criteria 12, 13, 14)', () => {
  it('paints farthest first, so nearer content lies over what it hides', () => {
    const { rows } = drawElevationView(KITCHEN, { sizing: SCREEN })
    expect(rows.length).toBeGreaterThan(1)
    for (const [index, row] of rows.entries()) {
      if (index === 0) continue
      expect(rows[index - 1]!.distance, `${row.id} painted after a nearer row`).toBeGreaterThanOrEqual(row.distance)
    }
  })

  it('paints an Opening after the Wall it is cut in, at the same distance', () => {
    const { rows } = drawElevationView(KITCHEN, { sizing: SCREEN })
    const wall = rowOf(rows, 'pr-017')
    const opening = rowOf(rows, 'pr-021')
    expect(opening.distance).toBe(wall.distance)
    expect(rows.indexOf(opening)).toBeGreaterThan(rows.indexOf(wall))
    expect(opening.hostWallId).toBe('pr-017')
  })

  it('reversed, the painter’s order is the nearest-first order click-to-cycle is fed', () => {
    const { rows } = drawElevationView(KITCHEN, { sizing: SCREEN })
    const nearest = [...rows].reverse()
    for (const [index, row] of nearest.entries()) {
      if (index === 0) continue
      expect(nearest[index - 1]!.distance, `${row.id} cycled after a farther row`).toBeLessThanOrEqual(row.distance)
    }
    // The Kitchen elevation is 1300 mm deep at the back Wall and 0 at the front one, so the cycle
    // starts at the Wall the viewer is standing against.
    expect(nearest[0]!.distance).toBe(0)
  })

  it('draws content the view line runs through with the heavier outline token', () => {
    const plain = drawElevationView(KITCHEN, { sizing: SCREEN })
    const crossed = paths(plain.list, 'elevation-crossing')
    expect(crossed).toHaveLength(2)
    expect(crossed.map((item) => (item.kind === 'path' ? item.ref?.id : ''))).toEqual(['pr-018', 'pr-020'])
    // The token is laid over the body, not instead of it: the same box is drawn twice, once in the
    // entity's own style and once heavier.
    const box = boxOf(crossed[0]!)
    expect(plain.list.layers
      .flatMap((layer) => layer.items)
      .filter((item) => item.kind === 'path' && item.ref?.id === 'pr-018')
      .map(boxOf)).toEqual([box, box])
  })

  it('drops content a Drawing Layer hides, from the paint and from the pick list alike', () => {
    const hidden = ['pr-005', 'pr-011', 'pr-014', 'pr-016']
    const all = drawElevationView(KITCHEN, { sizing: SCREEN })
    const focused = drawElevationView(KITCHEN, { sizing: SCREEN, layers: gatesHiding(hidden) })
    expect(all.rows).toHaveLength(8)
    expect(focused.rows.map((row) => row.id)).not.toContain('pr-005')
    expect(focused.rows).toHaveLength(4)
    const refs = new Set(items(focused.list).flatMap((item) => (item.kind === 'path' && item.ref !== undefined ? [item.ref.id] : [])))
    for (const id of hidden) expect(refs, id).not.toContain(id)
  })

  it('paints a layer’s colour over the entity’s own, and the entity’s own otherwise', () => {
    const own = drawElevationView(KITCHEN, { sizing: SCREEN })
    const item = items(own.list).find((each) => each.kind === 'path' && each.ref?.id === 'pr-005')!
    expect(item.kind === 'path' ? item.color : null).toBe(rowOf(own.rows, 'pr-005').color)
    expect(rowOf(own.rows, 'pr-017').color).toBeNull()

    const tinted = drawElevationView(KITCHEN, { sizing: SCREEN, layers: gatesTinting('#ff0000') })
    const tintedItem = items(tinted.list).find((each) => each.kind === 'path' && each.ref?.id === 'pr-005')!
    expect(tintedItem.kind === 'path' ? tintedItem.color : null).toBe('#ff0000')
  })

  it('gives the selected entity the selected weight', () => {
    const drawn = drawElevationView(KITCHEN, { sizing: SCREEN, selectedId: 'pr-005' })
    const selected = items(drawn.list).find((each) => each.kind === 'path' && each.ref?.id === 'pr-005')!
    expect(selected.kind === 'path' ? selected.style : '').toBe('plan-item:selected')
  })
})

describe('drawElevationView: which way round (#75 criteria 6, 7, 8)', () => {
  it('mirrors the horizontal axis for a view looking to its left', () => {
    const drawn = drawElevationView(KITCHEN, { sizing: SCREEN })
    const wall = rowOf(drawn.rows, 'pr-017')
    // The view line runs (0,1400) → (4000,1400) and looks to its left, so its start is on the
    // viewer's right: the whole 4000 mm of W-1 is drawn, and the Window that starts at s = 1500
    // lands at x = 2500, not 1500.
    expect(wall.sMin).toBe(0)
    const window = rowOf(drawn.rows, 'pr-021')
    const boxes = items(drawn.list).filter((item) => item.kind === 'path' && item.ref?.id === 'pr-021').map(boxOf)
    expect(boxes[0]!.x).toBe(4000 - window.sMax)
    expect(boxes[0]!.x + boxes[0]!.w).toBe(4000 - window.sMin)
    expect(window.sMin).toBe(1500)
  })

  it('leaves the axis unmirrored for a view looking to its right', () => {
    const drawn = drawElevationView(ANGLED, { sizing: SCREEN })
    const wall = rowOf(drawn.rows, 'pr-019')
    const box = boxOf(items(drawn.list).find((item) => item.kind === 'path' && item.ref?.id === 'pr-019')!)
    expect(box.x).toBeCloseTo(wall.sMin, 6)
    expect(box.x + box.w).toBeCloseTo(wall.sMax, 6)
  })

  it('draws an Opening as an outline inside its host, never as a solid void', () => {
    const drawn = drawElevationView(KITCHEN, { sizing: SCREEN })
    const opening = items(drawn.list).find((item) => item.kind === 'path' && item.ref?.id === 'pr-021')!
    expect(opening.kind === 'path' ? opening.closed : false).toBe(true)
    expect(opening.kind === 'path' ? opening.style : '').toBe('opening')
    // The `opening` style carries no fill: a hole in a Wall is that Wall's own body with a line
    // through it, never a black rectangle.
    expect(resolveStyle('opening').fill ?? null).toBeNull()
  })

  it('draws no Rooms and no Plan Image, in either band', () => {
    const drawn = drawElevationView(KITCHEN, { sizing: SCREEN })
    expect(drawn.list.layers.map((layer) => layer.key)).toEqual(['elevation-content', 'elevation-datum', 'elevation-ruler'])
    expect(texts(drawn.list)).not.toContain('Kitchen')
  })
})

describe('drawElevationView: heights and the ruler (#75 criterion 14)', () => {
  it('names the Floor Datum and the Floor’s own limits, and no limit it has not got', () => {
    const drawn = drawElevationView(KITCHEN, { sizing: SCREEN })
    const words = texts(drawn.list)
    expect(words).toContain('Floor Datum 0')
    expect(words).toContain('Upper limit 2600')
    expect(words.filter((word) => word.startsWith('Lower limit'))).toEqual([])
    expect(paths(drawn.list, 'elevation-datum')).toHaveLength(1)
    expect(paths(drawn.list, 'elevation-limit')).toHaveLength(1)
  })

  it('names a lower limit when the Floor has one', () => {
    const withLower: Project = {
      ...PROJECT,
      floors: PROJECT.floors.map((floor) => (floor.id === 'pr-002' ? { ...floor, limits: { lowerMm: -200, upperMm: 2600 } } : floor)),
    }
    const drawn = drawElevationView(elevationScene(withLower, view(withLower, 'el-004')), { sizing: SCREEN })
    expect(texts(drawn.list)).toContain('Lower limit -200')
    expect(paths(drawn.list, 'elevation-limit')).toHaveLength(2)
    // The pit the Sump box stands in is inside the drawing, so the picture reaches below the Datum:
    // it is taller than the height its top stands at.
    expect(drawn.area.y + drawn.area.h).toBeGreaterThan(drawn.topMm)
  })

  it('stands the whole ruler outside the drawing area, on the left', () => {
    const drawn = drawElevationView(KITCHEN, { sizing: SCREEN })
    const ruler = band(drawn.list, 'elevation-ruler')
    expect(ruler.length).toBeGreaterThan(0)
    for (const item of ruler) {
      const box = boxOf(item)
      expect(box.x + box.w, item.kind === 'text' ? item.text : 'tick').toBeLessThanOrEqual(drawn.area.x)
    }
    // Every 500 mm from the Datum to the top of the drawing, and the Datum itself among them.
    const labels = ruler.flatMap((item) => (item.kind === 'text' ? [item.text] : []))
    expect(labels).toEqual(['0', '500', '1000', '1500', '2000', '2500'])
  })

  it('reaches the ruler down to a pit without moving the drawing', () => {
    const drawn = drawElevationView(KITCHEN, { sizing: SCREEN })
    expect(drawn.area.x).toBe(0)
    expect(drawn.area.w).toBe(4000)
    // The picture stands on nothing: its y = 0 is its highest height, the Upper limit at 2 600, and it
    // reaches down past the Datum to the pit's floor at −150.
    expect(drawn.topMm).toBe(2600)
    expect(drawn.area.y).toBe(0)
    expect(drawn.area.y + drawn.area.h).toBe(2750)
  })

  it('keeps every item inside the list’s own bounds', () => {
    for (const scene of [KITCHEN, ANGLED]) {
      const drawn = drawElevationView(scene, { sizing: SCREEN })
      for (const item of items(drawn.list)) {
        expect(encloses(drawn.list.bounds, boxOf(item)), `${item.kind} outside`).toBe(true)
      }
    }
  })

  it('draws the same picture at paper scale, only sized differently', () => {
    const screen = drawElevationView(KITCHEN, { sizing: SCREEN })
    const paper = drawElevationView(KITCHEN, { sizing: { kind: 'paper', scale: 50 } })
    expect(paper.rows).toEqual(screen.rows)
    expect(paper.area).toEqual(screen.area)
    expect(paper.list.bounds.x).not.toBe(screen.list.bounds.x)
  })
})
