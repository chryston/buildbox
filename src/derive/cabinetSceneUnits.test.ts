import { describe, expect, it } from 'vitest'
import { cabinetSceneUnits } from './index'
import { rectangleFootprint } from '../domain'
import type { CabinetItemDesign, CabinetNode, GenericItemDesign, GlobalSettings, PlacedItem, Project } from '../domain'

const SETTINGS: GlobalSettings = {
  unit: 'mm',
  height: 800,
  width: 600,
  depth: 500,
  thickness: 18,
  backThickness: 6,
  toeKick: null,
  material: 'oak',
}

const leaf = (id: string): CabinetNode => ({ id, elementType: 'void', spaceLabel: id })

const cabinet = (id: string, settings: Partial<GlobalSettings> = {}): CabinetItemDesign => ({
  id,
  kind: 'cabinet',
  name: `Cabinet ${id}`,
  construction: { settings: { ...SETTINGS, ...settings }, root: leaf(`${id}-root`) },
})

const generic = (id: string): GenericItemDesign => ({
  id,
  kind: 'generic',
  name: `Sofa ${id}`,
  footprint: rectangleFootprint(2000, 900),
  origin: { x: 1000, y: 450 },
  height: 850,
  heightIsTypical: true,
  color: '#8d6e63',
  catalogKey: 'sofa-3',
})

const place = (id: string, itemDesignId: string, over: Partial<PlacedItem> = {}): PlacedItem => ({
  id,
  itemDesignId,
  floorId: 'floor-1',
  translation: { x: 300, y: 250 },
  rotationDeg: 0,
  baseElevation: 0,
  ...over,
})

const project = (parts: Partial<Project>): Project => ({
  id: 'proj-1',
  meta: { name: 'Test' },
  preferences: { displayUnit: 'mm', displayPrecision: 0, defaultWallHeight: 2600 },
  floors: [{ id: 'floor-1', name: 'Floor 1', planImage: null }],
  views: [{ id: 'view-1', kind: 'plan', floorId: 'floor-1', name: 'Floor 1', isDefault: true, showPlanImage: true }],
  itemDesigns: [],
  existingModel: { placedItems: [], walls: [], wallJunctions: [], openings: [] },
  warningAcknowledgements: [],
  ...parts,
})

describe('cabinetSceneUnits', () => {
  it('rebuilds a unit from its Item Design and its placement', () => {
    const source = project({
      itemDesigns: [cabinet('unit-a')],
      existingModel: {
        walls: [],
        wallJunctions: [],
        openings: [],
        placedItems: [place('place-a', 'unit-a', { translation: { x: 1000, y: 250 }, baseElevation: 120 })],
      },
    })

    expect(cabinetSceneUnits(source, 'floor-1')).toEqual([
      {
        type: 'cabinet',
        id: 'unit-a',
        label: 'Cabinet unit-a',
        // translation.x − width/2 = 1000 − 300; y is the base elevation, not the centre.
        x: 700,
        y: 120,
        settings: SETTINGS,
        root: leaf('unit-a-root'),
      },
    ])
  })

  it('keeps placement order, not Item Design order', () => {
    const source = project({
      itemDesigns: [cabinet('unit-a'), cabinet('unit-b')],
      existingModel: {
        walls: [],
        wallJunctions: [],
        openings: [],
        placedItems: [place('place-b', 'unit-b', { translation: { x: 900, y: 250 } }), place('place-a', 'unit-a')],
      },
    })

    expect(cabinetSceneUnits(source, 'floor-1').map((unit) => unit.id)).toEqual(['unit-b', 'unit-a'])
  })

  it('reads the settings each Item Design carries, unit and all', () => {
    const source = project({
      itemDesigns: [cabinet('unit-cm', { unit: 'cm', width: 40 })],
      existingModel: { placedItems: [place('place-cm', 'unit-cm', { translation: { x: 20, y: 18 } })], walls: [], wallJunctions: [], openings: [] },
    })
    const [unit] = cabinetSceneUnits(source, 'floor-1')

    expect(unit?.settings.unit).toBe('cm')
    expect(unit?.x).toBe(0)
  })

  it('leaves out other Floors, other kinds, and placements with no Item Design', () => {
    const source = project({
      floors: [
        { id: 'floor-1', name: 'Floor 1', planImage: null },
        { id: 'floor-2', name: 'Floor 2', planImage: null },
      ],
      itemDesigns: [cabinet('unit-a'), generic('sofa-1')],
      existingModel: {
        walls: [],
        wallJunctions: [],
        openings: [],
        placedItems: [
          place('place-a', 'unit-a'),
          place('place-sofa', 'sofa-1', { translation: { x: 4000, y: 4000 } }),
          place('place-gone', 'unit-missing'),
          place('place-elsewhere', 'unit-a', { floorId: 'floor-2', translation: { x: 9000, y: 9000 } }),
        ],
      },
    })

    expect(cabinetSceneUnits(source, 'floor-1').map((unit) => unit.id)).toEqual(['unit-a'])
    expect(cabinetSceneUnits(source, 'floor-2').map((unit) => unit.id)).toEqual(['unit-a'])
  })

  it('returns nothing for a Floor with no cabinets', () => {
    expect(cabinetSceneUnits(project({}), 'floor-1')).toEqual([])
  })
})
