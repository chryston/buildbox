/**
 * The Drawing Layer half of the catalogue (#71 §2–§5), under `VITE_FF_RENOVATION=true`: this file
 * runs in the `renovation` project (`npm run test:renovation`) and nowhere else. With the flag off
 * these ten types have no handler at all, and `applyIntent` answers one of them with the rejection
 * any unknown type gets — which is what `../intents.test.ts` checks.
 *
 * Every case here is about the two promises the feature rests on: a layer operation never changes
 * what a model record *is* (so the entity count, and every record's geometry, survive untouched),
 * and a view's layer state is derived from the data rather than remembered — which is why an
 * override that says the default in other words has to be absent, not present-and-default.
 */
import { describe, expect, it } from 'vitest'
import layersFixture from '../../../fixtures/domain/v7/rooms.json?raw'
import type { DesignOption, DrawingLayer, PlacedItem, Project, Wall } from '../../domain'
import { validateProject } from '../../domain'
import { canonicalJson } from '../../lib'
import { applyIntent, intentIdCount, intentLabel, previewIntent } from '../index'
import { expectRoundTrip, intent } from '../testing'

const base = (JSON.parse(layersFixture) as { project: Project }).project

const SHELL = 'layer-shell'
const SOFT = 'layer-soft'

/** A Design Option holding exactly the records `proposed` names. */
function optionWith(id: string, name: string, proposed: Partial<DesignOption['proposed']>): DesignOption {
  return {
    id,
    name,
    demolishedIds: [],
    proposed: { walls: [], wallJunctions: [], openings: [], rooms: [], placedItems: [], ...proposed },
  }
}

/** A copy of an Existing Wall reborn as proposed work of its own. */
function proposedWall(id: string, ref: string, layerId: string | null): Wall {
  const source = base.existingModel.walls[0]!
  return { ...source, id, ref, predecessorIds: [], drawingLayerId: layerId }
}

/** A Placed Item of a design the fixture already carries. */
function proposedItem(id: string, layerId: string | null): PlacedItem {
  const source = base.existingModel.placedItems[0]!
  return { ...source, id, predecessorIds: [], drawingLayerId: layerId }
}

/**
 * The deletion scene of #71 §5: five records on one layer — two of them the baseline, three of them
 * proposed work of two different Options — and two saved views that say something about that layer.
 *
 * The mix is the point. A delete that only swept the Existing Model would leave the Option records
 * naming a layer that no longer exists, and a delete that only swept the active Option would leave
 * the same orphan one Option away.
 */
function scene(): Project {
  return {
    ...base,
    drawingLayers: [
      { id: SHELL, name: 'Structure', color: '#b9b9c2' },
      { id: SOFT, name: 'Furniture', color: '#e3a857' },
    ],
    designOptions: [
      optionWith('option-a', 'Option A', { walls: [proposedWall('wall-a1', 'W-A1', SHELL), proposedWall('wall-a2', 'W-A2', SHELL)] }),
      optionWith('option-b', 'Option B', { placedItems: [proposedItem('place-b1', SHELL), proposedItem('place-b2', SOFT)] }),
    ],
    existingModel: {
      ...base.existingModel,
      walls: base.existingModel.walls.map((wall, index) => (index === 0 ? { ...wall, drawingLayerId: SHELL } : wall)),
      rooms: base.existingModel.rooms.map((room, index) => (index === 0 ? { ...room, drawingLayerId: SHELL } : room)),
    },
    views: base.views.map((view, index) =>
      index === 0
        ? { ...view, layerSettings: { [SHELL]: { visible: false, selectable: false, editable: false } } }
        : { ...view, layerOrder: [SOFT, SHELL, 'unlayered'] },
    ),
  }
}

/** The Project the flag-on migrator hands over: three layers, no overrides, nothing filed. */
function defaults(): Project {
  return {
    ...base,
    drawingLayers: [
      { id: 'layer-structure', name: 'Structure', color: '#b9b9c2' },
      { id: 'layer-services', name: 'Services', color: '#5fb3ff' },
      { id: 'layer-furniture', name: 'Furniture', color: '#e3a857' },
    ],
  }
}

/** How many model records the whole Project holds, Existing and proposed together. */
function recordCount(project: Project): number {
  const models = [project.existingModel, ...(project.designOptions ?? []).map((option) => option.proposed)]
  return models.reduce(
    (total, model) =>
      total + model.walls.length + model.openings.length + model.rooms.length + model.placedItems.length,
    0,
  )
}

const applied = (project: Project, next: Parameters<typeof applyIntent>[1]) => {
  const result = applyIntent(project, next)
  if (!result.ok) throw new Error(`${next.type} was refused with ${result.code}: ${JSON.stringify(result.problems)}`)
  return result
}

describe('layer.add (#71 §2)', () => {
  it('spends one ID and joins the front of the order', () => {
    const project = defaults()
    const result = applied(project, intent('layer.add', { name: 'Roof Void', color: '#9ad48a' }, ['layer-new']))
    expect(intentIdCount('layer.add')).toBe(1)
    expect(intentLabel('layer.add')).toBe('New Layer')
    // The end of the array is the front of the drawing, so the layer just made is the top row.
    expect(result.project.drawingLayers?.map((layer) => layer.id)).toEqual(['layer-structure', 'layer-services', 'layer-furniture', 'layer-new'])
    expect(validateProject(result.project).ok).toBe(true)
    expectRoundTrip(project, intent('layer.add', { name: 'Roof Void', color: '#9ad48a' }, ['layer-new']))
  })

  it('joins the front of every view that has an order of its own', () => {
    // A view's own order is a full one, so a layer added to the Project has to be placed in it — at
    // the front, the same place the Project put it. A view following the Project writes nothing.
    const project = scene()
    const result = applied(project, intent('layer.add', { name: 'Roof Void', color: '#9ad48a' }, ['layer-roof']))
    expect(result.project.views[0]!.layerOrder).toBeUndefined()
    expect(result.project.views[1]!.layerOrder).toEqual([SOFT, SHELL, 'unlayered', 'layer-roof'])
    expect(validateProject(result.project).ok).toBe(true)
  })

  it('refuses a blank name, a name the Project already answers to, and a colour it cannot draw', () => {
    const project = defaults()
    for (const [payload, why] of [
      [{ name: '   ', color: '#5fb3ff' }, 'a name'],
      [{ name: ' structure ', color: '#5fb3ff' }, 'a name another layer answers to folded'],
      [{ name: 'Services', color: '#GGG' }, 'a colour'],
      [{ name: 'Services', color: '5fb3ff' }, 'a colour without a hash'],
    ] as const) {
      const result = applyIntent(project, intent('layer.add', payload, ['layer-new']))
      expect(result.ok, why).toBe(false)
      if (!result.ok) expect(result.code).toBe('layer-blocked')
    }
    expect(project.drawingLayers?.length).toBe(3)
  })

  it('trims the name it keeps', () => {
    const result = applied(defaults(), intent('layer.add', { name: '  Roof Void  ', color: '#9ad48a' }, ['layer-roof']))
    expect(result.project.drawingLayers?.[result.project.drawingLayers.length - 1]?.name).toBe('Roof Void')
  })
})

describe('layer.rename and layer.setColor (#71 §2)', () => {
  it('re-labels a layer without re-filing anything that sits on it', () => {
    const project = scene()
    const before = project.existingModel.walls[0]!.drawingLayerId
    const result = applied(project, intent('layer.rename', { layerId: SHELL, name: 'Shell' }))
    expect(result.project.drawingLayers?.find((layer) => layer.id === SHELL)?.name).toBe('Shell')
    // The layer's ID is what its members point at, so renaming changes no record at all.
    expect(result.project.existingModel.walls[0]!.drawingLayerId).toBe(before)
    expect(canonicalJson(result.project.existingModel)).toBe(canonicalJson(project.existingModel))
    expectRoundTrip(project, intent('layer.rename', { layerId: SHELL, name: 'Shell' }))
  })

  it('refuses a name another layer answers to, and one that is empty', () => {
    const project = scene()
    expect(applyIntent(project, intent('layer.rename', { layerId: SHELL, name: ' furniture ' })).ok).toBe(false)
    expect(applyIntent(project, intent('layer.rename', { layerId: SHELL, name: '  ' })).ok).toBe(false)
    // Renaming a layer to the name it already has changed nothing, and an empty undo step is refused
    // the same way every other no-op Intent in the catalogue is (#47 criterion 3).
    expect(applyIntent(project, intent('layer.rename', { layerId: SHELL, name: 'Structure' })).ok).toBe(false)
    expect(applyIntent(project, intent('layer.rename', { layerId: SHELL, name: 'Structure' }))).toMatchObject({ code: 'no-change' })
  })

  it('changes only the colour', () => {
    const project = scene()
    const result = applied(project, intent('layer.setColor', { layerId: SOFT, color: '#9ad48a' }))
    expect(result.project.drawingLayers?.find((layer) => layer.id === SOFT)).toEqual({ id: SOFT, name: 'Furniture', color: '#9ad48a' })
    expect(applyIntent(project, intent('layer.setColor', { layerId: SOFT, color: 'rebeccapurple' })).ok).toBe(false)
    expectRoundTrip(project, intent('layer.setColor', { layerId: SOFT, color: '#9ad48a' }))
  })

  it('refuses a layer the Project does not have', () => {
    const result = applyIntent(scene(), intent('layer.rename', { layerId: 'layer-gone', name: 'Shell' }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('layer-blocked')
  })
})

describe('layer.move (#71 §2)', () => {
  it('swaps a layer with its neighbour in each direction', () => {
    const project = defaults()
    const order = (project: Project): (string | undefined)[] => project.drawingLayers?.map((layer) => layer.id) ?? []
    const forward = applied(project, intent('layer.move', { layerId: 'layer-structure', direction: 'forward' }))
    expect(order(forward.project)).toEqual(['layer-services', 'layer-structure', 'layer-furniture'])
    const back = applied(forward.project, intent('layer.move', { layerId: 'layer-structure', direction: 'back' }))
    expect(order(back.project)).toEqual(order(project))
    expectRoundTrip(project, intent('layer.move', { layerId: 'layer-structure', direction: 'forward' }))
    expect(intentLabel('layer.move')).toBe('Reorder Layer')
  })

  it('refuses a layer already at the end it is being pushed toward', () => {
    const project = defaults()
    // The last row is the front of the drawing: there is nothing in front of it.
    const result = applyIntent(project, intent('layer.move', { layerId: 'layer-furniture', direction: 'forward' }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('layer-blocked')
    expect(applyIntent(project, intent('layer.move', { layerId: 'layer-structure', direction: 'back' })).ok).toBe(false)
  })
})

describe('layer.delete (#71 §5)', () => {
  it('reports five records, no annotations and two views', () => {
    const project = scene()
    const review = previewIntent(project, intent('layer.delete', { layerId: SHELL, viewId: 'view-0' })).review
    expect(review).not.toBeNull()
    if (review?.kind !== 'delete-layer') throw new Error('the review is not a layer review')
    expect(review.counts).toEqual({ model: 5, annotations: 0, overrides: 2 })
    expect(review.viewNames).toEqual(['Floor 1', 'Mezzanine'])
    expect(review.unused).toBe(false)
    expect(review.members.length).toBe(5)
    // The labels are the ones the canvas uses, not the IDs behind them.
    expect(review.members.map((member) => member.label)).toEqual(['W-1', 'Living', 'W-A1', 'W-A2', 'Base Cabinet'])
    // `view-0` hides the Unlayered row? It does not — so the content this delete un-files stays visible.
    expect(review.unlayeredHidden).toBe(false)
    expect(review.message).toContain('5 items are')
  })

  it('says so when the view the dialog stands in hides Unlayered content', () => {
    const project: Project = {
      ...scene(),
      views: scene().views.map((view) => ({ ...view, layerSettings: { unlayered: { visible: false, selectable: true, editable: true } } })),
    }
    const review = previewIntent(project, intent('layer.delete', { layerId: SHELL, viewId: 'view-0' })).review
    if (review?.kind !== 'delete-layer') throw new Error('the review is not a layer review')
    expect(review.unlayeredHidden).toBe(true)
  })

  it('keeps the dialog short for a layer nothing is on', () => {
    const project = defaults()
    const review = previewIntent(project, intent('layer.delete', { layerId: 'layer-services', viewId: null })).review
    if (review?.kind !== 'delete-layer') throw new Error('the review is not a layer review')
    expect(review.unused).toBe(true)
    expect(review.counts).toEqual({ model: 0, annotations: 0, overrides: 0 })
    expect(review.members).toEqual([])
    expect(review.message).toBe('Unused. Nothing else changes.')
  })

  it('un-files every member, drops every override and order entry, and clears the active layer', () => {
    const project = scene()
    const withActive: Project = {
      ...project,
      views: project.views.map((view) => ({ ...view, activeLayerId: SHELL, snapToHiddenContent: true })),
    }
    const result = applied(withActive, intent('layer.delete', { layerId: SHELL, viewId: 'view-0' }))
    expect(result.project.drawingLayers?.map((layer) => layer.id)).toEqual([SOFT])
    // Nothing is destroyed: every record comes back Unlayered, the state a record written before
    // layers existed is already in.
    expect(recordCount(result.project)).toBe(recordCount(project))
    for (const model of [result.project.existingModel, ...result.project.designOptions!.map((option) => option.proposed)])
      for (const record of [...model.walls, ...model.openings, ...model.rooms, ...model.placedItems])
        expect(record.drawingLayerId === SHELL ? null : record.drawingLayerId ?? null).not.toBe(SHELL)
    expect(result.project.existingModel.walls[0]!.drawingLayerId).toBeNull()
    expect(result.project.designOptions![0]!.proposed.walls[0]!.drawingLayerId).toBeNull()
    // The other layer is untouched, and so is the record that was already on it.
    expect(result.project.designOptions![1]!.proposed.placedItems[1]!.drawingLayerId).toBe(SOFT)
    // View 0 loses exactly the one override — and with it the map, which said nothing else; view 1's
    // order keeps its arrangement minus the layer.
    expect(result.project.views[0]!.layerSettings).toBeUndefined()
    expect(result.project.views[1]!.layerOrder).toEqual([SOFT, 'unlayered'])
    expect(result.project.views.map((view) => view.activeLayerId)).toEqual([null, null])
    expect(validateProject(result.project).ok).toBe(true)
    expectRoundTrip(withActive, intent('layer.delete', { layerId: SHELL, viewId: 'view-0' }))
  })

  it('never changes how many model records the Project holds', () => {
    const project = scene()
    const before = recordCount(project)
    for (const next of [
      intent('layer.add', { name: 'Roof Void', color: '#9ad48a' }, ['layer-roof']),
      intent('layer.rename', { layerId: SHELL, name: 'Shell' }),
      intent('layer.setColor', { layerId: SOFT, color: '#9ad48a' }),
      intent('layer.move', { layerId: SHELL, direction: 'forward' }),
      intent('layer.delete', { layerId: SHELL, viewId: null }),
    ])
      expect(recordCount(applied(project, next).project), next.type).toBe(before)
  })

  it('refuses a layer the Project does not have', () => {
    expect(applyIntent(scene(), intent('layer.delete', { layerId: 'layer-gone', viewId: null })).ok).toBe(false)
  })
})

describe('view.setLayerSetting (#71 §3)', () => {
  it('records an override for one layer of one view', () => {
    const project = defaults()
    const result = applied(project, intent('view.setLayerSetting', { viewId: 'view-0', layerKey: 'layer-services', setting: { visible: false } }))
    expect(result.project.views[0]!.layerSettings).toEqual({ 'layer-services': { visible: false, selectable: true, editable: true } })
    // The other view follows the Project default, which is the whole point of a per-view setting.
    expect(result.project.views[1]!.layerSettings).toBeUndefined()
    expectRoundTrip(project, intent('view.setLayerSetting', { viewId: 'view-0', layerKey: 'layer-services', setting: { visible: false } }))
    expect(intentLabel('view.setLayerSetting')).toBe('Set Layer')
  })

  it('drops the override when the view ends up saying the default', () => {
    const project = defaults()
    const hidden = applied(project, intent('view.setLayerSetting', { viewId: 'view-0', layerKey: 'layer-services', setting: { visible: false } }))
    const back = applied(hidden.project, intent('view.setLayerSetting', { viewId: 'view-0', layerKey: 'layer-services', setting: { visible: true } }))
    // Byte-identical to a view that was never touched, so the panel's state is read from the data.
    expect(canonicalJson(back.project)).toBe(canonicalJson(project))
  })

  it('hands one field back to the Project with null and keeps the others', () => {
    const project = defaults()
    const coloured = applied(project, intent('view.setLayerSetting', { viewId: 'view-0', layerKey: 'layer-services', setting: { color: '#123456', editable: false } }))
    expect(coloured.project.views[0]!.layerSettings).toEqual({ 'layer-services': { visible: true, selectable: true, editable: false, color: '#123456' } })
    const cleared = applied(coloured.project, intent('view.setLayerSetting', { viewId: 'view-0', layerKey: 'layer-services', setting: { color: null } }))
    expect(cleared.project.views[0]!.layerSettings).toEqual({ 'layer-services': { visible: true, selectable: true, editable: false } })
  })

  it('takes the unlayered row by its key', () => {
    const result = applied(defaults(), intent('view.setLayerSetting', { viewId: 'view-0', layerKey: 'unlayered', setting: { visible: false } }))
    expect(result.project.views[0]!.layerSettings).toEqual({ unlayered: { visible: false, selectable: true, editable: true } })
    expect(validateProject(result.project).ok).toBe(true)
  })

  it('refuses a key that names no layer, and a colour it cannot draw', () => {
    const project = defaults()
    expect(applyIntent(project, intent('view.setLayerSetting', { viewId: 'view-0', layerKey: 'layer-gone', setting: { visible: false } })).ok).toBe(false)
    expect(applyIntent(project, intent('view.setLayerSetting', { viewId: 'view-0', layerKey: 'unlayered', setting: { color: 'red' } })).ok).toBe(false)
    expect(applyIntent(project, intent('view.setLayerSetting', { viewId: 'view-gone', layerKey: 'unlayered', setting: { visible: false } })).ok).toBe(false)
  })
})

describe('view.setLayerOrder, view.setActiveLayer and view.setSnapToHidden (#71 §3, §4)', () => {
  it('stores a whole order of its own, and null to follow the Project again', () => {
    const project = defaults()
    const order = ['layer-furniture', 'layer-structure', 'layer-services', 'unlayered']
    const result = applied(project, intent('view.setLayerOrder', { viewId: 'view-0', layerOrder: order }))
    expect(result.project.views[0]!.layerOrder).toEqual(order)
    const back = applied(result.project, intent('view.setLayerOrder', { viewId: 'view-0', layerOrder: null }))
    expect(back.project.views[0]!.layerOrder).toBeNull()
    expectRoundTrip(project, intent('view.setLayerOrder', { viewId: 'view-0', layerOrder: order }))
  })

  it('refuses an order that leaves a layer out, names one twice, or names something else', () => {
    const project = defaults()
    for (const layerOrder of [
      ['layer-structure', 'layer-services', 'unlayered'],
      ['layer-structure', 'layer-structure', 'layer-services', 'layer-furniture', 'unlayered'],
      ['layer-structure', 'layer-services', 'layer-furniture', 'layer-gone', 'unlayered'],
    ]) {
      const result = applyIntent(project, intent('view.setLayerOrder', { viewId: 'view-0', layerOrder }))
      expect(result.ok, JSON.stringify(layerOrder)).toBe(false)
      if (!result.ok) expect(result.code).toBe('layer-blocked')
    }
  })

  it('names the layer new content lands on, with null for Unlayered', () => {
    const project = defaults()
    const result = applied(project, intent('view.setActiveLayer', { viewId: 'view-0', layerId: 'layer-furniture' }))
    expect(result.project.views[0]!.activeLayerId).toBe('layer-furniture')
    expect(applied(result.project, intent('view.setActiveLayer', { viewId: 'view-0', layerId: null })).project.views[0]!.activeLayerId).toBeNull()
    expect(applyIntent(project, intent('view.setActiveLayer', { viewId: 'view-0', layerId: 'layer-gone' })).ok).toBe(false)
    expectRoundTrip(project, intent('view.setActiveLayer', { viewId: 'view-0', layerId: 'layer-furniture' }))
  })

  it('toggles snapping to hidden content', () => {
    const project = defaults()
    expect(applied(project, intent('view.setSnapToHidden', { viewId: 'view-0', snapToHidden: true })).project.views[0]!.snapToHiddenContent).toBe(true)
    expectRoundTrip(project, intent('view.setSnapToHidden', { viewId: 'view-0', snapToHidden: true }))
  })
})

describe('entity.setLayer (#71 §5)', () => {
  it('files a record on a layer and takes it off again', () => {
    const project = defaults()
    const result = applied(project, intent('entity.setLayer', { entityId: 'wall-1', layerId: 'layer-structure' }))
    expect(result.project.existingModel.walls[0]!.drawingLayerId).toBe('layer-structure')
    const off = applied(result.project, intent('entity.setLayer', { entityId: 'wall-1', layerId: null }))
    expect(off.project.existingModel.walls[0]!.drawingLayerId).toBeNull()
    expectRoundTrip(project, intent('entity.setLayer', { entityId: 'wall-1', layerId: 'layer-structure' }))
    expect(intentLabel('entity.setLayer')).toBe('Move to Layer')
  })

  it('files proposed work of the Option the view is looking through', () => {
    const project = scene()
    const result = applied(project, intent('entity.setLayer', { entityId: 'wall-a1', layerId: SOFT, target: { designOptionId: 'option-a' } }))
    expect(result.project.designOptions![0]!.proposed.walls[0]!.drawingLayerId).toBe(SOFT)
    // The baseline record of the same Option is a different record and stays where it was.
    expect(result.project.existingModel.walls[0]!.drawingLayerId).toBe(SHELL)
  })

  it('is not a baseline correction: re-filing an Existing record needs no dialog (#71 §5)', () => {
    const project = scene()
    expect(project.designOptions!.length).toBeGreaterThan(0)
    const result = applyIntent(project, intent('entity.setLayer', { entityId: 'wall-1', layerId: SOFT }))
    if (!result.ok) throw new Error(`re-filing a baseline record was refused with ${result.code}`)
    expect(result.project.existingModel.walls[0]!.drawingLayerId).toBe(SOFT)
    // Only the layer moved: the Wall itself is byte-identical, which is what makes this presentation.
    const before = { ...base.existingModel.walls[0]!, drawingLayerId: SOFT }
    expect(canonicalJson(result.project.existingModel.walls[0])).toBe(canonicalJson(before))
  })

  it('leaves every other baseline edit behind the dialog', () => {
    const project = scene()
    // The exemption is read off the patch path, so an Intent that changes the Wall *and* re-files it
    // still trips the guard on its other patches.
    const result = applyIntent(project, intent('wall.setLength', { wallId: 'wall-1', length: 3000, keepFixed: 'start' }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('baseline-correction-required')
  })

  it('refuses a record that is not there and a layer that is not there', () => {
    const project = defaults()
    expect(applyIntent(project, intent('entity.setLayer', { entityId: 'wall-gone', layerId: 'layer-structure' })).ok).toBe(false)
    expect(applyIntent(project, intent('entity.setLayer', { entityId: 'wall-1', layerId: 'layer-gone' })).ok).toBe(false)
  })
})

describe('the layer list is Project data (#71 §1)', () => {
  it('starts a migrated Project with the three layers, back to front', () => {
    const layers: DrawingLayer[] = defaults().drawingLayers!
    expect(layers.map((layer) => layer.name)).toEqual(['Structure', 'Services', 'Furniture'])
    expect(layers.map((layer) => layer.color)).toEqual(['#b9b9c2', '#5fb3ff', '#e3a857'])
  })
})
