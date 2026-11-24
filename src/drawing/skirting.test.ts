/**
 * Skirting as it is drawn (#78 §7): the strip on the host face, the holes the derivation cut in it,
 * the name once, and the band it paints in. The coordinates here are the same ones
 * `src/derive/skirting.test.ts` measures the lengths from, so the drawing and `net_length_mm` are
 * pinned to one another.
 */
import { describe, expect, it } from 'vitest'
import { deriveSkirting, deriveWalls, effectiveFloor, type RenovationState } from '../derive'
import { domainFixture } from '../derive/testing'
import type { Opening, Project } from '../domain'
import { drawSkirting } from './skirting'
import { resolveSize, resolveStyle } from './styles'
import { drawFloorView } from './floorView'
import { LAYER_ORDER } from './types'
import type { DisplayItem, DisplayList } from './types'

const sizing = { kind: 'screen', pxPerMm: 1 } as const

const project = domainFixture('v13/skirting.json')
const FLOOR = 'seed-001'

/** A door straight through `W-1` at 4 000 to 4 900, sill on the floor: a hole in the strip. */
const door: Opening = {
  id: 'sk-door',
  floorId: FLOOR,
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
  ...project,
  existingModel: { ...project.existingModel, openings: [...project.existingModel.openings, door] },
}

const itemsOf = (list: DisplayList | null, key: string): DisplayItem[] =>
  list === null ? [] : list.layers.find((layer) => layer.key === key)?.items ?? []

/** A drawn path, which is the only kind of item this file reads. */
type Drawn = Extract<DisplayItem, { kind: 'path' }>

/** The corners of every drawn body, as the plan put them. */
function cornersOf(item: Drawn): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = []
  for (const command of item.segments) out.push(command.to)
  return out
}

const bodies = (list: DisplayList | null): Drawn[] =>
  itemsOf(list, 'skirtings').filter((item): item is Drawn => item.kind === 'path' && item.style === 'skirting')

describe('drawSkirting (#78 §7)', () => {
  it('paints the strip between the host face and the exposed face', () => {
    const list = drawSkirting(deriveSkirting(project, FLOOR), { sizing })
    // `W-1` runs (600, 600) → (9600, 600), 200 thick and centred, so its left face is y = 500; the
    // 15 mm body stands off that face and its exposed face is y = 485.
    expect(cornersOf(bodies(list)[0]!)).toEqual([
      { x: 600, y: 500 },
      { x: 9600, y: 500 },
      { x: 9600, y: 485 },
      { x: 600, y: 485 },
      { x: 600, y: 500 },
    ])
  })

  it('gives each run a body and an invisible target of its own', () => {
    const list = drawSkirting(deriveSkirting(withDoor, FLOOR), { sizing })
    const shapes = itemsOf(list, 'skirtings').filter((item): item is Drawn => item.kind === 'path')
    // The door cuts the strip in two, so there are two bodies and two targets — and the targets are
    // the same two paths, because a 15 mm hairline is a hard thing for a pointer to find (#65 §11).
    expect(shapes).toHaveLength(4)
    expect(shapes.map((item) => item.style)).toEqual(['skirting', 'skirting-hit', 'skirting', 'skirting-hit'])
    expect(shapes.every((item) => item.ref?.id === 'skirting-1')).toBe(true)
    const spans = bodies(list).map((item) => {
      const xs = cornersOf(item).map((at) => at.x)
      return [Math.min(...xs), Math.max(...xs)]
    })
    expect(spans).toEqual([
      [600, 4600],
      [5500, 9600],
    ])
  })

  it('names a Skirting once, upright, at the middle of its longest run', () => {
    const list = drawSkirting(deriveSkirting(withDoor, FLOOR), { sizing })
    const labels = itemsOf(list, 'skirting-labels').filter((item): item is Extract<DisplayItem, { kind: 'text' }> => item.kind === 'text')
    expect(labels).toHaveLength(1)
    const label = labels[0]!
    expect(label.text).toBe('Skirting SK-1')
    expect(label.rotationDeg).toBe(0)
    expect(label.style).toBe('skirting-label')
    // The longer run is 5 500 → 9 600 — the door leaves more Wall standing on the far side — whose
    // middle is x 7 550; the strip's own middle is y 492.5.
    expect(label.at).toEqual({ x: 7550, y: 492.5 })
  })

  it('draws the selected Skirting in the accent', () => {
    const list = drawSkirting(deriveSkirting(project, FLOOR), { sizing, selectedSkirtingId: 'skirting-1' })
    expect(bodies(list).every((item) => item.style === 'skirting:selected')).toBe(true)
  })

  it('paints nothing for a Floor with no Skirting', () => {
    const bare: Project = { ...project, existingModel: { ...project.existingModel, skirting: [] } }
    expect(drawSkirting(deriveSkirting(bare, FLOOR), { sizing })).toBeNull()
  })
})

describe('the Skirting band of a Floor View (#78 §7)', () => {
  const view = (renovation: { states: ReadonlyMap<string, RenovationState> } | null = null) =>
    drawFloorView(
      {
        floor: effectiveFloor(project, 0, FLOOR, null),
        walls: deriveWalls(project, FLOOR),
        rooms: null,
        openings: [],
        skirting: deriveSkirting(project, FLOOR),
      },
      { sizing, showPlanImage: false, renovation },
    )

  it('lays the strip over the Wall band and under the footprints', () => {
    const keys = view().list.layers.map((layer) => layer.key)
    expect(keys).toContain('skirtings')
    expect(keys.indexOf('skirtings')).toBeGreaterThan(keys.indexOf('walls'))
    expect(keys.indexOf('skirtings')).toBeLessThan(keys.indexOf('placed-items'))
    expect(keys.indexOf('skirting-labels')).toBeGreaterThan(keys.indexOf('skirtings'))
    // The bands follow the single z-order source, whatever mix of them this Floor emits (#60 §3).
    expect(keys).toEqual([...keys].sort((a, b) => LAYER_ORDER.indexOf(a) - LAYER_ORDER.indexOf(b)))
  })

  it('leaves out a Skirting the Renovation Display does not draw', () => {
    // The Display's own subset: an entity absent from the State map is neither painted nor picked
    // (#70 §F), and the pick list says the same thing the pixels do.
    const drawn = view({ states: new Map() })
    expect(drawn.skirting?.skirting).toEqual([])
    expect(drawn.list.layers.some((layer) => layer.key === 'skirtings')).toBe(false)
  })
})

describe('the width a Skirting can be clicked at (#78 §7)', () => {
  it('strokes its invisible target at the aimable size, not at the body’s hairline', () => {
    // The pick in the Plan View widens its test by half this role's width, so the target the pointer
    // lands on and the target the click is measured against are the same number by construction.
    expect(resolveStyle('skirting-hit').strokeWidth).toBe('hit-target')
    expect(resolveStyle('skirting-hit').stroke).toBe('transparent')
    expect(resolveSize('hit-target', { kind: 'screen', pxPerMm: 0.1 }).px).toBeGreaterThanOrEqual(10)
    expect(resolveSize('hit-target', { kind: 'paper', scale: 1 / 100 }).mm).toBeGreaterThanOrEqual(2)
  })
})
