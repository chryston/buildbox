/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest'
import { migrateProject, validateProject } from './index'
import roomsFixture from '../../fixtures/domain/v7/rooms.json?raw'

// The Drawing Layer rejects of #71 §1 and §3, one test per rule the strict validator owns.
//
// The base is the v7 rooms fixture migrated up, for the same reason `validateRenovation.test.ts`
// uses it: the interesting rejects are references between collections — an entity naming a layer
// that is not there, a view whose order forgot one — and the fixture already holds real Walls,
// Openings, Rooms and a Placed Item to point at them.
//
// The rules themselves are flag-agnostic: a Project with no `drawingLayers` is valid in either
// build, and a Project with one is checked the same way in both. Only the migration that writes
// the defaults is gated, and that half lives in `migrate.renovation.test.ts`.

type Rec = Record<string, unknown>

function base(): Rec {
  const envelope = JSON.parse(roomsFixture) as { domainSchemaVersion: number; project: Rec }
  // The chain now runs to v8, which invents three Drawing Layer IDs, so the fixture needs a real
  // allocator rather than the empty one these loaders used while the chain stopped at v7.
  let issued = 0
  const result = migrateProject(envelope.project, envelope.domainSchemaVersion, (count) =>
    Array.from({ length: count }, () => `fixture-layer-${(issued += 1)}`),
  )
  if (!result.ok) throw new Error(`The rooms fixture no longer migrates: ${result.error.message}`)
  return structuredClone(result.project) as unknown as Rec
}

/**
 * The fixture with the layers written by hand.
 *
 * This file writes what `migrateV7toV8` would have, and proves the point the file exists for: the
 * validator's layer rules are not conditional on anything else in the Project, so a file that
 * carries layers reaches the same verdict however those layers got there.
 */
function layered(): Rec {
  const project = base()
  project.drawingLayers = [
    { id: 'layer-structure', name: 'Structure', color: '#b9b9c2' },
    { id: 'layer-services', name: 'Services', color: '#5fb3ff' },
    { id: 'layer-furniture', name: 'Furniture', color: '#e3a857' },
  ]
  const model = project.existingModel as Record<string, Rec[]>
  for (const key of ['walls', 'openings', 'rooms']) for (const entry of model[key] ?? []) entry.drawingLayerId = 'layer-structure'
  for (const entry of model.placedItems ?? []) entry.drawingLayerId = 'layer-furniture'
  for (const view of project.views as Rec[]) {
    view.layerSettings = {}
    view.layerOrder = null
    view.activeLayerId = 'layer-structure'
    view.snapToHiddenContent = false
  }
  expectProblems(project, [])
  return project
}

function problemsOf(value: unknown): { path: string; code: string }[] {
  const result = validateProject(value)
  return result.ok ? [] : result.problems.map(({ path, code }) => ({ path, code }))
}

/** The exact `{path, code}` pairs, in the order the validator reported them. */
function expectProblems(value: unknown, expected: { path: string; code: string }[]): void {
  expect(problemsOf(value)).toEqual(expected)
}

/** The Wall `layered()` filed on `Structure`. */
function firstWall(project: Rec): Rec {
  return ((project.existingModel as Rec).walls as Rec[])[0] as Rec
}

function firstView(project: Rec): Rec {
  return (project.views as Rec[])[0] as Rec
}

describe('the Drawing Layer list (#71 §1)', () => {
  it('accepts the three defaults a migrated Project carries', () => {
    expectProblems(layered(), [])
  })

  it('accepts an empty list, which is a Project whose content is all Unlayered', () => {
    const project = layered()
    project.drawingLayers = []
    for (const view of project.views as Rec[]) view.activeLayerId = null
    for (const key of ['walls', 'openings', 'rooms', 'placedItems']) {
      for (const entry of (project.existingModel as Record<string, Rec[]>)[key] ?? []) entry.drawingLayerId = null
    }
    expectProblems(project, [])
  })

  it('refuses a layer ID used twice', () => {
    const project = layered()
    const layers = project.drawingLayers as Rec[]
    layers[1] = { ...layers[1]!, id: layers[0]!.id as string }
    expectProblems(project, [{ path: 'drawingLayers[1].id', code: 'duplicate-id' }])
  })

  it('refuses a layer that shares an ID with anything else in the Project', () => {
    const project = layered()
    const layers = project.drawingLayers as Rec[]
    layers[1] = { ...layers[1]!, id: layers[0]!.id as string }
    expectProblems(project, [{ path: 'drawingLayers[1].id', code: 'duplicate-id' }])
  })

  it('refuses a layer that shares an ID with an entity', () => {
    const project = layered()
    const layers = project.drawingLayers as Rec[]
    const wall = firstWall(project)
    layers[2] = { ...layers[2]!, id: wall.id as string }
    // The Wall was indexed first, so it keeps the ID and the layer is the one reported — the same
    // rule that decides which of two Walls loses when they share an ID.
    expect(problemsOf(project)).toContainEqual({ path: 'drawingLayers[2].id', code: 'duplicate-id' })
  })

  it('refuses a layer whose ID is the reserved `unlayered`', () => {
    const project = layered()
    const layers = project.drawingLayers as Rec[]
    layers[0] = { ...layers[0]!, id: 'unlayered' }
    expect(problemsOf(project)).toContainEqual({ path: 'drawingLayers[0].id', code: 'bad-id' })
  })

  it('refuses a blank layer name', () => {
    const project = layered()
    const layers = project.drawingLayers as Rec[]
    layers[0] = { ...layers[0]!, name: '   ' }
    expectProblems(project, [{ path: 'drawingLayers[0].name', code: 'empty-text' }])
  })

  it('refuses a colour that is not a lowercase six-digit hex', () => {
    const project = layered()
    const layers = project.drawingLayers as Rec[]
    layers[0] = { ...layers[0]!, color: '#FFF' }
    expectProblems(project, [{ path: 'drawingLayers[0].color', code: 'bad-format' }])
  })

  it('refuses a field the shape does not describe', () => {
    const project = layered()
    const layers = project.drawingLayers as Rec[]
    layers[0] = { ...layers[0]!, visible: true }
    expectProblems(project, [{ path: 'drawingLayers[0].visible', code: 'unknown-field' }])
  })
})

describe('an entity\'s layer (#71 §1)', () => {
  it('accepts null and an absent field alike, both meaning Unlayered', () => {
    const project = layered()
    const wall = firstWall(project)
    wall.drawingLayerId = null
    expectProblems(project, [])
    delete wall.drawingLayerId
    expectProblems(project, [])
  })

  it('refuses a Wall naming a layer that is not there', () => {
    const project = layered()
    firstWall(project).drawingLayerId = 'layer-nope'
    expectProblems(project, [{ path: 'existingModel.walls[0].drawingLayerId', code: 'dangling-reference' }])
  })

  it('refuses a Placed Item naming a layer that is not there', () => {
    const project = layered()
    const item = ((project.existingModel as Rec).placedItems as Rec[])[0] as Rec
    item.drawingLayerId = 'layer-nope'
    expectProblems(project, [{ path: 'existingModel.placedItems[0].drawingLayerId', code: 'dangling-reference' }])
  })

  it('refuses a proposed record naming a layer that is not there', () => {
    const project = layered()
    project.designOptions = [
      {
        id: 'option-a',
        name: 'Option A',
        proposed: { walls: [], wallJunctions: [], openings: [], rooms: [], placedItems: [] },
        demolishedIds: [],
      },
    ]
    const view = firstView(project)
    view.designOptionId = 'option-a'
    // A proposed Wall with a layer of its own, on a Project that has no such layer.
    ;(project.designOptions as Rec[])[0]!.proposed = {
      walls: [
        {
          id: 'wall-proposed',
          ref: 'W-9',
          floorId: (project.floors as Rec[])[0]!.id,
          line: { kind: 'line', start: { x: 9000, y: 9000 }, end: { x: 12000, y: 9000 } },
          thickness: 100,
          height: 2400,
          justification: 'centre',
          baseElevation: 0,
          predecessorIds: [],
          drawingLayerId: 'layer-nope',
        },
      ],
      wallJunctions: [],
      openings: [],
      rooms: [],
      placedItems: [],
    }
    expectProblems(project, [{ path: 'designOptions[0].proposed.walls[0].drawingLayerId', code: 'dangling-reference' }])
  })
})

describe('the per-view layer settings (#71 §3)', () => {
  it('accepts an override that names a layer and gives the three switches', () => {
    const project = layered()
    const view = firstView(project)
    const key = (project.drawingLayers as Rec[])[0]!.id as string
    view.layerSettings = { [key]: { visible: false, selectable: false, editable: false } }
    expectProblems(project, [])
  })

  it('accepts an override of the Unlayered row', () => {
    const project = layered()
    firstView(project).layerSettings = { unlayered: { visible: false, selectable: true, editable: true } }
    expectProblems(project, [])
  })

  it('refuses an override keyed by nothing', () => {
    const project = layered()
    firstView(project).layerSettings = { 'layer-nope': { visible: false, selectable: true, editable: true } }
    expectProblems(project, [{ path: 'views[0].layerSettings.layer-nope', code: 'dangling-reference' }])
  })

  it('refuses an override missing a switch', () => {
    const project = layered()
    const key = (project.drawingLayers as Rec[])[0]!.id as string
    firstView(project).layerSettings = { [key]: { visible: false } }
    expectProblems(project, [
      { path: `views[0].layerSettings.${key}.selectable`, code: 'missing-field' },
      { path: `views[0].layerSettings.${key}.editable`, code: 'missing-field' },
    ])
  })

  it('refuses a per-view colour that is not a hex', () => {
    const project = layered()
    const key = (project.drawingLayers as Rec[])[0]!.id as string
    firstView(project).layerSettings = { [key]: { visible: true, selectable: true, editable: true, color: 'red' } }
    expectProblems(project, [{ path: `views[0].layerSettings.${key}.color`, code: 'bad-format' }])
  })

  it('refuses an Active Layer that names no layer', () => {
    const project = layered()
    firstView(project).activeLayerId = 'layer-nope'
    expectProblems(project, [{ path: 'views[0].activeLayerId', code: 'dangling-reference' }])
  })

  it('refuses a snap-to-hidden switch that is not a boolean', () => {
    const project = layered()
    firstView(project).snapToHiddenContent = 'yes'
    expectProblems(project, [{ path: 'views[0].snapToHiddenContent', code: 'wrong-type' }])
  })
})

describe('the per-view layer order (#71 §3)', () => {
  const ids = (project: Rec): string[] => (project.drawingLayers as Rec[]).map((layer) => layer.id as string)

  it('accepts null, which means the Project order', () => {
    const project = layered()
    firstView(project).layerOrder = null
    expectProblems(project, [])
  })

  it('accepts a complete order in any arrangement, with Unlayered anywhere', () => {
    const project = layered()
    firstView(project).layerOrder = ['unlayered', ...ids(project).reverse()]
    expectProblems(project, [])
  })

  it('refuses an order that leaves a layer out', () => {
    const project = layered()
    firstView(project).layerOrder = ids(project).slice(0, 2)
    // Both the omitted layer and Unlayered itself are missing.
    expectProblems(project, [
      { path: 'views[0].layerOrder', code: 'missing-field' },
      { path: 'views[0].layerOrder', code: 'missing-field' },
    ])
  })

  it('refuses an order that leaves Unlayered out', () => {
    const project = layered()
    firstView(project).layerOrder = ids(project)
    expectProblems(project, [{ path: 'views[0].layerOrder', code: 'missing-field' }])
  })

  it('refuses an order that names a layer twice', () => {
    const project = layered()
    const [first, , third] = ids(project)
    firstView(project).layerOrder = ['unlayered', first!, third!, first!]
    expectProblems(project, [
      { path: 'views[0].layerOrder[3]', code: 'duplicate-member' },
      { path: 'views[0].layerOrder', code: 'missing-field' },
    ])
  })

  it('refuses an order naming a layer that is not there', () => {
    const project = layered()
    firstView(project).layerOrder = ['unlayered', 'layer-nope', ...ids(project)]
    expectProblems(project, [{ path: 'views[0].layerOrder[1]', code: 'dangling-reference' }])
  })
})
