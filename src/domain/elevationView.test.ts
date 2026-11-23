/**
 * The name rules an Elevation View shares with everything else that has a name (#75 §1): one comparison
 * key, uniqueness among the Elevation Views of one Floor only, and the next free `Elevation N`.
 *
 * The gap these tests exist to close is the second kind of saved view: a Plan View and an Elevation View
 * of one Floor may be called the same thing, because the two kinds are listed as separate groups and
 * nothing ever has to ask which one was meant — while `Elevation 1` and `Elevation 1` on the same Floor
 * may not, and on two different Floors may.
 */
import { describe, expect, it } from 'vitest'
import type { ElevationView, Floor, PlanView, Project } from './index'
import { defaultPlanView, elevationViewNameTaken, nextElevationViewName } from './index'

const projectWith = (
  floorNames: string[],
  planViews: readonly [floorIndex: number, name: string][] = [],
  elevationViews: readonly [floorIndex: number, name: string][] = [],
): Project => {
  const floors: Floor[] = floorNames.map((name, index) => ({ id: `floor-${String(index)}`, name, planImage: null, limits: { upperMm: 2600 } }))
  const views: PlanView[] = floors.map((floor, index) => defaultPlanView(`view-${String(index)}`, floor))
  planViews.forEach(([floorIndex, name], index) => {
    views.push({
      id: `view-extra-${String(index)}`,
      kind: 'plan',
      floorId: `floor-${String(floorIndex)}`,
      name,
      isDefault: false,
      showPlanImage: false,
      planViewRange: { lowerMm: 0, upperMm: 2600 },
    })
  })
  const elevation: ElevationView[] = elevationViews.map(([floorIndex, name], index) => ({
    id: `elev-${String(index)}`,
    kind: 'elevation',
    floorId: `floor-${String(floorIndex)}`,
    name,
    line: { start: { x: 0, y: 0 }, end: { x: 4000, y: 0 } },
    side: 'left',
    depth: 2000,
  }))
  return {
    id: 'project-1',
    meta: { name: 'Home' },
    preferences: { displayUnit: 'mm', displayPrecision: 0, defaultWallHeight: 2600 },
    floors,
    views,
    elevationViews: elevation,
    itemDesigns: [],
    existingModel: { placedItems: [], walls: [], wallJunctions: [], openings: [], rooms: [] },
    warningAcknowledgements: [],
  }
}

describe('elevationViewNameTaken (#75 §1)', () => {
  it('refuses the same name twice on one Floor, however it is typed', () => {
    const project = projectWith(['Ground'], [], [[0, 'Kitchen elevation']])
    expect(elevationViewNameTaken(project, 'floor-0', 'kitchen ELEVATION')).toBe(true)
    expect(elevationViewNameTaken(project, 'floor-0', ' Kitchen elevation ')).toBe(true)
    // Fullwidth letters and a differently-composed accent are the same name once normalised.
    expect(elevationViewNameTaken(project, 'floor-0', 'Kitchen elevation'.normalize('NFD'))).toBe(true)
    expect(elevationViewNameTaken(project, 'floor-0', 'Kitchen')).toBe(false)
  })

  it('lets two Floors each have an Elevation View called the same thing', () => {
    const project = projectWith(['Ground', 'Upper'], [], [[0, 'North side'], [1, 'North side']])
    expect(elevationViewNameTaken(project, 'floor-0', 'North side')).toBe(true)
    expect(elevationViewNameTaken(project, 'floor-1', 'North side')).toBe(true)
    expect(elevationViewNameTaken(project, 'floor-0', 'South side')).toBe(false)
  })

  it('says nothing about a Plan View of the same Floor wearing the same name', () => {
    const project = projectWith(['Ground'], [[0, 'Kitchen elevation']], [[0, 'Living side']])
    expect(elevationViewNameTaken(project, 'floor-0', 'Kitchen elevation')).toBe(false)
    expect(elevationViewNameTaken(project, 'floor-0', 'Living side')).toBe(true)
  })

  it('stands aside for the view being renamed', () => {
    const project = projectWith(['Ground'], [], [[0, 'Kitchen elevation']])
    expect(elevationViewNameTaken(project, 'floor-0', 'Kitchen elevation', 'elev-0')).toBe(false)
    expect(elevationViewNameTaken(project, 'floor-0', 'Kitchen elevation', 'elev-1')).toBe(true)
  })

  it('says nothing at all when the Floor has no Elevation Views, or none stored', () => {
    expect(elevationViewNameTaken(projectWith(['Ground']), 'floor-0', 'Elevation 1')).toBe(false)
    const bare = projectWith(['Ground'])
    delete bare.elevationViews
    expect(elevationViewNameTaken(bare, 'floor-0', 'Elevation 1')).toBe(false)
  })
})

describe('nextElevationViewName (#75 §1)', () => {
  it('fills the gap the Floor’s own list is missing', () => {
    const project = projectWith(['Ground'], [], [[0, 'Elevation 1'], [0, 'Elevation 3']])
    expect(nextElevationViewName(project, 'floor-0')).toBe('Elevation 2')
  })

  it('starts at Elevation 1 for a Floor that has none, even when another Floor has several', () => {
    const project = projectWith(['Ground', 'Upper'], [], [[0, 'Elevation 1'], [0, 'Elevation 2']])
    expect(nextElevationViewName(project, 'floor-1')).toBe('Elevation 1')
    expect(nextElevationViewName(project, 'floor-0')).toBe('Elevation 3')
  })

  it('is unbothered by a Plan View or a Floor wearing the name it is about to hand out', () => {
    const project = projectWith(['Elevation 1'], [[0, 'Elevation 1']], [])
    expect(nextElevationViewName(project, 'floor-0')).toBe('Elevation 1')
  })

  it('counts a name the user typed, however it is spelled, as that number taken', () => {
    const project = projectWith(['Ground'], [], [[0, ' elevation 1 ']])
    expect(nextElevationViewName(project, 'floor-0')).toBe('Elevation 2')
  })
})
