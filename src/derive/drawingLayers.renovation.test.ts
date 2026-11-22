/**
 * The effective drawing rules of #71 §4, under `VITE_FF_RENOVATION=true`.
 *
 * Two things are easy to get wrong in opposite directions, and the file is built around them. The
 * first is a layer switch that reaches further than drawing: hiding Furniture must empty the canvas
 * and change nothing else — not the Cut List, not the Warnings List, not a demolition review — so
 * the settings must be invisible to `warnings()` and `quantities()`, and to the memo keys in front
 * of them. The second is a `Pick:` or Display gate that quietly widens what a read-only layer lets
 * you modify, so the three answers are checked as a lattice: each one is the previous one ANDed with
 * one more switch, never ORed.
 */
import { describe, expect, it } from 'vitest'
import * as fc from 'fast-check'
import renovationFixture from '../../fixtures/domain/v8/renovation-views.json?raw'
import type { DrawingLayer, LayerSetting, PlanView, Project, Wall } from '../domain'
import { entityLayerId, UNLAYERED_LAYER_KEY } from '../domain'
import { canonicalJson } from '../lib'
import { createDeriveCache, deriveWarnings, displayModel, effectiveModel, quantitiesForFloor } from './index'
import { effectiveLayerOrder, effectiveLayerSetting, layerAccessOf, layerRowsFrontFirst, snapCandidateAllowed } from './index'
import type { DrawingGates } from './index'

const base = (JSON.parse(renovationFixture) as { project: Project }).project

const STRUCTURE = 'layer-structure'
const SERVICES = 'layer-services'
const FURNITURE = 'layer-furniture'
const FLOOR = 'floor-0'
const VIEW = 'view-0'

const LAYERS: DrawingLayer[] = [
  { id: STRUCTURE, name: 'Structure', color: '#b9b9c2' },
  { id: SERVICES, name: 'Services', color: '#5fb3ff' },
  { id: FURNITURE, name: 'Furniture', color: '#e3a857' },
]

/** The fixture's content filed on layers: Walls and the Opening on Structure, the Island on Furniture. */
const scene: Project = {
  ...base,
  drawingLayers: LAYERS.map((layer) => ({ ...layer })),
  existingModel: {
    ...base.existingModel,
    walls: base.existingModel.walls.map((wall) => ({ ...wall, drawingLayerId: STRUCTURE })),
    wallJunctions: base.existingModel.wallJunctions.map((junction) => ({ ...junction, drawingLayerId: STRUCTURE })),
    openings: base.existingModel.openings.map((opening) => ({ ...opening, drawingLayerId: STRUCTURE })),
    placedItems: base.existingModel.placedItems.map((item) => ({ ...item, drawingLayerId: FURNITURE })),
  },
}

const view = (settings: Record<string, Partial<LayerSetting>>, over: Partial<PlanView> = {}): PlanView => ({
  id: VIEW,
  name: 'A view',
  kind: 'plan',
  floorId: FLOOR,
  isDefault: true,
  showPlanImage: false,
  designOptionId: null,
  renovationDisplay: 'combined',
  layerSettings: Object.fromEntries(Object.entries(settings).map(([key, setting]) => [key, { visible: true, selectable: true, editable: true, ...setting }])),
  ...over,
})

const ALL: DrawingGates = { displayIncluded: true }

const NO_VIEW: PlanView | null = null

describe('the effective layer order (#71 §1, §3)', () => {
  it('is the Project order with Unlayered front-most when the view says nothing', () => {
    expect(effectiveLayerOrder(scene, view({}))).toEqual([STRUCTURE, SERVICES, FURNITURE, UNLAYERED_LAYER_KEY])
    // The list shows the front first, so the row order is the reverse.
    expect(layerRowsFrontFirst(scene, view({}))).toEqual([UNLAYERED_LAYER_KEY, FURNITURE, SERVICES, STRUCTURE])
  })

  it('is the view’s own order when it has one', () => {
    const order = [UNLAYERED_LAYER_KEY, STRUCTURE, SERVICES, FURNITURE]
    expect(effectiveLayerOrder(scene, view({}, { layerOrder: order }))).toEqual(order)
    expect(layerRowsFrontFirst(scene, view({}, { layerOrder: order }))).toEqual([...order].reverse())
  })

  it('still lists Unlayered with a Project that has no layers at all', () => {
    const bare: Project = { ...base, drawingLayers: [] }
    expect(effectiveLayerOrder(bare, view({}))).toEqual([UNLAYERED_LAYER_KEY])
  })

  it('answers for a Project-level surface, where there is no view', () => {
    expect(effectiveLayerOrder(scene, NO_VIEW)).toEqual([STRUCTURE, SERVICES, FURNITURE, UNLAYERED_LAYER_KEY])
  })
})

describe('the effective setting of one layer key (#71 §1)', () => {
  it('defaults to visible, selectable and editable, in the Project colour', () => {
    expect(effectiveLayerSetting(scene, view({}), STRUCTURE)).toEqual({ visible: true, selectable: true, editable: true, color: '#b9b9c2' })
  })

  it('takes each switch and the colour from the view override, and only those it sets', () => {
    const overridden = view({ [STRUCTURE]: { visible: false, color: '#123456' } })
    expect(effectiveLayerSetting(scene, overridden, STRUCTURE)).toEqual({ visible: false, selectable: true, editable: true, color: '#123456' })
    // Another layer is untouched by this view's opinion about Structure.
    expect(effectiveLayerSetting(scene, overridden, SERVICES)).toEqual({ visible: true, selectable: true, editable: true, color: '#5fb3ff' })
  })

  it('gives Unlayered no colour of its own unless this view overrides it', () => {
    expect(effectiveLayerSetting(scene, view({}), UNLAYERED_LAYER_KEY).color).toBeNull()
    expect(effectiveLayerSetting(scene, view({ [UNLAYERED_LAYER_KEY]: { color: '#123456' } }), UNLAYERED_LAYER_KEY).color).toBe('#123456')
  })

  it('is the default for a Project-level surface', () => {
    expect(effectiveLayerSetting(scene, NO_VIEW, FURNITURE)).toEqual({ visible: true, selectable: true, editable: true, color: '#e3a857' })
  })
})

describe('drawn, pickable, modifiable (#71 §4)', () => {
  it('draws only what the Display includes AND the layer makes visible', () => {
    expect(layerAccessOf(scene, view({}), STRUCTURE, ALL)).toEqual({ drawn: true, pickable: true, modifiable: true })
    expect(layerAccessOf(scene, view({ [STRUCTURE]: { visible: false } }), STRUCTURE, ALL).drawn).toBe(false)
    expect(layerAccessOf(scene, view({}), STRUCTURE, { displayIncluded: false }).drawn).toBe(false)
    // A hidden layer hides even where the Display would have drawn it, and vice versa.
    expect(layerAccessOf(scene, view({ [STRUCTURE]: { visible: false } }), STRUCTURE, { displayIncluded: false }).drawn).toBe(false)
  })

  it('picks only drawn content that is selectable and passes the Pick filter', () => {
    expect(layerAccessOf(scene, view({ [STRUCTURE]: { selectable: false } }), STRUCTURE, ALL).pickable).toBe(false)
    expect(layerAccessOf(scene, view({}), STRUCTURE, { displayIncluded: true, pickAllowed: false }).pickable).toBe(false)
    // Not selectable is not the same as hidden: the content is drawn, and the click passes through it.
    const passThrough = layerAccessOf(scene, view({ [STRUCTURE]: { selectable: false } }), STRUCTURE, ALL)
    expect(passThrough.drawn).toBe(true)
    expect(passThrough.pickable).toBe(false)
    // …and hidden content cannot be picked back up by a permissive Pick filter.
    expect(layerAccessOf(scene, view({ [STRUCTURE]: { visible: false } }), STRUCTURE, { displayIncluded: true, pickAllowed: true }).pickable).toBe(false)
  })

  it('modifies only pickable content that is editable and passes the Display edit rules', () => {
    // Read-only content is still drawn and still pickable — that is what "inspect only" means.
    const readOnly = layerAccessOf(scene, view({ [STRUCTURE]: { editable: false } }), STRUCTURE, ALL)
    expect(readOnly).toEqual({ drawn: true, pickable: true, modifiable: false })
    expect(layerAccessOf(scene, view({}), STRUCTURE, { displayIncluded: true, editAllowed: false }).modifiable).toBe(false)
    // A gate further up the chain cannot be undone by the one below it.
    expect(layerAccessOf(scene, view({ [STRUCTURE]: { visible: false, editable: true } }), STRUCTURE, ALL).modifiable).toBe(false)
    expect(layerAccessOf(scene, view({ [STRUCTURE]: { selectable: true, editable: true } }), STRUCTURE, { displayIncluded: true, pickAllowed: false }).modifiable).toBe(false)
  })

  it('answers for Unlayered content, which is a row like any other', () => {
    expect(layerAccessOf(scene, view({}), UNLAYERED_LAYER_KEY, ALL)).toEqual({ drawn: true, pickable: true, modifiable: true })
    expect(layerAccessOf(scene, view({ [UNLAYERED_LAYER_KEY]: { visible: false } }), UNLAYERED_LAYER_KEY, ALL).drawn).toBe(false)
  })
})

describe('snapping (#71 §6, criterion 12)', () => {
  it('excludes hidden and non-selectable content, and lets the view opt back in', () => {
    expect(snapCandidateAllowed(scene, view({}), STRUCTURE)).toBe(true)
    expect(snapCandidateAllowed(scene, view({ [STRUCTURE]: { visible: false } }), STRUCTURE)).toBe(false)
    expect(snapCandidateAllowed(scene, view({ [STRUCTURE]: { selectable: false } }), STRUCTURE)).toBe(false)
    const opted = view({ [STRUCTURE]: { visible: false, selectable: false } }, { snapToHiddenContent: true })
    expect(snapCandidateAllowed(scene, opted, STRUCTURE)).toBe(true)
    // …as a snap target only: it is still not pickable.
    expect(layerAccessOf(scene, opted, STRUCTURE, ALL).pickable).toBe(false)
  })

  it('is allowed for Unlayered content unless this view hides it', () => {
    expect(snapCandidateAllowed(scene, view({}), UNLAYERED_LAYER_KEY)).toBe(true)
    expect(snapCandidateAllowed(scene, view({ [UNLAYERED_LAYER_KEY]: { visible: false } }), UNLAYERED_LAYER_KEY)).toBe(false)
  })
})

describe('layer settings never reach the numbers or the warnings (#71 criterion 9)', () => {
  /** Every layer key, turned against the view in the most restrictive way it can be. */
  const muted = (project: Project): Project => ({
    ...project,
    views: project.views.map((candidate) => ({
      ...candidate,
      snapToHiddenContent: false,
      layerSettings: Object.fromEntries(
        [...(project.drawingLayers ?? []).map((layer) => layer.id), UNLAYERED_LAYER_KEY].map((key) => [key, { visible: false, selectable: false, editable: false }]),
      ),
    })),
  })

  it('leaves warnings and quantities byte-identical', () => {
    for (const optionId of [null, 'option-a']) {
      expect(canonicalJson(deriveWarnings(muted(scene), FLOOR, optionId))).toBe(canonicalJson(deriveWarnings(scene, FLOOR, optionId)))
      expect(canonicalJson(quantitiesForFloor(muted(scene), FLOOR, optionId))).toBe(canonicalJson(quantitiesForFloor(scene, FLOOR, optionId)))
    }
  })

  it('leaves a memo slot built before the toggle answering afterwards', () => {
    // The memo key is (Project, revision, Floor, Option): a per-view style setting is not part of it,
    // so the entry must still hit — otherwise every layer checkbox would re-derive every Floor.
    const project: Project = { ...scene, views: scene.views.map((candidate) => ({ ...candidate })) }
    const cache = createDeriveCache()
    const before = cache.warnings(project, 1, FLOOR, null)
    const quantities = cache.quantities(project, 1, FLOOR, null)
    project.views[0].layerSettings = { [STRUCTURE]: { visible: false, selectable: false, editable: false } }
    project.views[0].snapToHiddenContent = true
    expect(cache.warnings(project, 1, FLOOR, null)).toBe(before)
    expect(cache.quantities(project, 1, FLOOR, null)).toBe(quantities)
  })

  it('still lists a hidden entity in the warnings it earns', () => {
    // Criterion 9's own claim, from the other side: the warning is a fact about the model.
    const warnings = canonicalJson(deriveWarnings(muted(scene), FLOOR, null))
    expect(canonicalJson(deriveWarnings(scene, FLOOR, null))).toBe(warnings)
  })
})

describe('the drawn set is Display-included intersected with visible (#71 criterion 13)', () => {
  const settings = fc.record({
    visible: fc.boolean(),
    selectable: fc.boolean(),
    editable: fc.boolean(),
  })

  it('holds for random layer settings and Displays', { timeout: 30_000 }, async () => {
    await fc.assert(
      fc.property(
        fc.tuple(settings, settings, settings, settings, fc.constantFrom('existing' as const, 'demolition' as const, 'proposed' as const, 'combined' as const), fc.boolean(), fc.boolean()),
        fc.constantFrom(null, 'option-a', 'option-b'),
        (four, optionId) => {
          const [structure, services, furniture, unlayered, display, pickAllowed, editAllowed] = four
          const project: Project = {
            ...scene,
            views: scene.views.map((candidate) => ({
              ...candidate,
              renovationDisplay: display,
              layerSettings: { [STRUCTURE]: structure, [SERVICES]: services, [FURNITURE]: furniture, [UNLAYERED_LAYER_KEY]: unlayered },
            })),
          }
          const current = project.views[0]
          const gates: DrawingGates = { displayIncluded: true, pickAllowed, editAllowed }
          const rows = displayModel(effectiveModel(project, FLOOR, optionId), display)
          const included: readonly { entity: Wall | { id: string } }[] = [...rows.walls, ...rows.openings, ...rows.rooms, ...rows.placedItems]
          const keyOf = (entity: { id: string }): string => entityLayerId(entity as Wall) ?? UNLAYERED_LAYER_KEY
          const ids = (rows_: readonly { entity: { id: string } }[], keep: (key: string) => boolean): string[] =>
            rows_.filter((row) => keep(keyOf(row.entity))).map((row) => row.entity.id)

          const drawn = ids(included, (key) => layerAccessOf(project, current, key, gates).drawn)
          // The drawn set is exactly what the Display included, kept by the layer's visibility — the
          // `Pick:` and edit gates must not reach into it.
          expect(drawn).toEqual(ids(included, (key) => effectiveLayerSetting(project, current, key).visible))
          const pickable = ids(included, (key) => layerAccessOf(project, current, key, gates).pickable)
          expect(pickable.every((id) => drawn.includes(id))).toBe(true)
          const modifiable = ids(included, (key) => layerAccessOf(project, current, key, gates).modifiable)
          expect(modifiable.every((id) => pickable.includes(id))).toBe(true)
        },
      ),
      { numRuns: 60 },
    )
  })
})
