/**
 * Seed 3 and Seed 4 of the export contract (#73 criteria 6, 7 and 8).
 *
 * `fixtures/domain/v9/export.json` is the Project the issue's two Lists seeds are named after —
 * `Ground Floor`, the three default layers, four Placed Items on Furniture, and the saved view
 * `Ground Floor · Plan · Demolition` (Option A, Demolition) with Furniture hidden. It is written by
 * `scripts/make-export-seed.ts` out of real Intents, so the four items are in the state a person
 * puts Placed Items into: filed on the layer that is active, on a baseline that was corrected.
 *
 * Criterion 6 is the reason the scope is explicit: a Data export never inherits view hiding, so
 * those four rows are in the file and the dialog says `4 items included that are hidden in this
 * view`. `hiddenInView` is the count behind that sentence, and the refs behind its disclosure.
 *
 * The goldens are the bytes each narrowing writes, committed and never regenerated silently:
 *
 *   UPDATE_GOLDEN=1 npx vitest run --project pure src/test/exportSeed.renovation.test.ts
 *
 * …then read the diff. This file lives in `src/test` for the same reason `tablesGolden.test.ts`
 * does: the Warnings List's sentence is a `ui/strings` value and `export` may not import `ui`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { PlanView, Project } from '../domain'
import { warningMessages } from '../derive'
import type { QuantityScope } from '../derive'
import { defaultListsScope, describeScope, exportLists, hiddenInView } from '../export'
import type { ExportClock, ListsRecipe, TableId } from '../export'
import { warningSentence } from '../ui'

const UPDATE = process.env['UPDATE_GOLDEN'] === '1'
const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const GOLDEN_DIR = join(fixturesRoot, 'export', 'golden')

const project = (
  JSON.parse(readFileSync(join(fixturesRoot, 'domain', 'v9', 'export.json'), 'utf8')) as { project: Project }
).project
const snapshot = { project, revision: 12 }
const CLOCK: ExportClock = { now: () => '2026-11-23T09:30:00.000Z', localDate: () => '2026-11-23' }

const floorId = project.floors[0]!.id
const view = project.views.find((each) => each.name === 'Ground Floor · Plan · Demolition') as PlanView
const layerId = (name: string): string =>
  project.drawingLayers?.find((layer) => layer.name === name)?.id ?? `no layer named ${name}`

/** The scope the dialog opens with for that view: every Floor, its Option, every State, every Layer. */
const fromView = (): QuantityScope => defaultListsScope(project, view)

const scopeOf = (over: Partial<QuantityScope> = {}): QuantityScope => ({ ...fromView(), ...over })

/** One CSV line, quotes and all: a label with a comma in it is one field, not two. */
function splitLine(line: string): string[] {
  const fields: string[] = []
  let at = 0
  while (at < line.length) {
    if (line[at] === '"') {
      const end = line.indexOf('",', at + 1)
      if (end === -1) {
        fields.push(line.slice(at + 1, -1))
        return fields
      }
      fields.push(line.slice(at + 1, end))
      at = end + 2
    } else {
      const end = line.indexOf(',', at)
      if (end === -1) {
        fields.push(line.slice(at))
        return fields
      }
      fields.push(line.slice(at, end))
      at = end + 1
    }
  }
  return fields
}

/** One table's bytes, as the writer puts them in the ZIP, plus the rows read back by header. */
async function csvOf(table: TableId, scope: QuantityScope): Promise<{ bytes: string; rows: Record<string, string>[] }> {
  const recipe: ListsRecipe = { tables: [table], scope }
  const result = await exportLists(snapshot, recipe, {
    clock: CLOCK,
    buildboxVersion: '0.0.0-test',
    warningMessages: warningMessages(project, scope, warningSentence),
  })
  if (!result.ok) throw new Error(result.failures.map((each) => each.reason).join(', '))
  if (result.kind !== 'single') throw new Error('expected one file')
  const text = new TextDecoder().decode(result.file.bytes)
  const [header, ...lines] = text.replace(/^/, '').trimEnd().split('\n')
  const keys = splitLine(header!)
  return {
    bytes: text,
    rows: lines.map((line) => {
      const values = splitLine(line)
      const row: Record<string, string> = {}
      keys.forEach((key, index) => (row[key] = values[index] ?? ''))
      return row
    }),
  }
}

function golden(name: string, text: string): void {
  const file = join(GOLDEN_DIR, `${name}.csv`)
  if (UPDATE) {
    mkdirSync(GOLDEN_DIR, { recursive: true })
    writeFileSync(file, text)
  }
  expect(readFileSync(file, 'utf8'), name).toBe(text)
}

const column = (rows: readonly Record<string, string>[], key: string): string[] => rows.map((row) => row[key]!)

/** The four Placed Items the seed puts on Furniture, by the name their Design carries. */
const FOUR = ['Base 600', 'Base 600′', 'Fridge', 'Island']

describe('Seed 3: a Data export never inherits view hiding (#73 criterion 6)', () => {
  const scope = scopeOf()

  it('exports the four Placed Items the view hides', async () => {
    const { bytes, rows } = await csvOf('placed-items', scope)
    const furniture = rows.filter((row) => row['drawing_layer'] === 'Furniture')
    expect(column(furniture, 'item_design').sort()).toEqual(FOUR)
    expect(furniture.length).toBe(4)
    golden('seed3-placed-items', bytes)
  })

  it('counts them in the Item List too, and the two tables agree', async () => {
    const list = await csvOf('items', scope)
    const placed = await csvOf('placed-items', scope)
    // The Item List has no Drawing Layer column (#19 §7: one row per Floor × Option × State ×
    // Item Design), so it is checked against the table it counts: the same number of standing
    // Placed Items per design, and the seed's four designs present under Option A.
    const standing = (design: string): number =>
      placed.rows.filter((row) => row['item_design'] === design && row['renovation_state'] === 'existing').length
    for (const design of FOUR) {
      const row = list.rows.find((each) => each['item_design'] === design && each['renovation_state'] === 'existing')
      expect(row, design).toBeDefined()
      expect(row?.['count'], design).toBe(String(standing(design)))
    }
    expect(FOUR.map((design) => standing(design)).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(4)
    golden('seed3-items', list.bytes)
  })

  it('reports exactly those four as hidden in the view, and nothing else', async () => {
    const hidden = hiddenInView(project, scope, view)
    expect(hidden.count).toBe(4)
    // The disclosure lists what the table printed, so the two cannot disagree about a label.
    const { rows } = await csvOf('placed-items', scope)
    const labels = rows
      .filter((row) => row['drawing_layer'] === 'Furniture')
      .map((row) => row['label']!)
      .sort()
    expect([...hidden.refs].sort()).toEqual(labels)
    // The same scope with the layer back in view hides nothing: the count belongs to the view, not
    // to the Project, which is why the notice is informational and never blocks the download.
    expect(hiddenInView(project, scope, { ...view, layerSettings: {} }).count).toBe(0)
    expect(hiddenInView(project, scope, null).count).toBe(0)
  })
})

describe('Seed 4: each narrowing changes the rows and the statement (#73 criterion 7)', () => {
  it('names the scope it opened with, in plain words', () => {
    expect(describeScope(scopeOf(), project)).toBe(
      'All Floors · Option A · Open kitchen · Existing, Demolition, Proposed · all layers incl. Unlayered',
    )
    expect(describeScope(scopeOf({ designOptionIds: 'existing-only' }), project)).toBe(
      'All Floors · Existing Model only · Existing, Demolition, Proposed · all layers incl. Unlayered',
    )
  })

  it('narrows Floors to Ground Floor', async () => {
    const scope = scopeOf({ floorIds: [floorId] })
    // The seed has one Floor, so `Ground Floor` IS every Floor and the statement still reads
    // `All Floors` — which is the honest sentence, not a missed narrowing. The rows are the same
    // file, and that is the whole of what a one-Floor Project can show for this control.
    expect(describeScope(scope, project)).toBe(
      'All Floors · Option A · Open kitchen · Existing, Demolition, Proposed · all layers incl. Unlayered',
    )
    const { bytes, rows } = await csvOf('walls', scope)
    expect(new Set(column(rows, 'floor'))).toEqual(new Set(['Ground Floor']))
    golden('seed4-floors-walls', bytes)
  })

  it('narrows Option to Option B', async () => {
    const scope = scopeOf({ designOptionIds: ['option-b'] })
    expect(describeScope(scope, project)).toBe(
      'All Floors · Option B · Widened opening · Existing, Demolition, Proposed · all layers incl. Unlayered',
    )
    const { bytes, rows } = await csvOf('walls', scope)
    expect(new Set(column(rows, 'design_option'))).toEqual(new Set(['Option B · Widened opening']))
    expect(column(rows, 'renovation_state')).toContain('demolition')
    golden('seed4-option-walls', bytes)
  })

  it('narrows States to Proposed', async () => {
    const scope = scopeOf({ renovationStates: ['proposed'] })
    expect(describeScope(scope, project)).toContain('· Proposed · all layers incl. Unlayered')
    const { bytes, rows } = await csvOf('placed-items', scope)
    expect(new Set(column(rows, 'renovation_state'))).toEqual(new Set(['proposed']))
    golden('seed4-states-placed-items', bytes)
  })

  it('narrows Layers to Structure', async () => {
    const scope = scopeOf({ drawingLayers: { layerIds: [layerId('Structure')], includeUnlayered: false } })
    expect(describeScope(scope, project)).toContain('· Structure')
    const { bytes, rows } = await csvOf('walls', scope)
    expect(rows.length).toBeGreaterThan(0)
    expect(new Set(column(rows, 'drawing_layer'))).toEqual(new Set(['Structure']))
    golden('seed4-layers-walls', bytes)
  })
})

describe('Seed 5: the comparison modes (#73 criterion 8)', () => {
  it('repeats each Existing row once per Option, with the Option named', async () => {
    const scope = scopeOf({ designOptionIds: ['option-a', 'option-b'] })
    expect(describeScope(scope, project)).toContain('(compared)')
    const { bytes, rows } = await csvOf('walls', scope)
    const existingOf = (optionId: string): string[] =>
      rows
        .filter((row) => row['design_option_id'] === optionId && row['renovation_state'] === 'existing')
        .map((row) => row['stable_id']!)
        .sort()
    const underA = existingOf('option-a')
    expect(underA.length).toBeGreaterThan(0)
    expect(existingOf('option-b')).toEqual(underA)
    golden('seed5-compared-walls', bytes)
  })

  it('leaves the Option columns empty for the Existing Model only', async () => {
    const scope = scopeOf({ designOptionIds: 'existing-only' })
    expect(describeScope(scope, project)).toContain('Existing Model only')
    const { bytes, rows } = await csvOf('walls', scope)
    expect(rows.length).toBeGreaterThan(0)
    expect(new Set(column(rows, 'design_option'))).toEqual(new Set(['']))
    expect(new Set(column(rows, 'design_option_id'))).toEqual(new Set(['']))
    expect(new Set(column(rows, 'renovation_state'))).toEqual(new Set(['existing']))
    golden('seed5-existing-only-walls', bytes)
  })
})
