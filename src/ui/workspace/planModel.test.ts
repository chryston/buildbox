/**
 * The Plan View projection (#55, #56): the exact inverse of what #47's handlers store —
 * Item Origin is the footprint centre, rotations are quarter-turns, an uncalibrated Plan
 * Image is drawn at raw pixels — and the Floor/view selectors that decide what the canvas
 * may draw at all.
 */
import { describe, expect, it } from 'vitest'
import type { GenericItemDesign, Project } from '../../domain'
import {
  customTemplates,
  decodeActiveViews,
  encodeActiveViews,
  planImageForView,
  planItemsForFloor,
  planViewKey,
  planViewsForFloor,
  placedOrigin,
  resolvePlanView,
} from './planModel'
import type { PlanView } from '../../domain'

const view = (id: string, floorId: string, name: string, isDefault = false): PlanView => ({
  id,
  kind: 'plan',
  floorId,
  name,
  isDefault,
  showPlanImage: true,
})

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

describe('planImageForView', () => {
  const calibrated: Project['floors'][number]['planImage'] = {
    assetHash: 'a'.repeat(64),
    mediaType: 'image/png',
    widthPx: 1200,
    heightPx: 1000,
    pixelsPerMm: 2,
  }
  const withImage = (showPlanImage = true): Project => ({
    ...project(),
    floors: [{ id: 'floor-1', name: 'Flat', planImage: calibrated }],
    views: [{ id: 'view-1', kind: 'plan', floorId: 'floor-1', name: 'Flat', isDefault: true, showPlanImage }],
  })
  const viewOf = (p: Project): Project['views'][number] => p.views[0] as Project['views'][number]

  it('scales a calibrated image to millimetres', () => {
    const p = withImage()
    expect(planImageForView(p, viewOf(p), 'blob:x')).toEqual({
      src: 'blob:x', widthMm: 600, heightMm: 500, pixelsPerMm: 2,
    })
  })

  it('draws an uncalibrated image at raw pixels', () => {
    const p: Project = {
      ...withImage(),
      floors: [{ id: 'floor-1', name: 'Flat', planImage: { ...calibrated, pixelsPerMm: null } }],
    }
    expect(planImageForView(p, viewOf(p), 'blob:x')).toEqual({
      src: 'blob:x', widthMm: 1200, heightMm: 1000, pixelsPerMm: null,
    })
  })

  it('is null when this Plan View has the image switched off (#19 §4)', () => {
    const p = withImage(false)
    expect(planImageForView(p, viewOf(p), 'blob:x')).toBeNull()
  })

  it('is null without an image or without its object URL yet', () => {
    const p = project()
    expect(planImageForView(p, viewOf(p), null)).toBeNull()
    expect(planImageForView(withImage(), viewOf(withImage()), null)).toBeNull()
    expect(planImageForView(p, null, 'blob:x')).toBeNull()
  })

  it('is stable while the Project, the view and the URL are', () => {
    const p = withImage()
    expect(planImageForView(p, viewOf(p), 'blob:x')).toBe(planImageForView(p, viewOf(p), 'blob:x'))
    expect(planImageForView(p, viewOf(p), 'blob:y')).not.toBe(planImageForView(p, viewOf(p), 'blob:x'))
    // The same Floor's image drawn and hidden are two different projections.
    const hidden = withImage(false)
    expect(planImageForView(hidden, viewOf(hidden), 'blob:x')).not.toBe(planImageForView(p, viewOf(p), 'blob:x'))
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
  it('is keyed by Plan View, so two views of one Floor keep separate viewports (#56)', () => {
    expect(planViewKey(view('view-1', 'floor-1', 'Flat', true)))
      .toBe('view:floor-1:Flat')
    expect(planViewKey(view('view-3', 'floor-1', 'Furniture'))).not.toBe(planViewKey(view('view-1', 'floor-1', 'Flat', true)))
  })

  it('survives a migration, which mints new view ids every time it runs (#56)', () => {
    // The same Plan View as two sessions see it: the record predates `views`, so each open
    // gives it a different id. The camera must not be one of the things that changes.
    const first = view('minted-1', 'floor-1', 'Flat', true)
    const second = view('minted-2', 'floor-1', 'Flat', true)
    expect(planViewKey(second)).toBe(planViewKey(first))
  })
})

describe('the device-local open view', () => {
  const two = project({
    floors: [{ id: 'floor-1', name: 'Flat', planImage: null }],
    views: [
      { id: 'view-1', kind: 'plan', floorId: 'floor-1', name: 'Flat', isDefault: true, showPlanImage: true },
      { id: 'view-2', kind: 'plan', floorId: 'floor-1', name: 'Furniture', isDefault: false, showPlanImage: true },
    ],
  })

  it('is stored by name, because a migration mints view ids afresh (#56)', () => {
    expect(encodeActiveViews(two, { 'floor-1': 'view-2' })).toEqual({ 'floor-1': 'Furniture' })
  })

  it('comes back as the live id of the view with that name', () => {
    expect(decodeActiveViews(two, { 'floor-1': 'Furniture' })).toEqual({ 'floor-1': 'view-2' })
  })

  it('drops a name this Project no longer has, rather than opening a guess', () => {
    expect(decodeActiveViews(two, { 'floor-1': 'Electrics', 'floor-9': 'Flat' })).toEqual({})
    expect(encodeActiveViews(two, { 'floor-1': 'gone' })).toEqual({})
  })
})

describe('planViewsForFloor', () => {
  it('lists the Floor\'s own views, default first, then named ones in order', () => {
    const p = project({
      floors: [
        { id: 'floor-1', name: 'Flat', planImage: null },
        { id: 'floor-2', name: 'Loft', planImage: null },
      ],
      views: [
        { id: 'view-1', kind: 'plan', floorId: 'floor-1', name: 'Flat', isDefault: true, showPlanImage: true },
        { id: 'view-2', kind: 'plan', floorId: 'floor-2', name: 'Loft', isDefault: true, showPlanImage: true },
        { id: 'view-3', kind: 'plan', floorId: 'floor-1', name: 'Furniture', isDefault: false, showPlanImage: true },
      ],
    })
    expect(planViewsForFloor(p, 'floor-1').map((each) => each.id)).toEqual(['view-1', 'view-3'])
    expect(planViewsForFloor(p, 'floor-2').map((each) => each.id)).toEqual(['view-2'])
    expect(planViewsForFloor(p, null)).toEqual([])
  })
})

describe('resolvePlanView', () => {
  const two = project({
    floors: [{ id: 'floor-1', name: 'Flat', planImage: null }],
    views: [
      { id: 'view-1', kind: 'plan', floorId: 'floor-1', name: 'Flat', isDefault: true, showPlanImage: true },
      { id: 'view-2', kind: 'plan', floorId: 'floor-1', name: 'Furniture', isDefault: false, showPlanImage: true },
    ],
  })

  it('keeps the remembered view', () => {
    expect(resolvePlanView(two, 'floor-1', 'view-2')?.id).toBe('view-2')
  })

  it('falls back to the Floor\'s default when nothing is remembered', () => {
    expect(resolvePlanView(two, 'floor-1', null)?.id).toBe('view-1')
  })

  it('falls back to the default when the remembered view was deleted', () => {
    expect(resolvePlanView(two, 'floor-1', 'gone')?.id).toBe('view-1')
  })

  it('is null for no Floor', () => {
    expect(resolvePlanView(two, null, 'view-1')).toBeNull()
  })
})

describe('placedOrigin', () => {
  it('is what the Copy to Floor dialog prefills', () => {
    expect(placedOrigin(project(), 'placed-1')).toEqual({ x: 420, y: 450, baseElevation: 0 })
    expect(placedOrigin(project(), 'nope')).toBeNull()
    expect(placedOrigin(project(), null)).toBeNull()
  })
})
