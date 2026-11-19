/**
 * The metrics table read as text widths (#60 §2, #19 §4).
 *
 * `layoutText` looks a code point up in a Map built once from two parallel generated arrays,
 * and the interesting failure of that design is a *build* bug: an off-by-one walking
 * `CODE_POINT_RANGES` gives every character the advance of its neighbour, which is plausible
 * at a glance and wrong in every box the label placer is handed. So the reference here is the
 * dumb version — a linear scan of the ranges and the kerning list, exactly as the generator
 * spells them — and the two have to agree.
 */
import { describe, expect, it } from 'vitest'
import {
  ADVANCES,
  ASCENDER,
  CODE_POINT_RANGES,
  DESCENDER,
  KERNING,
  NOTDEF_WIDTH,
  UNITS_PER_EM,
} from './notoSansMetrics'
import { layoutText, measureRect } from './layoutText'

/** The advance of one code point, found by walking the ranges the way the table is stored. */
function advanceOf(code: number): number | undefined {
  let index = 0
  for (const [first, last] of CODE_POINT_RANGES) {
    if (code >= first && code <= last) return ADVANCES[index + code - first]
    index += last - first + 1
  }
  return undefined
}

/** The kerning delta of one adjacent pair, in design units. */
const kernOf = (first: number, second: number): number =>
  KERNING.find(([a, b]) => a === first && b === second)?.[2] ?? 0

/** The width of a string, summed the slow obvious way. */
function naiveWidth(text: string, sizeMm: number): number {
  let units = 0
  let previous: number | null = null
  for (const char of text) {
    const code = char.codePointAt(0) as number
    units += advanceOf(code) ?? NOTDEF_WIDTH
    if (previous !== null) units += kernOf(previous, code)
    previous = code
  }
  return (units * sizeMm) / UNITS_PER_EM
}

/** The sum of the advances alone, with no kerning at all. */
const advanceSum = (text: string, sizeMm: number): number => {
  let units = 0
  for (const char of text) units += advanceOf(char.codePointAt(0) as number) ?? NOTDEF_WIDTH
  return (units * sizeMm) / UNITS_PER_EM
}

const TEN_MM = 10

describe('layoutText', () => {
  it('agrees with a linear scan of the table, for text that mixes cases and digits', () => {
    for (const text of ['Base 600', 'Wardrobe', 'Kitchen 600 × 560', 'aV To AV To', ' ']) {
      expect(layoutText(text, TEN_MM).width, text).toBeCloseTo(naiveWidth(text, TEN_MM), 10)
    }
  })

  it('kerns every pair the table carries', () => {
    for (const [first, second, delta] of KERNING) {
      const pair = String.fromCodePoint(first, second)
      const kerned = (delta * TEN_MM) / UNITS_PER_EM
      expect(layoutText(pair, TEN_MM).width, pair).toBeCloseTo(advanceSum(pair, TEN_MM) + kerned, 10)
    }
  })

  it('kerns adjacent characters only, which is what a space between them means', () => {
    // `AV` is in the table and `A V` is not: a placer that kerned across the space would
    // understate every label it was given, and the chip would clip.
    const delta = kernOf(0x41, 0x56)
    expect(delta).toBeLessThan(0)
    expect(layoutText('AV', TEN_MM).width).toBeCloseTo(
      advanceSum('AV', TEN_MM) + (delta * TEN_MM) / UNITS_PER_EM,
      10,
    )
    expect(layoutText('A V', TEN_MM).width).toBeCloseTo(advanceSum('A V', TEN_MM), 10)
  })

  it('measures the face\'s own ascent and descent, both positive', () => {
    const layout = layoutText('hp', TEN_MM)
    expect(layout.ascent).toBeCloseTo((ASCENDER * TEN_MM) / UNITS_PER_EM, 12)
    expect(layout.descent).toBeCloseTo((-DESCENDER * TEN_MM) / UNITS_PER_EM, 12)
    expect(layout.ascent).toBeGreaterThan(layout.descent)
  })

  it('reports a character it has no glyph for, once, in the order it appeared', () => {
    const layout = layoutText('Kitchen 厨房', TEN_MM)
    expect(layout.missing).toEqual(['厨', '房'])
    expect(layoutText('厨房厨', TEN_MM).missing).toEqual(['厨', '房'])
    expect(layoutText('Kitchen', TEN_MM).missing).toEqual([])
  })

  it('measures a missing glyph at .notdef, which is what the browser will draw', () => {
    expect(layoutText('厨', TEN_MM).width).toBeCloseTo((NOTDEF_WIDTH * TEN_MM) / UNITS_PER_EM, 12)
  })

  it('counts a code point once, not the two UTF-16 units it is stored as', () => {
    const astral = '😀'
    expect(astral.length).toBe(2)
    const layout = layoutText(astral, TEN_MM)
    expect(layout.missing).toEqual([astral])
    expect(layout.width).toBeCloseTo((NOTDEF_WIDTH * TEN_MM) / UNITS_PER_EM, 12)
  })

  it('scales linearly with the size, and is empty for nothing', () => {
    expect(layoutText('Wardrobe', 20).width).toBeCloseTo(layoutText('Wardrobe', 10).width * 2, 10)
    expect(layoutText('', TEN_MM)).toMatchObject({ width: 0, missing: [] })
  })

  it('is proportional, which is the whole reason a per-character guess was wrong', () => {
    expect(layoutText('iiii', TEN_MM).width).toBeLessThan(layoutText('MMMM', TEN_MM).width)
  })
})

describe('measureRect', () => {
  const layout = { width: 10, ascent: 2, descent: 1 }
  const at = { x: 100, y: 50 }

  it('centres the line box on the point every label is drawn at', () => {
    expect(measureRect(layout, at, 'middle')).toEqual({ x: 95, y: 48.5, w: 10, h: 3 })
  })

  it('starts and ends the box on the point, as text-anchor will', () => {
    expect(measureRect(layout, at, 'start')).toEqual({ x: 100, y: 48.5, w: 10, h: 3 })
    expect(measureRect(layout, at, 'end')).toEqual({ x: 90, y: 48.5, w: 10, h: 3 })
  })

  it('takes the whole line, descent included, not just the ascent', () => {
    const box = measureRect(layoutText('Wardrobe', TEN_MM), at, 'middle')
    expect(box.h).toBeCloseTo(layoutText('Wardrobe', TEN_MM).ascent + layoutText('Wardrobe', TEN_MM).descent, 12)
    expect(box.w).toBeCloseTo(layoutText('Wardrobe', TEN_MM).width, 12)
  })
})
