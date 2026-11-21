/**
 * The five element tables in the browser (#68 criteria 1, 5, 7 and Scope 9).
 *
 * `src/export`'s unit tests already know what a row says. What only a browser answers is the chain
 * the builder actually walks: the Lists tab offers the five tables, the number beside each checkbox
 * is the number of lines in the file the Worker wrote, all seven tables together come back as one
 * archive whose manifest hashes every entry, and a Floor with nothing on it exports five headers
 * rather than failing.
 *
 * The words are read from the contract rather than typed out here: `headerLine` and `STRINGS` are
 * the same modules the app and the golden files are built from, so a rename breaks the golden, the
 * dialog and this file at once — which is the point of a v1.0 freeze. They are reached through the
 * files that define them because Playwright's `esbuild` loader keeps `import type` in place, and
 * the barrel would then drag the whole app into a Node context.
 *
 * The scene is the seed (`scripts/make-tables-scene-seed.ts`): an arc wall with a door on it, a
 * window, a sliding kitchen door, an item crossing a Room and one inside another, and three
 * warnings — one open, one reopened, one acknowledged with a note.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync } from 'fflate'
import type { Page } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import { addFloor, openProjectFromLibrary, showFloorPlan } from '../support/previewApp'
import { readDownload } from '../support/libraryApp'
import { seedPreviewDb, type PreviewSeed } from '../support/seedPreviewDb'
import { parseCsv } from '../../src/export/testing'
import { TABLES, headerLine } from '../../src/export/csv/tables'
import type { TableId } from '../../src/export/csv/tables'
import { describeScope } from '../../src/export/scope'
import { SCOPE } from '../../src/export/strings'
import { STRINGS } from '../../src/ui/strings'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const tablesSeed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'tables-scene.json'), 'utf8'),
) as PreviewSeed
const projectName = tablesSeed.library.find((record) => record.id === tablesSeed.projects[0]!.id)!.name

/** The Project as its files are named: the slug is the name with its spaces turned to dashes. */
const SLUG = projectName.split(' ').join('-')
const FLOOR_ONE = tablesSeed.projects[0]!.data.floors[0]!.id

/** The arc the scene is built around, read out of the seed rather than typed in. */
const ARC = (() => {
  const line = tablesSeed.projects[0]!.data.existingModel.walls.find((w) => w.line.kind === 'arc')!.line
  if (line.kind !== 'arc') throw new Error('the tables scene has no arc Wall')
  const [a, b, c] = [line.start, line.through, line.end]
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y))
  const centre = {
    x: ((a.x ** 2 + a.y ** 2) * (b.y - c.y) + (b.x ** 2 + b.y ** 2) * (c.y - a.y) + (c.x ** 2 + c.y ** 2) * (a.y - b.y)) / d,
    y: ((a.x ** 2 + a.y ** 2) * (c.x - b.x) + (b.x ** 2 + b.y ** 2) * (a.x - c.x) + (c.x ** 2 + c.y ** 2) * (b.x - a.x)) / d,
  }
  return Math.hypot(a.x - centre.x, a.y - centre.y)
})()

/** The five tables of #68, in the contract's order — the order of the ZIP and of the checkboxes. */
const FIVE = ['rooms', 'walls', 'openings', 'placed-items', 'warnings'] as const satisfies readonly TableId[]

/** The label the checkbox carries, read from the copy rather than repeated here. */
const LABELS: Record<(typeof FIVE)[number], string> = {
  rooms: STRINGS.exportListRooms,
  walls: STRINGS.exportListWalls,
  openings: STRINGS.exportListOpenings,
  'placed-items': STRINGS.exportListPlacedItems,
  warnings: STRINGS.exportListWarnings,
}

interface Manifest {
  format: string
  manifest_version: number
  contract_version: string
  exported_at: string
  files: Array<{ path: string; kind: string; bytes?: number; sha256?: string }>
  recipe: { tables: string[]; scope?: Record<string, unknown> }
}

async function openLists(page: Page): Promise<void> {
  await page.getByTestId('export-open').click()
  await page.getByTestId('export-tab-lists').click()
  await expect(page.getByTestId('export-lists-tables')).toBeVisible()
}

/** The rows the dialog says one table holds. */
async function rows(page: Page, table: TableId): Promise<number> {
  const text = await page.getByTestId(`export-lists-rows-${table}`).textContent()
  return Number(/(\d+)/.exec(text ?? '')?.[0])
}

/** Tick the five and only the five, leaving anything already in that state alone. */
async function chooseFive(page: Page): Promise<void> {
  await page.evaluate(() => {
    const wanted = ['rooms', 'walls', 'openings', 'placed-items', 'warnings']
    for (const box of document.querySelectorAll<HTMLInputElement>('[data-testid^="export-lists-table-"]')) {
      const want = wanted.includes(box.getAttribute('data-testid')!.slice('export-lists-table-'.length))
      if (box.checked !== want) box.click()
    }
  })
  for (const id of FIVE) await expect(page.getByTestId(`export-lists-table-${id}`)).toBeChecked()
  await expect(page.getByTestId('export-lists-table-items')).not.toBeChecked()
  await expect(page.getByTestId('export-lists-table-cut-list')).not.toBeChecked()
}

/** Press `Export` and wait for the one archive the browser was handed. */
async function runLists(page: Page): Promise<{ name: string; buffer: Buffer }> {
  const pending = page.waitForEvent('download')
  await page.getByTestId('export-lists-run').click()
  const file = await readDownload(await pending)
  await expect(page.getByTestId('export-lists-run')).toHaveCount(0)
  return file
}

/** CSV bytes read back by the contract's own strict reader: the BOM is reported, never eaten. */
function csvRows(buffer: Buffer): readonly (readonly string[])[] {
  const parsed = parseCsv(new Uint8Array(buffer))
  expect(parsed.bom, 'no UTF-8 BOM').toBe(true)
  return parsed.rows
}

function manifestOf(entries: Record<string, Uint8Array>): Manifest {
  return JSON.parse(new TextDecoder().decode(entries['manifest.json'])) as Manifest
}

test('the five tables come back as one archive whose manifest hashes every entry', async ({ page }) => {
  await seedPreviewDb(page, tablesSeed)
  await page.goto('./', { waitUntil: 'networkidle' })
  await openProjectFromLibrary(page, projectName)
  await showFloorPlan(page)
  await openLists(page)

  // Scope 9: the five are offered under the two of #62, in the contract's names.
  const list = page.getByTestId('export-lists-tables')
  for (const id of FIVE) await expect(list).toContainText(LABELS[id])
  // The scope statement is the plain-words sentence of the scope, warnings or no warnings.
  await expect(page.getByTestId('export-lists-statement')).toHaveText(
    describeScope(
      {
        floorIds: [FLOOR_ONE],
        designOptionIds: 'existing-only',
        renovationStates: ['existing', 'demolition', 'proposed'],
        drawingLayers: 'all',
      },
      tablesSeed.projects[0]!.data as never,
    ),
  )

  // The Warnings List is scoped by Floor and Design Option only, so on its own it has nothing for
  // the State and Layer controls to do.
  const only = (id: (typeof FIVE)[number]): Promise<void> =>
    page.evaluate(
      (wanted) => {
        for (const box of document.querySelectorAll<HTMLInputElement>('[data-testid^="export-lists-table-"]')) {
          const want = wanted.includes(box.getAttribute('data-testid')!.slice('export-lists-table-'.length))
          if (box.checked !== want) box.click()
        }
      },
      [id] as string[],
    )
  await only('warnings')
  await expect(page.getByTestId('export-lists-warnings-ignore-scope')).toHaveText(
    STRINGS.exportListsWarningsIgnoreScope,
  )
  await expect(page.getByTestId('export-lists-state-existing')).toBeDisabled()
  await expect(page.getByTestId('export-lists-layers')).toBeDisabled()
  await expect(page.getByTestId(`export-lists-floor-${FLOOR_ONE}`)).toBeEnabled()
  // Combined again, they are live: the Warnings rows ignore them either way, the others need them.
  await page.getByTestId('export-lists-table-rooms').click()
  await expect(page.getByTestId('export-lists-warnings-ignore-scope')).toHaveCount(0)
  await expect(page.getByTestId('export-lists-state-existing')).toBeEnabled()
  // All five, and only the five, whatever order the boxes were ticked in.
  await chooseFive(page)

  const shown = {
    rooms: await rows(page, 'rooms'),
    walls: await rows(page, 'walls'),
    openings: await rows(page, 'openings'),
    'placed-items': await rows(page, 'placed-items'),
    warnings: await rows(page, 'warnings'),
  }
  expect(shown.walls).toBe(7)
  expect(shown.openings).toBe(3)
  expect(shown.rooms).toBe(2)
  expect(shown['placed-items']).toBe(12)
  // One open, one reopened, one acknowledged: all three are rows (§5 — the list is not the strip).
  expect(shown.warnings).toBe(3)

  const file = await runLists(page)
  expect(file.name).toMatch(new RegExp(`^${SLUG}_lists_\\d{8}\\.zip$`))
  const day = /_(\d{8})\.zip$/.exec(file.name)![1]

  const entries = unzipSync(new Uint8Array(file.buffer))
  // The contract's order, whatever order the boxes were ticked in — and nothing else in the archive.
  expect(Object.keys(entries)).toEqual([...FIVE.map((id) => `${SLUG}_${id}_${day}.csv`), 'manifest.json'])

  for (const id of FIVE) {
    const path = `${SLUG}_${id}_${day}.csv`
    const lines = csvRows(Buffer.from(entries[path]!))
    // Criterion 1: the header line is the published v1.0 header, byte for byte.
    expect(lines[0], id).toEqual(headerLine(TABLES[id]).split(','))
    // Criterion 5's other half: the number beside the checkbox and the file agree.
    expect(lines, id).toHaveLength(shown[id] + 1)
    for (const one of lines) expect(one, id).toHaveLength(TABLES[id].columns.length)
  }

  // Criterion 2 and 3, read out of the file the browser was handed rather than a fixture.
  const walls = csvRows(Buffer.from(entries[`${SLUG}_walls_${day}.csv`]!))
  const arc = walls.find((one) => one[10] === 'arc')
  expect(arc, 'no arc Wall in the exported Walls table').toBeDefined()
  expect(arc![12], 'radius_mm').toBe(String(Math.round(ARC * 1000) / 1000))
  expect(arc![11], 'length_mm').toBe('3141.593')
  const openings = csvRows(Buffer.from(entries[`${SLUG}_openings_${day}.csv`]!))
  const openingLine = headerLine(TABLES.openings).split(',')
  const at = (name: string): number => openingLine.indexOf(name)
  const sliding = openings.find((one) => one[at('label')] === 'Kitchen door')
  expect(sliding, 'no sliding kitchen door in the exported Openings table').toBeDefined()
  // Criterion 3: `swing` carries the door's own kind, and a sliding door has no hinge to have a
  // side of, so `hinge_side` is empty rather than invented.
  expect(sliding![at('swing')]).toBe('sliding')
  expect(sliding![at('hinge_side')]).toBe('')
  const items = csvRows(Buffer.from(entries[`${SLUG}_placed-items_${day}.csv`]!))
  expect(items.some((one) => one[16] === 'crosses' && one[14] === '' && one[15] === '')).toBe(true)
  expect(items.some((one) => one[15] === 'Kitchen')).toBe(true)
  // Criterion 3: every element row carries the S7 defaults in the columns #73 will fill.
  for (const one of items.slice(1)) {
    expect(one[3]).toBe('')
    expect(one[4]).toBe('')
    expect(one[5]).toBe('existing')
    expect(one[6]).toBe('')
    expect(one[7]).toBe('Unlayered')
    expect(one[17]).toBe('')
  }

  // The Warnings List: unacknowledged first, the acknowledged one last and carrying its note.
  const warnings = csvRows(Buffer.from(entries[`${SLUG}_warnings_${day}.csv`]!))
  expect(warnings.slice(1).map((one) => one[0])).toEqual(['unacknowledged', 'unacknowledged', 'acknowledged'])
  expect(warnings[3]![12]).toBe('Builder to check')
  // `message` is the strip's own sentence, spelled from the same copy this file reads.
  const sentences = warnings.slice(1).map((one) => one[11])
  expect(sentences.some((one) => one.includes('crosses'))).toBe(true)

  const manifest = manifestOf(entries)
  expect(manifest.format).toBe('buildbox-export')
  expect(manifest.manifest_version).toBe(1)
  expect(manifest.contract_version).toBe('1.0')
  expect([...manifest.recipe.tables].sort()).toEqual([...FIVE].sort())
  const tables = manifest.files.filter((one) => one.kind === 'list')
  expect(tables.map((one) => one.path)).toEqual([...FIVE.map((id) => `${SLUG}_${id}_${day}.csv`)])
  for (const one of tables) {
    const bytes = entries[one.path]!
    expect(one.bytes, one.path).toBe(bytes.length)
    expect(one.sha256, one.path).toBe(createHash('sha256').update(bytes).digest('hex'))
  }
  expect(manifest.files.some((one) => one.kind === 'manifest' && one.path === 'manifest.json')).toBe(true)
})

/** Criterion 7 (seed 19): a Floor with nothing on it is an answer, and the answer is a header. */
test('an empty Floor says 0 rows beside every table and writes five headers', async ({ page }) => {
  await seedPreviewDb(page, tablesSeed)
  await page.goto('./', { waitUntil: 'networkidle' })
  await openProjectFromLibrary(page, projectName)
  await showFloorPlan(page)

  const spare = await addFloor(page)
  await openLists(page)
  await chooseFive(page)

  // Only the new Floor is in scope: the sentence says its name, not `All Floors`.
  await page.getByTestId(`export-lists-floor-${FLOOR_ONE}`).click()
  await expect(page.getByTestId('export-lists-statement')).toContainText(SCOPE.existingOnly)
  await expect(page.getByTestId('export-lists-statement')).not.toContainText(SCOPE.allFloors)
  await expect(page.getByTestId(`export-lists-floor-${spare}`)).toBeChecked()
  for (const id of FIVE) await expect(page.getByTestId(`export-lists-rows-${id}`)).toHaveText('0 rows')

  const file = await runLists(page)
  const entries = unzipSync(new Uint8Array(file.buffer))
  expect(Object.keys(entries).filter((name) => name.endsWith('.csv'))).toHaveLength(FIVE.length)
  for (const id of FIVE) {
    const bytes = entries[Object.keys(entries).find((name) => name.startsWith(`${SLUG}_${id}_`))!]!
    const lines = csvRows(Buffer.from(bytes))
    expect(lines, id).toHaveLength(1)
    expect(lines[0], id).toEqual(headerLine(TABLES[id]).split(','))
  }
})
