/**
 * A view line never reaches a drawing (#75 criterion 7, export contract §5).
 *
 * The marker on the Plan — the line, the direction arrow, the name, the shaded prism, the far-edge
 * handle — is an overlay the Floor workspace hands the canvas, and the exporter builds its own
 * display list and never asks for one. That is true by construction, which is exactly why it is
 * worth pinning: the day a marker is moved into `drawPlanView` to save a few lines, this test is the
 * one that says a sheet gained a piece of screen furniture.
 *
 * `src/test` is where a test may read every layer: the sentence a drawing must not contain is a
 * view's own name, and the bytes are `export`'s.
 */
import { describe, expect, it } from 'vitest'
import { referenceProject } from '../derive/testing'
import type { ElevationView, Project } from '../domain'
import type { DisplayItem } from '../drawing'
import { composeSheet } from '../export'
import type { Recipe } from '../export'

const CLOCK = { localDate: () => '2026-11-20' }

const base = referenceProject()
const FLOOR_ID = base.floors[0]!.id
const PLAN_VIEW_ID = base.views.find((entry) => entry.kind === 'plan' && entry.floorId === FLOOR_ID)!.id

/**
 * The reference Project with one Elevation View across the Floor the sheet is drawn from.
 *
 * Written as a fixture rather than through `elevationView.create` because this test is about the
 * exporter, not the handler: the document handed to the sheet is the one the handler would have
 * produced, and the Intent's own behaviour is pinned in `src/edit`.
 */
const VIEW: ElevationView = {
  id: 'ev-1',
  kind: 'elevation',
  floorId: FLOOR_ID,
  name: 'Kitchen west',
  line: { start: { x: 1000, y: 2000 }, end: { x: 5000, y: 2000 } },
  side: 'left',
  depth: 1500,
}

const project: Project = { ...base, elevationViews: [VIEW] }

const RECIPE: Recipe = {
  views: [{ kind: 'plan', viewId: PLAN_VIEW_ID }],
  format: 'svg',
  pageSize: 'A4',
  orientation: 'auto',
  scale: 'fit',
  pngLongEdge: 2048,
  titleBlock: true,
  grid: false,
  unit: 'mm',
  precision: 0,
}

function texts(items: readonly DisplayItem[]): string[] {
  return items.flatMap((item) =>
    item.kind === 'group' ? texts(item.items) : item.kind === 'text' ? [item.text] : [],
  )
}

describe('a view line on the Plan', () => {
  it('is drawn on the screen and absent from the sheet the same Project exports', () => {
    const composed = composeSheet({ project, revision: 3 }, { kind: 'plan', viewId: PLAN_VIEW_ID }, RECIPE, CLOCK, '0.0.0-test')
    if (!composed.ok) throw new Error(`the sheet did not compose: ${composed.reason}`)
    const drawn = texts(composed.drawing.layers.flatMap((layer) => layer.items))
    const sheet = texts(composed.list.layers.flatMap((layer) => layer.items))
    // The Plan itself is there — the test would pass vacuously on an empty drawing.
    expect(drawn.length + sheet.length).toBeGreaterThan(0)
    // The view's own name is the sentence that would give it away, on the drawing or the title
    // block. Neither carries it, and neither carries a marker's test id either.
    for (const list of [drawn, sheet]) {
      expect(list).not.toContain('Kitchen west')
      expect(list.filter((text) => text.includes('elevation-'))).toEqual([])
    }
  })
})
