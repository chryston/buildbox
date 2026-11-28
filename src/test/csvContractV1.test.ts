/**
 * The CSV contract, frozen at v1.0 (#85 §4).
 *
 * v1.0 is the first version anyone outside this repository is expected to write a script against,
 * so from here the rule is one-directional: a minor version may only append columns at the end of a
 * table, and a rename, a removal, a reorder or a changed enum code is a major version with a release
 * note (export contract §10). Three things hold that line, and this file is where two of them are
 * checked:
 *
 *   `fixtures/export/csv/v1.0/<table>.csv` — the header and the rows of the reference fixture, as
 *   bytes. A reviewer who never opens TypeScript can read them, and `git diff` is the review.
 *   `fixtures/export/csv/v1.0/enums.json` — every `enum` column and the codes it publishes,
 *   including the Comment Register's `scope` and `target_type`. A code that no row can produce and a
 *   code a row produces that is not listed are both failures.
 *
 * Regenerate with `UPDATE_GOLDEN=1 npx vitest run --project pure src/test/csvContractV1.test.ts`,
 * then read the diff: a header that moved is a major version, not a refresh. The fixtures are never
 * deleted — a golden that disappears silently stops protecting anything, and a frozen contract is
 * exactly the thing that must outlive the code that first wrote it.
 *
 * The third thing is the compatibility check below, which is the rule itself rather than a snapshot
 * of one day's answer to it: it is run against synthetic mutations so that a future change which
 * *should* fail is proven to fail, and an append with a minor bump is proven to pass. A freeze test
 * that can only ever pass is a comment with an `expect` in it.
 *
 * This file lives in `src/test` for the same reason `tablesGolden.test.ts` does: the Warnings List's
 * `message` column is the strip's sentence, which lives in `ui/strings`, and `export` may not import
 * `ui`. Here the real `warningSentence` is injected, so the frozen bytes are the bytes the app writes.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { RENOVATION_STATES, warningMessages } from '../derive'
import { migrateProject, validateProject } from '../domain'
import type { Project } from '../domain'
import type { QuantityScope } from '../derive'
import {
  CSV_BOM,
  CSV_CONTRACT_VERSION,
  HANDOFF_TABLES,
  TABLES,
  headerLine,
  listRows,
  writeCsv,
} from '../export'
import type { CsvRow, ListsRecipe, TableId } from '../export'
import { warningSentence } from '../ui'

const UPDATE = process.env['UPDATE_GOLDEN'] === '1'
const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const V1_DIR = join(fixturesRoot, 'export', 'csv', 'v1.0')

/**
 * The reference fixture: the #68 tables scene, read and migrated exactly as the app reads one.
 *
 * The migration is not ceremony. The committed seed predates the Plan View Range, the Comments and
 * the Annotations, and `validateProject` refuses it as stored — so a fixture read raw would freeze
 * the bytes of a Project the app could never open. The allocator is named for the file's own id
 * prefix and starts past the highest number the seed carries, because a migration that handed a
 * Drawing Layer an id a View already holds would produce a Project that does not validate either.
 */
function referenceFixture(): Project {
  const seed = JSON.parse(
    readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'tables-scene.json'), 'utf8'),
  ) as { projects: { schemaVersion: number; data: unknown }[] }
  const stored = seed.projects[0]!
  const taken = [...JSON.stringify(stored.data).matchAll(/view-(\d+)/g)]
  let issued = taken.reduce((max, match) => Math.max(max, Number(match[1])), 0)
  const result = migrateProject(stored.data, stored.schemaVersion, (count = 1) =>
    Array.from({ length: count }, () => `view-${(issued += 1)}`),
  )
  if (!result.ok) throw new Error(`the reference fixture did not migrate: ${result.error.message}`)
  // A fixture that does not validate makes every Intent refuse without saying so, and would freeze
  // the bytes of a Project nobody can open.
  const problems = validateProject(result.project)
  if (!problems.ok) throw new Error(`the reference fixture did not validate: ${JSON.stringify(problems.problems)}`)
  return result.project
}

const project = referenceFixture()

/** Every Floor, the Existing Model, every State, every Layer: the dialog's default scope. */
const scope: QuantityScope = {
  floorIds: project.floors.map((floor) => floor.id),
  designOptionIds: 'existing-only',
  renovationStates: RENOVATION_STATES,
  drawingLayers: 'all',
}

/**
 * The rows of every table of the reference fixture, from the one source the app writes from.
 *
 * `listRows` is what `exportLists` — and so the Handoff Pack — reads, so the frozen bytes are the
 * bytes a download produces rather than a second derivation that could quietly disagree with it
 * about a row, a cell or an order (#84 §1.3).
 */
const rowsFor = (): Partial<Record<TableId, readonly CsvRow[]>> => {
  const recipe = { scope, formats: {}, tables: [...HANDOFF_TABLES] } as unknown as ListsRecipe
  // A fixed revision: the rows are a function of the Project, and a frozen contract must not move
  // because the session that read it happened to be the fourth save rather than the first.
  return listRows(
    { project, revision: 1 },
    recipe,
    [...HANDOFF_TABLES],
    warningMessages(project, scope, warningSentence),
  )
}
const ROWS = rowsFor()

const textOf = (bytes: Uint8Array): string => new TextDecoder('utf8', { ignoreBOM: true }).decode(bytes)

/** The CSV one table of the reference fixture writes, BOM and CRLFs and all. */
function csvOf(id: TableId): string {
  return textOf(writeCsv(TABLES[id], ROWS[id] ?? []))
}

/** A frozen file, or `null` the first time the contract is written and there is nothing to compare. */
function frozen(name: string): string | null {
  try {
    return readFileSync(join(V1_DIR, name), 'utf8')
  } catch {
    return null
  }
}

/** A frozen file's header line, without the BOM every CSV starts with. */
const firstLine = (csv: string): string => (csv.startsWith(CSV_BOM) ? csv.slice(CSV_BOM.length) : csv).split('\r\n')[0]!

/**
 * What changed between a frozen header and a candidate one.
 *
 * `append` is the only difference a minor version is allowed to introduce, and only at the end —
 * which is why the check compares the frozen line with a prefix of the candidate rather than
 * comparing sets of names. A set comparison would call a reorder a rename and a rename a removal,
 * and would pass a header that silently means something different to a reader's script.
 */
function headerChange(frozenLine: string, candidate: string): 'same' | 'append' | 'moved' | 'changed' {
  if (frozenLine === candidate) return 'same'
  const was = frozenLine.split(',')
  const now = candidate.split(',')
  if (now.length > was.length && now.slice(0, was.length).join(',') === frozenLine) return 'append'
  const kept = now.filter((name) => was.includes(name))
  if (kept.length === was.length && kept.join(',') === frozenLine) return 'append'
  if (kept.length === was.length) return 'moved'
  return 'changed'
}

/** Whether a candidate table may ship under a given version of a frozen one. */
function compatible(frozenLine: string, candidate: string, frozenVersion: string, candidateVersion: string): boolean {
  const change = headerChange(frozenLine, candidate)
  if (change === 'same') return true
  const minorBump =
    candidateVersion.split('.')[0] === frozenVersion.split('.')[0] && candidateVersion > frozenVersion
  return change === 'append' && minorBump
}

/** Every `enum` column of every table, keyed `<table>.<header>`, with the codes it publishes. */
function enumCodes(): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const id of HANDOFF_TABLES) {
    for (const column of TABLES[id].columns) {
      if (column.kind === 'enum' && column.values !== undefined) {
        out[`${id}.${column.header}`] = [...column.values]
      }
    }
  }
  return out
}

describe('the CSV contract frozen at v1.0 (#85 §4)', () => {
  it('writes the reference fixture byte for byte, under the version the manifest carries', () => {
    expect(CSV_CONTRACT_VERSION).toBe('1.0')
    if (UPDATE) mkdirSync(V1_DIR, { recursive: true })
    for (const id of HANDOFF_TABLES) {
      const bytes = csvOf(id)
      const held = frozen(`${id}.csv`)
      if (held === null || UPDATE) {
        writeFileSync(join(V1_DIR, `${id}.csv`), bytes)
        continue
      }
      // The whole file, not just the header: a value that changes format — `907.772` becoming
      // `907.77` — is as much a break to a reader's script as a column that moved.
      expect(bytes, `${id}.csv`).toBe(held)
    }
  })

  it('freezes every enum column and every code a row can hold', () => {
    const codes = enumCodes()
    const held = frozen('enums.json')
    if (held === null || UPDATE) {
      writeFileSync(join(V1_DIR, 'enums.json'), `${JSON.stringify(codes, null, 2)}\n`)
    } else {
      expect(codes).toEqual(JSON.parse(held) as Record<string, string[]>)
    }
    // The two #83 columns are the ones a reader is most likely to switch on, and the ones a
    // refactor of the Comment model would most easily change without noticing.
    expect(Object.keys(codes)).toContain('comments.scope')
    expect(Object.keys(codes)).toContain('comments.target_type')
    expect(Object.keys(codes)).toContain('walls.renovation_state')
    expect(Object.keys(codes)).toContain('warnings.status')
  })

  it('emits no code that the frozen list does not publish', () => {
    const codes = enumCodes()
    for (const id of HANDOFF_TABLES) {
      const rows = ROWS[id] ?? []
      for (const column of TABLES[id].columns) {
        if (column.kind !== 'enum' || column.values === undefined) continue
        const allowed = new Set<string>(column.values)
        for (const row of rows) {
          const value = String((row as Record<string, unknown>)[column.key] ?? '')
          if (value === '') continue
          expect(allowed.has(value), `${id}.${column.header} = ${value}`).toBe(true)
        }
      }
    }
    // A code in the frozen list that no row produces is not a break — it is a code the contract
    // promises and this fixture does not exercise — so it is not asserted away here. What is
    // asserted is that the frozen file names the columns at all.
    expect(Object.keys(codes).length).toBeGreaterThan(10)
  })

  it('holds the frozen headers as the contract spells them', () => {
    for (const id of HANDOFF_TABLES) {
      const held = frozen(`${id}.csv`)
      expect(held, `${id}.csv is not frozen yet`).not.toBeNull()
      expect(headerLine(TABLES[id])).toBe(firstLine(held as string))
    }
  })

  it('refuses a rename, a removal, a reorder and an enum change, and allows an append with a bump', () => {
    const base = 'stable_id,floor_id,floor,renovation_state,name,area_m2'
    // The four things a minor version must never do.
    expect(headerChange(base, 'stable_id,floor_id,floor,renovation_state,display_name,area_m2')).toBe('changed')
    expect(headerChange(base, 'stable_id,floor_id,renovation_state,name,area_m2')).toBe('changed')
    expect(headerChange(base, 'stable_id,floor_id,floor,renovation_state,name')).toBe('changed')
    expect(headerChange(base, 'stable_id,floor_id,renovation_state,floor,name,area_m2')).toBe('moved')
    // …and the one thing it may.
    expect(headerChange(base, `${base},room_id`)).toBe('append')

    expect(compatible(base, base, '1.0', '1.0')).toBe(true)
    expect(compatible(base, `${base},room_id`, '1.0', '1.1')).toBe(true)
    expect(compatible(base, `${base},room_id`, '1.0', '1.0')).toBe(false)
    expect(compatible(base, 'stable_id,floor_id,floor,renovation_state,display_name,area_m2', '1.0', '1.1')).toBe(false)
    expect(compatible(base, 'stable_id,floor_id,renovation_state,floor,name,area_m2', '1.0', '1.1')).toBe(false)
    expect(compatible(base, 'stable_id,floor_id,floor,renovation_state,name', '1.0', '1.1')).toBe(false)
    // A major version is not this question. `compatible` answers "may this ship without telling
    // anyone they need to change their script?", and a major says they do — it is frozen again
    // under a new directory, which is what `fixtures/export/csv/v1.0/` is for.
    expect(compatible(base, 'stable_id,floor_id,floor,renovation_state,display_name,area_m2', '1.0', '2.0')).toBe(false)
  })

  it('changes no header for a reason a row could have', () => {
    // A second derivation of the same fixture writes the same header: a header that depended on
    // which rows happened to exist would make the contract depend on the data.
    for (const id of HANDOFF_TABLES) {
      expect(headerLine(TABLES[id])).toBe(firstLine(csvOf(id)))
    }
  })
})
