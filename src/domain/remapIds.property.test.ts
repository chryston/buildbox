/// <reference types="vite/client" />
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { CabinetNode, EntityId, IdAllocator, Project } from './index'
import { remapIds, validateProject } from './index'
import { arbProject } from './testing'

/**
 * What #50 promises about an imported copy: every entity ID in it is new, every reference
 * still resolves, and nothing but the IDs moved.
 *
 * The walk is restated below, independently of the implementation, because the properties
 * need the ID list to name the map the function owes them. Restating it is the point: a
 * walk that quietly stopped collecting a field makes the two disagree, which is the only
 * way such a bug is visible from outside `domain`.
 */

// --- The walk, restated -------------------------------------------------------

/** Every entity ID a Project carries, in the order `remapIds` documents. */
function entityIds(project: Project): EntityId[] {
  const ids: EntityId[] = [project.id]
  for (const floor of project.floors) ids.push(floor.id)
  for (const view of project.views) ids.push(view.id)
  for (const design of project.itemDesigns) {
    ids.push(design.id)
    if (design.kind === 'cabinet') collectSpace(design.construction.root, ids)
  }
  for (const item of project.existingModel.placedItems) ids.push(item.id)
  return ids
}

/** A space, the boards and hardware it carries, then its left space, then its right. */
function collectSpace(node: CabinetNode, ids: EntityId[]): void {
  ids.push(node.id)
  for (const divider of node.dividers ?? []) ids.push(divider.id)
  for (const accessory of node.accessories ?? []) ids.push(accessory.id)
  if (node.children !== undefined) {
    collectSpace(node.children[0], ids)
    collectSpace(node.children[1], ids)
  }
}

// --- The allocator ------------------------------------------------------------

/** The identity the caller brings for the copy, as different as it can be from a generated one. */
const NEW_ID = 'imported-project'

/** `count` IDs in allocation order, none of which `arbProject()` ever produces. */
const allocateFresh: IdAllocator = (count) =>
  Array.from({ length: count }, (_, index) => `fresh-${index}`)

/** The map the contract describes: walk order, slot 0 filled by the caller's `newId`. */
function contractedMap(
  walk: readonly EntityId[],
  fresh: readonly EntityId[],
  newId: EntityId,
): Map<EntityId, EntityId> {
  const map = new Map<EntityId, EntityId>([[walk[0], newId]])
  walk.forEach((id, index) => {
    if (!map.has(id)) map.set(id, fresh[index])
  })
  return map
}

/** The keys that hold an entity ID or a reference to one, and nothing else. */
const ID_FIELDS: readonly string[] = ['id', 'itemDesignId', 'floorId']

/**
 * The Project with every ID-bearing key removed, key for key otherwise: what a copy must
 * not have changed.
 */
function withoutIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutIds)
  if (typeof value !== 'object' || value === null) return value
  const kept = Object.entries(value as Record<string, unknown>).filter(([key]) => !ID_FIELDS.includes(key))
  return Object.fromEntries(kept.map(([key, child]) => [key, withoutIds(child)]))
}

/** Every string the copy still carries that the original used as one of its IDs. */
function survivors(value: unknown, original: ReadonlySet<EntityId>): string[] {
  if (typeof value === 'string') return original.has(value) ? [value] : []
  if (Array.isArray(value)) return value.flatMap((item) => survivors(item, original))
  if (typeof value !== 'object' || value === null) return []
  return Object.values(value).flatMap((child) => survivors(child, original))
}

describe('remapIds — properties (#50)', () => {
  it('hands every entity a fresh ID and moves nothing else', () => {
    fc.assert(
      fc.property(arbProject(), (project) => {
        fc.pre(validateProject(project).ok)
        const walk = entityIds(project)
        const fresh = allocateFresh(walk.length)
        const remapped = remapIds(project, NEW_ID, () => fresh)
        const map = contractedMap(walk, fresh, NEW_ID)

        // Identity: the copy answers to the ID the caller brought.
        expect(remapped.id).toBe(NEW_ID)

        // Bijection: one new ID per distinct old one, and the output set is exactly the
        // image of the input set under the map.
        const out = entityIds(remapped)
        expect(new Set(out).size).toBe(new Set(walk).size)
        expect(new Set(out)).toEqual(new Set(map.values()))
        expect(new Set(map.values()).size).toBe(new Set(walk).size)

        // Freshness: no ID the input used survives anywhere in the copy.
        const original = new Set(walk)
        expect(out.filter((id) => original.has(id))).toEqual([])

        // Nothing else moved: spending the original IDs in the same walk positions is the
        // inverse map, applied by the function under test rather than by this file.
        expect(remapIds(remapped, project.id, () => walk)).toEqual(project)
      }),
      { numRuns: 300 },
    )
  })

  it('keeps every reference resolving', () => {
    fc.assert(
      fc.property(arbProject(), (project) => {
        fc.pre(validateProject(project).ok)
        const remapped = remapIds(project, NEW_ID, allocateFresh)
        const result = validateProject(remapped)
        expect(result.ok ? [] : result.problems).toEqual([])

        const designIds = new Set(remapped.itemDesigns.map((design) => design.id))
        const floorIds = new Set(remapped.floors.map((floor) => floor.id))
        for (const item of remapped.existingModel.placedItems) {
          expect(designIds.has(item.itemDesignId)).toBe(true)
          expect(floorIds.has(item.floorId)).toBe(true)
        }
      }),
      { numRuns: 300 },
    )
  })

  it('carries every non-ID field over unchanged', () => {
    fc.assert(
      fc.property(arbProject(), (project) => {
        fc.pre(validateProject(project).ok)
        const remapped = remapIds(project, NEW_ID, allocateFresh)

        // Everything that is not an ID: `meta`, `preferences`, each Floor's name and Plan
        // Image, each design's name, footprint, origin, height, color and `catalogKey`, a
        // cabinet's `construction.settings` with its `material`, every `Divider.materialId`
        // and `Accessory.label`, and each placement's geometry.
        expect(withoutIds(remapped)).toEqual(withoutIds(project))
      }),
      { numRuns: 300 },
    )
  })
})

// --- The reference Project ----------------------------------------------------

// The same way `src/domain/fixtures.test.ts` reads them: the fixture is JSON on disk, and
// `fixtures/domain/v3` is generated by `scripts/make-reference-project.ts`. The current
// schema is the one a copy is taken of, so this is the file the walk has to cover.
const SOURCES = import.meta.glob<string>('/fixtures/domain/v3/reference-project.json', {
  eager: true,
  query: '?raw',
  import: 'default',
})
const raw = Object.values(SOURCES)[0]
if (raw === undefined) throw new Error('fixtures/domain/v3/reference-project.json is missing')
const envelope = JSON.parse(raw) as { domainSchemaVersion: number; project: Project }
if (envelope.domainSchemaVersion !== 3) {
  throw new Error(`unsupported domainSchemaVersion ${String(envelope.domainSchemaVersion)}`)
}
const reference = envelope.project

/**
 * `project.id`, 3 Floors, 3 Plan Views, 630 Item Designs and 630 Placed Items, plus the
 * spaces, dividers and accessories of the 30 cabinet trees. Pinned as a number on purpose:
 * the day the schema gives another field an ID, this is what makes the walk say so.
 */
const REFERENCE_ID_COUNT = 16597

describe('remapIds — the reference Project (#50)', () => {
  it('asks the allocator once, for exactly one ID per entity', () => {
    const asked: number[] = []
    const remapped = remapIds(reference, NEW_ID, (count) => {
      asked.push(count)
      return allocateFresh(count)
    })

    expect(asked).toEqual([REFERENCE_ID_COUNT])
    expect(remapped.id).toBe(NEW_ID)
    const result = validateProject(remapped)
    expect(result.ok ? [] : result.problems).toEqual([])

    // A field whose ID forgot to join the walk would still carry the old one here, and the
    // fixture is the one Project big enough to hold every shape v1 has.
    expect(survivors(remapped, new Set(entityIds(reference)))).toEqual([])
  })
})
