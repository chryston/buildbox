import { describe, expect, it } from 'vitest'
import {
  BEAM_FEATURE_IDS,
  cabinetFeatureIds,
  DEFAULT_FEATURE_T,
  ENTITY_COLLECTION_KEYS,
  ENTITY_FEATURE_OWNER_KINDS,
  FEATURE_IDS,
  FEATURE_OWNER_KINDS,
  isLinearFeature,
  isRegisteredFeature,
  ownerKindOfCollection,
  ownerKindOfDesign,
  registeredFeatureIds,
  SERVICE_RISER_FEATURE_IDS,
  SERVICE_RUN_FEATURE_IDS,
  SKIRTING_FEATURE_IDS,
  WALL_FEATURE_IDS,
  type CabinetNode,
} from './index'

/**
 * The registry is the promise that a `feature` Anchor can be resolved (#80 §2 rule 3): every kind
 * that can own a Comment has an entry, and an empty entry is a considered answer rather than a gap.
 * The `Record` types make that a compile error for a new kind; these tests make it a compile error
 * for a new *collection* too, which the type alone cannot see.
 */
describe('the feature registry is exhaustive (#80 §2)', () => {
  it('names every model collection exactly once', () => {
    expect(new Set(ENTITY_COLLECTION_KEYS).size).toBe(ENTITY_COLLECTION_KEYS.length)
    expect([...ENTITY_COLLECTION_KEYS].sort()).toEqual([
      'beams',
      'openings',
      'placedItems',
      'rooms',
      'services',
      'skirting',
      'wallJunctions',
      'walls',
    ])
  })

  it('gives every model collection an owner kind, and every owner kind a registration', () => {
    for (const key of ENTITY_COLLECTION_KEYS) {
      expect(ENTITY_FEATURE_OWNER_KINDS[key]).toBeDefined()
      const kind = ownerKindOfCollection(key, 'run')
      expect(FEATURE_IDS).toHaveProperty(kind)
    }
    // Both design kinds, which are not collections at all.
    expect(FEATURE_IDS).toHaveProperty('cabinetDesign')
    expect(FEATURE_IDS).toHaveProperty('genericDesign')
  })

  it('registers exactly the kinds its own list names, in the same order', () => {
    // A `Record` cannot be checked for extra keys by the compiler, so this is the guard: the two
    // lists are the same set.
    expect(Object.keys(FEATURE_IDS)).toEqual([...FEATURE_OWNER_KINDS])
  })

  it('walks both design kinds', () => {
    expect(ownerKindOfDesign({ kind: 'cabinet' })).toBe('cabinetDesign')
    expect(ownerKindOfDesign({ kind: 'appliance' })).toBe('genericDesign')
    // Untrusted bytes: a design with no discriminator answers as the generic kind rather than
    // throwing, and the validator refuses it on its own terms.
    expect(ownerKindOfDesign({})).toBe('genericDesign')
    expect(ownerKindOfDesign({ kind: undefined })).toBe('genericDesign')
    expect(FEATURE_IDS[ownerKindOfDesign({})]).toBeDefined()
  })

  it('settles the one collection with two kinds from the record shape', () => {
    expect(ownerKindOfCollection('services', 'run')).toBe('serviceRun')
    expect(ownerKindOfCollection('services', 'riser')).toBe('serviceRiser')
    // The `shape` argument is ignored by every other collection, which is why the caller can pass it
    // unconditionally.
    for (const key of ENTITY_COLLECTION_KEYS) {
      if (key === 'services') continue
      expect(ownerKindOfCollection(key, 'riser')).toBe(ENTITY_FEATURE_OWNER_KINDS[key])
    }
  })
})

describe('the registered feature sets (#80 §2)', () => {
  it('names the Wall faces by the same spelling as the Beam set', () => {
    // One spelling of "the left-hand face" is worth more than matching prose (#80 Decisions).
    expect(WALL_FEATURE_IDS).toEqual(['start', 'end', 'leftFace', 'rightFace'])
    for (const id of WALL_FEATURE_IDS) expect(BEAM_FEATURE_IDS).toContain(id)
  })

  it('reuses the sets the model already published, rather than restating them', () => {
    expect(FEATURE_IDS.wall).toBe(WALL_FEATURE_IDS)
    expect(FEATURE_IDS.beam).toBe(BEAM_FEATURE_IDS)
    expect(FEATURE_IDS.skirting).toBe(SKIRTING_FEATURE_IDS)
    expect(FEATURE_IDS.serviceRun).toBe(SERVICE_RUN_FEATURE_IDS)
    expect(FEATURE_IDS.serviceRiser).toBe(SERVICE_RISER_FEATURE_IDS)
  })

  it('registers nothing for the kinds with no stable parts to name', () => {
    // An empty set is a registration: a Comment on a Room is a Comment on the Room, and the inspector
    // shows one button instead of a list of parts.
    for (const kind of ['wallJunction', 'opening', 'room', 'placedItem', 'genericDesign'] as const) {
      expect(registeredFeatureIds(kind)).toEqual([])
      expect(isRegisteredFeature(kind, 'start')).toBe(false)
      expect(isRegisteredFeature(kind, 'anything')).toBe(false)
    }
  })

  it('answers null for the one dynamic kind, so no caller mistakes it for an empty set', () => {
    expect(registeredFeatureIds('cabinetDesign')).toBeNull()
    expect(FEATURE_IDS.cabinetDesign).toBe('dynamic')
  })

  it('checks membership against the caller’s own list for the dynamic kind', () => {
    expect(isRegisteredFeature('cabinetDesign', 'node-3', ['node-1', 'node-3'])).toBe(true)
    expect(isRegisteredFeature('cabinetDesign', 'node-9', ['node-1', 'node-3'])).toBe(false)
    // No list at all means nothing is registered: a caller that has not loaded the design cannot
    // resolve a space inside it.
    expect(isRegisteredFeature('cabinetDesign', 'node-1')).toBe(false)
    expect(isRegisteredFeature('cabinetDesign', 'node-1', [])).toBe(false)
  })

  it('ignores the dynamic list for a closed kind, so a stale tree cannot widen a Wall', () => {
    expect(isRegisteredFeature('wall', 'leftFace', ['leftFace'])).toBe(true)
    expect(isRegisteredFeature('wall', 'notAFace', ['notAFace'])).toBe(false)
  })

  it('has no repeated ID inside any one set', () => {
    for (const kind of FEATURE_OWNER_KINDS) {
      const ids = registeredFeatureIds(kind)
      if (ids === null) continue
      expect(new Set(ids).size).toBe(ids.length)
    }
  })
})

describe('the linear features (#80 §2)', () => {
  it('marks only the two ends as carrying a position along the line', () => {
    expect(isLinearFeature('start')).toBe(true)
    expect(isLinearFeature('end')).toBe(true)
    for (const id of ['leftFace', 'rightFace', 'underside', 'top', 'face', 'bottom', 'axis', 'outline']) {
      expect(isLinearFeature(id)).toBe(false)
    }
    expect(isLinearFeature('')).toBe(false)
  })

  it('names every end of every linear kind as linear', () => {
    // The registry and the linear test agree: an ID that means an end is linear in both places.
    for (const kind of ['wall', 'beam', 'skirting', 'serviceRun'] as const) {
      const ids = registeredFeatureIds(kind)
      expect(ids).not.toBeNull()
      expect(ids!.filter(isLinearFeature)).toEqual(['start', 'end'])
    }
    // A Riser is vertical: its `bottom` and `top` are whole sections, not positions along a plan line.
    expect(registeredFeatureIds('serviceRiser')!.filter(isLinearFeature)).toEqual([])
  })

  it('leaves a new linear-feature Comment in the middle', () => {
    expect(isLinearFeature('start')).toBe(true)
    expect(DEFAULT_FEATURE_T).toBe(0.5)
  })
})

/** A cabinet node with whatever children the caller names. */
const node = (id: string, children: CabinetNode[] = []): CabinetNode =>
  ({ id, kind: 'space', children }) as unknown as CabinetNode

/** A cabinet tree: a carcass with one plain space and one split space. */
function tree(): CabinetNode {
  return node('carcass', [node('lower'), node('upper', [node('upper-left'), node('upper-right')])])
}

describe('the cabinet spaces (#80 §2)', () => {
  it('lists every node ID of a tree, root first in pre-order', () => {
    expect(cabinetFeatureIds(tree())).toEqual(['carcass', 'lower', 'upper', 'upper-left', 'upper-right'])
  })

  it('lists one node when the tree is one node', () => {
    expect(cabinetFeatureIds(node('only'))).toEqual(['only'])
  })

  it('answers the dynamic registration through the same membership test', () => {
    const ids = cabinetFeatureIds(tree())
    expect(isRegisteredFeature('cabinetDesign', 'upper-left', ids)).toBe(true)
    // A space of a different cabinet is not a space of this one.
    expect(isRegisteredFeature('cabinetDesign', 'lower', ['upper'])).toBe(false)
  })

  it('stops on a tree that repeats a node, instead of hanging on it', () => {
    // Imported bytes are untrusted, and a cycle in a `children` array is exactly the shape that would
    // otherwise spin forever.
    const node = { id: 'a', kind: 'space', children: [] } as unknown as CabinetNode
    ;(node.children as CabinetNode[]).push(node)
    expect(cabinetFeatureIds(node)).toEqual(['a'])
  })

  it('skips a malformed child instead of throwing', () => {
    // Imported bytes are untrusted: a `children` pair whose first half is missing must still walk the
    // second, and a node with no `id` is traversed but not named.
    const broken = {
      id: 'root',
      kind: 'carcass',
      children: [null, { kind: 'space', children: [null, node('real')] }],
    } as unknown as CabinetNode
    expect(cabinetFeatureIds(broken)).toEqual(['root', 'real'])
  })

  it('walks a node with no children at all', () => {
    expect(cabinetFeatureIds({ id: 'bare', kind: 'space' } as unknown as CabinetNode)).toEqual(['bare'])
  })
})
