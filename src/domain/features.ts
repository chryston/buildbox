/**
 * The stable feature registry (#80 §2).
 *
 * A feature is a named, stable part of one owner — a Wall's Kitchen-side face, a Beam's underside,
 * one space of a cabinet — and it is the only way an Anchor can point at a part of a thing instead
 * of the whole thing. Two rules make that mean something:
 *
 *  - **`domain` owns the set.** Every kind's registered feature IDs live here, so the strict
 *    validator can refuse a feature ID nothing ever names, and a UI can never invent one by
 *    string-building. `derive` evaluates where a registered feature currently is; nothing outside
 *    these two modules needs to know the names.
 *  - **Every kind is registered, even the kinds with nothing to name.** Openings, Rooms, Placed
 *    Items, Wall Junctions and generic Item Designs register the empty set, and the exhaustiveness
 *    test fails the day a new entity kind joins `domain` without one. An empty set is a decision —
 *    "this kind has no stable parts yet" — and the test is what stops it being an oversight.
 *
 * A cabinet Item Design is the one kind whose set is not written down: every `CabinetNode.id` of
 * that design is a feature, addressed as `(itemDesignId, nodeId)` (#20 §3, ADR 0004), so its
 * registration is `dynamic` and `cabinetFeatureIds` reads the tree. Node IDs are scoped to their
 * design — the same ID in two designs is what a fork produces — which is why they are not in the
 * Project-wide ID namespace.
 */
import type { CabinetNode } from './cabinetPayload'
import type { ServiceShape } from './project'
import {
  BEAM_FEATURE_IDS,
  SERVICE_RISER_FEATURE_IDS,
  SERVICE_RUN_FEATURE_IDS,
  SKIRTING_FEATURE_IDS,
  WALL_FEATURE_IDS,
} from './project'

/**
 * Every entity collection a model holds, in the order the Existing Model lists them (#80 §2 rule 3).
 *
 * This is the enumeration the exhaustiveness test walks, and `validate` reads its two model field
 * lists from it, so a collection added to the schema cannot be left unregistered: the map below
 * stops compiling, and the test stops passing.
 */
export const ENTITY_COLLECTION_KEYS = [
  'placedItems',
  'walls',
  'wallJunctions',
  'openings',
  'rooms',
  'beams',
  'skirting',
  'services',
] as const

/** One model collection, by the field that holds it. */
export type EntityCollectionKey = (typeof ENTITY_COLLECTION_KEYS)[number]

/** Every kind a feature Anchor's owner can be (#80 §2 rule 2). */
export type FeatureOwnerKind =
  | 'wall'
  | 'wallJunction'
  | 'opening'
  | 'room'
  | 'placedItem'
  | 'beam'
  | 'skirting'
  | 'serviceRun'
  | 'serviceRiser'
  | 'cabinetDesign'
  | 'genericDesign'

/** Every owner kind, in the order the registry lists them — the exhaustiveness test's list. */
export const FEATURE_OWNER_KINDS: readonly FeatureOwnerKind[] = Object.freeze([
  'wall',
  'wallJunction',
  'opening',
  'room',
  'placedItem',
  'beam',
  'skirting',
  'serviceRun',
  'serviceRiser',
  'cabinetDesign',
  'genericDesign',
])

/**
 * What a kind registers: its closed set of feature IDs, or `dynamic` for the one kind whose set is
 * read from the owner itself — a cabinet, whose features are its spaces.
 */
export type FeatureRegistration = readonly string[] | 'dynamic'

/** The kind with no stable parts to name: a whole entity, and nothing beside it. */
const NONE: readonly string[] = Object.freeze([])

/** Every kind's registered set. An empty set is a registration, not a gap (#80 §2 rule 3). */
export const FEATURE_IDS: Record<FeatureOwnerKind, FeatureRegistration> = Object.freeze({
  // Faces are relative to the reference-line direction, exactly as a Beam derives its own (#80
  // Decisions). The names follow the Beam set already in `domain` — `leftFace`, not `left_face` —
  // because one spelling of "the left-hand face" is worth more than matching prose.
  wall: WALL_FEATURE_IDS,
  wallJunction: NONE,
  opening: NONE,
  room: NONE,
  placedItem: NONE,
  beam: BEAM_FEATURE_IDS,
  skirting: SKIRTING_FEATURE_IDS,
  serviceRun: SERVICE_RUN_FEATURE_IDS,
  serviceRiser: SERVICE_RISER_FEATURE_IDS,
  cabinetDesign: 'dynamic',
  genericDesign: NONE,
})

/**
 * Which owner kind one model collection's records are.
 *
 * A Service is the one collection holding two kinds, so it maps to `'service'` and
 * `ownerKindOfCollection` settles it from the record's own `shape`.
 */
export type CollectionOwnerKind = Exclude<FeatureOwnerKind, 'serviceRun' | 'serviceRiser'> | 'service'

/** The owner kind each collection's records answer as. */
export const ENTITY_FEATURE_OWNER_KINDS: Record<EntityCollectionKey, CollectionOwnerKind> = Object.freeze({
  placedItems: 'placedItem',
  walls: 'wall',
  wallJunctions: 'wallJunction',
  openings: 'opening',
  rooms: 'room',
  beams: 'beam',
  skirting: 'skirting',
  services: 'service',
})

/** The owner kind of one record of one collection. */
export function ownerKindOfCollection(key: EntityCollectionKey, serviceShape: ServiceShape): FeatureOwnerKind {
  const kind = ENTITY_FEATURE_OWNER_KINDS[key]
  if (kind !== 'service') return kind
  return serviceShape === 'riser' ? 'serviceRiser' : 'serviceRun'
}

/**
 * The owner kind an Item Design answers as.
 *
 * Typed on the discriminator alone rather than on `ItemDesign`, because the strict validator calls it
 * on a record it has not yet believed.
 */
export const ownerKindOfDesign = (design: { kind?: unknown }): FeatureOwnerKind =>
  design.kind === 'cabinet' ? 'cabinetDesign' : 'genericDesign'

/** The registered set of one kind, or `null` for the one kind whose set is dynamic. */
export const registeredFeatureIds = (kind: FeatureOwnerKind): readonly string[] | null => {
  const registration = FEATURE_IDS[kind]
  return registration === 'dynamic' ? null : registration
}

/**
 * Every `CabinetNode.id` of one cabinet, root first in pre-order.
 *
 * Iterative and cycle-guarded, because this runs on untrusted imported bytes: a tree that repeats a
 * space is refused by the validator's own walk, and must not hang the reader that runs after it.
 */
export function cabinetFeatureIds(root: CabinetNode): string[] {
  const ids: string[] = []
  const seen = new Set<CabinetNode>()
  const stack: CabinetNode[] = [root]
  while (stack.length > 0) {
    const node = stack.pop() as CabinetNode
    if (node === null || typeof node !== 'object' || seen.has(node)) continue
    seen.add(node)
    if (typeof node.id === 'string') ids.push(node.id)
    if (Array.isArray(node.children)) stack.push(node.children[1] as CabinetNode, node.children[0] as CabinetNode)
  }
  return ids
}

/**
 * Whether `featureId` is registered for one owner.
 *
 * The dynamic case is answered by the caller, which is the only party holding the design whose tree
 * the ID has to be found in — `domain`'s validator passes that design's node IDs, and a later UI
 * passes the same list it drew the `+ Comment on <feature>` buttons from.
 */
export function isRegisteredFeature(
  kind: FeatureOwnerKind,
  featureId: string,
  dynamicIds?: readonly string[],
): boolean {
  const registered = registeredFeatureIds(kind)
  if (registered === null) return dynamicIds?.includes(featureId) ?? false
  return registered.includes(featureId)
}

/**
 * Whether a feature of this kind runs along a line, and so takes a parametric `t` (#80 §2).
 *
 * `start` and `end` are the ends of a linear feature, which is where `t` means something; a face,
 * an underside or a cabinet space is a whole thing with no position along it.
 */
export const isLinearFeature = (featureId: string): boolean => featureId === 'start' || featureId === 'end'

/** The `t` a new linear-feature Comment starts at, as the inspector's button leaves it (#80 §8). */
export const DEFAULT_FEATURE_T = 0.5
