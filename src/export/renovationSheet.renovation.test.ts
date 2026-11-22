/**
 * What a Renovation sheet says about itself (#73 §1).
 *
 * A hatch on a plan is a smudge until the sheet says what it means, and a Design Option's name is
 * the difference between a sheet that can be filed and one that cannot. These read the display list
 * the sheet is built from rather than its pixels: the claim is about which words and swatches are on
 * the paper, and where.
 */
import { describe, expect, it } from 'vitest'
import renovationFixture from '../../fixtures/domain/v8/renovation-views.json?raw'
import type { Project } from '../domain'
import { composeSheet } from './compose'
import { DESIGN_OPTION, DISPLAY_NAME, RENOVATION_LEGEND, TITLE_BLOCK } from './strings'
import type { ExportSnapshot, Recipe } from './types'

const project = (JSON.parse(renovationFixture) as { project: Project }).project
const snapshot: ExportSnapshot = { project, revision: 1 }
const CLOCK = { localDate: (): string => '2026-11-23' }

const RECIPE: Recipe = {
  views: [],
  format: 'svg',
  pageSize: 'A3',
  orientation: 'auto',
  scale: 'fit',
  pngLongEdge: 2048,
  titleBlock: true,
  grid: false,
  unit: 'mm',
  precision: 0,
}

/** The sheet for one saved view, or the failure that stopped it. */
function sheetFor(viewId: string): { words: string[]; legend: string[] } {
  const view = { kind: 'plan' as const, viewId }
  const out = composeSheet(snapshot, view, { ...RECIPE, views: [view] }, CLOCK, 'test')
  if (!out.ok) throw new Error(`${viewId}: ${out.reason}`)
  const items = out.list.layers.flatMap((band) => band.items)
  return {
    words: items.flatMap((item) => (item.kind === 'text' ? [item.text] : [])),
    // A legend swatch is the only renovation path on a sheet with no `ref`: the overlays drawn on
    // the model all point at the entity they mark.
    legend: items.flatMap((item) =>
      item.kind === 'path' && item.style.startsWith('renovation-') && item.ref === undefined ? [item.style] : [],
    ),
  }
}

describe('the Renovation sheet', () => {
  it('says Existing only and shows no legend for the Existing Model', () => {
    const sheet = sheetFor('seed-view-001')
    expect(sheet.words).toContain(DESIGN_OPTION)
    expect(sheet.words).not.toContain(TITLE_BLOCK.renovationDisplay)
    expect(sheet.legend).toEqual([])
  })

  it('names the Design Option and the Display it was drawn from', () => {
    const sheet = sheetFor('views-view-015')
    expect(sheet.words).toContain('Option A · Open kitchen')
    expect(sheet.words).not.toContain(DESIGN_OPTION)
    expect(sheet.words).toContain(TITLE_BLOCK.renovationDisplay)
    expect(sheet.words).toContain(DISPLAY_NAME.demolition)
  })

  it('legends only the States its own sheet marks', () => {
    expect(sheetFor('views-view-015').legend).toEqual(['renovation-demolition', 'renovation-hatch'])
    expect(sheetFor('views-view-014').legend).toEqual(['renovation-halo'])
    expect(sheetFor('views-view-016').legend).toEqual([
      'renovation-demolition',
      'renovation-hatch',
      'renovation-halo',
    ])
  })

  it('says the State beside the swatch, and never the word Existing', () => {
    const demolition = sheetFor('views-view-015')
    expect(demolition.words).toContain(RENOVATION_LEGEND.demolition)
    expect(demolition.words).not.toContain(RENOVATION_LEGEND.proposed)
    const combined = sheetFor('views-view-016')
    expect(combined.words).toContain(RENOVATION_LEGEND.demolition)
    expect(combined.words).toContain(RENOVATION_LEGEND.proposed)
    // `Existing` is content in its own layer colour: no swatch points at it, so no row claims to.
    for (const viewId of ['seed-view-001', 'views-view-014', 'views-view-015', 'views-view-016']) {
      expect(sheetFor(viewId).words.filter((word) => word === DISPLAY_NAME.existing)).toEqual([])
    }
  })

  it('stacks the legend above the title block, clear of the scale bar', () => {
    const view = { kind: 'plan' as const, viewId: 'views-view-016' }
    const out = composeSheet(snapshot, view, { ...RECIPE, views: [view], scale: 50 }, CLOCK, 'test')
    if (!out.ok) throw new Error(out.reason)
    const items = out.list.layers.flatMap((band) => band.items)
    const rows = items.flatMap((item) =>
      item.kind === 'text' && (item.text === RENOVATION_LEGEND.demolition || item.text === RENOVATION_LEGEND.proposed)
        ? [{ text: item.text, at: item.at }]
        : [],
    )
    const titleTop = out.sheet.titleBlock?.y ?? 0
    // One row per State, each above the last, all of them above the title block: the band under the
    // drawing is the only free space on a sheet, and the scale bar owns its right-hand end.
    expect(rows).toHaveLength(2)
    expect(Math.max(...rows.map((row) => row.at.y))).toBeLessThan(titleTop)
    expect(new Set(rows.map((row) => row.at.y)).size).toBe(2)
    expect(Math.min(...rows.map((row) => row.at.x))).toBeGreaterThan(out.sheet.content.x)
  })
})
