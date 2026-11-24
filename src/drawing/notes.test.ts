import { describe, expect, it } from 'vitest'
import { drawNotes, notePinRadius, noteRects } from './notes'
import type { NoteBadgeSubject, NotePinSubject } from './notes'
import type { Rect, Sizing } from './types'

const SCREEN: Sizing = { kind: 'screen', pxPerMm: 1 }

const pin = (id: string, x: number, y: number, tone: NotePinSubject['tone'] = 'normal'): NotePinSubject => ({
  id,
  at: { x, y },
  tone,
  reference: `C-${id}`,
})

const badge = (id: string, bounds: Rect, count: number): NoteBadgeSubject => ({ id, bounds, count })

const itemsOf = (id: string): { style: string; role?: string }[] => {
  const list = drawNotes([pin(id, 0, 0, 'high')], [], { sizing: SCREEN })
  if (list === null) throw new Error('expected a list')
  return list.layers[0]!.items.flatMap((item) =>
    item.kind === 'group' ? item.items.filter((one) => one.kind === 'path').map((one) => ({ style: one.style })) : [],
  )
}

describe('the Notes overlay', () => {
  it('draws nothing when there is no note to show (#80 §7.1)', () => {
    expect(drawNotes([], [], { sizing: SCREEN })).toBeNull()
  })

  it('puts every mark on one band of its own, above the model and below the words', () => {
    const list = drawNotes([pin('a', 0, 0), pin('b', 500, 0)], [badge('p', { x: 100, y: 100, w: 300, h: 600 }, 2)], { sizing: SCREEN })
    expect(list).not.toBeNull()
    expect(list!.layers.map((layer) => layer.key)).toEqual(['plan-notes'])
  })

  it('fills a pin with its priority, and grey once the note is Resolved (#80 §7.3)', () => {
    expect(itemsOf('a')).toEqual([{ style: 'plan-note-pin-high' }])
    const tones = (['high', 'normal', 'low', 'resolved'] as const).map((tone) => {
      const list = drawNotes([pin('a', 0, 0, tone)], [], { sizing: SCREEN })!
      return list.layers[0]!.items.flatMap((item) => (item.kind === 'group' ? item.items.flatMap((one) => (one.kind === 'path' ? [one.style] : [])) : []))[0]
    })
    expect(tones).toEqual(['plan-note-pin-high', 'plan-note-pin-normal', 'plan-note-pin-low', 'plan-note-pin-resolved'])
  })

  it('writes the count on the badge, one badge per placement (#80 §12)', () => {
    const list = drawNotes([], [badge('p', { x: 0, y: 0, w: 600, h: 600 }, 2)], { sizing: SCREEN })!
    const texts = list.layers[0]!.items.flatMap((item) =>
      item.kind === 'group' ? item.items.filter((one) => one.kind === 'text').map((one) => (one.kind === 'text' ? one.text : '')) : [],
    )
    expect(texts).toEqual(['✎2'])
  })

  it('leaves every pin clear of every label, handle and warning it was given (#80 criterion 22)', () => {
    // Label-sized boxes, the shape the canvas actually passes: a Wall reference, a dimension, a
    // warning disc. The pins stand where the notes stand, and none of them may sit on a word.
    const obstacles: Rect[] = [
      { x: 100, y: 100, w: 120, h: 30 },
      { x: 900, y: 400, w: 200, h: 24 },
      { x: 1600, y: 900, w: 14, h: 14 },
    ]
    const list = drawNotes(
      [pin('a', 160, 115), pin('b', 1000, 412), pin('c', 1607, 907)],
      [badge('p', { x: 2400, y: 200, w: 600, h: 600 }, 2)],
      { sizing: SCREEN, obstacles },
    )!
    for (const box of noteRects(list)) {
      for (const one of obstacles) {
        expect(box.x < one.x + one.w && one.x < box.x + box.w && box.y < one.y + one.h && one.y < box.y + box.h).toBe(false)
      }
    }
  })

  it('keeps a pin where it is when the seat is free, and leads it back when it is not (#80 §7.4)', () => {
    const r = notePinRadius(SCREEN)
    const free = drawNotes([pin('a', 800, 800)], [], { sizing: SCREEN })!
    expect(free.bounds.x).toBeCloseTo(800 - r)
    const taken = drawNotes([pin('a', 0, 0)], [], { sizing: SCREEN, obstacles: [{ x: -500, y: -500, w: 1000, h: 1000 }] })!
    const leader = taken.layers[0]!.items[0]!
    expect(leader.kind === 'group' && leader.items.some((one) => one.kind === 'path' && one.style === 'plan-note-leader')).toBe(true)
  })

  it('answers the same way twice, whatever order the notes arrived in (#80 §7.4)', () => {
    const a = drawNotes([pin('a', 0, 0), pin('b', 4000, 0)], [], { sizing: SCREEN })
    const b = drawNotes([pin('b', 4000, 0), pin('a', 0, 0)], [], { sizing: SCREEN })
    expect(JSON.stringify(a!.layers)).not.toEqual(JSON.stringify(b!.layers))
    const sortedA = JSON.stringify([...a!.layers[0]!.items].sort((x, y) => (x.kind === 'group' ? x.ref!.id : '').localeCompare(y.kind === 'group' ? y.ref!.id : '')))
    const sortedB = JSON.stringify([...b!.layers[0]!.items].sort((x, y) => (x.kind === 'group' ? x.ref!.id : '').localeCompare(y.kind === 'group' ? y.ref!.id : '')))
    expect(sortedA).toEqual(sortedB)
  })
})
