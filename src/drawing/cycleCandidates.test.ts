import { describe, expect, it } from 'vitest'
import { candidatesAtPoint, drawOrderOf } from './cycleCandidates'
import type { DrawnEntities } from './cycleCandidates'
import type { RenovationState } from '../derive'
import type { ClosedPath, Pt } from '../geometry'

/**
 * The candidates a click lands on (#70 §8), and the one widening a Skirting needs (#78 §7): a 15 mm
 * strip is a pixel and a half of ink at the zoom a Flat is read at, so the click is measured against
 * the width the Plan View paints its invisible target at rather than against a hairline.
 */

const rect = (xMin: number, yMin: number, xMax: number, yMax: number): ClosedPath => ({
  start: { x: xMin, y: yMin },
  segments: [
    { kind: 'line', to: { x: xMax, y: yMin } },
    { kind: 'line', to: { x: xMax, y: yMax } },
    { kind: 'line', to: { x: xMin, y: yMax } },
    { kind: 'line', to: { x: xMin, y: yMin } },
  ],
})

const entities = (over: Partial<DrawnEntities>): DrawnEntities => ({
  walls: [],
  placements: [],
  rooms: [],
  beams: [],
  skirtings: [],
  states: new Map<string, RenovationState>(),
  ...over,
})

const strip = { id: 'skirting-1', outline: rect(600, 685, 9600, 700) }
const wall = { id: 'wall-1', outline: rect(600, 500, 9600, 700) }
const states = new Map([['skirting-1', 'existing' as RenovationState], ['wall-1', 'existing' as RenovationState]])

describe('the Skirting in the click’s candidate list (#78 §7)', () => {
  it('answers a click on its own body', () => {
    const at: Pt = { x: 3000, y: 692 }
    expect(candidatesAtPoint(at, entities({ walls: [wall], skirtings: [strip], states }))).toEqual(
      expect.arrayContaining([expect.objectContaining({ entityId: 'skirting-1' })]),
    )
  })

  it('answers a click a few pixels off its centre line, and only because the target is wider than the body', () => {
    // 4 mm below the strip's outer face: inside the 10 device pixel target the Plan View strokes, and
    // outside the strip. Without the reach the strip answers nothing and the cycle can never reach it.
    const at: Pt = { x: 3000, y: 704 }
    const drawn = entities({ walls: [wall], skirtings: [strip], states })
    expect(candidatesAtPoint(at, drawn).map((each) => each.entityId)).not.toContain('skirting-1')
    expect(candidatesAtPoint(at, drawn, 50).map((each) => each.entityId)).toContain('skirting-1')
  })

  it('widens the Skirting alone: a Wall is still answered where it is drawn', () => {
    // 40 mm beyond the Wall's outer face: the reach is offered to the strip, never to the Wall.
    const at: Pt = { x: 3000, y: 740 }
    expect(candidatesAtPoint(at, entities({ walls: [wall], states }), 50)).toEqual([])
    expect(candidatesAtPoint({ x: 3000, y: 692 }, entities({ walls: [wall], states }), 50)).toHaveLength(1)
  })

  it('gives a strip broken by a door two places that answer, and none where the door is', () => {
    const drawn = entities({
      skirtings: [
        { id: 'skirting-1', outline: rect(600, 685, 4000, 700) },
        { id: 'skirting-1', outline: rect(4200, 685, 9600, 700) },
      ],
      states,
    })
    expect(candidatesAtPoint({ x: 1000, y: 690 }, drawn)).toHaveLength(1)
    expect(candidatesAtPoint({ x: 9000, y: 690 }, drawn)).toHaveLength(1)
    expect(candidatesAtPoint({ x: 4100, y: 690 }, drawn)).toHaveLength(0)
  })

  it('puts the strip above the Wall it is skirted to, the way it is painted', () => {
    const found = candidatesAtPoint({ x: 3000, y: 692 }, entities({ walls: [wall], skirtings: [strip], states }))
    const of = (id: string): number => found.find((each) => each.entityId === id)!.drawOrder
    expect(of('skirting-1')).toBeGreaterThan(of('wall-1'))
    // The strip sits in its own layer's band of the paint order, not merely after the Wall.
    expect(of('skirting-1') - drawOrderOf('skirtings', 0)).toBeGreaterThanOrEqual(0)
    expect(of('skirting-1') - drawOrderOf('skirtings', 0)).toBeLessThan(1000)
  })
})
