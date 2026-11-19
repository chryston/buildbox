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
  expectApplied,
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
      viewId: null, view: 'plan',
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

describe('plan.placeDesign', () => {
  it('places a second Placed Item that references the same design (#57 criterion 13)', () => {
    const project = basicProject()
    const [placedItemId] = idSource('place')(1)
    const applied = expectRoundTrip(project, intent('plan.placeDesign', {
      floorId: 'floor-main',
      itemDesignId: 'design-custom-chest',
    }, [placedItemId]))

    expect(applied.project.itemDesigns.length, 'reuse creates no design').toBe(project.itemDesigns.length)
    expect(placement(applied.project, placedItemId)).toMatchObject({
      itemDesignId: 'design-custom-chest',
      floorId: 'floor-main',
      translation: { x: 100 + 450, y: 100 + 225 },
      rotationDeg: 0,
      baseElevation: 0,
    })
    expect(applied.affected).toEqual({
      floorId: 'floor-main',
      viewId: null,
      view: 'plan',
      itemDesignIds: ['design-custom-chest'],
      placedItemIds: [placedItemId],
    })
  })

  it('reuses a migrated custom shape and a cabinet alike (#57 criterion 14)', () => {
    const project = basicProject()
    const [first, second] = idSource('twice')(2)
    const onGround = expectApplied(project, intent('plan.placeDesign', { floorId: 'floor-main', itemDesignId: 'design-base-cabinet' }, [first]))
    const onMezz = expectApplied(onGround.project, intent('plan.placeDesign', { floorId: 'floor-mezz', itemDesignId: 'design-base-cabinet' }, [second]))
    const ids = onMezz.project.existingModel.placedItems.filter((item) => item.itemDesignId === 'design-base-cabinet')
    expect(ids.map((item) => item.id).sort()).toEqual(['place-base-left', 'place-base-right', first, second].sort())
    expect(onMezz.project.itemDesigns.filter((item) => item.id === 'design-base-cabinet').length).toBe(1)
  })

  it('refuses a design or a Floor that is not in the Project', () => {
    const project = deepFreeze(basicProject())
    expectRejection(project, intent('plan.placeDesign', { floorId: 'floor-main', itemDesignId: 'nope' }, ['p']), 'unknown-target')
    expectRejection(project, intent('plan.placeDesign', { floorId: 'nope', itemDesignId: 'design-bed-king' }, ['p']), 'unknown-target')
    expectRejection(project, intent('plan.placeDesign', { floorId: 'floor-main', itemDesignId: 'design-bed-king' }, []), 'missing-ids')
  })
})

describe('plan.movePlacement and plan.rotatePlacement', () => {
  it('writes the Item Origin position and nothing else (#57 criterion 7)', () => {
    const project = basicProject()
    const applied = expectRoundTrip(project, intent('plan.movePlacement', { placedItemId: 'place-bed', translation: { x: 2100, y: 640 } }))
    expect(placement(applied.project, 'place-bed').translation).toEqual({ x: 2100, y: 640 })
    expect(canonicalJson(design(applied.project, 'design-bed-king'))).toBe(canonicalJson(design(project, 'design-bed-king')))
  })

  it('turns a placement about its Item Origin, keeping rotation inside one turn', () => {
    const project = basicProject()
    for (const [rotationDeg, expected] of [[45, 45], [400, 40], [-90, 270], [37.5, 37.5]] as const) {
      const applied = expectRoundTrip(project, intent('plan.rotatePlacement', { placedItemId: 'place-chest', rotationDeg }))
      expect(placement(applied.project, 'place-chest').rotationDeg).toBeCloseTo(expected, 10)
      expect(placement(applied.project, 'place-chest').translation).toEqual(placement(project, 'place-chest').translation)
    }
    // A full turn from a turned object lands back on zero rather than on 360.
    const turned = expectApplied(project, intent('plan.rotatePlacement', { placedItemId: 'place-chest', rotationDeg: 90 }))
    const spun = expectRoundTrip(turned.project, intent('plan.rotatePlacement', { placedItemId: 'place-chest', rotationDeg: 360 }))
    expect(placement(spun.project, 'place-chest').rotationDeg).toBe(0)
    expectRejection(spun.project, intent('plan.rotatePlacement', { placedItemId: 'place-chest', rotationDeg: 720 }), 'no-change')
  })

  it('refuses a move that changes nothing, and one that names nothing', () => {
    const project = deepFreeze(basicProject())
    const here = placement(project, 'place-bed').translation
    expectRejection(project, intent('plan.movePlacement', { placedItemId: 'place-bed', translation: { ...here } }), 'no-change')
    expectRejection(project, intent('plan.movePlacement', { placedItemId: 'gone', translation: { x: 1, y: 1 } }), 'unknown-target')
    expectRejection(project, intent('plan.rotatePlacement', { placedItemId: 'gone', rotationDeg: 12 }), 'unknown-target')
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
    expect(applied.affected).toEqual({ floorId: null, viewId: null, view: 'plan', itemDesignIds: [itemDesignId], placedItemIds: [] })
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

  it('refuses to re-set the picture that is already there, calibration and all', () => {
    const project = basicProject()
    const existing = project.floors.find((floor) => floor.id === 'floor-main')!.planImage!
    // Nothing about the record changes, so history records nothing — and the calibrated
    // scale the user measured stays exactly where it was.
    expectRejection(project, intent('plan.setImage', {
      floorId: 'floor-main',
      image: {
        assetHash: existing.assetHash,
        mediaType: existing.mediaType,
        widthPx: existing.widthPx,
        heightPx: existing.heightPx,
      },
    }), 'no-change')
  })

  it('resets the scale when the bytes change, because the old one measured a different picture', () => {
    const project = basicProject()
    const applied = expectRoundTrip(project, intent('plan.setImage', { floorId: 'floor-main', image: IMAGE }))
    expect(applied.project.floors.find((floor) => floor.id === 'floor-main')!.planImage).toEqual({ ...IMAGE, pixelsPerMm: null })
  })

  it('leaves every Placed Item standing when it replaces the picture (#56)', () => {
    const project = basicProject()
    const applied = expectRoundTrip(project, intent('plan.setImage', { floorId: 'floor-mezz', image: IMAGE }))
    const floor = applied.project.floors.find((candidate) => candidate.id === 'floor-mezz')!
    expect(floor.planImage).toEqual({ ...IMAGE, pixelsPerMm: null })
    // Nothing is deleted behind the user's back: the objects, the designs and the template
    // are exactly where they were.
    expect(applied.project.existingModel.placedItems).toEqual(project.existingModel.placedItems)
    expect(applied.project.itemDesigns).toEqual(project.itemDesigns)
  })

  it('removes the image, and refuses a Floor with no image to calibrate', () => {
    const project = basicProject()
    const removed = expectRoundTrip(project, intent('plan.removeImage', { floorId: 'floor-main' }))
    expect(removed.project.floors.find((floor) => floor.id === 'floor-main')!.planImage).toBeNull()
    // Removing the picture is not removing the plan: the objects are still standing.
    expect(removed.project.existingModel.placedItems).toEqual(project.existingModel.placedItems)
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
