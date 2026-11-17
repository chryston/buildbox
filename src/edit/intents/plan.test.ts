/**
 * The floor-plan family (#47 criteria 3–5): the catalogue table's plan rows, the legacy
 * top-left convention, and the Plan Image rules.
 *
 * A plan object is one generic Item Design plus one Placed Item, so every test here says
 * which half of that pair a patch is allowed to touch.
 */
import { describe, expect, it } from 'vitest'
import type { GenericItemDesign, Project } from '../../domain'
import { canonicalJson } from '../../lib'
import { applyIntent } from '../apply'
import { CUSTOM_PLAN_ENTRY, PLAN_CATALOGUE } from '../planCatalogue'
import {
  basicProject,
  deepFreeze,
  expectDeterministic,
  expectRejection,
  expectRoundTrip,
  idSource,
  intent,
  newProject,
} from '../testing'

function design(project: Project, itemDesignId: string): GenericItemDesign {
  const found = project.itemDesigns.find((candidate) => candidate.id === itemDesignId)
  if (found === undefined || found.kind !== 'generic') throw new Error(`no generic Item Design ${itemDesignId} in this test Project`)
  return found
}

function placement(project: Project, placedItemId: string) {
  const found = project.existingModel.placedItems.find((candidate) => candidate.id === placedItemId)
  if (found === undefined) throw new Error(`no Placed Item ${placedItemId} in this test Project`)
  return found
}

/** A King Bed on the new Project's only Floor, at the legacy spawn point. */
function withBed(): { project: Project; itemDesignId: string; placedItemId: string } {
  const project = newProject()
  const [itemDesignId, placedItemId] = idSource('bed')(2)
  const result = applyIntent(project, intent('plan.addObject', { floorId: project.floors[0]!.id, catalogKey: 'bed-king' }, [itemDesignId, placedItemId]))
  if (!result.ok) throw new Error(`the bed was refused: ${result.code}`)
  return { project: result.project, itemDesignId, placedItemId }
}

describe('plan.addObject', () => {
  it('makes a 1:1 Item Design from the catalogue and spawns it at the legacy corner', () => {
    const project = newProject()
    const [itemDesignId, placedItemId] = idSource('bed')(2)
    const entry = PLAN_CATALOGUE['bed-king']!
    const applied = expectRoundTrip(project, intent('plan.addObject', { floorId: project.floors[0]!.id, catalogKey: 'bed-king' }, [itemDesignId, placedItemId]))

    expect(design(applied.project, itemDesignId)).toEqual({
      id: itemDesignId,
      kind: 'generic',
      name: entry.label,
      footprint: { kind: 'rectangle', width: entry.w, depth: entry.h },
      origin: { x: entry.w / 2, y: entry.h / 2 },
      height: entry.height,
      heightIsTypical: true,
      color: entry.color,
      catalogKey: 'bed-king',
    })
    // The sidebar drops it with its top-left corner at (100, 100).
    expect(placement(applied.project, placedItemId)).toEqual({
      id: placedItemId,
      itemDesignId,
      floorId: project.floors[0]!.id,
      translation: { x: 100 + entry.w / 2, y: 100 + entry.h / 2 },
      rotationDeg: 0,
      baseElevation: entry.base,
    })
    expect(applied.affected).toEqual({
      floorId: project.floors[0]!.id,
      view: 'plan',
      itemDesignIds: [itemDesignId],
      placedItemIds: [placedItemId],
    })
    expectDeterministic(project, intent('plan.addObject', { floorId: project.floors[0]!.id, catalogKey: 'bed-king' }, [itemDesignId, placedItemId]))
  })

  it('refuses a catalog key that does not exist, and an empty ID list', () => {
    const project = deepFreeze(newProject())
    const floorId = project.floors[0]!.id
    expectRejection(project, intent('plan.addObject', { floorId, catalogKey: 'space-shuttle' }, idSource('x')(2)), 'unknown-target')
    expectRejection(project, intent('plan.addObject', { floorId, catalogKey: 'fridge' }, []), 'missing-ids')
    expectRejection(project, intent('plan.addObject', { floorId: 'no-such-floor', catalogKey: 'fridge' }, idSource('x')(2)), 'unknown-target')
  })
})

describe('plan.addFromTemplate', () => {
  it('forks the template instead of placing it', () => {
    const project = basicProject()
    const [itemDesignId, placedItemId] = idSource('fork')(2)
    const applied = expectRoundTrip(project, intent('plan.addFromTemplate', {
      floorId: 'floor-main',
      templateItemDesignId: 'design-custom-chest',
    }, [itemDesignId, placedItemId]))

    const template = design(project, 'design-custom-chest')
    const fork = design(applied.project, itemDesignId)
    expect(fork).toEqual({ ...template, id: itemDesignId, isCustom: true })
    expect(placement(applied.project, placedItemId)).toMatchObject({
      itemDesignId,
      floorId: 'floor-main',
      translation: { x: 100 + template.footprint.width / 2, y: 100 + template.footprint.depth / 2 },
      baseElevation: CUSTOM_PLAN_ENTRY.base,
    })
    // The template itself is still in the sidebar, unplaced.
    expect(placement(applied.project, 'place-chest').itemDesignId).toBe('design-custom-chest')
  })

  it('refuses a design that is not a custom shape', () => {
    const project = deepFreeze(basicProject())
    expectRejection(
      project,
      intent('plan.addFromTemplate', { floorId: 'floor-main', templateItemDesignId: 'design-bed-king' }, idSource('x')(2)),
      'unknown-target',
    )
  })
})

describe('plan.updateObject', () => {
  it('moves the object by its legacy top-left corner', () => {
    const { project, itemDesignId, placedItemId } = withBed()
    const applied = expectRoundTrip(project, intent('plan.updateObject', { placedItemId, patch: { x: 500, y: 400 } }))
    expect(placement(applied.project, placedItemId).translation).toEqual({ x: 500 + 910, y: 400 + 990 })
    expect(canonicalJson(design(applied.project, itemDesignId))).toBe(canonicalJson(design(project, itemDesignId)))
  })

  it('resizes without moving the top-left corner', () => {
    const { project, itemDesignId, placedItemId } = withBed()
    const applied = expectRoundTrip(project, intent('plan.updateObject', { placedItemId, patch: { w: 2000, h: 1980 } }))
    const entry = PLAN_CATALOGUE['bed-king']!
    expect(placement(applied.project, placedItemId).translation).toEqual({ x: 100 + 1000, y: 100 + entry.h / 2 })
    expect(design(applied.project, itemDesignId).footprint).toEqual({ kind: 'rectangle', width: 2000, depth: 1980 })
    expect(design(applied.project, itemDesignId).origin).toEqual({ x: 1000, y: 990 })
  })

  it('keeps rotation inside one turn, the way the validator wants it', () => {
    const { project, placedItemId } = withBed()
    for (const [rotation, expected] of [[45, 45], [400, 40], [-90, 270]] as const) {
      const applied = expectRoundTrip(project, intent('plan.updateObject', { placedItemId, patch: { rotation } }))
      expect(applied.project.existingModel.placedItems.find((item) => item.id === placedItemId)!.rotationDeg).toBe(expected)
    }
    // A full turn from a turned object lands back on zero rather than on 360.
    const turned = applyIntent(project, intent('plan.updateObject', { placedItemId, patch: { rotation: 90 } }))
    if (!turned.ok) throw new Error('the turn was refused')
    const spun = expectRoundTrip(turned.project, intent('plan.updateObject', { placedItemId, patch: { rotation: 360 } }))
    expect(placement(spun.project, placedItemId).rotationDeg).toBe(0)
    expectRejection(spun.project, intent('plan.updateObject', { placedItemId, patch: { rotation: 720 } }), 'no-change')
  })

  it('writes the label and colour onto the design, not the placement', () => {
    const { project, itemDesignId, placedItemId } = withBed()
    const applied = expectRoundTrip(project, intent('plan.updateObject', { placedItemId, patch: { label: 'Guest bed', color: '#00ff00' } }))
    expect(design(applied.project, itemDesignId).name).toBe('Guest bed')
    expect(design(applied.project, itemDesignId).color).toBe('#00ff00')
    expect(canonicalJson(placement(applied.project, placedItemId))).toBe(canonicalJson(placement(project, placedItemId)))
  })

  it('refuses an object below the legacy 10 mm floor, rather than clamping it', () => {
    const { project, placedItemId } = deepFreeze(withBed())
    expectRejection(project, intent('plan.updateObject', { placedItemId, patch: { w: 5 } }), 'invalid-size')
    expectRejection(project, intent('plan.updateObject', { placedItemId, patch: { h: 9.99 } }), 'invalid-size')
  })

  it('refuses a patch that changes nothing, and one that names nothing', () => {
    const { project, placedItemId } = deepFreeze(withBed())
    const here = placement(project, placedItemId).translation
    expectRejection(project, intent('plan.updateObject', { placedItemId, patch: { x: here.x - 910, y: here.y - 990 } }), 'no-change')
    expectRejection(project, intent('plan.updateObject', { placedItemId: 'gone', patch: { x: 1 } }), 'unknown-target')
  })

  it('refuses to treat a cabinet placement as a floor-plan object', () => {
    const project = deepFreeze(basicProject())
    expectRejection(project, intent('plan.updateObject', { placedItemId: 'place-base-left', patch: { label: 'No' } }), 'unknown-target')
  })
})

describe('plan.removeObject', () => {
  it('removes the placement and the design that was its alone', () => {
    const { project, itemDesignId, placedItemId } = withBed()
    const applied = expectRoundTrip(project, intent('plan.removeObject', { placedItemId }))
    expect(applied.project.existingModel.placedItems.some((item) => item.id === placedItemId)).toBe(false)
    expect(applied.project.itemDesigns.some((item) => item.id === itemDesignId)).toBe(false)
  })

  it('keeps a design another placement still uses', () => {
    const project = basicProject()
    const applied = expectRoundTrip(project, intent('plan.removeObject', { placedItemId: 'place-base-left' }))
    expect(applied.project.itemDesigns.some((item) => item.id === 'design-base-cabinet')).toBe(true)
    expect(applied.project.existingModel.placedItems.some((item) => item.id === 'place-base-left')).toBe(false)
  })
})

describe('plan.addTemplate and plan.removeTemplate', () => {
  it('saves a custom shape as an unplaced design', () => {
    const project = newProject()
    const [itemDesignId] = idSource('tpl')(1)
    const applied = expectRoundTrip(project, intent('plan.addTemplate', { label: 'Bay window', w: 1200, h: 400, color: '#123456' }, [itemDesignId]))
    expect(design(applied.project, itemDesignId)).toEqual({
      id: itemDesignId,
      kind: 'generic',
      name: 'Bay window',
      footprint: { kind: 'rectangle', width: 1200, depth: 400 },
      origin: { x: 600, y: 200 },
      height: CUSTOM_PLAN_ENTRY.height,
      heightIsTypical: true,
      color: '#123456',
      isCustom: true,
    })
    expect(applied.project.existingModel.placedItems.length).toBe(1)
    expect(applied.affected).toEqual({ floorId: null, view: 'plan', itemDesignIds: [itemDesignId], placedItemIds: [] })
  })

  it('removes a custom shape that is not placed', () => {
    const project = basicProject()
    const applied = expectRoundTrip(project, intent('plan.removeTemplate', { itemDesignId: 'design-legacy-wardrobe' }))
    expect(applied.project.itemDesigns.map((item) => item.id)).not.toContain('design-legacy-wardrobe')
  })

  it('refuses to remove a custom shape that is standing on the floor plan', () => {
    const project = deepFreeze(basicProject())
    expectRejection(project, intent('plan.removeTemplate', { itemDesignId: 'design-custom-chest' }), 'unknown-target')
    expectRejection(project, intent('plan.removeTemplate', { itemDesignId: 'design-bed-king' }), 'unknown-target')
  })
})

describe('the Plan Image', () => {
  const IMAGE = { assetHash: 'a'.repeat(64), mediaType: 'image/png' as const, widthPx: 1000, heightPx: 800 }

  it('sets an image and keeps the scale the user already calibrated', () => {
    const project = basicProject()
    const applied = expectRoundTrip(project, intent('plan.setImage', { floorId: 'floor-main', image: IMAGE, clearExisting: false }))
    expect(applied.project.floors.find((floor) => floor.id === 'floor-main')!.planImage).toEqual({ ...IMAGE, pixelsPerMm: 0.5 })
    // Nothing else moved: the objects are still standing.
    expect(applied.project.existingModel.placedItems.length).toBe(project.existingModel.placedItems.length)
  })

  it('clears the floor plan in the same transaction when the upload confirms one', () => {
    const project = basicProject()
    const applied = expectRoundTrip(project, intent('plan.setImage', { floorId: 'floor-mezz', image: IMAGE, clearExisting: true }))
    const floor = applied.project.floors.find((candidate) => candidate.id === 'floor-mezz')!
    expect(floor.planImage).toEqual({ ...IMAGE, pixelsPerMm: null })
    expect(applied.project.existingModel.placedItems.map((item) => item.floorId)).toEqual(['floor-main', 'floor-main'])
    // The cabinet design survives; the mezzanine's own objects do not. The template stays.
    expect(applied.project.itemDesigns.map((item) => item.id)).toEqual(['design-base-cabinet', 'design-legacy-wardrobe'])
  })

  it('removes the image, and refuses a Floor with no image to calibrate', () => {
    const project = basicProject()
    const removed = expectRoundTrip(project, intent('plan.setImage', { floorId: 'floor-main', image: null, clearExisting: false }))
    expect(removed.project.floors.find((floor) => floor.id === 'floor-main')!.planImage).toBeNull()
    expectRejection(removed.project, intent('plan.calibrate', { floorId: 'floor-main', pixelsPerMm: 0.4 }), 'unknown-target')
  })

  it('cabinet.plan.calibrate changes only the scale', () => {
    const project = basicProject()
    const applied = expectRoundTrip(project, intent('plan.calibrate', { floorId: 'floor-main', pixelsPerMm: 0.25 }))
    expect(applied.project.floors.find((floor) => floor.id === 'floor-main')!.planImage!.pixelsPerMm).toBe(0.25)
    expect(canonicalJson(applied.project.existingModel)).toBe(canonicalJson(project.existingModel))
    expect(canonicalJson(applied.project.itemDesigns)).toBe(canonicalJson(project.itemDesigns))
  })
})

describe('plan.clear', () => {
  it('takes the floor plan objects with it and leaves the picture, the templates and the cabinets', () => {
    const project = basicProject()
    const applied = expectRoundTrip(project, intent('plan.clear', { floorId: 'floor-mezz' }))
    const floor = applied.project.floors.find((candidate) => candidate.id === 'floor-mezz')!
    expect(floor.planImage!.assetHash).toBe(project.floors[1]!.planImage!.assetHash)
    expect(floor.planImage!.pixelsPerMm).toBeNull()
    expect(applied.project.existingModel.placedItems.map((item) => item.floorId)).toEqual(['floor-main', 'floor-main'])
    expect(applied.project.itemDesigns.map((item) => item.id)).toEqual(['design-base-cabinet', 'design-legacy-wardrobe'])
    expect(applied.affected.placedItemIds).toEqual(['place-bed', 'place-chest'])
  })

  it('refuses to clear a floor plan that is already clear', () => {
    const project = basicProject()
    const cleared = applyIntent(project, intent('plan.clear', { floorId: 'floor-mezz' }))
    if (!cleared.ok) throw new Error('the first clear was refused')
    expectRejection(deepFreeze(cleared.project), intent('plan.clear', { floorId: 'floor-mezz' }), 'no-change')
  })
})
