/**
 * A Drawing Set: several views, one order, one output (#85 §1).
 *
 * The interesting part of a set is not any single sheet — one sheet is #61's business — it is the
 * three things that only exist when there is more than one: which page shows which view, what the
 * file is called, and what happens to the order when a view is added or the person moves one.
 *
 * Page order is asserted through the SVG archive, because its entries are named after the view each
 * page draws and the order they appear in is the order the pages were made. The PDF is asserted
 * through page count and page shape, because its text is drawn with a subset face and the words are
 * not sitting in the bytes to be read.
 */
import { readFileSync } from 'node:fs'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { elevationScene, referenceProject } from '../derive/testing'
import { validateProject } from '../domain'
import { unzipEntries } from '../lib'
import type { ZipLimits } from '../lib'
import { defaultPageOrder, exportFiles, pageOrderOf, viewKey } from './index'
import type { ExportClock, ExportDeps, ExportFile, ExportSnapshot, Recipe, RecipeViewRef } from './types'

const CLOCK: ExportClock = { now: () => '2026-03-04T09:30:00.000Z', localDate: () => '2026-03-04' }
const DEPS: ExportDeps = { clock: CLOCK, buildboxVersion: '0.0.0-test' }
const withFont: ExportDeps = { ...DEPS, font: { bytes: latin1Font() } }

const LIMITS: ZipLimits = {
  maxEntries: 64,
  maxEntryBytes: 1 << 24,
  maxTotalBytes: 1 << 27,
  maxRatio: 200,
  ratioFloorBytes: 1024,
}

const PROJECT = elevationScene()
const SNAPSHOT: ExportSnapshot = { project: PROJECT, revision: 3 }
/** The same slug the file names are built from, so a test does not hard-code a second spelling. */
const SET = 'Plan-with-a-Plan-View-Range_drawings_20260304'

const PLAN: RecipeViewRef = { kind: 'plan', viewId: 'pr-003' }
const KITCHEN: RecipeViewRef = { kind: 'elevation', viewId: 'el-004' }
const ANGLED: RecipeViewRef = { kind: 'elevation', viewId: 'el-005' }
const ITEM: RecipeViewRef = { kind: 'item-detail', itemDesignId: 'pr-004' }

/** The same recipe every test starts from, with the views it asks for on top. */
function recipeFor(views: readonly RecipeViewRef[], over: Partial<Recipe> = {}): Recipe {
  return {
    views,
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

const textOf = (file: ExportFile): string => new TextDecoder().decode(file.bytes)

/** The archive as its entries are ordered on disk: name → bytes. */
function entriesOf(bytes: Uint8Array): [string, Uint8Array][] {
  const read = unzipEntries(bytes, LIMITS)
  if (!read.ok) throw new Error(`the archive did not read back: ${read.failure.code}`)
  return read.entries.map((entry) => [entry.name, entry.data])
}

/** The page count and the shape of each page, read back out of the PDF that was written. */
async function pagesOf(bytes: Uint8Array): Promise<{ count: number; shapes: string[] }> {
  const doc = await PDFDocument.load(bytes)
  return {
    count: doc.getPageCount(),
    shapes: doc.getPages().map((page) => {
      const { width, height } = page.getSize()
      return width > height ? 'landscape' : 'portrait'
    }),
  }
}

/** The subset face a PDF needs, read from the source tree — the only file system a test may touch. */
function latin1Font(): Uint8Array {
  return readFileSync(new URL('../assets/fonts/NotoSans-Latin1.ttf', import.meta.url))
}

describe('the default page order (#85 §1.2)', () => {
  it('follows the Floor, then the Floor’s own view list, then the Item Designs', () => {
    expect(validateProject(PROJECT).ok).toBe(true)
    // Ticked in the order a person happens to click; the page order is the Project's, not theirs.
    expect(defaultPageOrder(PROJECT, [ITEM, ANGLED, PLAN, KITCHEN])).toEqual([
      viewKey(PLAN),
      viewKey(KITCHEN),
      viewKey(ANGLED),
      viewKey(ITEM),
    ])
  })

  it('keeps Floors in display order and puts every Item Detail View last', () => {
    const project = referenceProject()
    expect(validateProject(project).ok).toBe(true)
    const [first, second, third] = project.views
    const item: RecipeViewRef = { kind: 'item-detail', itemDesignId: project.itemDesigns[1]!.id }
    const picked = [first!, second!, third!].map((view): RecipeViewRef => ({ kind: 'plan', viewId: view.id }))
    expect(defaultPageOrder(project, [item, picked[2]!, picked[0]!, picked[1]!])).toEqual([
      viewKey(picked[0]!),
      viewKey(picked[1]!),
      viewKey(picked[2]!),
      viewKey(item),
    ])
  })

  it('honours a recorded order and joins anything ticked since at the end', () => {
    const views = [PLAN, KITCHEN, ITEM]
    expect(pageOrderOf(PROJECT, views, [viewKey(ITEM), viewKey(PLAN)])).toEqual([
      viewKey(ITEM),
      viewKey(PLAN),
      viewKey(KITCHEN),
    ])
  })

  it('ignores a recorded key that names nothing and keeps a ticked view that has gone', () => {
    // A view still ticked still gets a page — `exportFiles` is what says it cannot be drawn, rather
    // than the order quietly losing it. A recorded key that names nothing the person asked for is
    // simply not a page.
    const gone: RecipeViewRef = { kind: 'elevation', viewId: 'el-gone' }
    expect(pageOrderOf(PROJECT, [PLAN, gone, KITCHEN], ['nonsense', viewKey(KITCHEN)])).toEqual([
      viewKey(KITCHEN),
      viewKey(PLAN),
      viewKey(gone),
    ])
  })
})

describe('a Drawing Set of several views (#85 §1.1, §1.5)', () => {
  it('writes one archive named after the Project and the day, with one file per view in page order', async () => {
    const picked = [ITEM, ANGLED, PLAN, KITCHEN]
    const result = await exportFiles(SNAPSHOT, recipeFor(picked), DEPS)
    expect(result.ok).toBe(true)
    if (!result.ok || result.kind !== 'archive') return
    expect(result.archive.name).toBe(`${SET}.zip`)
    expect(result.archive.mediaType).toBe('application/zip')

    const entries = entriesOf(result.archive.bytes)
    expect(entries[0]![0]).toBe('manifest.json')
    const sheets = entries.slice(1).map(([name]) => name)
    expect(sheets).toHaveLength(4)
    // The pages follow the Project's order, not the order the boxes were ticked in.
    expect(sheets[0]).toContain('Floor-1')
    expect(sheets[1]).toContain('Kitchen-elevation')
    expect(sheets[2]).toContain('Angled-elevation')
    expect(sheets[3]).toContain('Base-cabinet')
    // Each file is named exactly as the same view exported on its own would be (#85 §1.5), and the
    // pages arrive in the Project's order rather than the order the boxes were ticked in.
    const inPageOrder = [PLAN, KITCHEN, ANGLED, ITEM]
    for (const [index, name] of sheets.entries()) {
      const alone = await exportFiles(SNAPSHOT, recipeFor([inPageOrder[index]!]), DEPS)
      expect(alone.ok).toBe(true)
      if (alone.ok && alone.kind === 'single') expect(name).toBe(alone.file.name)
    }
  })

  it('numbers each page across the whole set, in the order the pages are drawn', async () => {
    const result = await exportFiles(SNAPSHOT, recipeFor([ITEM, PLAN]), DEPS)
    expect(result.ok).toBe(true)
    if (!result.ok || result.kind !== 'archive') return
    const entries = entriesOf(result.archive.bytes).filter(([name]) => name !== 'manifest.json')
    expect(entries).toHaveLength(2)
    expect(textOf({ name: '', mediaType: '', bytes: entries[0]![1] })).toContain('Page 1/2')
    expect(textOf({ name: '', mediaType: '', bytes: entries[1]![1] })).toContain('Page 2/2')
  })

  it('puts a single view on page 1 of 1, as it always did', async () => {
    const result = await exportFiles(SNAPSHOT, recipeFor([PLAN]), DEPS)
    expect(result.ok).toBe(true)
    if (!result.ok || result.kind !== 'single') return
    expect(textOf(result.file)).toContain('Page 1/1')
  })
})

describe('a Drawing Set as one PDF (#85 §1.3)', () => {
  it('is one file with one page per view, named for the set', async () => {
    const result = await exportFiles(SNAPSHOT, recipeFor([ITEM, ANGLED, PLAN, KITCHEN], { format: 'pdf' }), withFont)
    expect(result.ok).toBe(true)
    if (!result.ok || result.kind !== 'single') return
    expect(result.file.name).toBe(`${SET}.pdf`)
    expect(result.file.mediaType).toBe('application/pdf')
    expect((await pagesOf(result.file.bytes)).count).toBe(4)
  })

  it('draws the pages in the recorded order, and again in the new one', async () => {
    // Each view is held a known way, so the shape of each page says which view it is: the order the
    // shapes arrive in is the order the pages were made.
    const asDrawn = recipeFor([PLAN, KITCHEN, ITEM], {
      format: 'pdf',
      pageOrientations: {
        [viewKey(PLAN)]: 'landscape',
        [viewKey(KITCHEN)]: 'landscape',
        [viewKey(ITEM)]: 'portrait',
      },
    })
    const first = await exportFiles(SNAPSHOT, asDrawn, withFont)
    expect(first.ok).toBe(true)
    if (!first.ok || first.kind !== 'single') return
    expect((await pagesOf(first.file.bytes)).shapes).toEqual(['landscape', 'landscape', 'portrait'])

    const moved = await exportFiles(
      SNAPSHOT,
      { ...asDrawn, pageOrder: [viewKey(ITEM), viewKey(PLAN), viewKey(KITCHEN)] },
      withFont,
    )
    expect(moved.ok).toBe(true)
    if (!moved.ok || moved.kind !== 'single') return
    expect((await pagesOf(moved.file.bytes)).shapes).toEqual(['portrait', 'landscape', 'landscape'])
  })

  it('holds one page the way the person said and the rest the way the recipe did', async () => {
    const result = await exportFiles(
      SNAPSHOT,
      recipeFor([PLAN, ITEM], {
        format: 'pdf',
        orientation: 'portrait',
        pageOrientations: { [viewKey(ITEM)]: 'landscape' },
      }),
      withFont,
    )
    expect(result.ok).toBe(true)
    if (!result.ok || result.kind !== 'single') return
    expect((await pagesOf(result.file.bytes)).shapes).toEqual(['portrait', 'landscape'])
  })

  it('records the page order it drew in, in the file’s own metadata', async () => {
    const order = [viewKey(ITEM), viewKey(PLAN)]
    const result = await exportFiles(
      SNAPSHOT,
      recipeFor([PLAN, ITEM], { format: 'pdf', pageOrder: order }),
      withFont,
    )
    expect(result.ok).toBe(true)
    if (!result.ok || result.kind !== 'single') return
    const xml = new TextDecoder().decode(result.file.bytes)
    expect(xml).toContain('pageOrder')
    expect(xml).toContain('item:pr-004')
  })

  it('writes the same bytes twice, and different ones when a page has moved', async () => {
    const asDrawn = recipeFor([PLAN, KITCHEN], { format: 'pdf' })
    const once = await exportFiles(SNAPSHOT, asDrawn, withFont)
    const twice = await exportFiles(SNAPSHOT, asDrawn, withFont)
    const moved = await exportFiles(SNAPSHOT, { ...asDrawn, pageOrder: [viewKey(KITCHEN), viewKey(PLAN)] }, withFont)
    if (!once.ok || !twice.ok || !moved.ok || once.kind !== 'single' || twice.kind !== 'single' || moved.kind !== 'single')
      throw new Error('expected three PDFs')
    expect([...once.file.bytes]).toEqual([...twice.file.bytes])
    expect([...once.file.bytes]).not.toEqual([...moved.file.bytes])
  })
})
