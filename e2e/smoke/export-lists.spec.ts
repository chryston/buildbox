import { createHash } from 'node:crypto'
import { unzipSync } from 'fflate'
import { expect, test } from '../support/fixtures'
import { parseCsv } from '../../src/export/testing'
import { FIRST_PROJECT, openPreviewApp, saveStatus, showFloorPlan, undoButton } from '../support/previewApp'
import { previewSeed, readDownload } from '../support/libraryApp'
import { projectRevision } from '../support/seedPreviewDb'
import type { Page } from '@playwright/test'

// The Lists smoke (#62, criteria 3, 5, 10, 11, 12): the Lists tab hands the browser a CSV or a ZIP,
// the bytes carry the published header and a BOM, the manifest hashes every entry, a scope with
// nothing in it says `0 rows` and exports anyway, and none of it touches the Project.
//
// The rows themselves are `src/export`'s unit tests' concern, where the clock and the fixture are
// fixed. What only a browser answers is the chain: dialog, Worker, blob, download — and that the
// number the dialog printed is the number of lines in the file.

/** The two published headers, spelled out here on purpose: a rename is a major version, and it
 * should break this file as loudly as it breaks the golden. */
const ITEMS_HEADER =
  'floor_id,floor,design_option_id,design_option,renovation_state,item_design_id,item_design,count,width_mm,depth_mm,height_mm'
const CUT_LIST_HEADER =
  'design_option_id,design_option,renovation_state,item_design_id,item_design,part,length_mm,width_mm,thickness_mm,material,qty_per_item,item_count,qty_in_scope,notes'

/** The Project as its files are named: the slug is the name with its spaces turned to dashes. */
const SLUG = FIRST_PROJECT.split(' ').join('-')

async function openLists(page: Page): Promise<void> {
  await page.getByTestId('export-open').click()
  await page.getByTestId('export-tab-lists').click()
  await expect(page.getByTestId('export-lists-tables')).toBeVisible()
}

/** The rows the dialog says a table holds. */
async function rows(page: Page, table: 'items' | 'cut-list'): Promise<number> {
  const text = await page.getByTestId(`export-lists-rows-${table}`).textContent()
  return Number(/(\d+)/.exec(text ?? '')?.[0])
}

/** Press `Export` and wait for the one file the browser was handed. */
async function runLists(page: Page): Promise<{ name: string; buffer: Buffer }> {
  const pending = page.waitForEvent('download')
  await page.getByTestId('export-lists-run').click()
  const file = await readDownload(await pending)
  await expect(page.getByTestId('export-lists-run')).toHaveCount(0)
  return file
}

/**
 * CSV bytes read back by the contract's own strict reader (#62 criterion 3): the BOM is reported
 * rather than eaten, a bare LF or a stray quote throws rather than parsing into something that
 * merely looks like a row, and a UTF-8 name that survived the round trip is the name that was
 * written.
 */
function csvRows(buffer: Buffer): readonly (readonly string[])[] {
  const parsed = parseCsv(new Uint8Array(buffer))
  expect(parsed.bom, 'no UTF-8 BOM').toBe(true)
  return parsed.rows
}

interface Manifest {
  format: string
  manifest_version: number
  contract_version: string
  exported_at: string
  files: Array<{ path: string; kind: string; bytes?: number; sha256?: string }>
  recipe: { tables: string[] }
}

function manifestOf(entries: Record<string, Uint8Array>): Manifest {
  return JSON.parse(new TextDecoder().decode(entries['manifest.json'])) as Manifest
}

test('one table downloads one CSV that carries the published header', async ({ page }) => {
  await openPreviewApp(page)
  await showFloorPlan(page)
  await openLists(page)

  // Two tables are on by default, so nothing has to be said about provenance; one table is a bare
  // CSV with nowhere to put the Project or the revision, and the dialog says so before the download.
  await expect(page.getByTestId('export-lists-notice-single')).toHaveCount(0)
  await page.getByTestId('export-lists-table-cut-list').click()
  await expect(page.getByTestId('export-lists-notice-single')).toBeVisible()

  const shown = await rows(page, 'items')
  expect(shown, 'the seed Project holds no items').toBeGreaterThan(0)

  const file = await runLists(page)
  expect(file.name).toMatch(new RegExp(`^${SLUG}_items_\\d{8}\\.csv$`))

  const lines = csvRows(file.buffer)
  expect(lines[0]).toEqual(ITEMS_HEADER.split(','))
  // Criterion 5's other half: the sentence beside the table and the file agree.
  expect(lines).toHaveLength(shown + 1)
  for (const one of lines) expect(one).toHaveLength(ITEMS_HEADER.split(',').length)
  expect(lines[1]).toContain('Base Unit')
  expect(lines[1]).toContain('existing')
  // The count column arrives as a number a spreadsheet can add, not a string that looks like one.
  expect(Number(lines[1]![7])).toBeGreaterThan(0)
  // The dialog closes once the file is handed over.
  await expect(page.getByTestId('export-lists-run')).toHaveCount(0)
})

test('two tables arrive as one archive whose manifest hashes each entry', async ({ page }) => {
  await openPreviewApp(page)
  await showFloorPlan(page)
  await openLists(page)

  const file = await runLists(page)
  expect(file.name).toMatch(new RegExp(`^${SLUG}_lists_\\d{8}\\.zip$`))
  const day = /_(\d{8})\.zip$/.exec(file.name)![1]

  const entries = unzipSync(new Uint8Array(file.buffer))
  // The contract's order, and nothing else in the archive: no directories, no stray files.
  expect(Object.keys(entries)).toEqual([`${SLUG}_items_${day}.csv`, `${SLUG}_cut-list_${day}.csv`, 'manifest.json'])
  expect(csvRows(Buffer.from(entries[`${SLUG}_items_${day}.csv`]!))[0]).toEqual(ITEMS_HEADER.split(','))
  expect(csvRows(Buffer.from(entries[`${SLUG}_cut-list_${day}.csv`]!))[0]).toEqual(CUT_LIST_HEADER.split(','))

  const manifest = manifestOf(entries)
  expect(manifest.format).toBe('buildbox-export')
  expect(manifest.manifest_version).toBe(1)
  expect(manifest.contract_version).toBe('1.0')
  expect(manifest.recipe.tables).toEqual(['items', 'cut-list'])
  const tables = manifest.files.filter((one) => one.kind === 'list')
  expect(tables.map((one) => one.path)).toEqual([`${SLUG}_items_${day}.csv`, `${SLUG}_cut-list_${day}.csv`])
  for (const one of tables) {
    const bytes = entries[one.path]!
    expect(one.bytes, one.path).toBe(bytes.length)
    expect(one.sha256, one.path).toBe(createHash('sha256').update(bytes).digest('hex'))
  }
  // The manifest describes itself, so an extracted table still explains where it came from.
  expect(manifest.files.some((one) => one.kind === 'manifest' && one.path === 'manifest.json')).toBe(true)
})

/** Criterion 5: an empty answer is an answer. The notice is `0 rows`, not a blocked button. */
test('a scope with nothing in it says 0 rows and still writes both headers', async ({ page }) => {
  await openPreviewApp(page)
  await showFloorPlan(page)
  await openLists(page)

  for (const state of ['existing', 'demolition', 'proposed']) {
    await page.getByTestId(`export-lists-state-${state}`).click()
  }
  await expect(page.getByTestId('export-lists-rows-items')).toHaveText('0 rows')
  await expect(page.getByTestId('export-lists-rows-cut-list')).toHaveText('0 rows')

  const pending = page.waitForEvent('download')
  await page.getByTestId('export-lists-run').click()
  const file = await readDownload(await pending)
  const entries = unzipSync(new Uint8Array(file.buffer))
  for (const one of Object.keys(entries).filter((name) => name.endsWith('.csv'))) {
    expect(csvRows(Buffer.from(entries[one]!)), one).toHaveLength(1)
  }
})

/**
 * Criterion 12 and 13 in the browser: the same recipe twice is the same bytes, and the Project was
 * never touched — not its revision on disk, not its undo history, not its save state.
 */
test('the same recipe twice gives the same bytes and leaves the Project alone', async ({ page }) => {
  await openPreviewApp(page)
  await showFloorPlan(page)
  await expect(saveStatus(page)).toContainText('Saved locally')
  const revision = await projectRevision(page, previewSeed.projects[0].id)

  const first = await listsZip(page)
  const second = await listsZip(page)

  const a = unzipSync(new Uint8Array(first))
  const b = unzipSync(new Uint8Array(second))
  expect(Object.keys(a)).toEqual(Object.keys(b))
  for (const name of Object.keys(a)) {
    if (name === 'manifest.json') continue
    expect(Buffer.from(a[name]!).equals(Buffer.from(b[name]!)), name).toBe(true)
  }
  // The manifest is the only entry that may differ, and only in the instant it was written.
  const before = manifestOf(a)
  const after = manifestOf(b)
  expect({ ...before, exported_at: '' }).toEqual({ ...after, exported_at: '' })

  await expect(saveStatus(page)).toContainText('Saved locally')
  await expect(undoButton(page)).toBeDisabled()
  expect(await projectRevision(page, previewSeed.projects[0].id)).toBe(revision)
})

/** Criterion 11: the recipe is remembered for this view on this device. */
test('the tables this view was last exported with are the tables it starts on', async ({ page }) => {
  await openPreviewApp(page)
  await showFloorPlan(page)
  await openLists(page)

  await page.getByTestId('export-lists-table-cut-list').click()
  await runLists(page)

  await page.getByTestId('export-open').click()
  await page.getByTestId('export-tab-lists').click()
  await expect(page.getByTestId('export-lists-table-items')).toBeChecked()
  await expect(page.getByTestId('export-lists-table-cut-list')).not.toBeChecked()
})

/** The archive a default recipe writes, opened from whatever state the dialog is in. */
async function listsZip(page: Page): Promise<Buffer> {
  await openLists(page)
  return (await runLists(page)).buffer
}
