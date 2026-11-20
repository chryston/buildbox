/**
 * The memoisation in front of the effective model (#60 §1, #20 §8).
 *
 * `effectiveFloor` is a whole Floor at a time — every placement's footprint turned, bounded
 * and unioned — and the Plan View asks for it on every pan-settling render, on every hover,
 * on every selection change. Without a cache that is the same 200 placements derived dozens
 * of times a second, against the 50 ms budget the issue names.
 *
 * The cache is an instance, never a module-level `Map`: the session holds one, a test makes
 * its own, and two of them can never see each other's entries (#60 criterion 2). `effective`
 * stays a pure function so a caller that wants no cache — a preview Project mid-drag, a
 * property test — has one less thing to get wrong.
 *
 * The key carries the Project and the revision. The revision alone is not enough: two tabs of
 * one Project each sit at their own revision with their own contents, and the store hands this
 * tab a Project at exactly the revision it already had, so a key of `(revision, entity)` answers
 * a reload with the picture of the tab's own discarded edit. The Project is identified by object,
 * through a `WeakMap`, so nothing is kept alive by being counted.
 *
 * An entry remembers the entity it describes as well. So a new revision of a Floor *replaces*
 * that Floor's entry rather than joining it: the session's history has moved past the old one,
 * and a slot spent on a picture nothing can ask for again is a slot taken from a Floor that is
 * still on screen. It is also what makes a stale answer impossible by construction — an entry
 * only ever answers the Project revision it was built at, and asking for anything else
 * recomputes.
 *
 * It is an LRU of `maxEntries` entries (8 by default), least-recently-used first out. A hit
 * returns the identical object, which is what lets a `useSyncExternalStore` selector compare
 * by reference instead of rebuilding a view-model forever (#49).
 */
import type { EntityId, Project } from '../domain'
import { effectiveFloor, effectiveItemDetail } from './effective'
import type { DerivedFloor, DerivedItemDetail } from './effective'
import { quantitiesForFloor } from './quantities/quantities'
import type { FloorQuantities } from './quantities/quantities'
import { deriveWalls } from './walls'
import type { FloorWalls } from './walls'

/** How many entries a cache holds before the least-recently-used one goes. */
export const DERIVE_CACHE_MAX_ENTRIES = 8

/** The memoised pair the rest of the app reads through; `session` owns one instance. */
export interface DeriveCache {
  floor(project: Project, revision: number, floorId: EntityId, optionId: EntityId | null): DerivedFloor
  itemDetail(project: Project, revision: number, designId: EntityId, floorId?: EntityId): DerivedItemDetail
  /**
   * The Item List and Cut List rows of one Floor under one Design Option (#62 §6).
   *
   * A Cut List is the most expensive thing the app derives for a scope — every cabinet's panels,
   * from scratch — and a scope is a set of Floors, so this is the stage worth holding. The scope's
   * own filters are applied above it, which is what lets one Floor's entry serve every scope that
   * mentions the Floor.
   */
  quantities(project: Project, revision: number, floorId: EntityId, optionId: EntityId | null): FloorQuantities
  /**
   * The tidied Walls, faces, corners and lengths of one Floor (#64 §6). Faces and corners are
   * what every tool snaps to, and the Plan View asks for them on every pointer move, so the
   * same slot discipline as a Cut List applies: one entry per Floor, replaced by its own next
   * revision.
   */
  walls(project: Project, revision: number, floorId: EntityId, optionId: EntityId | null): FloorWalls
}

interface Entry {
  /** The entity this entry describes: the same key without its revision. */
  readonly slot: string
  readonly value: unknown
}

/**
 * A cache of derived models: an LRU of `maxEntries`, keyed by revision.
 *
 * `maxEntries` below 1 is read as 1 — an entry is evicted the moment a second one arrives,
 * which is the degenerate case a test asks for, not a reason to keep nothing at all.
 */
export function createDeriveCache(opts: { maxEntries?: number } = {}): DeriveCache {
  const maxEntries = Math.max(1, Math.floor(opts.maxEntries ?? DERIVE_CACHE_MAX_ENTRIES))
  // Insertion order *is* recency: a hit is deleted and re-inserted, and the first key out is
  // the one nothing has asked for longest. `Map` guarantees that order; no timestamps, no
  // counter, nothing that would make a cache miss depend on the clock.
  const entries = new Map<string, Entry>()
  // Which Project an entry was built from. The revision cannot answer that on its own: two tabs
  // of one Project each sit at their own revision 7 with different contents, and "Reload the
  // latest version" hands this session a Project at exactly the revision it already had. The
  // token belongs to the object, is handed out once, and is forgotten with it — a `WeakMap`, so
  // a Project nothing holds any more leaves the cache as quietly as it left the session.
  const tokens = new WeakMap<Project, number>()
  let issued = 0
  const tokenOf = (project: Project): number => {
    const seen = tokens.get(project)
    if (seen !== undefined) return seen
    issued += 1
    tokens.set(project, issued)
    return issued
  }

  /**
   * The one entry for `(kind, project, revision, id, optionId)`, computed on a miss.
   *
   * The key is JSON rather than a joined string because an `EntityId` may hold any character
   * but whitespace and control characters (#42 §3): a separator would let one ID forge
   * another entity's key, and JSON quotes and escapes without a rule about what an ID may
   * not contain. `slot` is that key without the revision — the entity whose entry a new
   * revision replaces, which is why an old revision is never answered from a new one.
   */
  const remember = <T>(
    kind: 'floor' | 'item' | 'quantities' | 'walls',
    projectToken: number,
    revision: number,
    id: EntityId,
    optionId: EntityId | null,
    compute: () => T,
  ): T => {
    const key = JSON.stringify([kind, projectToken, revision, id, optionId])
    const hit = entries.get(key)
    if (hit !== undefined) {
      entries.delete(key)
      entries.set(key, hit)
      return hit.value as T
    }
    const slot = JSON.stringify([kind, projectToken, id, optionId])
    for (const [existing, entry] of entries) {
      if (entry.slot === slot) entries.delete(existing)
    }
    const value = compute()
    entries.set(key, { slot, value })
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next()
      if (oldest.done === true) break
      entries.delete(oldest.value)
    }
    return value
  }

  return {
    floor: (project, revision, floorId, optionId) =>
      remember('floor', tokenOf(project), revision, floorId, optionId, () => effectiveFloor(project, revision, floorId, optionId)),
    itemDetail: (project, revision, designId, floorId) =>
      remember('item', tokenOf(project), revision, designId, floorId ?? null, () => effectiveItemDetail(project, revision, designId, floorId)),
    quantities: (project, revision, floorId, optionId) =>
      remember('quantities', tokenOf(project), revision, floorId, optionId, () => quantitiesForFloor(project, floorId, optionId)),
    walls: (project, revision, floorId, optionId) =>
      remember('walls', tokenOf(project), revision, floorId, optionId, () => deriveWalls(project, floorId)),
  }
}
