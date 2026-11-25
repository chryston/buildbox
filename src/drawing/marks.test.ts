/**
 * The five glyphs and their targets (#81 §5).
 *
 * What each kind draws, what it wears and what the pointer can press: measured on the display
 * list rather than on pixels, because the list is the one answer both the screen and #83's
 * export will read.
 */
import { describe, expect, it } from 'vitest'
import { drawMarks, cloudCommands, wrapMarkText, type MarkSubject, type MarkStyle } from './marks'
import type { DisplayItem, DisplayList, Sizing } from './types'

const sizing: Sizing = { kind: 'screen', pxPerMm: 0.4 }

const style: MarkStyle = {
  size: 'M',
  colour: '#ffb547',
  weight: 2,
  dashed: false,
  arrowhead: true,
  cloudTint: false,
  markerShape: 'circle',
}

const subject = (over: Partial<MarkSubject>): MarkSubject => ({
  id: 'mark-1',
  type: 'text',
  at: { x: 1000, y: 2000 },
  text: 'Set out here',
  endpointAt: null,
  rect: null,
  targetLabel: null,
  style,
  ...over,
})

const itemsOf = (list: DisplayList | null): DisplayItem[] => list?.layers[0]?.items ?? []
const groupOf = (list: DisplayList | null): DisplayItem[] => (itemsOf(list)[0] as { items: DisplayItem[] }).items
const texts = (list: DisplayList | null): string[] =>
  groupOf(list).filter((item) => item.kind === 'text').map((item) => (item as { text: string }).text)

describe('drawMarks (#81 §5)', () => {
  it('draws nothing when there is nothing to draw', () => {
    expect(drawMarks([], { sizing })).toBeNull()
  })

  it('wraps a Text into a column, wears the record’s colour and carries a filled target', () => {
    const list = drawMarks([subject({ text: 'Move the boiler before the tiler comes and check the flue route' })], { sizing })
    const group = itemsOf(list)[0] as { ref: { id: string; role: string }; items: DisplayItem[] }
    expect(group.ref).toEqual({ id: 'mark-1', role: 'mark' })
    expect(texts(list).length).toBeGreaterThan(1)
    const first = group.items.find((item) => item.kind === 'text') as { color?: string }
    expect(first.color).toBe('#ffb547')
    const hit = group.items.find((item) => item.kind === 'path') as { style: string; closed: boolean }
    expect(hit.style).toBe('plan-mark-hit')
    expect(hit.closed).toBe(true)
  })

  it('draws a Leader from its endpoint to its label with an arrowhead at the endpoint', () => {
    const list = drawMarks([subject({ type: 'leader', endpointAt: { x: 2000, y: 2500 } })], { sizing })
    const group = (itemsOf(list)[0] as { items: DisplayItem[] }).items
    const line = group[0] as { segments: { to: { x: number; y: number } }[]; style: string }
    expect(line.segments[0]!.to).toEqual({ x: 1000, y: 2000 })
    expect(line.segments[1]!.to).toEqual({ x: 2000, y: 2500 })
    expect(line.style).toBe('plan-mark-2')
    const arrow = group[1] as { segments: { to: { x: number; y: number } }[] }
    expect(arrow.segments[1]!.to).toEqual({ x: 2000, y: 2500 })
    expect(group.some((item) => (item as { style?: string }).style === 'plan-mark-hit-line')).toBe(true)
  })

  it('leaves the arrowhead off when the record says so', () => {
    const list = drawMarks([subject({ type: 'arrow', endpointAt: { x: 2000, y: 2500 }, style: { ...style, arrowhead: false } })], { sizing })
    const group = (itemsOf(list)[0] as { items: DisplayItem[] }).items
    expect(group.filter((item) => (item as { style?: string }).style === 'plan-mark-2').length).toBe(1)
  })

  it('draws a dashed line when the record is dashed', () => {
    const list = drawMarks([subject({ type: 'arrow', endpointAt: { x: 2000, y: 2500 }, style: { ...style, dashed: true } })], { sizing })
    const line = (itemsOf(list)[0] as { items: DisplayItem[] }).items[0] as { style: string }
    expect(line.style).toBe('plan-mark-2-dashed')
  })

  it('scallops a Revision Cloud outward, tints it when asked and labels its top-right', () => {
    const rect = { x: 0, y: 0, w: 1200, h: 600 }
    const arcs = cloudCommands(rect, 60)
    expect(arcs.every((command) => command.k === 'M' || (command.k === 'A' && command.sweep === true))).toBe(true)
    const list = drawMarks([subject({ type: 'revision_cloud', rect, style: { ...style, cloudTint: true } })], { sizing })
    const group = (itemsOf(list)[0] as { items: DisplayItem[] }).items
    expect(group.some((item) => (item as { style?: string }).style === 'plan-mark-tint')).toBe(true)
    expect(texts(list)).toEqual(['△ Set out here'])
    const label = group.find((item) => item.kind === 'text') as { at: { x: number; y: number } }
    expect(label.at.x).toBe(1200)
    expect(label.at.y).toBeLessThan(0)
  })

  it('draws a Marker’s shape with its label inside and its target beside it', () => {
    const list = drawMarks([subject({ type: 'reference_marker', text: '3', targetLabel: 'Elevation — sink wall' })], { sizing })
    const group = (itemsOf(list)[0] as { items: DisplayItem[] }).items
    expect(texts(list)).toEqual(['3', '→ Elevation — sink wall'])
    const shape = group[0] as { kind: string; closed: boolean }
    expect(shape.kind).toBe('path')
    expect(shape.closed).toBe(true)
    const hex = drawMarks([subject({ type: 'reference_marker', text: '3', style: { ...style, markerShape: 'hexagon' } })], { sizing })
    const hexShape = (itemsOf(hex)[0] as { items: DisplayItem[] }).items[0] as { segments: { k: string }[] }
    expect(hexShape.segments.length).toBe(6)
  })

  it('bounds the whole list around every glyph', () => {
    const list = drawMarks(
      [
        subject({ at: { x: -500, y: -500 }, text: 'a' }),
        subject({ id: 'mark-2', type: 'arrow', at: { x: 4000, y: 4000 }, endpointAt: { x: 5000, y: 5000 }, text: '' }),
      ],
      { sizing },
    )!
    expect(list.bounds.x).toBeLessThanOrEqual(-500)
    expect(list.bounds.x + list.bounds.w).toBeGreaterThanOrEqual(5000)
    expect(list.bounds.y + list.bounds.h).toBeGreaterThanOrEqual(5000)
  })
})

describe('the wrap (#81 §5)', () => {
  it('breaks a long line at the column and caps the note at twelve lines', () => {
    const lines = wrapMarkText('word '.repeat(60), 12, 100)
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.every((line) => line.trim().length > 0)).toBe(true)
    const long = wrapMarkText(Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n'), 12, 10_000)
    expect(long.length).toBe(12)
    expect(long[11]).toContain('…')
  })
})
