/**
 * What leans on a Floor (#56 criterion 9).
 *
 * The counts are what the delete dialog reads and what keeps `Delete Floor` disabled, so
 * they are the acceptance numbers: three Placed Items, one Plan Image, one named Plan View.
 * The Floor's own default Plan View is the interesting absence — it goes with the Floor
 * rather than blocking it.
 */
import { describe, expect, it } from 'vitest'
import type { Floor, PlanView, Project } from './index'
import { FLOOR_DEPENDENCY_KINDS, floorHasDependencies, summarizeFloorDependencies } from './index'

const floor = (id: string, over: Partial<Floor> = {}): Floor => ({ id, name: id, planImage: null, ...over })
const view = (id: string, floorId: string, isDefault: boolean): PlanView => ({
  id,
  kind: 'plan',
  floorId,
  name: id,
  isDefault,
  showPlanImage: true,
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
    itemDesigns: [],
    existingModel: {
      walls: [],
      wallJunctions: [],
      openings: [],
      rooms: [],
      placedItems: [placed('placed-1', 'floor-kitchen'), placed('placed-2', 'floor-kitchen'), placed('placed-3', 'floor-kitchen')],
    },
    warningAcknowledgements: [],
  }
}

const textOf = (floorId: string): string[] => summarizeFloorDependencies(project(), floorId).map((row) => row.text)

describe('summarizeFloorDependencies', () => {
  it('counts the Placed Items, the Plan Image and the named Plan Views of one Floor', () => {
    expect(textOf('floor-kitchen')).toEqual(['3 Placed Items', '1 Plan Image', '1 named Plan View'])
  })

  it('reads an empty Floor as having nothing leaning on it', () => {
    expect(textOf('floor-cellar')).toEqual(['0 Placed Items', '0 Plan Images', '0 named Plan Views'])
    expect(floorHasDependencies(project(), 'floor-cellar')).toBe(false)
  })

  it('never counts the default Plan View, which goes with the Floor (#56)', () => {
    const onlyDefault = summarizeFloorDependencies(project(), 'floor-cellar').find((row) => row.kind.id === 'planViews')
    expect(onlyDefault?.count).toBe(0)
  })

  it('names each kind in registry order, so a dialog can key a row', () => {
    expect(FLOOR_DEPENDENCY_KINDS.map((kind) => kind.id)).toEqual(['placedItems', 'planImage', 'planViews'])
    expect(summarizeFloorDependencies(project(), 'floor-kitchen').map((row) => row.kind.id)).toEqual([
      'placedItems',
      'planImage',
      'planViews',
    ])
  })

  it('reads a Floor that is not there as having nothing, rather than throwing', () => {
    expect(floorHasDependencies(project(), 'floor-nowhere')).toBe(false)
    expect(textOf('floor-nowhere')).toEqual(['0 Placed Items', '0 Plan Images', '0 named Plan Views'])
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
    expect(floorHasDependencies(emptied, 'floor-kitchen')).toBe(false)
  })

  it('is true for a Floor whose only content is its Plan Image', () => {
    const imageOnly = project()
    imageOnly.existingModel.placedItems = []
    imageOnly.views = imageOnly.views.filter((candidate) => candidate.isDefault)
    expect(floorHasDependencies(imageOnly, 'floor-kitchen')).toBe(true)
  })
})
