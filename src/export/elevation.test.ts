/**
 * An Elevation View through the Drawing tab (#75 criterion 15).
 *
 * The sheet is the same machinery a Plan View goes through — fit, title block, provenance, one file
 * per view — so what is tested here is only what an Elevation View brings to it: the drawing area it
 * asks the page to fit, the heights the sheet writes in the model's own millimetres rather than the
 * paper's, and the definition the recipe records alongside the layers.
 */
import { describe, expect, it } from 'vitest'
import { elevationScene as fixture } from '../derive/testing'
import { exportFiles } from './index'
import { modelBounds } from './compose'
import { provenanceOf } from './provenance'
import type { ExportClock, ExportDeps, ExportFile, ExportSnapshot, Recipe, RecipeViewRef } from './types'

const CLOCK: ExportClock = { now: () => '2026-03-04T09:30:00.000Z', localDate: () => '2026-03-04' }
const DEPS: ExportDeps = { clock: CLOCK, buildboxVersion: '0.0.0-test' }

const PROJECT = fixture()
const VIEW: RecipeViewRef = { kind: 'elevation', viewId: 'el-004' }
const SNAPSHOT: ExportSnapshot = { project: PROJECT, revision: 3 }

const recipe = (over: Partial<Recipe> = {}): Recipe => ({
  views: [VIEW],
  format: 'svg',
  pageSize: 'A4',
  orientation: 'auto',
  scale: 'fit',
  pngLongEdge: 2048,
  titleBlock: true,
  grid: false,
  unit: 'mm',
  precision: 0,
  ...over,
})

const textOf = (file: ExportFile): string => new TextDecoder().decode(file.bytes)

describe('an Elevation View on paper (#75 criterion 15)', () => {
  it('writes one SVG named after the Floor and the view', async () => {
    const result = await exportFiles(SNAPSHOT, recipe(), DEPS)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.kind).toBe('single')
    if (result.kind !== 'single') return
    const file = result.file
    expect(file.mediaType).toBe('image/svg+xml')
    const slug = (value: string): string => value.replace(/[^A-Za-z0-9]+/g, '-')
    expect(file.name).toBe(
      `${slug(PROJECT.meta.name)}_${slug(PROJECT.floors.find((each) => each.id === 'pr-002')!.name)}_Kitchen-elevation_20260304.svg`,
    )
    expect(textOf(file)).toContain('<metadata>')
  })

  it('writes the heights in the model’s millimetres, not the paper’s', async () => {
    const result = await exportFiles(SNAPSHOT, recipe({ scale: 50 }), DEPS)
    if (!result.ok || result.kind !== 'single') throw new Error('the sheet did not come back')
    const text = textOf(result.file)
    // The drawing is shrunk to 1:50 and the ruler still says 2600 where the room measures 2600.
    expect(text).toContain('Upper limit 2600')
    expect(text).toContain('Floor Datum 0')
    expect(text).not.toContain('Upper limit 52')
  })

  it('records the Elevation definition the sheet was drawn from', () => {
    const provenance = provenanceOf(SNAPSHOT, recipe(), DEPS)
    const published = provenance.recipe
    expect('composition' in published ? published.composition?.[0] : undefined).toMatchObject({
      view_id: 'el-004',
      view_name: 'Kitchen elevation',
      elevation: {
        name: 'Kitchen elevation',
        line: { start: { x: 0, y: 1400 }, end: { x: 4000, y: 1400 } },
        side: 'left',
        depth: 2000,
      },
    })
  })

  it('measures the drawn area for the page to fit', () => {
    const bounds = modelBounds(SNAPSHOT, VIEW)
    expect(bounds).not.toBeNull()
    // 4000 along the view line, and from the Sump box's pit up to the Floor's own upper limit.
    expect(bounds!.x).toBe(0)
    expect(bounds!.w).toBe(4000)
    expect(bounds!.y).toBe(-150)
    expect(bounds!.y + bounds!.h).toBe(2600)
  })

  it('says which view is gone rather than writing a blank sheet', async () => {
    const result = await exportFiles(SNAPSHOT, recipe({ views: [{ kind: 'elevation', viewId: 'el-999' }] }), DEPS)
    expect(result).toEqual({ ok: false, failures: [{ output: 'el-999', reason: 'unknown-view' }] })
  })
})
