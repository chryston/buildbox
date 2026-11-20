/**
 * The golden files (#61 Verification).
 *
 * These are the bytes a reviewer can read. `src/drawing`'s goldens pin the display list; these pin
 * what a sheet of it looks like once the frame, the title block, the scale bar and the provenance are
 * on it — the whole file a person would open in a text editor and check the arithmetic in.
 *
 * The fixture is the reference Project: three Floors with a Plan Image under each and six hundred
 * Placed Items over them, plus thirty cabinet Item Designs. It is the biggest real drawing in the
 * repository, which is the one that shows a rounding error.
 *
 * Regenerate with `UPDATE_GOLDEN=1 npx vitest run --project pure src/export/golden.test.ts`, then
 * read the diff: a golden that moves because a label found a millimetre is a decision, not a refresh.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { basicProject, referenceProject } from '../derive/testing'
import { exportFiles } from './index'
import { metreOnPaper } from './sheet'
import { modelBounds } from './compose'
import type { ExportClock, ExportDeps, ExportResult, Recipe, RecipeViewRef } from './types'

/** Write the file instead of comparing, for the run that means to change the drawing. */
const UPDATE = process.env['UPDATE_GOLDEN'] === '1'

const CLOCK: ExportClock = { now: () => '2026-03-04T09:30:00.000Z', localDate: () => '2026-03-04' }
const FONT_PATH = new URL('../assets/fonts/NotoSans-Latin1.ttf', import.meta.url)

/**
 * A real one-pixel PNG. The Flat's Plan Image is stored by hash and the bytes are not in the
 * repository, so the asset port answers with this: the golden then carries the `<image>` element and
 * the PDF carries an XObject, which is the part of a Plan Image the writer is responsible for.
 */
const PLAN_IMAGE = new Uint8Array(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4AWMAAQAABQABNtCI3QAAAABJRU5ErkJggg==', 'base64'),
)

const deps: ExportDeps = {
  clock: CLOCK,
  buildboxVersion: '0.0.0-test',
  font: { bytes: new Uint8Array(readFileSync(FONT_PATH)) },
  assets: async () => ({ bytes: PLAN_IMAGE, mediaType: 'image/png' }),
}

const project = referenceProject()
const snapshot = { project, revision: 3 }

/** The two-room Flat: big enough to be a drawing, small enough to sit on an A4 sheet at 1:50. */
const small = basicProject()
const smallSnapshot = { project: small, revision: 1 }

function recipe(view: RecipeViewRef, over: Partial<Recipe> = {}): Recipe {
  return {
    views: [view],
    format: 'svg',
    pageSize: 'A4',
    orientation: 'auto',
    scale: 50,
    pngLongEdge: 2048,
    titleBlock: true,
    grid: false,
    unit: 'mm',
    precision: 0,
    ...over,
  }
}

const only = (result: ExportResult): Uint8Array => {
  if (!result.ok) throw new Error(`export failed: ${JSON.stringify(result.failures)}`)
  if (result.kind !== 'single') throw new Error('expected one file')
  return result.file.bytes
}

function golden(name: string, bytes: Uint8Array): string {
  const file = fileURLToPath(new URL(`../../fixtures/export/golden/${name}.svg`, import.meta.url))
  const text = new TextDecoder().decode(bytes)
  if (UPDATE) {
    mkdirSync(fileURLToPath(new URL('../../fixtures/export/golden/', import.meta.url)), { recursive: true })
    writeFileSync(file, text)
  }
  expect(readFileSync(file, 'utf8'), name).toBe(text)
  return text
}

describe('the golden drawings', () => {
  it('puts a Floor on an A4 sheet at 1:50', async () => {
    // The small Floor, because 1:50 is a fixed scale and the writer refuses to draw a drawing that
    // will not fit one — which is the same answer the dialog gives before the person presses Export.
    const view = small.views.find((one) => one.kind === 'plan')!
    const ref = { kind: 'plan' as const, viewId: view.id }
    const text = golden('plan-1to50', only(await exportFiles(smallSnapshot, recipe(ref), deps)))
    // The arithmetic a reader checks with a ruler: the drawing is the model divided by fifty, and a
    // metre on paper at 1:50 is twenty millimetres.
    const bounds = modelBounds(smallSnapshot, ref)
    expect(bounds).not.toBeNull()
    expect(metreOnPaper(50)).toBe(20)
    expect(text).toContain('1:50')
    // A sheet at a fixed scale states the ratio; only a drawing scaled to the paper says it is not
    // to scale.
    expect(text).not.toContain('Not to scale')
    expect(text).toContain('Dimensions in mm')
    expect(text).toContain(small.meta.name)
    expect(text).toContain('2026-03-04')
  })

  it('puts the whole reference Floor on an A3 sheet at its own scale', async () => {
    const view = project.views.find((one) => one.kind === 'plan')!
    golden(
      'plan-reference-fit',
      only(
        await exportFiles(
          snapshot,
          recipe({ kind: 'plan', viewId: view.id }, { pageSize: 'A3', scale: 'fit' }),
          deps,
        ),
      ),
    )
  })

  it('puts a cabinet Item Detail on one too', async () => {
    // The Flat's own cabinet: seven components, which is a drawing a person can read. The reference
    // Project's units are 18-metre runs of 511 components each, and their detail is a black band.
    const design = small.itemDesigns.find((one) => one.kind === 'cabinet')!
    const text = golden(
      'item-detail-cabinet',
      only(
        await exportFiles(smallSnapshot, recipe({ kind: 'item-detail', itemDesignId: design.id }), deps),
      ),
    )
    expect(text).toContain(design.name)
    // An Item Detail is drawn to its own scale statement, and the frame and footer are still there.
    expect(text).toContain('Prepared with BuildBox')
  })

  it('writes the same bytes twice, and only the date moves', async () => {
    const view = project.views.find((one) => one.kind === 'plan')!
    const fit = recipe({ kind: 'plan', viewId: view.id }, { pageSize: 'A3', scale: 'fit' })
    const one = only(await exportFiles(snapshot, fit, deps))
    const two = only(
      await exportFiles(snapshot, fit, {
        ...deps,
        clock: { now: () => '2026-08-09T18:45:12.000Z', localDate: () => '2026-08-09' },
      }),
    )
    const mask = (bytes: Uint8Array): string =>
      new TextDecoder()
        .decode(bytes)
        .replace(/"exported_at":"[^"]*"/, '"exported_at":"…"')
        .replace(/2026-03-04|2026-08-09/g, '<day>')
    expect(mask(two)).toBe(mask(one))
  })
})

describe('the golden PDF', () => {
  const pdfOf = async (clock: ExportClock): Promise<string> => {
    const view = project.views.find((one) => one.kind === 'plan')!
    const bytes = only(
      await exportFiles(
        snapshot,
        recipe({ kind: 'plan', viewId: view.id }, { format: 'pdf', pageSize: 'A3', scale: 'fit' }),
        { ...deps, clock },
      ),
    )
    return new TextDecoder('latin1').decode(bytes)
  }

  it('has the objects, the id, the subset and the packet it had last time', async () => {
    const text = await pdfOf(CLOCK)
    // Page, content, font, the Plan Image and its style, the metadata stream, the catalog and the
    // info dictionary: thirteen objects, pinned so that a change in what the writer emits is a
    // decision someone reads.
    expect(text.match(/^\d+ 0 obj/gm)?.length).toBe(13)
    // `/ID` is the content hash, not the instant: two runs of the same drawing agree. pdf-lib keeps
    // a 16-byte identifier, so the digest is carried truncated and the file still says which
    // drawing it is.
    const id = /\/ID \[ <([0-9a-f]+)> <([0-9a-f]+)> \]/.exec(text)
    expect(id).not.toBeNull()
    expect(id![1]).toBe(id![2])
    expect(id![1]).toHaveLength(32)
    // The subset carries the tag derived from the content, so the file names its own letters.
    expect(text).toMatch(/\/BaseFont \/[A-Z]{6}\+NotoSans/)
    expect(text).toContain('<bb:ExportJSON>')
    expect(text).toContain('<x:xmpmeta')
    // `pdf-lib` writes the document-info strings as UTF-16BE, so the producer reads as hex here.
    expect(text).toContain('/Producer <FEFF004200750069006C00640042006F0078>')
    expect(text).toContain('/CreationDate (D:20260304093000Z)')
    expect(text).not.toContain('/Author')
  })

  it('keeps its id when the clock moves', async () => {
    const first = await pdfOf(CLOCK)
    const second = await pdfOf({ now: () => '2026-08-09T18:45:12.000Z', localDate: () => '2026-08-09' })
    const idOf = (text: string): string => /\/ID \[ <([0-9a-f]+)>/.exec(text)?.[1] ?? 'no id'
    // Criterion 1: `/ID` is identical across the two runs, because it is a hash of the drawing and
    // the recipe and not of the moment they were put on paper. The rest of the file is allowed to
    // differ — the title block prints the day, and a different day is a different drawing.
    expect(idOf(first)).toMatch(/^([0-9a-f]){32}$/)
    expect(idOf(second)).toBe(idOf(first))
    expect(second).not.toBe(first)
  })
})
