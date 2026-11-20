/**
 * The Cut List is the legacy Cut List, for every cabinet the legacy corpus holds (#62 criterion 6).
 *
 * `cutListParts` claims to be a rename of `computeCutListForUnits` and nothing more. That claim is
 * only worth what the fixtures make it worth, so this walks the same corpus `#43`'s parity test
 * walks — every legacy file that converts cleanly — and for every cabinet unit in it compares the
 * migrated Item Design's rows against the rows the legacy unit produced, at the tolerance the
 * issue states: 0.001 mm.
 *
 * Countertop parity is not asserted, because there is nothing to assert it against: no countertop
 * cut list exists to be wrong (#20 §15.2), and `computeCutListForUnits` answers nothing for a
 * non-cabinet unit. The corpus is checked for that instead, so the day a countertop arrives in a
 * legacy file this test says the comparison has become possible rather than quietly skipping it.
 *
 * It lives in `derive` with an eslint element of its own rather than in `test-support`, because
 * the file is the boundary claim: `derive` may import `cabinet` and `domain`, and this is the one
 * place in `derive` that also reaches `package`, to build the legacy side to compare against.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { computeCutListForUnits } from '../../cabinet'
import type { CabinetItemDesign, Project } from '../../domain'
import { convertLegacy, upgradeLegacyDesign, type LegacyDesign } from '../../package'
import { cutListParts } from '../index'

const fixturesRoot = fileURLToPath(new URL('../../../fixtures/legacy', import.meta.url))
const read = (rel: string): string => readFileSync(join(fixturesRoot, rel), 'utf8')
const listed = (dir: string, suffix: string): string[] =>
  readdirSync(join(fixturesRoot, dir)).filter((name) => name.endsWith(suffix)).sort().map((name) => `${dir}/${name}`)

/** Fresh ids in a stable order, so a failure says the same thing on the next run. */
const allocator = (): (() => string) => {
  let issued = 0
  return () => `gen-${++issued}`
}

const SOURCES = [
  'v0/buildbox-store.json',
  'v1/buildbox-store.json',
  'v2/buildbox-store.json',
  'v3/buildbox-store.json',
  'v3-large-image/buildbox-store.json',
  'migration-review/buildbox-store.json',
  'sketches/buildbox-store.json',
  ...listed('workspace', '.buildbox.json'),
]

/** The Designs a legacy source holds, in the vocabulary `computeCutListForUnits` speaks. */
function legacyDesigns(rel: string): LegacyDesign[] {
  const source = JSON.parse(read(rel)) as unknown
  const record = (value: unknown): Record<string, unknown> | null =>
    typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  const root = record(source)
  if (root === null) throw new Error(`${rel}: not an object`)
  if (Array.isArray(root.projects)) return root.projects.map((design) => upgradeLegacyDesign(design, allocator())) as LegacyDesign[]
  const state = record(root.state)
  const projects = state === null || !Array.isArray(state.projects) ? [] : state.projects
  return projects.map((design) => upgradeLegacyDesign(design, allocator())) as LegacyDesign[]
}

/** The Projects a legacy source converted cleanly, keyed as the converter keyed them. */
async function projectsOf(rel: string): Promise<Map<string, Project>> {
  const result = await convertLegacy(read(rel), { newId: allocator() })
  if (!result.ok) throw new Error(`${rel}: ${JSON.stringify(result.problems)}`)
  return new Map(
    result.conversion.projects
      .filter((proposal) => proposal.status === 'ok')
      .map((proposal) => [proposal.designId, proposal.project]),
  )
}

/** One row, as the contract spells it, with the three sizes sorted so a rename cannot hide. */
function rowOf(part: string, material: string, qty: number, notes: string, sizes: readonly number[]): string[] {
  return [part, material, String(qty), notes, ...[...sizes].sort((a, b) => a - b).map((each) => each.toFixed(4))]
}

const TOLERANCE = 0.001

describe.each(SOURCES)('Cut List parity: %s (#62 criterion 6)', (rel) => {
  it('is the legacy Cut List of the unit it came from, to within 0.001 mm', async () => {
    const projects = await projectsOf(rel)
    let compared = 0
    for (const design of legacyDesigns(rel)) {
      const project = projects.get(design.id)
      if (project === undefined) continue // This Design did not convert to a Project of its own.
      for (const unit of design.units) {
        const migrated = project.itemDesigns.find((each) => each.id === unit.id)
        if (migrated === undefined) continue // The converter gave this unit no Item Design.
        expect(migrated.kind, `${rel} · ${design.id} · ${unit.id}: expected a cabinet Design`).toBe('cabinet')
        const legacy = computeCutListForUnits([unit])
        const parts = cutListParts(migrated as CabinetItemDesign, 1)
        expect(parts.length, `${rel} · ${unit.id}: row count`).toBe(legacy.length)
        // The order is the legacy order: the list groups by unit, and one unit is one group.
        expect(parts.map((part) => part.part), `${rel} · ${unit.id}: part order`).toEqual(legacy.map((each) => each.label))
        parts.forEach((part, index) => {
          const entry = legacy[index]!
          const label = `${rel} · ${unit.id} · ${entry.label}`
          expect(part.qtyPerItem, `${label}: qty`).toBe(entry.qty)
          expect(part.material, `${label}: material`).toBe(entry.material)
          expect(part.notes, `${label}: notes`).toBe(entry.notes ?? '')
          // The triple is compared unordered: `length_mm` is the longer of the legacy pair, which
          // is a rename and not a recalculation, and a tolerance is the issue's own.
          const ours = [part.lengthMm, part.widthMm, part.thicknessMm].sort((a, b) => a - b)
          const theirs = [entry.width, entry.height, entry.depth].sort((a, b) => a - b)
          ours.forEach((value, at) => {
            const want = theirs[at]!
            expect(Math.abs(value - want), `${label}: size ${String(at)} ${String(value)} vs ${String(want)}`).toBeLessThanOrEqual(
              TOLERANCE,
            )
          })
          expect(rowOf(part.part, part.material, part.qtyPerItem, part.notes, ours)).toEqual(
            rowOf(entry.label, entry.material, entry.qty, entry.notes ?? '', theirs),
          )
          compared += 1
        })
      }
    }
    expect(compared, `${rel}: no cabinet unit to compare`).toBeGreaterThan(0)
  })

  it('holds nothing but cabinets, so countertop parity stays not applicable', () => {
    for (const design of legacyDesigns(rel)) {
      for (const unit of design.units) expect(unit.type).toBe('cabinet')
    }
  })
})
