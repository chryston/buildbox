/**
 * The Plan View projection (#55): the exact inverse of what #47's handlers store —
 * Item Origin is the footprint centre, rotations are quarter-turns, and an uncalibrated
 * Plan Image is drawn at raw pixels.
 */
import { describe, expect, it } from 'vitest'
import type { GenericItemDesign, Project } from '../../domain'
import { customTemplates, planImageForFloor, planItemsForFloor, planViewKey } from './planModel'

const genericDesign = (over: Partial<GenericItemDesign> = {}): GenericItemDesign => ({
  id: 'design-1',
  kind: 'generic',
  name: 'Sofa 3-seater',
  footprint: { kind: 'rectangle', width: 600, depth: 220 },
  origin: { x: 300, y: 110 },
  height: 850,
  heightIsTypical: true,
  color: '#6366f1',
  ...over,
})

const project = (over: Partial<Project> = {}): Project => ({
  id: 'project-1',
  meta: { name: 'Home' },
  preferences: { displayUnit: 'mm', displayPrecision: 0 },
  floors: [{ id: 'floor-1', name: 'Flat', planImage: null }],
  views: [{ id: 'view-1', kind: 'plan', floorId: 'floor-1', name: 'Flat', isDefault: true, showPlanImage: true }],
  itemDesigns: [genericDesign()],
  existingModel: {
    placedItems: [{
      id: 'placed-1',
      itemDesignId: 'design-1',
      floorId: 'floor-1',
      translation: { x: 420, y: 450 },
      rotationDeg: 0,
      baseElevation: 0,
    }],
  },
  ...over,
})

describe('planItemsForFloor', () => {
  it('draws the footprint from the Item Origin as centre', () => {
    const [item] = planItemsForFloor(project(), 'floor-1')
    expect(item).toEqual({
      id: 'placed-1',
      label: 'Sofa 3-seater',
      x: 120,
      y: 340,
      w: 600,
      h: 220,
      rotationDeg: 0,
      color: '#6366f1',
    })
  })

  it('snaps a rotation to the nearest quarter turn', () => {
    const drift = (rotationDeg: number): Project => {
      const p = project()
      p.existingModel.placedItems[0].rotationDeg = rotationDeg
      return p
    }
    expect(planItemsForFloor(drift(91), 'floor-1')[0].rotationDeg).toBe(90)
    expect(planItemsForFloor(drift(359), 'floor-1')[0].rotationDeg).toBe(0)
  })

  it('shows only the Floor\'s generic items', () => {
    const withOther = project()
    withOther.floors.push({ id: 'floor-2', name: 'Upstairs', planImage: null })
    withOther.existingModel.placedItems.push({
      id: 'placed-2', itemDesignId: 'design-1', floorId: 'floor-2',
      translation: { x: 0, y: 0 }, rotationDeg: 0, baseElevation: 0,
    })
    expect(planItemsForFloor(withOther, 'floor-1').map((i) => i.id)).toEqual(['placed-1'])
    expect(planItemsForFloor(withOther, 'floor-2').map((i) => i.id)).toEqual(['placed-2'])
  })

  it('is stable while the Project object is', () => {
    const p = project()
    expect(planItemsForFloor(p, 'floor-1')).toBe(planItemsForFloor(p, 'floor-1'))
  })
})

describe('planImageForFloor', () => {
  const calibrated: Project['floors'][number]['planImage'] = {
    assetHash: 'a'.repeat(64),
    mediaType: 'image/png',
    widthPx: 1200,
    heightPx: 1000,
    pixelsPerMm: 2,
  }

  it('scales a calibrated image to millimetres', () => {
    const p = project({ floors: [{ id: 'floor-1', name: 'Flat', planImage: calibrated }] })
    expect(planImageForFloor(p, 'floor-1', 'blob:x')).toEqual({
      src: 'blob:x', widthMm: 600, heightMm: 500, pixelsPerMm: 2,
    })
  })

  it('draws an uncalibrated image at raw pixels', () => {
    const p = project({
      floors: [{ id: 'floor-1', name: 'Flat', planImage: { ...calibrated, pixelsPerMm: null } }],
    })
    expect(planImageForFloor(p, 'floor-1', 'blob:x')).toEqual({
      src: 'blob:x', widthMm: 1200, heightMm: 1000, pixelsPerMm: null,
    })
  })

  it('is null without an image or without its object URL yet', () => {
    expect(planImageForFloor(project(), 'floor-1', null)).toBeNull()
    const p = project({ floors: [{ id: 'floor-1', name: 'Flat', planImage: calibrated }] })
    expect(planImageForFloor(p, 'floor-1', null)).toBeNull()
  })

  it('is stable while the Project and the URL are', () => {
    const p = project({ floors: [{ id: 'floor-1', name: 'Flat', planImage: calibrated }] })
    expect(planImageForFloor(p, 'floor-1', 'blob:x')).toBe(planImageForFloor(p, 'floor-1', 'blob:x'))
    expect(planImageForFloor(p, 'floor-1', 'blob:y')).not.toBe(planImageForFloor(p, 'floor-1', 'blob:x'))
  })
})

describe('customTemplates', () => {
  it('offers a custom design that is placed nowhere', () => {
    const p = project()
    p.itemDesigns.push(genericDesign({ id: 'design-2', name: 'Island', isCustom: true }))
    expect(customTemplates(p)).toEqual([{ itemDesignId: 'design-2', label: 'Island' }])
    expect(customTemplates(p)).toBe(customTemplates(p))
    const placedAgain: Project = {
      ...p,
      existingModel: {
        placedItems: [...p.existingModel.placedItems, {
          id: 'placed-2', itemDesignId: 'design-2', floorId: 'floor-1',
          translation: { x: 0, y: 0 }, rotationDeg: 0, baseElevation: 0,
        }],
      },
    }
    expect(customTemplates(placedAgain)).toEqual([])
  })
})

describe('planViewKey', () => {
  it('names the Floor\'s default Plan view', () => {
    expect(planViewKey('floor-1')).toBe('plan:floor-1')
  })
})
