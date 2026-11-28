import { createHash } from 'node:crypto'
import { unzipSync } from 'fflate'
import { expect, test } from '../support/fixtures'
import { FIRST_PROJECT, openPreviewApp, saveStatus } from '../support/previewApp'
import { dialogHeading, openLibrary, previewSeed, readDownload, restoreFile, storeFingerprint } from '../support/libraryApp'

// The Handoff Pack and the Drawing Set in a real browser (#85, criteria 1, 2, 6, 12, 16).
//
// `src/export`'s unit tests hold the clock and the fixture still, and answer what the bytes say.
// What only a browser answers is the chain the person actually walks: three tabs in one dialog, a
// pack assembled in the app and handed to the browser as one download, a Drawing Set whose pages
// arrive as one PDF — and, at the other end of the file's life, the Project Library refusing to
// Restore it as though it were a Backup, without touching anything.

/** The Project as its files are named: the slug is the name with its spaces turned to dashes. */
const SLUG = FIRST_PROJECT.split(' ').join('-')

/** The sentence the Library says about an export handed to Restore (`ui/strings`, `restoreProblemExport`). */
const NOT_A_BACKUP = 'This is an export, not a BuildBox Backup'

interface Manifest {
  format: string
  manifest_version: number
  contract_version: string
  files: Array<{
    path: string
    media_type?: string
    bytes?: number
    sha256?: string
    contract_version?: string
  }>
  metadata: Record<string, unknown>
  recipe: Record<string, unknown>
}

function manifestOf(entries: Record<string, Uint8Array>): Manifest {
  return JSON.parse(new TextDecoder().decode(entries['manifest.json'])) as Manifest
}

/** The eight-digit date the export's own clock writes, read from the name rather than recomputed:
 * a test that built today's date itself would pass at midnight and fail the day after. */
function dateOf(name: string): string {
  const match = /_(\d{8})\./.exec(name)
  expect(match, name).not.toBeNull()
  return match![1]!
}

test('downloads a Handoff Pack whose manifest describes every file in it', async ({ page }) => {
  await openPreviewApp(page)
  await page.getByTestId('export-open').click()
  await page.getByTestId('export-tab-handoff').click()
  await expect(page.getByTestId('export-handoff-outputs')).toBeVisible()
  await expect(page.getByTestId('export-handoff-data')).toBeVisible()

  // The pack says what it is before it is pressed: the scope in plain words, and the three notices
  // that a person has to be able to see rather than discover in a file afterwards.
  await expect(page.getByTestId('export-handoff-statement')).toBeVisible()
  await expect(page.getByTestId('export-handoff-notice-backup')).toContainText('cannot be opened again as your work')
  await expect(page.getByTestId('export-handoff-open-backup')).toBeVisible()

  const pending = page.waitForEvent('download')
  await page.getByTestId('export-handoff-run').click()
  const file = await readDownload(await pending)
  await expect(page.getByTestId('export-handoff-run')).toHaveCount(0)

  expect(file.name).toBe(`${SLUG}_handoff_${dateOf(file.name)}.zip`)
  const entries = unzipSync(new Uint8Array(file.buffer)) as Record<string, Uint8Array>
  const manifest = manifestOf(entries)

  expect(manifest.format).toBe('buildbox-export')
  expect(manifest.contract_version).toBe('1.0')

  // The eleven CSVs, under `data/`, whatever the seed holds — the pack's promise is the set of names.
  for (const table of [
    'items',
    'cut-list',
    'placed-items',
    'rooms',
    'walls',
    'openings',
    'beams',
    'skirting',
    'services',
    'warnings',
    'comments',
  ]) {
    expect(entries[`data/${table}.csv`], `data/${table}.csv`).toBeDefined()
    expect(
      manifest.files.some((entry) => entry.path === `data/${table}.csv` && entry.contract_version === '1.0'),
    ).toBe(true)
  }

  // Every entry the manifest names is in the archive, and its digest is the digest of those bytes.
  for (const entry of manifest.files) {
    if (entry.path === 'manifest.json') continue
    const held = entries[entry.path]
    expect(held, entry.path).toBeDefined()
    expect(entry.bytes).toBe(held!.length)
    expect(entry.sha256).toBe(createHash('sha256').update(held!).digest('hex'))
  }

  // Nothing that identifies the person or the machine travels in the manifest.
  const raw = new TextDecoder().decode(entries['manifest.json'])
  for (const key of ['"author"', '"device"', '"user_agent"', '"locale"', '"timezone"', 'C:\\', '/home/']) {
    expect(raw, key).not.toContain(key)
  }

  // The pack is read-only: exporting it did not save anything, because it did not change anything.
  await expect(saveStatus(page)).toContainText('Saved locally')
})

test('downloads a Drawing Set as one PDF with one page per view', async ({ page }) => {
  await openPreviewApp(page)
  await page.getByTestId('export-open').click()
  await page.getByTestId('export-tab-drawing').click()

  const boxes = page.getByRole('checkbox').and(page.locator('[data-testid^="export-view-"]'))
  const count = await boxes.count()
  expect(count).toBeGreaterThan(1)
  // Two views, whichever they are: the set is the point, not this seed's view list.
  await boxes.nth(0).check()
  await boxes.nth(1).check()
  await expect(page.getByTestId('export-page-order')).toBeVisible()
  // PDF is what makes it a set: SVG and PNG give one file per view, and those go into an archive.
  await page.getByTestId('export-format').selectOption('pdf')

  const pending = page.waitForEvent('download')
  await page.getByTestId('export-run').click()
  const file = await readDownload(await pending)

  // One file, not a ZIP: a multi-page PDF is one document, and a person emails it.
  expect(file.name).toBe(`${SLUG}_drawings_${dateOf(file.name)}.pdf`)
  const pdf = file.buffer.toString('latin1')
  expect(pdf.startsWith('%PDF-')).toBe(true)
  // One `/Type /Page` per selected view, and the count the pages print.
  expect(pdf.match(/\/Type\s*\/Page[^s]/g)?.length).toBe(2)
})

test('refuses to Restore a downloaded Handoff Pack and changes nothing', async ({ page }) => {
  // The pack is built in the workspace, so it is downloaded there and carried back by hand — the
  // same route a person takes when they attach it to an email and it comes back months later.
  await openPreviewApp(page)
  await page.getByTestId('export-open').click()
  await page.getByTestId('export-tab-handoff').click()
  const pending = page.waitForEvent('download')
  await page.getByTestId('export-handoff-run').click()
  const pack = await readDownload(await pending)
  expect(pack.name).toContain('_handoff_')

  await openLibrary(page, previewSeed)
  const before = await storeFingerprint(page)

  await restoreFile(page, pack)
  await expect(dialogHeading(page)).toHaveText(NOT_A_BACKUP)
  await page.getByRole('button', { name: 'Close', exact: true }).click()

  expect(await storeFingerprint(page)).toBe(before)
  expect(await page.evaluate(() => document.querySelectorAll('article.project-card').length)).toBe(2)
})

test("the pack's note goes to where a Backup is actually downloaded", async ({ page }) => {
  await openPreviewApp(page)
  await page.getByTestId('export-open').click()
  await page.getByTestId('export-tab-handoff').click()
  await page.getByTestId('export-handoff-open-backup').click()

  // The dialog closes and the Library is where the person stands — the pack never grows its own
  // Backup button, because two ways to download a Backup is two ways to get it wrong.
  await expect(page.getByTestId('export-open')).toHaveCount(0)
  await expect(dialogHeading(page)).toHaveCount(0)
})
