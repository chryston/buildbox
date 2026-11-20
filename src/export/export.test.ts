import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { basicProject, referenceProject } from '../derive/testing'
import type { Project } from '../domain'
import { exportFiles } from './index'
import type { ExportClock, ExportDeps, ExportFile, ExportSnapshot, Recipe } from './types'
import { EXPORT_FOOTER, NOT_TO_SCALE } from './strings'

/** A clock that never moves, so a test can compare two exports byte for byte. */
const FIXED_CLOCK: ExportClock = {
  now: () => '2026-03-04T09:30:00.000Z',
  localDate: () => '2026-03-04',
}

function snapshotOf(revision = 3): ExportSnapshot {
  return { project: referenceProject(), revision }
}

function recipeFor(viewId: string, over: Partial<Recipe> = {}): Recipe {
  return {
    views: [{ kind: 'plan', viewId }],
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
  }
}

const deps: ExportDeps = { clock: FIXED_CLOCK, buildboxVersion: '0.0.0-test' }

/** The same export with the subset face attached, which is all a PDF needs beyond the drawing. */
const withFont: ExportDeps = { ...deps, font: { bytes: latin1Font() } }

describe('exportFiles', () => {
  it('writes one SVG for one Plan View', async () => {
    const project = referenceProject()
    const file = single(await exportFiles(snapshotOf(), recipeFor(project.views[0]!.id), deps))
    const text = new TextDecoder().decode(file.bytes)
    expect(file.mediaType).toBe('image/svg+xml')
    expect(text.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg')).toBe(true)
    expect(text).toContain(EXPORT_FOOTER)
    expect(text).toContain(NOT_TO_SCALE)
    expect(text).toContain('<metadata>')
    expect(file.name).toMatch(/\.svg$/)
  })

  it('names the file after the Project, the Floor, the view and the day', async () => {
    const project = referenceProject()
    const file = single(await exportFiles(snapshotOf(), recipeFor(project.views[0]!.id), deps))
    expect(file.name).toBe(
      `${project.meta.name.replace(/[^A-Za-z0-9]+/g, '-')}_${project.floors[0]!.name.replace(/[^A-Za-z0-9]+/g, '-')}_${project.views[0]!.name.replace(/[^A-Za-z0-9]+/g, '-')}_existing_20260304.svg`,
    )
  })

  it('says which view is gone rather than writing a blank sheet', async () => {
    const result = await exportFiles(snapshotOf(), recipeFor('view-nope'), deps)
    expect(result).toEqual({ ok: false, failures: [{ output: 'view-nope', reason: 'unknown-view' }] })
  })

  it('writes the same bytes twice', async () => {
    const project = referenceProject()
    const first = single(await exportFiles(snapshotOf(), recipeFor(project.views[0]!.id), deps))
    const second = single(await exportFiles(snapshotOf(), recipeFor(project.views[0]!.id), deps))
    expect(first.bytes).toEqual(second.bytes)
  })

  it('writes a PDF whose bytes do not move between runs', async () => {
    const project = referenceProject()
    const recipe = recipeFor(project.views[0]!.id, { format: 'pdf' })
    const first = single(await exportFiles(snapshotOf(), recipe, withFont))
    const second = single(await exportFiles(snapshotOf(), recipe, withFont))
    const text = new TextDecoder('latin1').decode(first.bytes)
    expect(first.mediaType).toBe('application/pdf')
    expect(text.startsWith('%PDF-1.7\n')).toBe(true)
    expect(text.endsWith('\n%%EOF')).toBe(true)
    expect(text).toContain('/ID [')
    expect(text).toContain('+NotoSans')
    expect(first.bytes).toEqual(second.bytes)
  })

  it('draws a sheet for a Plan View with nothing in it (#61 criterion 7)', async () => {
    // The Mezzanine of the basic Project: take its Plan Image away and the cabinet off it, and the
    // view is left with no extent at all. It still gets a sheet — frame, title block, footer — and
    // the sheet says which Floor it is, so an empty one reads as empty rather than as a failure.
    const base = basicProject()
    const project: Project = {
      ...base,
      floors: base.floors.map((floor) => (floor.id === 'floor-mezz' ? { ...floor, planImage: null } : floor)),
      existingModel: {
        ...base.existingModel,
        placedItems: base.existingModel.placedItems.filter((one) => one.floorId !== 'floor-mezz'),
      },
    }
    const view = project.views.find((one) => one.kind === 'plan' && one.floorId === 'floor-mezz')
    if (view === undefined || view.kind !== 'plan') throw new Error('the basic Project has no Mezzanine view')

    const svg = new TextDecoder().decode(single(await exportFiles({ project, revision: 1 }, recipeFor(view.id), deps)).bytes)
    expect(svg).toContain('data-layer="sheet-furniture"')
    expect(svg).toContain(EXPORT_FOOTER)
    expect(svg).toContain(base.meta.name)
    expect(svg).toContain('Mezzanine')
    expect(svg).toContain(NOT_TO_SCALE)
  })

  it('names the label whose character the font has no glyph for (#61 criterion 11)', async () => {
    // The export completes and the notice says which label lost a character — for one file as much
    // as for an archive, which is why the names ride on the result and not only on the manifest.
    const base = basicProject()
    const design = base.itemDesigns[0]!
    const project: Project = {
      ...base,
      itemDesigns: base.itemDesigns.map((one) => (one.id === design.id ? { ...one, name: 'Island 🏠' } : one)),
    }
    const result = await exportFiles(
      { project, revision: 1 },
      recipeFor(design.id, { format: 'pdf', views: [{ kind: 'item-detail', itemDesignId: design.id }] }),
      withFont,
    )
    if (!result.ok) throw new Error(JSON.stringify(result.failures))
    expect(single(result).mediaType).toBe('application/pdf')
    expect(result.missingGlyphs).toEqual(['Island 🏠'])
  })

  it('hands back nothing when the second of three sheets cannot be written (#61 criterion 6)', async () => {
    // Three Plan Views, and the Plan Image of the middle one comes back in a format no PDF writer
    // takes. The answer is no files and no archive — a ZIP of two sheets out of three would be the
    // partial export criterion 6 forbids — and the failure names the sheet that could not be made.
    const project = referenceProject()
    const [first, second, third] = project.views
    const hashed = project.floors.find((floor) => floor.planImage !== null)
    if (hashed === undefined || hashed.planImage === null) throw new Error('the reference Project has no Plan Image')
    const badHash = hashed.planImage.assetHash
    const views: Recipe['views'] = [
      { kind: 'plan', viewId: second!.id },
      { kind: 'plan', viewId: first!.id },
      { kind: 'plan', viewId: third!.id },
    ]
    const tiff: ExportDeps = {
      ...withFont,
      assets: async (hash) => (hash === badHash ? { mediaType: 'image/tiff', bytes: new Uint8Array() } : null),
    }

    const result = await exportFiles(
      { project, revision: 3 },
      recipeFor(first!.id, { format: 'pdf', views }),
      tiff,
    )
    if (result.ok) throw new Error('expected the export to refuse')
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]!.reason).toBe('image-format')
    expect(result.failures[0]!.output).toContain('Floor-1')
  })
})

/** The one file an export of one view produced, or the failures that stopped it. */
function single(result: Awaited<ReturnType<typeof exportFiles>>): ExportFile {
  if (!result.ok) throw new Error(JSON.stringify(result.failures))
  if (result.kind !== 'single') throw new Error('expected a single file')
  return result.file
}

/** The subset face a PDF needs, read from the source tree — the only file system a test may touch. */
function latin1Font(): Uint8Array {
  return readFileSync(new URL('../assets/fonts/NotoSans-Latin1.ttf', import.meta.url))
}
