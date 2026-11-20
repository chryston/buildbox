/**
 * Walls as they are drawn (#64 §15): the tidied band and its faces, the `W-n` reference inside
 * the band when the band can hold it, and end handles on the tidied caps. The reference line is
 * the one thing that must never reach the paper.
 */
import { describe, expect, it } from 'vitest'
import { deriveWalls } from '../derive'
import { domainFixture } from '../derive/testing'
import type { Project, Wall, WallJunction } from '../domain'
import { drawWalls } from './walls'
import type { DisplayItem } from './types'

const sizing = { kind: 'screen', pxPerMm: 1 } as const

const projectWith = (walls: readonly Wall[], junctions: readonly WallJunction[] = []): Project => {
  const base = domainFixture('v4/project-basic.json')
  return { ...base, existingModel: { ...base.existingModel, walls: [...walls], wallJunctions: [...junctions] } }
}

const wall = (id: string, ref: string, thickness: number, end: { x: number; y: number }): Wall => ({
  id,
  ref,
  floorId: 'floor-main',
  line: { kind: 'line', start: { x: 0, y: 0 }, end },
  thickness,
  justification: 'centre',
  baseElevation: 0,
  height: 2600,
})

const itemsOf = (items: readonly DisplayItem[], role: string): readonly DisplayItem[] =>
  items.filter((item) => item.ref?.role === role)

const texts = (items: readonly DisplayItem[]): readonly { text: string; at: { x: number; y: number } }[] =>
  items.flatMap((item) => item.kind === 'text' ? [{ text: item.text, at: item.at }] : [])

describe('drawWalls', () => {
  it('draws the tidied band and its two faces, and never the reference line', () => {
    const derived = deriveWalls(projectWith([wall('w1', 'W-1', 200, { x: 4000, y: 0 })]), 'floor-main')
    const list = drawWalls(derived, { sizing })
    const band = list.layers.find((layer) => layer.key === 'walls')
    expect(band).toBeDefined()
    expect(itemsOf(band!.items, 'wall')).toHaveLength(1)
    expect(itemsOf(band!.items, 'wall-face')).toHaveLength(2)
    // Centre-justified over (0,0)→(4000,0): the band's own corners are 100 mm off that line, so
    // the reference line's endpoints appear nowhere in what is drawn.
    const drawn = band!.items.flatMap((item) => item.kind === 'path' ? item.segments : [])
    expect(drawn.some((command) => command.to.x === 0 && command.to.y === 0)).toBe(false)
    expect(drawn.some((command) => command.to.x === 4000 && command.to.y === 0)).toBe(false)
  })

  it('puts the reference inside a band thick enough to hold it', () => {
    const derived = deriveWalls(projectWith([wall('w1', 'W-1', 600, { x: 4000, y: 0 })]), 'floor-main')
    const list = drawWalls(derived, { sizing })
    const labels = list.layers.find((layer) => layer.key === 'wall-labels')
    expect(labels).toBeDefined()
    expect(texts(labels!.items)).toEqual([{ text: 'W-1', at: { x: 2000, y: 0 } }])
  })

  it('moves the reference beside a band too thin to hold it', () => {
    const derived = deriveWalls(projectWith([wall('w1', 'W-1', 100, { x: 4000, y: 0 })]), 'floor-main')
    // Zoomed out so the 12 px line of text is 240 mm of Floor: no 100 mm band can hold it.
    const list = drawWalls(derived, { sizing: { kind: 'screen', pxPerMm: 0.05 } })
    const [label] = texts(list.layers.find((layer) => layer.key === 'wall-labels')!.items)
    expect(label?.text).toBe('W-1')
    // Clear of the band's own face, rather than sitting on top of it.
    expect(Math.abs(label?.at.y ?? 0)).toBeGreaterThan(50)
  })

  it('shows the selected Wall’s end handles as squares on the tidied caps', () => {
    const derived = deriveWalls(projectWith([wall('w1', 'W-1', 200, { x: 4000, y: 0 })]), 'floor-main')
    const list = drawWalls(derived, { sizing, selectedWallId: 'w1' })
    const handles = list.layers.find((layer) => layer.key === 'plan-handle')
    expect(handles).toBeDefined()
    const corners = handles!.items.flatMap((item) => item.kind === 'path'
      ? item.segments.map((command) => command.to)
      : [])
    const near = (x: number, y: number): boolean =>
      corners.some((point) => Math.abs(point.x - x) < 10 && Math.abs(point.y - y) < 10)
    expect(near(0, 0)).toBe(true)
    expect(near(4000, 0)).toBe(true)
    expect(handles!.items.every((item) => item.kind === 'path' && item.style === 'plan-handle')).toBe(true)
  })

  it('draws nothing for a Floor with no Walls', () => {
    const derived = deriveWalls(projectWith([]), 'floor-main')
    const list = drawWalls(derived, { sizing })
    expect(list.layers).toEqual([])
  })
})
