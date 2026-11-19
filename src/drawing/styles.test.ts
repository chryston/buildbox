/**
 * The style and size tables hold together (#60 §4).
 *
 * Two things can go wrong in a table this size, and neither is a type error: a row that names
 * a `SizeRole` nobody defined, and a row that is a *variant* of a base row that no longer
 * exists — a `:selected` nobody can reach, because the key is built by suffixing the base.
 * Both are checked against the tables themselves rather than against a hand-written list that
 * would drift the moment a row was added.
 */
import { describe, expect, it } from 'vitest'
import { FONT_STACK, SIZE_ROLES, STYLES, resolveSize, resolveStyle } from './styles'
import type { SizeRole, Style, StyleKey } from './types'

/** Every size role a row can name, in the four fields that name one. */
const namedRoles = (style: Style): SizeRole[] =>
  [style.strokeWidth, style.size, style.corner, ...(style.dash ?? [])].filter(
    (role): role is SizeRole => role !== undefined,
  )

const rows = Object.entries(STYLES) as [StyleKey, Style][]

describe('STYLES', () => {
  it('names only size roles that exist', () => {
    for (const [key, style] of rows) {
      for (const role of namedRoles(style)) {
        expect(SIZE_ROLES[role], `${key} names the missing size role "${role}"`).toBeDefined()
      }
    }
  })

  it('paints something, unless its colours come from the call site', () => {
    // `cabinet-divider` is the one row that carries only a width: a Divider's fill and stroke
    // are its material's, so a call site names `cabinet-divider-oak` and this row is the
    // answer for a material the table does not have.
    for (const [key, style] of rows) {
      const painted =
        style.fill !== undefined || style.stroke !== undefined || style.size !== undefined
      expect(painted, `${key} has neither a paint nor a size`).toBe(key !== 'cabinet-divider')
    }
  })

  it('gives every row that draws text a font and a size', () => {
    for (const [key, style] of rows) {
      if (style.size === undefined) continue
      expect(style.fontFamily, `${key} has a size but no font`).toBe(FONT_STACK)
    }
  })

  it('gives every emphasis variant a base row to vary', () => {
    // `toSvgTree` reaches a variant by suffixing the row an item already named, so a variant
    // whose base is missing is a row no caller can ever ask for.
    for (const [key] of rows) {
      const base = key.split(':')[0]
      if (base === key) continue
      expect(STYLES[base as StyleKey], `${key} varies the missing row "${base}"`).toBeDefined()
    }
  })

  it('resolves every key it holds', () => {
    for (const [key, style] of rows) {
      expect(resolveStyle(key)).toBe(style)
    }
  })

  it('keeps the colours the legacy canvases drew', () => {
    // The issue's promise is an identical picture, so these are the old literals, and a test
    // that pins them is what stops a well-meant "harmonise the palette" commit.
    expect(STYLES['cabinet-panel-oak']).toMatchObject({ fill: '#C8A96E', stroke: '#8B6914' })
    expect(STYLES['cabinet-void']).toMatchObject({ fill: 'rgba(255,255,255,0.03)' })
    expect(STYLES['cabinet-void:selected']).toMatchObject({
      fill: 'rgba(124,58,237,0.15)',
      stroke: '#7c3aed',
    })
    expect(STYLES['cabinet-pull']).toMatchObject({ fill: '#cbd5e1' })
    expect(STYLES['cabinet-unlock-mark']).toMatchObject({ fill: 'rgba(251,191,36,0.15)' })
    expect(STYLES['cabinet-space-label']).toMatchObject({ fill: '#6b7280' })
    // The Plan View's `fill={color + '33'}` is an alpha, not a second colour.
    expect(STYLES['plan-item']).toMatchObject({ fill: 'item', fillAlpha: 0x33 / 0xff })
  })
})

describe('SIZE_ROLES', () => {
  it('has a millimetre answer for the sheet, for every role', () => {
    // #62's export draws in millimetres of paper and has no zoom to fall back on: a role with
    // only a pixel value there would have nothing to resolve to.
    for (const [role, row] of Object.entries(SIZE_ROLES)) {
      expect('mm' in row.paper, `${role} has no paper millimetres`).toBe(true)
    }
  })

  it('keeps the screen arithmetic the legacy canvas did', () => {
    // `Math.max(12 / zoom, 8)` and `Math.max(10 / zoom, 6)`, and a plan label that never grew.
    expect(SIZE_ROLES['cabinet-dimension']).toEqual({ screen: { px: 12, mm: 8 }, paper: { mm: 2 } })
    expect(SIZE_ROLES['cabinet-space-label']).toEqual({ screen: { px: 10, mm: 6 }, paper: { mm: 2 } })
    expect(SIZE_ROLES['plan-label']).toEqual({ screen: { px: 12 }, paper: { mm: 2.5 } })
    // The Plan View's own constants, which are not negotiable either.
    expect(SIZE_ROLES['plan-dim-offset'].screen).toEqual({ px: 22 })
    expect(SIZE_ROLES['plan-dim-gap'].screen).toEqual({ px: 8 })
    expect(SIZE_ROLES['plan-dim-tick'].screen).toEqual({ px: 5 })
    expect(SIZE_ROLES['plan-chip-height'].screen).toEqual({ px: 18 })
    expect(SIZE_ROLES['plan-chip-char'].screen).toEqual({ px: 6.2 })
    expect(SIZE_ROLES['plan-origin-line'].screen).toEqual({ px: 1.25 })
    expect(SIZE_ROLES['plan-origin-arm'].screen).toEqual({ px: 7 })
    expect(SIZE_ROLES['plan-origin-dot'].screen).toEqual({ px: 2 })
    expect(SIZE_ROLES['cabinet-lock-icon'].screen).toEqual({ mm: 14 })
  })
})

describe('resolveSize', () => {
  const screen = (pxPerMm: number) => ({ kind: 'screen', pxPerMm }) as const
  const paper = (scale: number) => ({ kind: 'paper', scale }) as const

  it('divides a pixel size by the zoom', () => {
    expect(resolveSize('plan-label', screen(0.2))).toEqual({ mm: 60, px: 12 })
    expect(resolveSize('plan-label', screen(1))).toEqual({ mm: 12, px: 12 })
  })

  it('keeps a plan label at its pixel size at every zoom, because it has no floor', () => {
    // The Plan View's text is 12 CSS px whatever the zoom, so its millimetres are 12 / zoom
    // and nothing else: 6 mm at two pixels to the millimetre, 60 mm at a fifth.
    expect(resolveSize('plan-label', screen(2)).mm).toBe(6)
    expect(resolveSize('plan-label', screen(0.2)).mm).toBe(60)
  })

  it('takes the larger of the pixel size and the millimetre floor', () => {
    // `Math.max(12 / zoom, 8)`: twelve pixels at zoom 1, and then the floor takes over.
    expect(resolveSize('cabinet-dimension', screen(1))).toEqual({ mm: 12, px: 12 })
    expect(resolveSize('cabinet-dimension', screen(4))).toEqual({ mm: 8, px: 32 })
    expect(resolveSize('cabinet-space-label', screen(10)).mm).toBe(6)
  })

  it('leaves a millimetre-only row alone on screen', () => {
    // The placeholder rect was drawn inside the zoomed group: two millimetres of Floor, so
    // eight device pixels at four to the millimetre.
    expect(resolveSize('plan-placeholder-line', screen(4))).toEqual({ mm: 2, px: 8 })
    expect(resolveSize('cabinet-outline', screen(0.5))).toEqual({ mm: 1, px: 0.5 })
  })

  it('answers in millimetres of paper, and in millimetres of ink', () => {
    // `px` on paper is the sheet's own length: 2.5 mm of label at 1:20 is 0.125 mm of the
    // drawing's coordinate space, which is what a plotter is told.
    expect(resolveSize('plan-label', paper(0.05))).toEqual({ mm: 2.5, px: 0.125 })
    expect(resolveSize('plan-line', paper(0.05))).toEqual({ mm: 0.25, px: 0.0125 })
    expect(resolveSize('cabinet-lock-icon', paper(1))).toEqual({ mm: 3, px: 3 })
  })

  it('is the same answer for the same role, twice', () => {
    expect(resolveSize('plan-dim-offset', screen(0.37))).toEqual(
      resolveSize('plan-dim-offset', screen(0.37)),
    )
  })
})

describe('FONT_STACK', () => {
  it('names the bundled face before the generic family', () => {
    expect(FONT_STACK).toBe('"Noto Sans", sans-serif')
  })
})
