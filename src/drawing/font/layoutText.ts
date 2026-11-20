/**
 * Text measured without a browser (#60 §2, #19 §4).
 *
 * The Plan View has always needed a text's box before it draws it — the `Floor bounds` chip
 * is placed against a box guessed as `length × 6.2 px`, which is a guess in a language where
 * an `i` and an `M` cost the same. The bundled face's metrics are committed as a table, so
 * the box can be the real one: the same advance widths the browser will use, read from the
 * same font file, in millimetres.
 *
 * This is also the only place that learns a glyph is *missing*. A code point the table does
 * not cover is measured at `.notdef` and reported, because a name drawn as boxes is a name
 * the user cannot read and the app has to say so (#19 §4).
 */
import type { Rect, TextAnchor } from '../types'
import {
  ADVANCES,
  ASCENDER,
  CODE_POINT_RANGES,
  DESCENDER,
  KERNING,
  NOTDEF_WIDTH,
  UNITS_PER_EM,
} from './notoSansMetrics'

/** What `layoutText` answers: the box the string takes, and what it could not measure. */
export type TextLayout = {
  width: number
  ascent: number
  descent: number
  missing: string[]
}

/**
 * The advance of each code point the font covers, and `undefined` for one it does not.
 *
 * Built once, at module load, from the two generated arrays. That is not module state in the
 * sense #60 criterion 1 bans: nothing can add to it, no function reads a value another
 * function wrote, and every call to `layoutText` sees the same frozen table — the ban is on
 * *mutable* state, and a lookup table is the opposite of it. The alternative, a linear scan
 * of `CODE_POINT_RANGES` per character, would make laying out one Plan View quadratic in the
 * size of the font.
 */
const ADVANCE_BY_CODE_POINT: ReadonlyMap<number, number> = (() => {
  const table = new Map<number, number>()
  let index = 0
  for (const [first, last] of CODE_POINT_RANGES) {
    for (let code = first; code <= last; code++) {
      table.set(code, ADVANCES[index])
      index += 1
    }
  }
  return table
})()

/**
 * The kerning pair key: the two code points as one number.
 *
 * `first * 0x110000 + second` is exact in float64 for every code point there is, which beats
 * a string key that has to be built and hashed for every pair of characters on the canvas.
 */
const pairKey = (first: number, second: number): number => first * 0x110000 + second

/** The kerning delta of each pair, in design units. Built once, for the same reason. */
const KERNING_BY_PAIR: ReadonlyMap<number, number> = new Map(
  KERNING.map(([first, second, delta]) => [pairKey(first, second), delta]),
)

/**
 * What one string costs, in millimetres, at `sizeMm`.
 *
 * `width` is the sum of the advance widths plus every kerning delta between adjacent
 * characters — `AV` and `To` really are narrower than their advances add up to, and a chip
 * sized without them clips the `V`. `ascent` and `descent` are the face's own, both positive,
 * so a caller that wants the line box adds them.
 *
 * `missing` holds each character with no glyph, once, in the order it first appears: the
 * drawing turns it into a `MissingGlyph` row, and the Plan View turns that into a warning the
 * user can act on.
 */
export function layoutText(text: string, sizeMm: number): TextLayout {
  const scale = sizeMm / UNITS_PER_EM
  let units = 0
  const missing: string[] = []
  let previous: number | null = null
  // Iterating a string walks code points, so an astral character is one character here and
  // not the two UTF-16 units `text.length` counts.
  for (const char of text) {
    const code = char.codePointAt(0) as number
    const advance = ADVANCE_BY_CODE_POINT.get(code)
    if (advance === undefined) {
      units += NOTDEF_WIDTH
      if (!missing.includes(char)) missing.push(char)
    } else {
      units += advance
    }
    if (previous !== null) units += KERNING_BY_PAIR.get(pairKey(previous, code)) ?? 0
    previous = code
  }
  return {
    width: units * scale,
    ascent: (ASCENDER * sizeMm) / UNITS_PER_EM,
    descent: (-DESCENDER * sizeMm) / UNITS_PER_EM,
    missing,
  }
}

/**
 * The axis-aligned box laid-out text occupies, for the label placer's obstacles (#57).
 *
 * The box is the full line — ascent above the baseline, descent below — centred on `at.y`,
 * because every piece of text on the Plan View is drawn `dominant-baseline: middle` and the
 * obstacle has to be the box the reader sees rather than the line the baseline sits on.
 * Horizontally it starts, centres or ends on `at.x` exactly as `text-anchor` will draw it.
 */
export function measureRect(
  layout: { width: number; ascent: number; descent: number },
  at: { x: number; y: number },
  anchor: TextAnchor,
): Rect {
  const h = layout.ascent + layout.descent
  const x =
    anchor === 'middle' ? at.x - layout.width / 2 : anchor === 'end' ? at.x - layout.width : at.x
  return { x, y: at.y - h / 2, w: layout.width, h }
}
