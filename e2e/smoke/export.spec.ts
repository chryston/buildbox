import { expect, test } from '../support/fixtures'
import { readDownload } from '../support/libraryApp'
import { FIRST_PROJECT, openPreviewApp, openProjectFromLibrary, showFloorPlan } from '../support/previewApp'
import type { Page } from '@playwright/test'

// The Export smoke (#61, criteria 9, 11, 14, 15): the dialog is reachable from the Plan View, one
// press of `Export` hands the browser exactly one file, and the drawing in that file says what it
// has to say — the Project name, `Not to scale`, the dimensions' unit.
//
// The bytes are read out of the download rather than compared to a golden file: the golden SVG pair
// is `src/export`'s own unit test, where the clock and the font are fixed. What only a browser can
// answer is that the whole chain — dialog, Worker, blob, download — delivers.

/** Record every Worker the app constructs, and every task that blocks the main thread. */
async function instrument(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const store = window as unknown as { __workers: string[]; __longTasks: number[] }
    store.__workers = []
    store.__longTasks = []
    const RealWorker = window.Worker
    class TrackedWorker extends RealWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        store.__workers.push(String(url))
      }
    }
    window.Worker = TrackedWorker as unknown as typeof Worker
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) store.__longTasks.push(entry.duration)
    }).observe({ entryTypes: ['longtask'] })
  })
}

/** Open the dialog from the Plan View and press `Export`, returning the file the browser got. */
async function exportOnce(page: Page): Promise<{ name: string; text: string }> {
  await page.getByTestId('export-open').click()
  await expect(page.getByTestId('export-tab-drawing')).toBeVisible()
  const pending = page.waitForEvent('download')
  await page.getByTestId('export-run').click()
  const file = await readDownload(await pending)
  return { name: file.name, text: file.buffer.toString('utf8') }
}

/**
 * The drawing with its provenance stripped: the metadata block carries the instant of the export and
 * the view's minted id, neither of which is the drawing, and the second of which the migration hands
 * out afresh on every load.
 */
const drawingOnly = (text: string): string =>
  text.replace(/<metadata>.*?<\/metadata>/s, '').replace(/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/g, 'view')

test('Export… writes one SVG that states what it must', async ({ page }) => {
  await instrument(page)
  await openPreviewApp(page)
  await showFloorPlan(page)

  const file = await exportOnce(page)
  expect(file.name).toMatch(/\.svg$/)
  expect(file.name).not.toContain('floor-plan.svg')
  expect(file.text).toContain('<svg')
  // The title block is on by default, and an SVG is never to scale (§7).
  expect(file.text).toContain('Not to scale')
  expect(file.text).toContain('Dimensions in mm')
  expect(file.text).toContain(FIRST_PROJECT)
  // The dialog closes once the file is handed over.
  await expect(page.getByTestId('export-run')).toHaveCount(0)
})

test('the drawing is made in a Worker, and the main thread keeps answering', async ({ page }) => {
  await instrument(page)
  await openPreviewApp(page)
  await showFloorPlan(page)

  const before = await page.evaluate(() => (window as unknown as { __longTasks: number[] }).__longTasks.length)
  const file = await exportOnce(page)
  expect(file.text).toContain('<svg')

  const workers = await page.evaluate(() => (window as unknown as { __workers: string[] }).__workers)
  expect(workers.length, 'no Worker was constructed').toBeGreaterThan(0)
  const blocked = await page.evaluate(() => (window as unknown as { __longTasks: number[] }).__longTasks)
  // Criterion 14: no single block over 200 ms while a drawing was written. The observer counts
  // every long task since load, including the app's own first paint, so the assertion is about
  // the longest one rather than the count — an export that froze the page would top it.
  const longest = blocked.slice(before).reduce((worst, one) => Math.max(worst, one), 0)
  expect(longest, `main thread blocked for ${longest} ms`).toBeLessThan(200)
})

test('with no Worker available, the same bytes come from the main thread', async ({ page }) => {
  await instrument(page)
  await openPreviewApp(page)
  await showFloorPlan(page)
  const viaWorker = await exportOnce(page)

  // The same Project, the same recipe, and a `Worker` that refuses to be constructed: §9 says the
  // person sees no difference, and criterion 14 pins that to the bytes. The stub is installed
  // before the reload, because an init script only reaches the next document.
  await page.addInitScript(() => {
    window.Worker = function Worker() {
      throw new Error('no Worker in this browser')
    } as unknown as typeof Worker
  })
  await page.reload({ waitUntil: 'networkidle' })
  await openProjectFromLibrary(page, FIRST_PROJECT)
  await showFloorPlan(page)
  const onMainThread = await exportOnce(page)

  expect(onMainThread.name).toBe(viaWorker.name)
  expect(drawingOnly(onMainThread.text)).toBe(drawingOnly(viaWorker.text))
})

test('a PDF is one drawing per file, and the file is a PDF', async ({ page }) => {
  await openPreviewApp(page)
  await showFloorPlan(page)
  await page.getByTestId('export-open').click()
  await page.getByTestId('export-format').selectOption('pdf')
  // §12: the view picker takes one view for a PDF, because a PDF sheet is one drawing.
  await expect(page.locator('[data-testid^="export-view-"][aria-checked="true"], [data-testid^="export-view-"]:checked')).toHaveCount(1)

  const pending = page.waitForEvent('download')
  await page.getByTestId('export-run').click()
  const file = await readDownload(await pending)
  expect(file.name).toMatch(/\.pdf$/)
  expect(file.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  // The subset font is embedded, so the file carries its own letters and not a name to look up.
  expect(file.buffer.subarray(-1024).toString('latin1')).toContain('%%EOF')
})
