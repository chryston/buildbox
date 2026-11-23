/**
 * The Vertical Extent rows the inspector draws (#74 §5, criteria 12 and 17).
 *
 * The scene entities are the ones the fixture holds — W-1, `Window 1`, `Wall cabinet #1`, `Sump box` —
 * so the labels and the numbers are checked against the Project the criteria are stated against, and
 * one hand-drawn Wall covers the arithmetic a fixture cannot: a Wall that does not start at the Datum.
 */
import { describe, expect, it } from 'vitest'
import type { ItemDesign, PlanViewRange, Wall } from '../../domain'
import { planRangeScene } from '../../derive/testing'
import { openingExtentView, placementExtentView, wallExtentView } from './verticalExtentFields'

const scene = planRangeScene()
const RANGE: PlanViewRange = { lowerMm: 0, upperMm: 1200 }
/** Millimetres, grouped — the formatter the inspector passes when the Project displays millimetres. */
const mm = (value: number): string => new Intl.NumberFormat('en-GB').format(value)

const design = (name: string): ItemDesign => scene.itemDesigns.find((row) => row.name === name) ?? expect.fail(`no ${name}`)
const placement = (name: string, index = 0) =>
  scene.existingModel.placedItems.filter((row) => row.itemDesignId === design(name).id)[index] ??
  expect.fail(`no ${name} placement`)
const wall = (index: number): Wall => scene.existingModel.walls[index] ?? expect.fail(`no wall ${index}`)
const opening = scene.existingModel.openings[0]!

/** A Wall that starts nowhere near the Floor Datum, to show `Top` is Base + Height and nothing else. */
const raised: Wall = { ...wall(0), baseElevation: 300, height: 2000 }

const shape = (rows: readonly { field: string; label: string; valueMm: number; caption: string }[]): string[] =>
  rows.map((row) => `${row.field} ${row.label} ${row.valueMm}${row.caption === '' ? '' : ` (${row.caption})`}`)

describe('a Wall (#74 §5)', () => {
  it('shows Base, Height and Top, and no Height line', () => {
    const view = wallExtentView(wall(0), RANGE, mm)
    expect(shape(view.rows)).toEqual(['base Base 0', 'height Height 2600', 'top Top 2600'])
    expect(view.heightLine).toBeNull()
    expect(view.shownAs).toBe('Shown as: In range')
  })

  it('derives Top from Base and Height, and stores neither of the other two differently', () => {
    const view = wallExtentView(raised, RANGE, mm)
    expect(shape(view.rows)).toEqual(['base Base 300', 'height Height 2000', 'top Top 2300'])
    expect(view.rows.map((row) => row.valueMm)).toEqual([300, 2000, 2300])
  })

  it('is In range because it intersects the range, whatever the range is', () => {
    // A range above the storey leaves the whole Wall under it; a range below the Datum leaves it over.
    expect(wallExtentView(wall(0), { lowerMm: 3000, upperMm: 4000 }, mm).rangeClass).toBe('below')
    expect(wallExtentView(wall(0), { lowerMm: -4000, upperMm: -3000 }, mm).rangeClass).toBe('above')
    expect(wallExtentView(wall(0), { lowerMm: 2599, upperMm: 4000 }, mm).rangeClass).toBe('in')
  })
})

describe('an Opening (#74 §5)', () => {
  it('shows Base (sill), Height and Top', () => {
    const view = openingExtentView(opening, RANGE, mm)
    expect(shape(view.rows)).toEqual(['base Base (sill) 900', 'height Height 1200', 'top Top 2100'])
    expect(view.heightLine).toBeNull()
    expect(view.shownAs).toBe('Shown as: In range')
  })

  it('says nothing about its host Wall', () => {
    // The host is not part of the view: editing a sill never moves the Wall it is cut into (#74 §5).
    expect(Object.keys(openingExtentView(opening, RANGE, mm))).toEqual(['rows', 'heightLine', 'shownAs', 'rangeClass'])
  })
})

describe('a Placed Item (#74 §5, §7)', () => {
  it('shows Base and Top, captions the Top, and reads the height out instead of offering a box', () => {
    const view = placementExtentView(design('Wall cabinet'), placement('Wall cabinet'), 1, RANGE, mm)
    expect(shape(view.rows)).toEqual(['base Base 1500', 'top Top 2200 (moves item)'])
    expect(view.heightLine).toBe('700 mm · from Item Design Wall cabinet · shared by 1 placement')
    expect(view.shownAs).toBe('Shown as: Above range')
  })

  it('says `placements` once there is more than one', () => {
    const view = placementExtentView(design('Base cabinet'), placement('Base cabinet'), 2, RANGE, mm)
    expect(view.heightLine).toBe('860 mm · from Item Design Base cabinet · shared by 2 placements')
    expect(view.shownAs).toBe('Shown as: In range')
  })

  it('has no Height field, because the record has no height to write (#74 criterion 17)', () => {
    const view = placementExtentView(design('Sump box'), placement('Sump box'), 1, RANGE, mm)
    expect(view.rows.map((row) => row.field)).not.toContain('height')
    expect(view.shownAs).toBe('Shown as: Below range')
  })
})

describe('the display unit (#74 §5)', () => {
  it('changes the text and never the value', () => {
    const metres = (value: number): string => (value / 1000).toFixed(2)
    const view = placementExtentView(design('Wall cabinet'), placement('Wall cabinet'), 1, RANGE, metres)
    expect(view.rows.map((row) => row.text)).toEqual(['1.50', '2.20'])
    expect(view.rows.map((row) => row.valueMm)).toEqual([1500, 2200])
    // The Height line names the number the design stores, in the same formatter the boxes use.
    expect(view.heightLine).toBe('0.70 mm · from Item Design Wall cabinet · shared by 1 placement')
  })
})
