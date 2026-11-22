/**
 * Which records one Edit Transaction actually touched (#69 §8).
 *
 * `applyIntent` validates the Project it produced, and on the reference Project that read costs
 * several times what the edit did. Architecture §4 scopes it instead: Immer's patches say exactly
 * which array slots changed, and structural sharing guarantees every other record is the *same
 * object* it was, so the patch paths answer "what changed" completely — no diffing needed.
 *
 * The scope is deliberately wider than the changed records. A record that **names** a changed one
 * can now come out differently: an Opening whose host Wall went, a Junction whose member moved, a
 * Room whose face reference is stale, a Placement whose Design was edited, an Option that demolishes
 * or succeeds it. Those are pulled in as referrers, and any Existing Model edit pulls in every
 * Design Option, because each Option is a delta over that shared baseline.
 *
 * Anything this file cannot interpret returns `null`, which means "validate the whole Project" —
 * the answer that is always safe. Meta, preferences, Floors, Views and warning acknowledgements are
 * all in that group: they are cheap to validate and they can invalidate anything.
 */
import type { Patch } from 'immer'
import { designOptionsOf } from '../domain'
import type { Project, ValidationScope } from '../domain'

/** The record collections of a model, named the same way in the Existing Model and in a proposal. */
const COLLECTIONS = ['placedItems', 'walls', 'wallJunctions', 'openings', 'rooms'] as const

type CollectionKey = (typeof COLLECTIONS)[number]

const isCollectionKey = (value: unknown): value is CollectionKey =>
  typeof value === 'string' && (COLLECTIONS as readonly string[]).includes(value)

const at = (list: unknown, index: unknown): unknown =>
  Array.isArray(list) && typeof index === 'number' ? list[index] : undefined

const idOf = (record: unknown): string | null => {
  if (typeof record !== 'object' || record === null || Array.isArray(record)) return null
  const id = (record as { id?: unknown }).id
  return typeof id === 'string' && id !== '' ? id : null
}

/**
 * The record at one array slot, read from whichever Project still has it: a `remove` patch indexes
 * the Project before the edit and an `add` patch the one after, and nothing here needs to know
 * which, because a slot only ever holds the record it names.
 */
const slotId = (after: unknown, before: unknown, index: unknown): string | null => idOf(at(after, index)) ?? idOf(at(before, index))

type Touched = { kind: 'all' } | { kind: 'ids'; ids: readonly string[]; baseline: boolean }

const ALL: Touched = { kind: 'all' }

/** The value at a patch path, walking through arrays and records alike. */
function walk(root: unknown, path: readonly (string | number)[]): unknown {
  let node = root
  for (const segment of path) {
    if (typeof segment === 'number') {
      if (!Array.isArray(node)) return undefined
      node = node[segment]
      continue
    }
    if (typeof node !== 'object' || node === null) return undefined
    node = (node as Record<string, unknown>)[segment]
  }
  return node
}

/**
 * The record a replaced array belongs to, found by walking up from it: `proposed.openings` belongs
 * to its Option, `rooms[3].wallFaceRefs` to that Room. A collection with no owning record — the
 * Existing Model's `walls` written whole — has none, and the element diff alone is what names the
 * records that moved.
 */
function ownerIdOf(path: readonly (string | number)[], before: Project, after: Project): string | null {
  for (let depth = path.length - 1; depth > 0; depth -= 1) {
    const here = path.slice(0, depth)
    const id = idOf(walk(after, here)) ?? idOf(walk(before, here))
    if (id !== null) return id
  }
  return null
}

/** Which records of a collection that was replaced whole are new, changed, or gone. */
function diffCollection(path: readonly (string | number)[], before: Project, after: Project): Touched {
  const beforeList = walk(before, path)
  const afterList = walk(after, path)
  if (!Array.isArray(beforeList) || !Array.isArray(afterList)) return ALL
  const ids: string[] = []
  const stillThere = new Map<string, unknown>()
  for (const record of beforeList) {
    const id = idOf(record)
    if (id !== null) stillThere.set(id, record)
  }
  let records = 0
  for (const record of afterList) {
    const id = idOf(record)
    if (id === null) continue
    records += 1
    // The same ID holding a different object is a rewrite; an ID missing from `before` is new work.
    if (stillThere.get(id) !== record) ids.push(id)
    stillThere.delete(id)
  }
  for (const id of stillThere.keys()) ids.push(id)
  const owner = ownerIdOf(path, before, after)
  if (owner !== null) ids.push(owner)
  // An array of nothing but values — a demolition list, a face-reference list — says nothing on its
  // own about which records changed, so it stands on its owner alone.
  if (records === 0 && owner === null) return ALL
  return { kind: 'ids', ids, baseline: path[0] === 'existingModel' }
}

const proposedOf = (record: unknown): Record<string, unknown> | null => {
  if (typeof record !== 'object' || record === null) return null
  const proposed = (record as { proposed?: unknown }).proposed
  return typeof proposed === 'object' && proposed !== null ? (proposed as Record<string, unknown>) : null
}

/** One patch path, read against the Projects on either side of the edit. */
function resolve(patch: Patch, before: Project, after: Project): Touched {
  const [head, second, third, fourth, fifth] = patch.path
  // A whole collection written at once — the shape every Option handler uses when it rebuilds
  // `proposed.openings` — carries no index, so it is read by comparing the two arrays element by
  // element. Structural sharing is what makes that exact: a record Immer did not touch is the same
  // object on both sides.
  if (patch.op === 'replace' && Array.isArray(patch.value)) return diffCollection(patch.path, before, after)
  if (head === 'itemDesigns') {
    const id = slotId(after.itemDesigns, before.itemDesigns, second)
    return id === null ? ALL : { kind: 'ids', ids: [id], baseline: false }
  }
  if (head === 'existingModel') {
    if (!isCollectionKey(second)) return ALL
    const id = slotId(after.existingModel[second], before.existingModel[second], third)
    return id === null ? ALL : { kind: 'ids', ids: [id], baseline: true }
  }
  if (head === 'designOptions') {
    const optionAfter = at(after.designOptions ?? [], second)
    const optionBefore = at(before.designOptions ?? [], second)
    const optionId = idOf(optionAfter) ?? idOf(optionBefore)
    if (optionId === null) return ALL
    // `designOptions[i].proposed.<collection>[j]` is one of the Option's own records; every other
    // path under an Option — its name, its demolition list, the Option itself — is the Option.
    if (third === 'proposed' && isCollectionKey(fourth)) {
      const id = slotId(proposedOf(optionAfter)?.[fourth], proposedOf(optionBefore)?.[fourth], fifth)
      return id === null ? ALL : { kind: 'ids', ids: [id, optionId], baseline: false }
    }
    return { kind: 'ids', ids: [optionId], baseline: false }
  }
  return ALL
}

/** Every record that names something already in `entities`, added in place. */
function referrersOf(project: Project, entities: Set<string>): void {
  const model = project.existingModel
  // The Walls whose **effective** shape this Transaction can change: the ones it edited, and the
  // ones a Junction it wrote attaches to. A new or moved Junction shortens the Walls it joins and
  // tidies their ends, and both an Opening's usable interval and a Room's face reference are read
  // against that tidied band — so those two hops are what an Opening clash on an untouched Wall is
  // missed by, and they cost one pass over the Junctions.
  const wallsTouched = new Set<string>()
  for (const junction of model.wallJunctions) {
    const mine =
      entities.has(junction.id) ||
      junction.ends.some((end) => entities.has(end.wallId)) ||
      (junction.host !== undefined && entities.has(junction.host.wallId))
    if (mine === false) continue
    for (const end of junction.ends) wallsTouched.add(end.wallId)
    if (junction.host !== undefined) wallsTouched.add(junction.host.wallId)
  }
  const wallMatters = (id: string): boolean => entities.has(id) || wallsTouched.has(id)
  for (const junction of model.wallJunctions) {
    if (junction.ends.some((end) => wallMatters(end.wallId)) || (junction.host !== undefined && wallMatters(junction.host.wallId))) {
      entities.add(junction.id)
    }
  }
  for (const opening of model.openings) {
    if (wallMatters(opening.hostWallId)) entities.add(opening.id)
  }
  for (const room of model.rooms) {
    if (room.wallFaceRefs.some((reference) => wallMatters(reference.wallId))) entities.add(room.id)
  }
  for (const item of model.placedItems) {
    if (entities.has(item.itemDesignId)) entities.add(item.id)
  }
  for (const option of designOptionsOf(project)) {
    const proposed = option.proposed as unknown as Record<CollectionKey, readonly { id: string; predecessorIds?: string[] }[]>
    const touched =
      entities.has(option.id) ||
      option.demolishedIds.some((id) => entities.has(id)) ||
      COLLECTIONS.some((key) =>
        proposed[key].some((record) => (record.predecessorIds ?? []).some((id) => entities.has(id))),
      )
    if (touched === false) continue
    // An Option that is in scope is validated whole: its records reference each other freely, and
    // one Option is tens of records rather than the Project's thousands.
    entities.add(option.id)
    for (const key of COLLECTIONS) {
      for (const record of proposed[key]) entities.add(record.id)
    }
  }
}

/**
 * The scope to validate `project` with when the caller already knows which records matter — the
 * same referrer widening {@link validationScopeFor} applies, starting from a set instead of from
 * patches. A caller that has built a synthetic Project (one Option's effective model, say) has no
 * patches to hand and the same rule still applies.
 */
export function scopeAround(project: Project, ids: Iterable<string>): ValidationScope {
  const entities = new Set<string>(ids)
  referrersOf(project, entities)
  return { entities }
}

/**
 * The scope to validate `after` with, given the patches that produced it from `before`, or `null`
 * when this Transaction cannot be scoped and the whole Project has to be read.
 */
export function validationScopeFor(patches: readonly Patch[], before: Project, after: Project): ValidationScope | null {
  const entities = new Set<string>()
  let baseline = false
  for (const patch of patches) {
    const touched = resolve(patch, before, after)
    if (touched.kind === 'all') return null
    for (const id of touched.ids) entities.add(id)
    if (touched.baseline) baseline = true
  }
  // Every Option is a delta over the Existing Model, so a baseline edit changes the effective model
  // each of them is drawn against — which is exactly why such an edit is its own command (#69 §12).
  if (baseline) {
    for (const option of designOptionsOf(after)) entities.add(option.id)
  }
  referrersOf(after, entities)
  return { entities }
}
