/**
 * What leans on a Floor (#56 criterion 9).
 *
 * The counts are what the delete dialog reads and what keeps `Delete Floor` disabled, so
 * they are the acceptance numbers: three Placed Items, one Plan Image, one named Plan View.
 * The Floor's own default Plan View is the interesting absence — it goes with the Floor
 * rather than blocking it.
 */
import { describe, expect, it } from 'vitest'
import type { ElevationView, Floor, PlanView, Project } from './index'
import { FLOOR_DEPENDENCY_KINDS, floorHasDependencies, summarizeFloorDependencies } from './index'

const floor = (id: string, over: Partial<Floor> = {}): Floor => ({ id, name: id, planImage: null, ...over })
const view = (id: string, floorId: string, isDefault: boolean): PlanView => ({
  id,
  kind: 'plan',
  floorId,
  name: id,
  isDefault,
  showPlanImage: true,
  planViewRange: { lowerMm: 0, upperMm: 2600 },
})
const elevation = (id: string, floorId: string): ElevationView => ({
  id,
  kind: 'elevation',
  floorId,
  name: id,
  line: { start: { x: 0, y: 1400 }, end: { x: 4000, y: 1400 } },
  side: 'left',
  depth: 2000,
})
const placed = (id: string, floorId: string): Project['existingModel']['placedItems'][number] => ({
  id,
  itemDesignId: 'design-1',
  floorId,
  translation: { x: 0, y: 0 },
  rotationDeg: 0,
  baseElevation: 0,
})

const IMAGE = { assetHash: 'a'.repeat(64), mediaType: 'image/png' as const, widthPx: 100, heightPx: 100, pixelsPerMm: null }

/** "Kitchen" carries three Placed Items, a Plan Image and one named Plan View; "Cellar" nothing. */
function project(): Project {
  return {
    id: 'project-1',
    meta: { name: 'Home' },
    preferences: { displayUnit: 'mm', displayPrecision: 0, defaultWallHeight: 2600 },
    floors: [floor('floor-kitchen', { planImage: IMAGE }), floor('floor-cellar')],
    views: [
      view('view-kitchen', 'floor-kitchen', true),
      view('view-kitchen-evening', 'floor-kitchen', false),
      view('view-cellar', 'floor-cellar', true),
    ],
    elevationViews: [elevation('elevation-kitchen-sink', 'floor-kitchen')],
    itemDesigns: [],
    existingModel: {
      walls: [],
      wallJunctions: [],
      openings: [],
      rooms: [],
      beams: [],
      placedItems: [placed('placed-1', 'floor-kitchen'), placed('placed-2', 'floor-kitchen'), placed('placed-3', 'floor-kitchen')],
    },
    warningAcknowledgements: [],
  }
}

const textOf = (floorId: string): string[] => summarizeFloorDependencies(project(), floorId).map((row) => row.text)

describe('summarizeFloorDependencies', () => {
  it('counts the Placed Items, the Beams, the Skirting, the Plan Image, the named Plan Views and the Elevation Views of one Floor', () => {
    expect(textOf('floor-kitchen')).toEqual(['3 Placed Items', '0 Beams', '0 Skirting', '0 Services', '1 Plan Image', '1 named Plan View', '1 Elevation View'])
  })

  it('reads an empty Floor as having nothing leaning on it', () => {
    expect(textOf('floor-cellar')).toEqual(['0 Placed Items', '0 Beams', '0 Skirting', '0 Services', '0 Plan Images', '0 named Plan Views', '0 Elevation Views'])
    expect(floorHasDependencies(project(), 'floor-cellar')).toBe(false)
  })

  it('never counts the default Plan View, which goes with the Floor (#56)', () => {
    const onlyDefault = summarizeFloorDependencies(project(), 'floor-cellar').find((row) => row.kind.id === 'planViews')
    expect(onlyDefault?.count).toBe(0)
  })

  it('names each kind in registry order, so a dialog can key a row', () => {
    expect(FLOOR_DEPENDENCY_KINDS.map((kind) => kind.id)).toEqual(['placedItems', 'beams', 'skirting', 'services', 'planImage', 'planViews', 'elevationViews'])
    expect(summarizeFloorDependencies(project(), 'floor-kitchen').map((row) => row.kind.id)).toEqual([
      'placedItems',
      'beams',
      'skirting',
      'services',
      'planImage',
      'planViews',
      'elevationViews',
    ])
  })

  it('reads a Floor that is not there as having nothing, rather than throwing', () => {
    expect(floorHasDependencies(project(), 'floor-nowhere')).toBe(false)
    expect(textOf('floor-nowhere')).toEqual([
      '0 Placed Items',
      '0 Beams',
      '0 Skirting',
      '0 Services',
      '0 Plan Images',
      '0 named Plan Views',
      '0 Elevation Views',
    ])
  })

  it('refuses a Floor a Beam still stands on, because a Beam has nothing else to lean on (#77 §1)', () => {
    const one = project()
    one.existingModel.beams = [
      {
        id: 'beam-1',
        floorId: 'floor-kitchen',
        line: { start: { x: 0, y: 0 }, end: { x: 3000, y: 0 } },
        justification: 'centre',
        width: 200,
        underside: 2300,
        height: 300,
      },
    ]
    expect(floorHasDependencies(one, 'floor-kitchen')).toBe(true)
    expect(summarizeFloorDependencies(one, 'floor-kitchen')[1]?.text).toBe('1 Beam')
    expect(floorHasDependencies(one, 'floor-cellar')).toBe(false)
  })

  it('refuses a Floor a Skirting is still drawn against, because it has no face to stand off (#78 §1)', () => {
    const one = project()
    one.existingModel.skirting = [
      {
        id: 'skirting-1',
        floorId: 'floor-kitchen',
        hostWallId: 'wall-kitchen-1',
        side: 'left',
        start: 0,
        end: 1000,
        bottom: 0,
        height: 100,
        thickness: 15,
      },
    ]
    expect(floorHasDependencies(one, 'floor-kitchen')).toBe(true)
    expect(summarizeFloorDependencies(one, 'floor-kitchen')[2]?.text).toBe('1 Skirting')
    expect(floorHasDependencies(one, 'floor-cellar')).toBe(false)
  })

  it('refuses a Floor a Service is still documented on, because it has nothing else to lean on (#79 §1)', () => {
    const one = project()
    one.existingModel.services = [
      {
        id: 'service-1',
        shape: 'run',
        floorId: 'floor-kitchen',
        kind: 'water',
        line: { start: { x: 600, y: 1200 }, end: { x: 3600, y: 1200 } },
        section: 'round',
        centrelineElevation: 2200,
        outsideDiameter: 50,
      },
    ]
    expect(floorHasDependencies(one, 'floor-kitchen')).toBe(true)
    expect(summarizeFloorDependencies(one, 'floor-kitchen')[3]?.text).toBe('1 Service')
    expect(floorHasDependencies(one, 'floor-cellar')).toBe(false)
  })

  it('says "1 Placed Item" and "2 Placed Items", which is the whole row', () => {
    const one = project()
    one.existingModel.placedItems = [placed('placed-1', 'floor-kitchen')]
    expect(summarizeFloorDependencies(one, 'floor-kitchen')[0]?.text).toBe('1 Placed Item')
    expect(summarizeFloorDependencies(project(), 'floor-kitchen')[0]?.text).toBe('3 Placed Items')
  })
})

describe('floorHasDependencies', () => {
  it('is true while anything leans on the Floor, and false once nothing does', () => {
    expect(floorHasDependencies(project(), 'floor-kitchen')).toBe(true)

    const emptied = project()
    emptied.existingModel.placedItems = []
    emptied.floors[0]!.planImage = null
    emptied.views = emptied.views.filter((candidate) => candidate.isDefault)
    emptied.elevationViews = []
    expect(floorHasDependencies(emptied, 'floor-kitchen')).toBe(false)
  })

  it('is true for a Floor whose only content is its Plan Image', () => {
    const imageOnly = project()
    imageOnly.existingModel.placedItems = []
    imageOnly.views = imageOnly.views.filter((candidate) => candidate.isDefault)
    expect(floorHasDependencies(imageOnly, 'floor-kitchen')).toBe(true)
  })
})
