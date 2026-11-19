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
 * The key carries the revision, and an entry remembers the entity it describes as well. So a
 * new revision of a Floor *replaces* that Floor's entry rather than joining it: the session's
 * history has moved past the old one, and a slot spent on a picture nothing can ask for
 * again is a slot taken from a Floor that is still on screen. It is also what makes a stale
 * answer impossible by construction — an entry only ever answers the revision it was built
 * at, and asking for an older one recomputes.
 *
 * It is an LRU of `maxEntries` entries (8 by default), least-recently-used first out. A hit
 * returns the identical object, which is what lets a `useSyncExternalStore` selector compare
 * by reference instead of rebuilding a view-model forever (#49).
 */
import type { EntityId, Project } from '../domain'
import { effectiveFloor, effectiveItemDetail } from './effective'
import type { DerivedFloor, DerivedItemDetail } from './effective'

/** How many entries a cache holds before the least-recently-used one goes. */
export const DERIVE_CACHE_MAX_ENTRIES = 8

/** The memoised pair the rest of the app reads through; `session` owns one instance. */
export interface DeriveCache {
  floor(project: Project, revision: number, floorId: EntityId, optionId: EntityId | null): DerivedFloor
  itemDetail(project: Project, revision: number, designId: EntityId, floorId?: EntityId): DerivedItemDetail
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

  /**
   * The one entry for `(kind, revision, id, optionId)`, computed on a miss.
   *
   * The key is JSON rather than a joined string because an `EntityId` may hold any character
   * but whitespace and control characters (#42 §3): a separator would let one ID forge
   * another entity's key, and JSON quotes and escapes without a rule about what an ID may
   * not contain. `slot` is that key without the revision — the entity whose entry a new
   * revision replaces, which is why an old revision is never answered from a new one.
   */
  const remember = <T>(
    kind: 'floor' | 'item',
    revision: number,
    id: EntityId,
    optionId: EntityId | null,
    compute: () => T,
  ): T => {
    const key = JSON.stringify([kind, revision, id, optionId])
    const hit = entries.get(key)
    if (hit !== undefined) {
      entries.delete(key)
      entries.set(key, hit)
      return hit.value as T
    }
    const slot = JSON.stringify([kind, id, optionId])
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
      remember('floor', revision, floorId, optionId, () => effectiveFloor(project, revision, floorId, optionId)),
    itemDetail: (project, revision, designId, floorId) =>
      remember('item', revision, designId, floorId ?? null, () => effectiveItemDetail(project, revision, designId, floorId)),
  }
}
