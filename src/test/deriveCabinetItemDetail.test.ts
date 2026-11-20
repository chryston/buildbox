/**
 * The derived cabinet Item Detail is the cabinet canvas's own scene, for every cabinet the
 * legacy corpus holds (#60 criterion 5).
 *
 * `src/derive/effective.test.ts` proves the same thing over the domain fixtures; this is the
 * walk the criterion actually asks for, because a cabinet only has to survive the renderer
 * switch as it arrives out of a legacy file — with the node tree, settings and unit IDs the
 * converter gave it, which is where a projection would be most likely to lose something.
 *
 * The comparison is the one the criterion states: `effectiveItemDetail`'s layout against
 * `computeSceneLayout` over the same `cabinetSceneUnits`, deep-equal, with the shown design the
 * active unit. Nothing is compared at a tolerance and nothing is re-projected by hand, so the
 * test fails the moment `derive` starts inventing a scene instead of asking `cabinet` for one.
 *
 * It lives here rather than in `src/derive` because `derive` may not import `package`, and only
 * `test-support` is allowed to hold the legacy converter and the derived surface in one scope.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { computeSceneLayout } from '../cabinet'
import { cabinetSceneUnits, effectiveItemDetail } from '../derive'
import type { Project } from '../domain'
import { convertLegacy } from '../package'

const fixturesRoot = fileURLToPath(new URL('../../fixtures/legacy', import.meta.url))
const read = (rel: string): string => readFileSync(join(fixturesRoot, rel), 'utf8')
const listed = (dir: string, suffix: string): string[] =>
  readdirSync(join(fixturesRoot, dir)).filter((name) => name.endsWith(suffix)).sort().map((name) => `${dir}/${name}`)

/** Fresh ids in a stable order, so a failure says the same thing on the next run. */
const allocator = (): (() => string) => {
  let issued = 0
  return () => `gen-${++issued}`
}

/** Every store envelope and workspace file the corpus holds, as `parity.test.ts` lists them. */
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

/** The Projects a legacy source converted cleanly, in the order the converter proposed them. */
async function projectsOf(rel: string): Promise<Project[]> {
  const result = await convertLegacy(read(rel), { newId: allocator() })
  if (!result.ok) throw new Error(`${rel}: ${JSON.stringify(result.problems)}`)
  return result.conversion.projects
    .filter((proposal) => proposal.status === 'ok')
    .map((proposal) => proposal.project)
}

describe.each(SOURCES)('derived cabinet Item Detail: %s (#60 criterion 5)', (rel) => {
  it('is the very layout computeSceneLayout gives the same cabinetSceneUnits', async () => {
    let compared = 0
    for (const project of await projectsOf(rel)) {
      for (const floor of project.floors) {
        const units = cabinetSceneUnits(project, floor.id)
        // One case per design: two placements of one design share a scene unit id, and the
        // scene is the Floor's, so the comparison would be repeated identically.
        for (const designId of new Set(units.map((unit) => unit.id))) {
          const label = `${rel} · ${project.meta.name} · ${floor.name} · ${designId}`
          const detail = effectiveItemDetail(project, 1, designId, floor.id)
          if (detail.kind !== 'cabinet') throw new Error(`${label}: expected a cabinet Item Detail`)
          expect(detail.designId, label).toBe(designId)
          expect(detail.layout, label).toEqual(computeSceneLayout(units, designId))
          expect(detail.layout.units, label).toHaveLength(units.length)
          expect(detail.layout.units.filter((unit) => unit.isActive).length, label).toBe(
            units.filter((unit) => unit.id === designId).length,
          )
          compared += 1
        }
      }
    }
    // Not a vacuous walk: a source whose cabinets stopped converting would pass every
    // comparison above by making none of them.
    expect(compared, rel).toBeGreaterThan(0)
  })
})
