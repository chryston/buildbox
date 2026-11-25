/**
 * The name rules Floors and Plan Views share (#56): one comparison key, the next free
 * `Floor N`, and the default Plan View every Floor comes with.
 */
import { describe, expect, it } from 'vitest'
import type { Floor, PlanView, Project } from './index'
import { defaultPlanView, floorNameTaken, nameKey, nextFloorName, planViewNameTaken } from './index'

const projectWith = (floorNames: string[], viewNames: [floorId: string, name: string][] = []): Project => {
  const floors: Floor[] = floorNames.map((name, index) => ({
    id: `floor-${String(index)}`,
    name,
    planImage: null,
  }))
  const views: PlanView[] = floors.map((each, index) => defaultPlanView(`view-${String(index)}`, each))
  viewNames.forEach(([floorId, name], index) => {
    views.push({
      id: `view-extra-${String(index)}`,
      kind: 'plan',
      floorId,
      name,
      isDefault: false,
      showPlanImage: false,
      planViewRange: { lowerMm: 0, upperMm: 2600 },
    })
  })
  return {
    id: 'project-1',
    meta: { name: 'Home' },
    preferences: { displayUnit: 'mm', displayPrecision: 0, defaultWallHeight: 2600 },
    floors,
    views,
    itemDesigns: [],
    existingModel: { placedItems: [], walls: [], wallJunctions: [], openings: [], rooms: [], beams: [] },
    warningAcknowledgements: [],
    comments: [],
    commentReferenceCounter: 0,
    annotations: [],
    annotationReferenceCounter: 0,
  }
}

describe('nameKey', () => {
  it('trims, folds case and normalises Unicode, so one name typed three ways is one name', () => {
    expect(nameKey('  Kitchen Level ')).toBe('kitchen level')
    expect(nameKey('KITCHEN LEVEL')).toBe(nameKey('kitchen level'))
    // "ＫＩＴＣＨＥＮ" (fullwidth) and "ＫＩＴＣＨＥＮ" composed differently are the same string once normalised.
    expect(nameKey('ＫＩＴＣＨＥＮ')).toBe(nameKey('ＫＩＴＣＨＥＮ'.normalize('NFD')))
    expect(nameKey('Café')).toBe(nameKey('Café'))
  })
})

describe('floorNameTaken', () => {
  it('says yes to a name another Floor already answers to, however it is typed', () => {
    const project = projectWith(['Floor 1', 'Kitchen level'])
    expect(floorNameTaken(project, 'kitchen LEVEL')).toBe(true)
    expect(floorNameTaken(project, '  kitchen level  ')).toBe(true)
    expect(floorNameTaken(project, 'Loft')).toBe(false)
  })

  it('lets a Floor keep the name it already has', () => {
    const project = projectWith(['Floor 1', 'Kitchen level'])
    expect(floorNameTaken(project, 'Kitchen level', 'floor-1')).toBe(false)
    expect(floorNameTaken(project, 'Kitchen level', 'floor-0')).toBe(true)
  })
})

describe('nextFloorName', () => {
  it('fills the gap rather than counting past the end', () => {
    expect(nextFloorName(projectWith(['Floor 1', 'Floor 3']))).toBe('Floor 2')
    expect(nextFloorName(projectWith([]))).toBe('Floor 1')
    expect(nextFloorName(projectWith(['Floor 1', 'Floor 2']))).toBe('Floor 3')
  })

  it('is indifferent to how the taken name was typed', () => {
    expect(nextFloorName(projectWith(['FLOOR 1', 'floor 2']))).toBe('Floor 3')
  })
})

describe('defaultPlanView', () => {
  it('is the Floor, seen: named after it, showing its Plan Image, looking at the Existing Model', () => {
    const [target] = projectWith(['Mezzanine']).floors
    if (target === undefined) throw new Error('expected a Floor')
    expect(defaultPlanView('view-9', target)).toEqual({
      id: 'view-9',
      kind: 'plan',
      floorId: target.id,
      name: 'Mezzanine',
      isDefault: true,
      showPlanImage: true,
      planViewRange: { lowerMm: 0, upperMm: 2600 },
      // A Floor that has just arrived has no Design Option to look through and nothing to show
      // but what stands today (#70 §1).
      designOptionId: null,
      renovationDisplay: 'existing',
    })
  })

  it('carries the Option and Display it is handed, which is how floor.duplicate keeps them', () => {
    const [target] = projectWith(['Mezzanine']).floors
    if (target === undefined) throw new Error('expected a Floor')
    const copied = defaultPlanView('view-9', target, { designOptionId: 'option-a', renovationDisplay: 'combined' })
    expect(copied.designOptionId).toBe('option-a')
    expect(copied.renovationDisplay).toBe('combined')
  })
})

describe('planViewNameTaken', () => {
  it('is per Floor: the same words on another Floor are fine', () => {
    const project = projectWith(['Floor 1', 'Floor 2'], [['floor-0', 'Evening']])
    expect(planViewNameTaken(project, 'floor-0', 'evening')).toBe(true)
    expect(planViewNameTaken(project, 'floor-1', 'evening')).toBe(false)
    // The Floor's own default view holds the Floor's name.
    expect(planViewNameTaken(project, 'floor-1', 'Floor 2')).toBe(true)
  })

  it('lets a Plan View keep the name it already has', () => {
    const project = projectWith(['Floor 1'], [['floor-0', 'Evening']])
    const extra = project.views.find((view) => view.id === 'view-extra-0')
    if (extra === undefined) throw new Error('expected the named view')
    expect(planViewNameTaken(project, 'floor-0', 'Evening', extra.id)).toBe(false)
  })
})
