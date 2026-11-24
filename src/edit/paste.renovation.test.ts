/**
 * The cross-Project paste (#72 §4, §5).
 *
 * Two Projects stand in for the issue's criterion 1. `Unit 4 Fitout` is a fitout drawing on two
 * Drawing Layers with no Design Options of its own; `14 Elm St` is an empty Floor with one
 * `Services` layer, one Option and one Combined view. The copy set is taken out of the first by
 * `captureCopySet` and put into the second by the real Intent, so what is asserted is the path the
 * command takes — capture, review, mapping, one transaction — rather than a hand-assembled shape
 * that happens to apply.
 *
 * The scene is built so that every hard case is present in one copy: a Join whose two Walls both
 * come and another whose third Wall stayed behind, an Opening whose host comes and one whose host
 * does not, a Room edge on a Wall that is not in the copy, and four Placed Items across three
 * layer answers.
 */
import { describe, expect, it } from 'vitest'
import layersFixture from '../../fixtures/domain/v9/layers.json?raw'
import type { DesignOption, EntityId, Project } from '../domain'
import { skirtingOf, validateProject } from '../domain'
import { canonicalJson } from '../lib'
import { applyIntent, captureCopySet, intentIdCount, intentLabel, pasteReviewOf, previewIntent } from './index'
import type { CopySet, Intent, PasteFromOtherProject, PasteLayerResolution } from './index'
import { NOW, deepFreeze, expectRejection, expectRoundTrip, idSource } from './testing'
import { currentSchemaOf } from '../domain/testing'

/** The fixture's shape is fixed by `scripts/make-layers-seed.ts`, which wrote it. */
const fixture = JSON.parse(layersFixture) as { project: unknown }

const base = currentSchemaOf(fixture.project, 8)

const JOINERY = 'fitout-joinery'
const FIT_SERVICES = 'fitout-services'
const DEST_SERVICES = 'elm-services'
const DEST_OPTION = 'elm-option-a'
const DEST_VIEW = 'elm-view-1'
const DEST_FLOOR = 'elm-floor-1'
const SOURCE_VIEW = 'seed-view-001'

/** The three Walls that come across, and the two Joins that close between them. */
const WALL_IDS: EntityId[] = ['seed-wall-002', 'seed-wall-003', 'seed-wall-004']
const JOINED = ['seed-wall-007', 'seed-wall-008']
/** `Window 3` is cut into W-6, which is not in the copy: it has nothing to be cut into here. */
const STRANDED = 'seed-opening-016'

/** The four Placed Items of criterion 1, filed the way that criterion files them. */
const ITEM_LAYERS: Record<string, EntityId | null> = {
  'seed-002': JOINERY,
  'seed-003': JOINERY,
  'fp-fridge': FIT_SERVICES,
  'fp-sofa': null,
}

const selection: EntityId[] = [
  ...WALL_IDS,
  'seed-opening-014',
  STRANDED,
  'seed-room-017',
  'seed-room-022',
  ...Object.keys(ITEM_LAYERS),
]

/** `Unit 4 Fitout`: the fixture's records re-filed on two layers, with no Options and one view. */
function fitout(): Project {
  const filed = <T extends { drawingLayerId?: EntityId | null }>(rows: readonly T[], layer: EntityId | null): T[] =>
    rows.map((row) => ({ ...row, drawingLayerId: layer }))
  return {
    ...base,
    id: 'project-fitout',
    meta: { ...base.meta, name: 'Unit 4 Fitout' },
    designOptions: [],
    drawingLayers: [
      { id: JOINERY, name: 'Joinery', color: '#e3a857' },
      { id: FIT_SERVICES, name: 'Services', color: '#5fb3ff' },
    ],
    existingModel: {
      ...base.existingModel,
      walls: filed(
        base.existingModel.walls.filter((wall) => WALL_IDS.includes(wall.id)),
        JOINERY,
      ),
      // A Join carries no layer of its own — it is a claim between two Walls — so these stay unfilled.
      wallJunctions: base.existingModel.wallJunctions,
      openings: filed(base.existingModel.openings, FIT_SERVICES),
      rooms: filed(base.existingModel.rooms, JOINERY),
      beams: [],
      placedItems: base.existingModel.placedItems.map((item) =>
        item.id in ITEM_LAYERS ? { ...item, drawingLayerId: ITEM_LAYERS[item.id] ?? null } : item,
      ),
    },
    views: [
      {
        ...base.views[0]!,
        id: SOURCE_VIEW,
        designOptionId: null,
        renovationDisplay: undefined,
        layerOrder: null,
        layerSettings: undefined,
        activeLayerId: null,
      },
    ],
  }
}

/** `14 Elm St`: an empty Floor, one `Services` layer, one Option, one Combined view. */
function elmSt(overrides: Partial<Project> = {}): Project {
  const option: DesignOption = {
    id: DEST_OPTION,
    name: 'Option A',
    demolishedIds: [],
    proposed: { walls: [], wallJunctions: [], openings: [], rooms: [], beams: [], placedItems: [] },
  }
  return {
    ...base,
    ...overrides,
    id: 'project-elm',
    meta: { ...base.meta, name: '14 Elm St' },
    floors: base.floors.map((floor) => ({ ...floor, id: DEST_FLOOR })),
    designOptions: overrides.designOptions ?? [option],
    drawingLayers: overrides.drawingLayers ?? [{ id: DEST_SERVICES, name: 'Services', color: '#5fb3ff' }],
    existingModel: overrides.existingModel ?? { walls: [], wallJunctions: [], openings: [], rooms: [], beams: [], placedItems: [] },
    views: [
      {
        ...base.views[0]!,
        id: DEST_VIEW,
        name: 'Option A · Combined',
        floorId: DEST_FLOOR,
        designOptionId: DEST_OPTION,
        renovationDisplay: 'combined',
        layerOrder: null,
        layerSettings: undefined,
        activeLayerId: null,
      },
    ],
  }
}

const copySetOf = (source = fitout()): CopySet =>
  captureCopySet(source, source.views.find((view) => view.id === SOURCE_VIEW)!, selection)

/** The mapping criterion 1 describes: `Joinery` made here, `Services` sent onto the one that exists. */
const mapping: PasteLayerResolution[] = [
  { sourceLayerId: JOINERY, target: { kind: 'new' } },
  { sourceLayerId: FIT_SERVICES, target: { kind: 'existing', layerId: DEST_SERVICES } },
]

function pasteIntent(
  copySet: CopySet,
  resolutions: readonly PasteLayerResolution[],
  target: { viewId?: EntityId; floorId?: EntityId } = {},
): Intent<'renovation.pasteFromProject'> {
  const payload: PasteFromOtherProject = {
    floorId: target.floorId ?? DEST_FLOOR,
    viewId: target.viewId ?? DEST_VIEW,
    copySet,
    includeComments: false,
  }
  return {
    type: 'renovation.pasteFromProject',
    label: intentLabel('renovation.pasteFromProject'),
    payload,
    ids: idSource('paste')(intentIdCount('renovation.pasteFromProject', payload)),
    now: NOW,
    resolutions: { layers: resolutions },
  }
}

const paste = (resolutions: readonly PasteLayerResolution[] = mapping, source = fitout(), destination = elmSt()): Project => {
  const applied = applyIntent(destination, pasteIntent(copySetOf(source), resolutions))
  if (!applied.ok) throw new Error(`the paste was refused: ${applied.code} ${JSON.stringify(applied.problems ?? null)}`)
  return applied.project
}

function optionOf(project: Project): DesignOption {
  const option = project.designOptions?.find((entry) => entry.id === DEST_OPTION)
  if (option === undefined) throw new Error(`the destination holds no Design Option ${DEST_OPTION}`)
  return option
}

describe('the copy set and the review it feeds (#72 §5)', () => {
  it('takes the records the view draws, the Joins they close and the Designs they name', () => {
    const copySet = copySetOf()
    expect(copySet.sourceProjectName).toBe('Unit 4 Fitout')
    expect(copySet.entities.walls.map((wall) => wall.id)).toEqual(WALL_IDS)
    // Both Walls of these two Joins came, so both Joins come whether they were selected or not;
    // the two that name W-5 do not, because a Join with a free end is not a record.
    expect(copySet.entities.wallJunctions.map((junction) => junction.id)).toEqual(JOINED)
    expect(copySet.entities.openings.map((opening) => opening.id)).toEqual(['seed-opening-014', STRANDED])
    expect(copySet.entities.rooms.map((room) => room.id)).toEqual(['seed-room-017', 'seed-room-022'])
    expect(copySet.entities.placedItems.map((item) => item.id).sort()).toEqual(Object.keys(ITEM_LAYERS).sort())
    expect(copySet.itemDesigns.map((design) => design.id).sort()).toEqual(
      copySet.entities.placedItems.map((item) => item.itemDesignId).sort(),
    )
    expect(copySet.demolishedCount).toBe(0)
    expect(copySet.notes).toEqual([])
  })

  it('is a snapshot: the copy does not follow the Project it came from', () => {
    const source = fitout()
    const copySet = copySetOf(source)
    source.existingModel.walls[0]!.line.start.x = 1
    source.meta.name = 'Renamed afterwards'
    expect(copySet.entities.walls[0]!.line.start.x).not.toBe(1)
    expect(copySet.sourceProjectName).toBe('Unit 4 Fitout')
  })

  it('lists one row per source layer the copy rides, with the destination name match beside it', () => {
    const destination = elmSt()
    const review = pasteReviewOf(destination, destination.views[0]!, copySetOf())
    expect(review.kind).toBe('paste-from-project')
    expect(review.sourceProjectId).toBe('project-fitout')
    // 3 Walls + 2 Joins + 1 Opening that has a host + 2 Rooms + 4 Items; `Window 3` is not counted
    // because it is not coming, which is what the row beside it is for.
    expect(review.entityCount).toBe(12)
    expect(review.unlayeredCount).toBe(1)
    expect(review.rows).toEqual([
      {
        sourceLayerId: JOINERY,
        sourceLayerName: 'Joinery',
        sourceLayerColor: '#e3a857',
        itemCount: 7,
        suggestedLayerId: null,
        suggestedLayerName: null,
      },
      {
        sourceLayerId: FIT_SERVICES,
        sourceLayerName: 'Services',
        sourceLayerColor: '#5fb3ff',
        itemCount: 2,
        suggestedLayerId: DEST_SERVICES,
        suggestedLayerName: 'Services',
      },
    ])
    expect(review.destination).toEqual({ kind: 'option', designOptionId: DEST_OPTION, designOptionName: 'Option A' })
  })

  it('says what will not come across and what will be detached, by the name the person looks for', () => {
    const destination = elmSt()
    const review = pasteReviewOf(destination, destination.views[0]!, copySetOf())
    expect(review.notComingAcross).toEqual([{ ref: 'Window 3', reason: 'its host Wall was not copied' }])
    // The Kitchen's edge followed W-6; W-6 stays in the other Project, so the edge stops following.
    expect(review.detached).toEqual([{ ref: 'Kitchen edge 2', reason: 'its Wall was not copied' }])
  })

  it('answers a display that owns no new work with the one sentence, and no write', () => {
    const plain = elmSt()
    const demolition = { ...plain, views: [{ ...plain.views[0]!, renovationDisplay: 'demolition' as const }] }
    const review = pasteReviewOf(demolition, demolition.views[0]!, copySetOf())
    expect(review.destination).toEqual({ kind: 'blocked', reason: 'Switch to Proposed or Combined display to paste new work.' })
    const rejection = expectRejection(demolition, pasteIntent(copySetOf(), mapping), 'option-blocked')
    expect(rejection.problems?.[0]?.message).toBe('Switch to Proposed or Combined display to paste new work.')
  })

  it('refuses a Proposed view with no Design Option chosen', () => {
    const plain = elmSt()
    const homeless = { ...plain, views: [{ ...plain.views[0]!, designOptionId: null }] }
    expect(pasteReviewOf(homeless, homeless.views[0]!, copySetOf()).destination.kind).toBe('blocked')
    expectRejection(homeless, pasteIntent(copySetOf(), mapping), 'option-blocked')
  })
})

describe('the paste (#72 §4)', () => {
  it('lands everything in the Option the view draws, as that Option owns it', () => {
    const after = paste()
    const proposed = optionOf(after).proposed
    expect(proposed.walls).toHaveLength(3)
    expect(proposed.wallJunctions).toHaveLength(2)
    expect(proposed.openings).toHaveLength(1)
    expect(proposed.rooms).toHaveLength(2)
    expect(proposed.placedItems).toHaveLength(4)
    expect(after.existingModel.walls).toHaveLength(0)
    // Work invented here has an empty predecessor list, which is not the same as having none.
    expect(proposed.walls.map((wall) => wall.predecessorIds)).toEqual([[], [], []])
    expect(proposed.placedItems.every((item) => item.predecessorIds?.length === 0)).toBe(true)
    expect(validateProject(after).ok).toBe(true)
  })

  it('gives every record a new ID and rewrites every reference to it', () => {
    const source = fitout()
    const after = paste()
    const proposed = optionOf(after).proposed
    const sourceIds = new Set<EntityId>([
      ...source.existingModel.walls.map((row) => row.id),
      ...source.existingModel.wallJunctions.map((row) => row.id),
      ...source.existingModel.openings.map((row) => row.id),
      ...source.existingModel.rooms.map((row) => row.id),
      ...source.existingModel.placedItems.map((row) => row.id),
      ...source.itemDesigns.map((row) => row.id),
    ])
    const landed = [
      ...proposed.walls,
      ...proposed.wallJunctions,
      ...proposed.openings,
      ...proposed.rooms,
      ...proposed.placedItems,
    ]
    expect(landed.filter((row) => sourceIds.has(row.id))).toEqual([])
    // Nothing dangles: every reference the copy carries names a record that came with it.
    const wallIds = new Set(proposed.walls.map((wall) => wall.id))
    const designIds = new Set(after.itemDesigns.map((design) => design.id))
    for (const junction of proposed.wallJunctions) {
      for (const end of junction.ends) expect(wallIds.has(end.wallId)).toBe(true)
      if (junction.host !== undefined) expect(wallIds.has(junction.host.wallId)).toBe(true)
    }
    for (const opening of proposed.openings) expect(wallIds.has(opening.hostWallId)).toBe(true)
    for (const item of proposed.placedItems) expect(designIds.has(item.itemDesignId)).toBe(true)
    // And the copy stands on this Floor, whichever Floor it was copied from.
    expect(new Set(landed.map((row) => row.floorId))).toEqual(new Set([DEST_FLOOR]))
  })

  it('keeps the geometry and the coordinates the source Floor gave them', () => {
    const source = fitout()
    const proposed = optionOf(paste()).proposed
    for (const wall of proposed.walls) {
      const origin = source.existingModel.walls.find((row) => row.ref === wall.ref)!
      expect(wall.line).toEqual(origin.line)
      expect(wall.thickness).toBe(origin.thickness)
      expect(wall.height).toBe(origin.height)
    }
    const sofa = base.existingModel.placedItems.find((item) => item.id === 'fp-sofa')!
    expect(proposed.placedItems.map((item) => canonicalJson(item.translation))).toContain(canonicalJson(sofa.translation))
  })

  it('takes fresh Wall references, because a reference is unique in the Project (#64 §1)', () => {
    expect(optionOf(paste()).proposed.walls.map((wall) => wall.ref)).toEqual(['W-1', 'W-2', 'W-3'])
    // A destination that already has W-1…W-3 sends the copy on to W-4, W-5, W-6.
    const occupied = elmSt({
      existingModel: {
        walls: base.existingModel.walls.slice(0, 3).map((wall, index) => ({
          ...wall,
          id: `elm-wall-${index}`,
          ref: `W-${index + 1}`,
          floorId: DEST_FLOOR,
          drawingLayerId: null,
        })),
        wallJunctions: [],
        openings: [],
        rooms: [],
        beams: [],
        placedItems: [],
      },
    })
    const applied = applyIntent(occupied, pasteIntent(copySetOf(), mapping))
    if (!applied.ok) throw new Error(`the paste into an occupied Floor was refused: ${applied.code}`)
    expect(optionOf(applied.project).proposed.walls.map((wall) => wall.ref)).toEqual(['W-4', 'W-5', 'W-6'])
  })

  it('brings each Item Design across whole, construction and node IDs included', () => {
    const source = fitout()
    const after = paste()
    const wanted = copySetOf().itemDesigns
    const added = after.itemDesigns.slice(base.itemDesigns.length)
    expect(added).toHaveLength(wanted.length)
    added.forEach((landed, index) => {
      const origin = source.itemDesigns.find((design) => design.id === wanted[index]!.id)!
      expect(landed.id).not.toBe(origin.id)
      // Only the identity is new: a cabinet's tree is not the copy's to renumber.
      expect(canonicalJson({ ...landed, id: origin.id })).toBe(canonicalJson(origin))
    })
  })

  it('files the copy by the mapping: a new layer, an existing one, and Unlayered', () => {
    const after = paste()
    const layers = after.drawingLayers ?? []
    // The new layer is made the way `layer.add` makes one: at the end of the list, which is the front.
    expect(layers.map((layer) => layer.name)).toEqual(['Services', 'Joinery'])
    expect(layers[1]!.color).toBe('#e3a857')
    const joinery = layers[1]!.id
    const proposed = optionOf(after).proposed
    expect(proposed.walls.map((wall) => wall.drawingLayerId)).toEqual([joinery, joinery, joinery])
    expect(proposed.rooms.map((room) => room.drawingLayerId)).toEqual([joinery, joinery])
    expect(proposed.placedItems.filter((item) => item.drawingLayerId === joinery)).toHaveLength(2)
    expect(proposed.openings[0]!.drawingLayerId).toBe(DEST_SERVICES)
    expect(proposed.placedItems.filter((item) => item.drawingLayerId === DEST_SERVICES)).toHaveLength(1)
    // The Sofa rode no layer there, so it rides none here — Unlayered is a place of its own.
    expect(proposed.placedItems.filter((item) => (item.drawingLayerId ?? null) === null)).toHaveLength(1)
  })

  it('sends a row answered Unlayered to Unlayered, and makes no layer for it', () => {
    const after = paste([
      { sourceLayerId: JOINERY, target: { kind: 'unlayered' } },
      { sourceLayerId: FIT_SERVICES, target: { kind: 'existing', layerId: DEST_SERVICES } },
    ])
    expect(after.drawingLayers).toHaveLength(1)
    const proposed = optionOf(after).proposed
    expect(proposed.walls.every((wall) => wall.drawingLayerId === undefined || wall.drawingLayerId === null)).toBe(true)
    expect(proposed.openings[0]!.drawingLayerId).toBe(DEST_SERVICES)
  })

  it('joins the shared Existing Model when the Project has no Design Options', () => {
    const plain = elmSt()
    const bare = { ...plain, designOptions: [], views: [{ ...plain.views[0]!, designOptionId: null, renovationDisplay: 'existing' as const }] }
    const applied = applyIntent(bare, pasteIntent(copySetOf(), mapping))
    if (!applied.ok) throw new Error(`the paste into the baseline was refused: ${applied.code}`)
    expect(applied.project.existingModel.walls).toHaveLength(3)
    expect(applied.project.existingModel.placedItems).toHaveLength(4)
    // Existing work carries no provenance field at all — an empty list would say Option work.
    expect(applied.project.existingModel.walls.every((wall) => wall.predecessorIds === undefined)).toBe(true)
    expect(validateProject(applied.project).ok).toBe(true)
  })

  it('asks for a baseline correction rather than writing Existing work every Option will see', () => {
    const plain = elmSt()
    const destination = { ...plain, views: [{ ...plain.views[0]!, renovationDisplay: 'existing' as const }] }
    expect(pasteReviewOf(destination, destination.views[0]!, copySetOf()).destination.kind).toBe('correct-existing')
    expectRejection(destination, pasteIntent(copySetOf(), mapping), 'baseline-correction-required')
    // The same Intent, wrapped: the correction is what carries it, and the IDs are counted once —
    // the wrapper spends them on the inner Intent's behalf.
    const inner = pasteIntent(copySetOf(), mapping)
    const correction: Intent<'renovation.correctExistingModel'> = {
      type: 'renovation.correctExistingModel',
      label: intentLabel('renovation.correctExistingModel'),
      payload: { inner: { ...inner, ids: [] } },
      ids: inner.ids,
      now: NOW,
    }
    const applied = applyIntent(destination, correction)
    if (!applied.ok) throw new Error(`the correction was refused: ${applied.code} ${JSON.stringify(applied.problems ?? null)}`)
    expect(applied.project.existingModel.walls).toHaveLength(3)
    expect(optionOf(applied.project).proposed.walls).toHaveLength(0)
    expect(validateProject(applied.project).ok).toBe(true)
  })

  it('is one Edit Transaction, and its inverse takes the layers and Designs back with it (#72 §6)', () => {
    const destination = deepFreeze(elmSt())
    const applied = expectRoundTrip(destination, pasteIntent(copySetOf(), mapping))
    expect(applied.patches.length).toBeGreaterThan(0)
    expect(applied.project.itemDesigns).toHaveLength(base.itemDesigns.length + 4)
    expect(applied.project.drawingLayers).toHaveLength(2)
    expect(applied.project.designOptions?.[0]!.proposed.walls).toHaveLength(3)
  })

  it('is deterministic: the same Project and Intent give byte-identical results', () => {
    const destination = elmSt()
    const next = pasteIntent(copySetOf(), mapping)
    const first = applyIntent(destination, next)
    const second = applyIntent(destination, next)
    if (!first.ok || !second.ok) throw new Error('the paste was refused')
    expect(canonicalJson(first.project)).toBe(canonicalJson(second.project))
    expect(canonicalJson(first.patches)).toBe(canonicalJson(second.patches))
  })
})

describe('what a paste refuses (#72 §5, criteria 8, 9, 10)', () => {
  it('refuses an unanswered source layer and changes nothing', () => {
    const rejection = expectRejection(deepFreeze(elmSt()), pasteIntent(copySetOf(), [mapping[0]!]), 'layer-blocked')
    expect(rejection.problems?.[0]?.message).toBe(
      'Every layer the copy brings needs an answer before it can be pasted — "Services" has none.',
    )
  })

  it('refuses a mapping that names a layer this Project does not have', () => {
    expectRejection(
      deepFreeze(elmSt()),
      pasteIntent(copySetOf(), [
        { sourceLayerId: JOINERY, target: { kind: 'new' } },
        { sourceLayerId: FIT_SERVICES, target: { kind: 'existing', layerId: 'no-such-layer' } },
      ]),
      'layer-blocked',
    )
  })

  it('refuses a mapping the dialog never filled in', () => {
    expectRejection(deepFreeze(elmSt()), { ...pasteIntent(copySetOf(), mapping), resolutions: undefined }, 'unknown-target')
  })

  it('drops the Opening whose Wall stayed behind and detaches the Room edge that followed it', () => {
    const proposed = optionOf(paste()).proposed
    expect(proposed.openings.map((opening) => opening.label)).toEqual(['Door 1'])
    const kitchen = proposed.rooms.find((room) => room.name === 'Kitchen')!
    expect(kitchen.wallFaceRefs).toEqual([])
    expect(kitchen.outline).toEqual(base.existingModel.rooms.find((room) => room.id === 'seed-room-017')!.outline)
  })

  it('refuses a Room that would overlap one the destination already has, and leaves the Project alone', () => {
    const plain = elmSt()
    const occupied = {
      ...plain,
      existingModel: {
        ...plain.existingModel,
        rooms: base.existingModel.rooms.map((room) => ({
          ...room,
          floorId: DEST_FLOOR,
          drawingLayerId: null,
          // The Kitchen's edge followed a Wall this empty Floor does not have.
          wallFaceRefs: [],
        })),
      },
    }
    expect(validateProject(occupied).ok).toBe(true)
    const rejection = expectRejection(deepFreeze(occupied), pasteIntent(copySetOf(), mapping), 'room-blocked')
    expect(rejection.problems?.[0]?.message).toContain('Overlaps')
  })

  it('refuses a copy that names a record it did not bring, rather than pasting a dangling reference', () => {
    const copySet = copySetOf()
    const broken: CopySet = {
      ...copySet,
      entities: {
        ...copySet.entities,
        placedItems: [{ ...copySet.entities.placedItems[0]!, itemDesignId: 'design-from-another-project' }],
      },
    }
    expectRejection(deepFreeze(elmSt()), pasteIntent(broken, mapping), 'unknown-target')
  })

  it('refuses an Intent that did not carry the IDs the copy needs', () => {
    expectRejection(deepFreeze(elmSt()), { ...pasteIntent(copySetOf(), mapping), ids: ['paste-only-one'] }, 'missing-ids')
  })

  it('counts exactly the IDs the paste spends, and no more', () => {
    const copySet = copySetOf()
    const payload: PasteFromOtherProject = { floorId: DEST_FLOOR, viewId: DEST_VIEW, copySet, includeComments: false }
    // One per record, one per Item Design, one per source layer — including the slots the stranded
    // Opening and the `existing` answer leave unspent.
    expect(intentIdCount('renovation.pasteFromProject', payload)).toBe(13 + 4 + 2)
    expect(applyIntent(elmSt(), pasteIntent(copySet, mapping)).ok).toBe(true)
  })

  it('previews the rows and the refusal together, so the dialog can open with nothing mapped', () => {
    const preview = previewIntent(elmSt(), pasteIntent(copySetOf(), []))
    expect(preview.rejection?.code).toBe('layer-blocked')
    expect(preview.review?.kind).toBe('paste-from-project')
    if (preview.review?.kind === 'paste-from-project') expect(preview.review.rows).toHaveLength(2)
    expect(preview.affected.viewId).toBe(DEST_VIEW)
    expect(preview.affected.view).toBe('plan')
  })
})

/**
 * Skirting across a Project (#78 §1): the one kind that crosses only when its host Wall crosses,
 * because a run with no Wall is a record that refers to nothing.
 */
describe('Skirting crossing a Project (#78 §1)', () => {
  const host = 'seed-wall-002'
  /** A Wall outside the copy, so a run drawn against it has nothing to come across on. */
  const other = 'seed-wall-005'

  const run = (id: EntityId, hostWallId: EntityId): Project => {
    const source = fitout()
    const wall = base.existingModel.walls.find((entry) => entry.id === hostWallId)
    if (wall === undefined) throw new Error(`the fixture holds no ${hostWallId}`)
    // `fitout` keeps only the three Walls of the copy; a run drawn against a Wall outside them is
    // the stranded case, so that Wall goes back into the source — unselected.
    if (!source.existingModel.walls.some((entry) => entry.id === hostWallId)) {
      source.existingModel.walls = [...source.existingModel.walls, { ...wall, drawingLayerId: JOINERY }]
    }
    source.existingModel.skirting = [
      {
        id,
        floorId: wall.floorId,
        hostWallId,
        side: 'left',
        start: 0,
        end: 1000,
        bottom: 0,
        height: 100,
        thickness: 15,
        drawingLayerId: JOINERY,
      },
    ]
    return source
  }

  it('comes across with a fresh identity, on the Wall that came with it', () => {
    const source = run('seed-skirting-1', host)
    const copySet = captureCopySet(source, source.views[0]!, [...WALL_IDS, 'seed-skirting-1'])
    expect(skirtingOf(copySet.entities).map((entry) => entry.id)).toEqual(['seed-skirting-1'])
    const applied = applyIntent(elmSt(), pasteIntent(copySet, mapping))
    if (!applied.ok) throw new Error(`the paste was refused: ${applied.code}`)
    const proposed = optionOf(applied.project).proposed
    const landed = skirtingOf(proposed)
    expect(landed).toHaveLength(1)
    expect(landed[0]!.id).not.toBe('seed-skirting-1')
    // The host reference moved with the host: the run stands on the copied Wall, not the source's.
    expect(proposed.walls.map((wall) => wall.id)).toContain(landed[0]!.hostWallId)
    expect(landed[0]!.hostWallId).not.toBe(host)
    // It rode `Joinery` there, so it rides the layer created for `Joinery` here.
    const joinery = (applied.project.drawingLayers ?? []).find((layer) => layer.name === 'Joinery')!
    expect(landed[0]!.drawingLayerId).toBe(joinery.id)
    expect(validateProject(applied.project).ok).toBe(true)
  })

  it('is left behind when its Wall stays behind, and is not counted in the copy', () => {
    const source = run('seed-skirting-2', other)
    const copySet = captureCopySet(source, source.views[0]!, [...WALL_IDS, 'seed-skirting-2'])
    // Captured, because it was selected and the view draws it…
    expect(skirtingOf(copySet.entities).map((entry) => entry.id)).toEqual(['seed-skirting-2'])
    const review = pasteReviewOf(elmSt(), elmSt().views[0]!, copySet)
    // …but the count is what is coming, and a run whose Wall is not is not coming.
    expect(review.kind).toBe('paste-from-project')
    if (review.kind !== 'paste-from-project') return
    // 3 Walls + the 2 Joins they close; the run is not counted, because its Wall is not coming.
    expect(review.entityCount).toBe(5)
    const applied = applyIntent(elmSt(), pasteIntent(copySet, mapping))
    if (!applied.ok) throw new Error(`the paste was refused: ${applied.code}`)
    expect(skirtingOf(optionOf(applied.project).proposed)).toEqual([])
    expect(validateProject(applied.project).ok).toBe(true)
  })
})
