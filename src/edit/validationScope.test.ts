/**
 * That scoping a validation pass loses nothing (#69 §8).
 *
 * `applyIntent` no longer reads the whole Project after every Transaction, which is only allowed if
 * a scoped pass and a whole-document pass *agree*. Not merely the same verdict: the same problems,
 * in the same order, at the same paths — a rejection the UI cannot point at is a worse bug than a
 * slow Transaction. So these tests run the generated Projects and the generated corruptions of
 * `src/domain/testing` through single-record edits and compare the two passes record for record,
 * and then check the three ways a scope could plausibly hide something: a duplicate ID in a
 * collection the pass skipped, a reference left dangling by a record that went away, and a Room
 * overlap whose other side was never touched.
 *
 * Two contracts, because two situations deserve them. On a **valid** Project — the only kind
 * `applyIntent` is ever handed — the two passes must return byte-identical problems. On a Project
 * that was already broken, a scoped pass must still report every problem about a record it was
 * asked to check, and is allowed to ignore a fault its Transaction had nothing to do with.
 */
import fc from 'fast-check'
import { produceWithPatches } from 'immer'
import type { Patch } from 'immer'
import { describe, expect, it } from 'vitest'
import type { Project, ValidationScope } from '../domain'
import { validateProject } from '../domain'
import { arbCorruption, arbProject } from '../domain/testing'
import { applyIntent } from './apply'
import { intent } from './testing'
import { validationScopeFor } from './validationScope'

const PROPERTY_OPTIONS = { numRuns: 40 } as const

/**
 * One property test, with the room a loaded CI runner needs: each of these runs dozens of generated
 * Projects through a validation pass, and the default 5 s is a coin flip on a busy box.
 */
function long(title: string, fn: () => void): void {
  it(title, fn, 30_000)
}

/** The collections a single-record edit can reach, and what it writes into one. */
type ExistingKey = 'placedItems' | 'walls' | 'wallJunctions' | 'openings' | 'rooms'
type CollectionKey = ExistingKey | 'itemDesigns' | 'meta' | 'floors'

const COLLECTIONS: readonly CollectionKey[] = ['itemDesigns', 'placedItems', 'walls', 'wallJunctions', 'openings', 'rooms', 'meta', 'floors']

/**
 * One record, one field, written through Immer so the patches are the ones `applyIntent` would
 * have handed the scope. `null` means the collection holds nothing to write to.
 */
function editRecord(source: Project, key: CollectionKey, index: number): [Project, readonly Patch[]] | null {
  const length =
    key === 'meta'
      ? 1
      : key === 'floors'
        ? source.floors.length
        : key === 'itemDesigns'
          ? source.itemDesigns.length
          : source.existingModel[key].length
  if (index >= length) return null
  return produce(source, key, index)
}

function produce(source: Project, key: CollectionKey, index: number): [Project, readonly Patch[]] {
  return produceWithPatches(source, (draft) => {
    const model = draft.existingModel
    switch (key) {
      case 'meta':
        draft.meta.name = `${draft.meta.name} x`
        return
      case 'floors':
        draft.floors[index].name = `${draft.floors[index].name} x`
        return
      case 'itemDesigns':
        draft.itemDesigns[index].name = `${draft.itemDesigns[index].name} x`
        return
      case 'placedItems':
        model.placedItems[index].rotationDeg = 12.5
        return
      case 'walls':
        model.walls[index].thickness = 240
        return
      case 'wallJunctions':
        model.wallJunctions[index].ends[0] = { ...model.wallJunctions[index].ends[0]!, end: 'end' }
        return
      case 'openings':
        model.openings[index].label = 'Opening 99'
        return
      case 'rooms':
        draft.existingModel.rooms[index].name = 'Room 99'
        return
    }
  }) as unknown as [Project, readonly Patch[]]
}

/** Both passes, compared. Returns the scope so a caller can say something about its size. */
function expectAgreement(before: Project, after: Project, patches: readonly Patch[]): ValidationScope | null {
  const scope = validationScopeFor(patches, before, after)
  const full = validateProject(after)
  const scoped = validateProject(after, scope)
  expect(scoped.ok).toBe(full.ok)
  if (full.ok === false && scoped.ok === false) expect(scoped.problems).toEqual(full.problems)
  return scope
}

/**
 * The record a problem path points into, or `null` when it points at the document as a whole.
 * Written against the paths `src/domain/validate.ts` emits: `<collection>[i].<field>`, with
 * `existingModel.` and `designOptions[i].` as the two prefixes.
 */
function recordIdAt(path: string, project: Project): string | null {
  const match = /^(?:existingModel\.)?([a-zA-Z]+)\[(\d+)\]/.exec(path)
  if (match === null) return null
  const [, collection, digits] = match as unknown as [string, string, string]
  const index = Number(digits)
  const list: unknown =
    collection === 'itemDesigns'
      ? project.itemDesigns
      : collection === 'designOptions'
        ? (project.designOptions ?? [])
        : collection === 'floors'
          ? project.floors
          : (project.existingModel as unknown as Record<string, unknown>)[collection]
  const record = Array.isArray(list) ? list[index] : undefined
  if (typeof record !== 'object' || record === null) return null
  const id = (record as { id?: unknown }).id
  return typeof id === 'string' ? id : null
}

/**
 * The weaker contract, for a Project that was already broken before the Transaction: a scoped pass
 * may not hide a problem **about a record it was asked to check**. Problems about records nobody
 * touched and nobody named are exactly the ones it is allowed to skip — `applyIntent` is only ever
 * called on a Project that was validated on the way in, so those cannot exist in production, and
 * pretending otherwise would ask the scope to re-find a fault its Transaction had nothing to do
 * with.
 */
function expectNoHiddenProblems(before: Project, after: Project, patches: readonly Patch[]): ValidationScope | null {
  const scope = validationScopeFor(patches, before, after)
  const full = validateProject(after)
  const scoped = validateProject(after, scope)
  if (full.ok === true) {
    expect(scoped.ok).toBe(true)
    return scope
  }
  const reported = new Set((scoped.ok === false ? scoped.problems : []).map((entry) => `${entry.path} ${entry.code}`))
  for (const problem of full.problems) {
    const id = recordIdAt(problem.path, after)
    if (scope !== null && id !== null && !scope.entities.has(id)) continue
    expect(reported.has(`${problem.path} ${problem.code}`), `a scoped pass dropped the problem at ${problem.path}`).toBe(true)
  }
  return scope
}

/** How many of the property runs actually got a scope rather than the whole-document fallback. */
let scopedRuns = 0

describe('the scope a Transaction gets', () => {
  long('names the edited record, its referrers, and the Walls a Junction it wrote touches', () => {
    fc.assert(
      fc.property(arbProject(), fc.integer({ min: 0, max: 99 }), (project, roll) => {
        const junction = project.existingModel.wallJunctions[Math.floor(roll / 4) % Math.max(1, project.existingModel.wallJunctions.length)]
        if (junction === undefined) return
        const patches: readonly Patch[] = [{ op: 'replace', path: ['existingModel', 'wallJunctions', 0, 'floorId'], value: junction.floorId }]
        const scope = validationScopeFor(patches, project, project)
        if (scope === null) return
        // The Junction itself, every Junction sharing its Walls, and everything measured against
        // those Walls: an Opening's usable interval and a Room's face reference both read the band
        // a Junction tidies, so a Junction edit reaches further than the record it wrote.
        expect(scope.entities.has(junction.id)).toBe(true)
        const walls = new Set(junction.ends.map((end) => end.wallId))
        if (junction.host !== undefined) walls.add(junction.host.wallId)
        for (const opening of project.existingModel.openings) {
          if (walls.has(opening.hostWallId)) expect(scope.entities.has(opening.id)).toBe(true)
        }
        for (const room of project.existingModel.rooms) {
          if (room.wallFaceRefs.some((reference) => walls.has(reference.wallId))) expect(scope.entities.has(room.id)).toBe(true)
        }
      }),
      PROPERTY_OPTIONS,
    )
  })

  long('falls back to the whole Project for a patch it cannot read', () => {
    fc.assert(
      fc.property(arbProject(), (project) => {
        const unidentifiable: readonly Patch[] = [
          { op: 'replace', path: ['meta', 'name'], value: 'x' },
          { op: 'replace', path: ['warningAcknowledgements', 0], value: {} },
          { op: 'remove', path: ['floors', 0] },
        ]
        for (const patch of unidentifiable) {
          expect(validationScopeFor([patch], project, project)).toBeNull()
        }
      }),
      { numRuns: 5 },
    )
  })

  long('reads a collection written whole by comparing it to itself', () => {
    // Option handlers reassign `proposed.openings` rather than pushing into it, so Immer reports one
    // patch for the array and no index at all. Reference identity is what makes that readable: a
    // record the edit did not touch is the same object on both sides of the patch.
    fc.assert(
      fc.property(arbProject(), (project) => {
        if (project.existingModel.walls.length === 0) return
        const untouched: readonly Patch[] = [{ op: 'replace', path: ['existingModel', 'walls'], value: project.existingModel.walls }]
        expect(validationScopeFor(untouched, project, project)).toEqual({ entities: new Set<string>() })

        const [rewritten] = produceWithPatches(project, (draft) => {
          draft.existingModel.walls[0]!.thickness += 10
        })
        const patches: readonly Patch[] = [{ op: 'replace', path: ['existingModel', 'walls'], value: rewritten.existingModel.walls }]
        const scope = validationScopeFor(patches, project, rewritten)
        if (scope === null) throw new Error('a rewritten collection fell back to the whole Project')
        expect(scope.entities.has(project.existingModel.walls[0]!.id)).toBe(true)
        // Widened by referrers — the Openings, Joins and Rooms naming that Wall — and nothing else:
        // no Item Design, no other Floor, is reachable from one Wall's thickness.
        for (const design of project.itemDesigns) expect(scope.entities.has(design.id)).toBe(false)
        const changed = project.existingModel.walls[0]!.id
        for (const wall of project.existingModel.walls.slice(1)) {
          const named =
            project.existingModel.openings.some((opening) => opening.hostWallId === wall.id) ||
            project.existingModel.rooms.some((room) => room.wallFaceRefs.some((face) => face.wallId === wall.id)) ||
            // A Join on the changed Wall shortens the Wall it joins, which is the second hop the
            // scope has to take: an Opening on that other Wall can stop fitting.
            project.existingModel.wallJunctions.some((junction) => {
              const ids = junction.ends.map((end) => end.wallId).concat(junction.host === undefined ? [] : [junction.host.wallId])
              return ids.includes(wall.id) && ids.includes(changed)
            })
          if (!named) expect(scope.entities.has(wall.id), `an unrelated Wall ${wall.id} was pulled in`).toBe(false)
        }
      }),
      { numRuns: 20 },
    )
  })

  long('is a scope, not a whole-document pass in disguise', () => {
    // The optimisation has to actually narrow: a scope that always came back `null` would keep
    // every test above green and buy nothing.
    let narrowed = 0
    fc.assert(
      fc.property(arbProject(), fc.integer({ min: 0, max: COLLECTIONS.length - 1 }), (project, which) => {
        const edited = editRecord(project, COLLECTIONS[which]!, 0)
        if (edited === null) return
        const scope = validationScopeFor(edited[1], project, edited[0])
        if (scope !== null && scope.entities.size > 0) narrowed += 1
      }),
      PROPERTY_OPTIONS,
    )
    expect(narrowed).toBeGreaterThan(0)
  })
})

describe('a scoped pass agrees with the whole document', () => {
  long('reports the same problems for a single-record edit of any generated Project', () => {
    fc.assert(
      fc.property(
        arbProject(),
        fc.integer({ min: 0, max: COLLECTIONS.length - 1 }),
        fc.integer({ min: 0, max: 9 }),
        (project, which, slot) => {
          const edited = editRecord(project, COLLECTIONS[which]!, slot)
          if (edited === null) return
          const scope = expectAgreement(project, edited[0], edited[1])
          if (scope !== null) scopedRuns += 1
        },
      ),
      PROPERTY_OPTIONS,
    )
    expect(scopedRuns).toBeGreaterThan(0)
  })

  long('reports the same problems for a generated Project with one invariant already broken', () => {
    // The corruptions are the interesting cases: each puts exactly one real problem somewhere in the
    // document, so a scope that skipped the wrong record would drop a problem the whole-document
    // pass still reports — and this is the one place the two passes are compared on Projects that
    // actually fail.
    fc.assert(
      fc.property(
        arbCorruption(),
        fc.integer({ min: 0, max: COLLECTIONS.length - 1 }),
        fc.integer({ min: 0, max: 9 }),
        (corruption, which, slot) => {
          const edited = editRecord(corruption.project, COLLECTIONS[which]!, slot)
          if (edited === null) return
          expectNoHiddenProblems(corruption.project, edited[0], edited[1])
        },
      ),
      PROPERTY_OPTIONS,
    )
  })

  long('leaves a rejection path-addressed', () => {
    // A rejection the UI cannot point at is worse than a slow Transaction: whatever the scope, the
    // problems that come back name the field that is wrong.
    fc.assert(
      fc.property(arbProject(), fc.integer({ min: 0, max: COLLECTIONS.length - 1 }), (project, which) => {
        const key = COLLECTIONS[which]!
        const edited = editRecord(project, key, 0)
        if (edited === null) return
        const full = validateProject(edited[0])
        if (full.ok === true) return
        const scoped = validateProject(edited[0], validationScopeFor(edited[1], project, edited[0]))
        if (scoped.ok === true) throw new Error('the whole document rejected what a scoped pass accepted')
        for (const problem of scoped.problems) {
          expect(problem.path.startsWith('existingModel.') || problem.path.startsWith('itemDesigns[') || problem.path === '$').toBe(true)
        }
      }),
      PROPERTY_OPTIONS,
    )
  })
})

describe('what a scope cannot hide', () => {
  long('still reports a duplicate ID in a collection it skipped', () => {
    fc.assert(
      fc.property(arbProject(), (project) => {
        const walls = project.existingModel.walls
        if (walls.length < 2) return
        const broken = structuredClone(project) as Project
        broken.existingModel.walls[1]!.id = broken.existingModel.walls[0]!.id
        const scope = { entities: new Set(['nothing-this-pass']) }
        const problems = validateProject(broken, scope)
        if (problems.ok === true) throw new Error('a duplicated Wall ID went unreported')
        expect(problems.problems.some((entry) => entry.code === 'duplicate-id')).toBe(true)
      }),
      { numRuns: 10 },
    )
  })

  long('still reports a reference left dangling by a record that went away', () => {
    fc.assert(
      fc.property(arbProject(), (project) => {
        const hostId = project.existingModel.openings[0]?.hostWallId
        if (hostId === undefined) return
        const broken = structuredClone(project) as Project
        broken.existingModel.walls = broken.existingModel.walls.filter((wall) => wall.id !== hostId)
        // The Opening is untouched; only the Wall it is cut into is gone. The referrer sweep is what
        // puts it back in scope, and the path is what the UI highlights.
        const patches: readonly Patch[] = [{ op: 'remove', path: ['existingModel', 'walls', 0], value: undefined }]
        const scope = validationScopeFor(patches, project, broken)
        const opening = broken.existingModel.openings[0]!
        if (scope === null) return
        expect(scope.entities.has(opening.id)).toBe(true)
        const result = validateProject(broken, scope)
        if (result.ok === true) throw new Error('a dangling host Wall went unreported')
        expect(result.problems.some((entry) => entry.path === `existingModel.openings[0].hostWallId`)).toBe(true)
      }),
      { numRuns: 10 },
    )
  })

  long('still reports a Room overlapping one it never touched', () => {
    fc.assert(
      fc.property(arbProject(), (project) => {
        const rooms = project.existingModel.rooms
        if (rooms.length < 1) return
        const broken = structuredClone(project) as Project
        const first = broken.existingModel.rooms[0]!
        const copy = structuredClone(first)
        copy.id = 'injected-room'
        copy.wallFaceRefs = []
        broken.existingModel.rooms.push(copy)
        // Only the new Room is in scope. The overlap pass compares outlines over the whole document
        // whatever the scope, precisely so that this cannot slip through.
        const result = validateProject(broken, { entities: new Set(['injected-room']) })
        if (result.ok === true) throw new Error('a Room drawn on top of another went unreported')
        expect(result.problems.some((entry) => entry.path.startsWith('existingModel.rooms['))).toBe(true)
      }),
      { numRuns: 10 },
    )
  })
})

describe('a Transaction that breaks a record it never touched', () => {
  long('is rejected with the problems of the whole document, at their paths', () => {
    fc.assert(
      fc.property(arbProject(), fc.integer({ min: 0, max: 9 }), (project, roll) => {
        const wall = project.existingModel.walls[roll % Math.max(1, project.existingModel.walls.length)]
        if (wall === undefined) return
        const result = applyIntent(project, intent('wall.setThickness', { wallId: wall.id, thickness: 4000 }, ['tx-scope']))
        if (result.ok === true || result.code !== 'invalid-project') return
        expect(result.problems.length).toBeGreaterThan(0)
        for (const problem of result.problems) expect(problem.path).not.toBe('')
      }),
      PROPERTY_OPTIONS,
    )
  })
})
