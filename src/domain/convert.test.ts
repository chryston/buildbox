/**
 * What converting to a Custom Path costs (#58 §5).
 *
 * The dialog reads this table verbatim, so the assertions are about the words a person
 * reads: a warning that names a field the shape never had is a warning about a shape they
 * are not holding.
 */
import { describe, expect, it } from 'vitest'
import { PRESET_KINDS } from '../geometry'
import type { Preset } from '../geometry'
import { PRESET_NAMES, convertWarningFor, lostParametersOf } from './index'

const ALL: Record<string, Preset> = {
  square: { kind: 'square', side: 600 },
  rectangle: { kind: 'rectangle', width: 1200, depth: 600 },
  roundedRectangle: { kind: 'roundedRectangle', width: 1200, depth: 600, radius: 40 },
  circle: { kind: 'circle', diameter: 1600 },
  ellipse: { kind: 'ellipse', width: 1600, depth: 900 },
  capsule: { kind: 'capsule', length: 1200, width: 400 },
  triangle: { kind: 'triangle', baseWidth: 900, depth: 600 },
  regularPolygon: { kind: 'regularPolygon', sideCount: 6, sideLength: 200 },
}

describe('PRESET_NAMES — one name per preset (#58 §4)', () => {
  it('names every preset the kernel knows, and no others', () => {
    expect(Object.keys(PRESET_NAMES).sort()).toEqual([...PRESET_KINDS].sort())
  })

  it('spells them the way the Shapes gallery does', () => {
    expect(PRESET_NAMES).toMatchObject({
      square: 'Square',
      rectangle: 'Rectangle',
      roundedRectangle: 'Rounded Rectangle',
      circle: 'Circle',
      ellipse: 'Ellipse',
      capsule: 'Capsule',
      triangle: 'Triangle',
      regularPolygon: 'Regular Polygon',
    })
  })

  it('never says "segment" where it means an Edge', () => {
    const copy = [...Object.values(PRESET_NAMES), ...PRESET_KINDS.map((kind) => convertWarningFor(ALL[kind]))]
    for (const text of copy) expect(text.toLowerCase()).not.toContain('segment')
  })
})

describe('lostParametersOf — the fields conversion removes (#58 §5)', () => {
  it('lists the parameters each preset actually stores', () => {
    expect(lostParametersOf(ALL.square)).toEqual(['side', 'orientation'])
    expect(lostParametersOf(ALL.rectangle)).toEqual(['width', 'depth', 'orientation'])
    expect(lostParametersOf(ALL.circle)).toEqual(['diameter', 'orientation'])
    expect(lostParametersOf(ALL.ellipse)).toEqual(['width', 'depth', 'orientation'])
    expect(lostParametersOf(ALL.capsule)).toEqual(['length', 'width', 'orientation'])
    expect(lostParametersOf(ALL.triangle)).toEqual(['base width', 'depth', 'apex offset', 'orientation'])
    expect(lostParametersOf(ALL.regularPolygon)).toEqual(['sides', 'side length', 'orientation'])
  })

  it('names a Rectangle\'s radii not at all', () => {
    // The criterion in one line: a Rectangle never had a corner radius, so a warning that
    // promises to remove one is lying about the shape in hand.
    expect(lostParametersOf(ALL.rectangle).join(' ')).not.toMatch(/radius|radii/)
  })

  it('counts one radius or four, whichever is stored', () => {
    const shared: Preset = { kind: 'roundedRectangle', width: 1200, depth: 600, radius: 40 }
    const perCorner: Preset = {
      kind: 'roundedRectangle',
      width: 1200,
      depth: 600,
      radii: { topLeft: 40, topRight: 40, bottomRight: 40, bottomLeft: 40 },
    }
    expect(lostParametersOf(shared)).toContain('corner radius')
    expect(lostParametersOf(perCorner)).toContain('the four corner radii')
    expect(lostParametersOf(perCorner)).not.toContain('corner radius')
  })

  it('always loses the turn and never the position', () => {
    // The outline keeps its own coordinates, so where the shape sits survives; how far it
    // was turned has nothing left to be stored in once the parameters are gone.
    for (const preset of Object.values(ALL)) {
      const lost = lostParametersOf(preset)
      expect(lost).toContain('orientation')
      expect(lost).not.toContain('position')
      expect(lost).not.toContain('position x')
      expect(lost).not.toContain('position y')
    }
  })
})

describe('convertWarningFor — the dialog body (#58 §5, criterion 22)', () => {
  it('says what stays, what goes and how to get it back', () => {
    expect(convertWarningFor(ALL.rectangle)).toBe(
      'Edges become individually editable. The Rectangle\'s width, depth and orientation fields will be removed. You can reverse this only with Undo.',
    )
  })

  it('names the preset in hand', () => {
    expect(convertWarningFor(ALL.regularPolygon)).toContain('The Regular Polygon\'s')
    expect(convertWarningFor(ALL.circle)).toContain('The Circle\'s diameter and orientation fields')
  })

  it('lists two lost fields with "and" and no comma', () => {
    expect(convertWarningFor(ALL.circle)).toContain('diameter and orientation')
  })

  it('lists three or more with an Oxford-free serial comma and a final "and"', () => {
    expect(convertWarningFor(ALL.triangle)).toContain('base width, depth, apex offset and orientation')
  })
})
