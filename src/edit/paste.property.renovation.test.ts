/**
 * Random copy sets under random layer mappings (#72 criteria 4, 5, 6, 10).
 *
 * The unit tests pin the scene the issue describes. This one asks the question a scene cannot: is
 * there *any* selection of records and *any* set of layer answers for which the paste leaves the
 * destination holding a reference to something that is not there, an ID that was already taken, a
 * Project the validator refuses, or a transaction whose inverse does not give the Project back?
 * Those four are the whole promise of §4 — a copy is a fresh set of records, filed where the person
 * said, in one Edit Transaction — so all four are asserted on every case, including the cases where
 * the copy brings nothing but a Wall, or where every layer is answered the same way.
 */
import { describe, expect, it } from 'vitest'
import * as fc from 'fast-check'
import layersFixture from '../../fixtures/domain/v9/layers.json?raw'
import type { DrawingLayer, EntityId, Project } from '../domain'
import { validateProject } from '../domain'
import { canonicalJson } from '../lib'
import { applyIntent, captureCopySet, intentIdCount, intentLabel, pasteReviewOf } from './index'
import type { PasteLayerResolution, PasteReview } from './index'
import { NOW, expectRoundTrip, idSource } from './testing'
import { currentSchemaOf } from '../domain/testing'

/** The fixture's shape is fixed by `scripts/make-layers-seed.ts`, which wrote it. */
const fixture = JSON.parse(layersFixture) as { project: unknown }

const base = currentSchemaOf(fixture.project, 8)
const SRC_JOINERY = 'prop-joinery'
const SRC_SERVICES = 'prop-services'
const DEST_OPTION = 'prop-option'
const DEST_VIEW = 'prop-view'
const DEST_FLOOR = 'prop-floor'

/** The pool a random selection draws from: three Walls, the Joins between them, one of each kind. */
const WALL_IDS: EntityId[] = ['seed-wall-002', 'seed-wall-003', 'seed-wall-004']
const JOIN_IDS: EntityId[] = ['seed-wall-007', 'seed-wall-008']
const POOL: EntityId[] = [...WALL_IDS, 'seed-opening-014', 'seed-room-022', 'seed-002', 'fp-fridge', 'fp-sofa']

const filed = <T extends { drawingLayerId?: EntityId | null; wallFaceRefs?: unknown }>(row: T, layer: EntityId | null): T => ({
  ...row,
  drawingLayerId: layer,
  ...(row.wallFaceRefs === undefined ? {} : { wallFaceRefs: [] }),
})

/** The Project the copy comes out of: two layers, one Unlayered item, no Design Options. */
const source: Project = {
  ...base,
  id: 'prop-source',
  meta: { ...base.meta, name: 'Copied from here' },
  designOptions: [],
  drawingLayers: [
    { id: SRC_JOINERY, name: 'Joinery', color: '#e3a857' },
    { id: SRC_SERVICES, name: 'Services', color: '#5fb3ff' },
  ],
  existingModel: {
    walls: base.existingModel.walls.filter((wall) => WALL_IDS.includes(wall.id)).map((wall) => filed(wall, SRC_JOINERY)),
    wallJunctions: base.existingModel.wallJunctions.filter((junction) => JOIN_IDS.includes(junction.id)),
    openings: base.existingModel.openings.filter((opening) => opening.id === 'seed-opening-014').map((opening) => filed(opening, SRC_SERVICES)),
    rooms: base.existingModel.rooms.filter((room) => room.id === 'seed-room-022').map((room) => filed(room, SRC_JOINERY)),
    beams: [],
    placedItems: base.existingModel.placedItems
      .filter((item) => item.id === 'seed-002' || item.id === 'fp-fridge' || item.id === 'fp-sofa')
      .map((item) => filed(item, item.id === 'seed-002' ? SRC_JOINERY : item.id === 'fp-fridge' ? SRC_SERVICES : null)),
  },
  views: [
    {
      ...base.views[0]!,
      designOptionId: null,
      renovationDisplay: undefined,
      layerOrder: null,
      layerSettings: undefined,
      activeLayerId: null,
    },
  ],
}

const CANDIDATES: DrawingLayer[] = [
  { id: 'dest-services', name: 'Services', color: '#5fb3ff' },
  { id: 'dest-joinery', name: 'Joinery', color: '#e3a857' },
]

/** An empty Floor with one Option, one Combined view and a random handful of layers. */
const destination = (layers: readonly DrawingLayer[]): Project => ({
  ...base,
  id: 'prop-destination',
  meta: { ...base.meta, name: 'Pasted into here' },
  floors: base.floors.map((floor) => ({ ...floor, id: DEST_FLOOR })),
  designOptions: [
    { id: DEST_OPTION, name: 'Option', demolishedIds: [], proposed: { walls: [], wallJunctions: [], openings: [], rooms: [], beams: [], placedItems: [] } },
  ],
  drawingLayers: [...layers],
  existingModel: { walls: [], wallJunctions: [], openings: [], rooms: [], beams: [], placedItems: [] },
  views: [
    {
      ...base.views[0]!,
      id: DEST_VIEW,
      floorId: DEST_FLOOR,
      designOptionId: DEST_OPTION,
      renovationDisplay: 'combined',
      layerOrder: null,
      layerSettings: undefined,
      activeLayerId: null,
    },
  ],
})

/** Every layer the copy brings gets one of the three answers the dialog offers. */
const answers = (review: PasteReview, layers: readonly DrawingLayer[]): PasteLayerResolution[] =>
  review.rows.map((row, index) => {
    if (layers.length > 0 && index % 3 === 2) return { sourceLayerId: row.sourceLayerId, target: { kind: 'existing', layerId: layers[index % layers.length]!.id } }
    return { sourceLayerId: row.sourceLayerId, target: index % 3 === 0 ? { kind: 'new' } : { kind: 'unlayered' } }
  })

describe('any copy set under any layer mapping (#72 §4)', () => {
  it('lands fresh IDs, no dangling reference, a valid Project, and undoes to the byte it started at', () => {
    fc.assert(
      fc.property(fc.subarray(POOL, { minLength: 0 }), fc.subarray(CANDIDATES, { minLength: 0, maxLength: 2 }), (picked, layers) => {
        const before = destination(layers)
        const copySet = captureCopySet(source, source.views[0]!, picked)
        const review = pasteReviewOf(before, before.views[0]!, copySet)
        // A copy that brings nothing is a no-op the shell never offers; it is not a case here.
        fc.pre(review.entityCount > 0)
        const payload = { floorId: DEST_FLOOR, viewId: DEST_VIEW, copySet, includeComments: false as const }
        const next = {
          type: 'renovation.pasteFromProject' as const,
          label: intentLabel('renovation.pasteFromProject'),
          payload,
          ids: idSource('prop')(intentIdCount('renovation.pasteFromProject', payload)),
          now: NOW,
          resolutions: { layers: answers(review, layers) },
        }
        const applied = expectRoundTrip(before, next)
        const option = applied.project.designOptions?.find((entry) => entry.id === DEST_OPTION)
        if (option === undefined) throw new Error('the Option the view draws is gone')
        const landed = [
          ...option.proposed.walls,
          ...option.proposed.wallJunctions,
          ...option.proposed.openings,
          ...option.proposed.rooms,
          ...option.proposed.placedItems,
        ]
        expect(landed).toHaveLength(review.entityCount)

        // Criterion 4: nothing the copy brings is already in use here, and nothing it refers to was
        // left behind in the Project it came from.
        const taken = new Set<EntityId>([
          ...base.existingModel.walls.map((row) => row.id),
          ...base.existingModel.placedItems.map((row) => row.id),
          ...base.itemDesigns.map((row) => row.id),
          ...source.existingModel.walls.map((row) => row.id),
          ...source.existingModel.openings.map((row) => row.id),
          ...source.existingModel.rooms.map((row) => row.id),
          ...source.existingModel.placedItems.map((row) => row.id),
          ...source.itemDesigns.map((row) => row.id),
        ])
        expect(landed.filter((row) => taken.has(row.id))).toEqual([])
        const wallIds = new Set(option.proposed.walls.map((wall) => wall.id))
        const designIds = new Set(applied.project.itemDesigns.map((design) => design.id))
        for (const junction of option.proposed.wallJunctions) {
          for (const end of junction.ends) expect(wallIds.has(end.wallId)).toBe(true)
          if (junction.host !== undefined) expect(wallIds.has(junction.host.wallId)).toBe(true)
        }
        for (const opening of option.proposed.openings) expect(wallIds.has(opening.hostWallId)).toBe(true)
        for (const room of option.proposed.rooms) for (const face of room.wallFaceRefs) expect(wallIds.has(face.wallId)).toBe(true)
        for (const item of option.proposed.placedItems) expect(designIds.has(item.itemDesignId)).toBe(true)

        // Criterion 4 again, from the other side: the validator is the same one the app runs before
        // it writes, and it sees every reference the paste wrote.
        expect(validateProject(applied.project).ok).toBe(true)

        // Criterion 5: a record is filed on a layer of this Project, or on none — never on the layer
        // it rode in the other one.
        const here = new Set<EntityId>((applied.project.drawingLayers ?? []).map((layer) => layer.id))
        expect(here.has(SRC_JOINERY) || here.has(SRC_SERVICES)).toBe(false)
        for (const row of [...option.proposed.walls, ...option.proposed.openings, ...option.proposed.rooms, ...option.proposed.placedItems]) {
          if (row.drawingLayerId !== undefined && row.drawingLayerId !== null) expect(here.has(row.drawingLayerId)).toBe(true)
        }
        // The rows the review counted are the rows the mapping answered, so the counts cannot drift.
        expect(review.rows.map((row) => row.itemCount).reduce((sum, count) => sum + count, 0) + review.unlayeredCount).toBe(
          option.proposed.walls.length + option.proposed.openings.length + option.proposed.rooms.length + option.proposed.placedItems.length,
        )
      }),
      { timeout: 30_000 },
    )
  })

  it('is deterministic across the whole space: the same case twice gives the same Project', () => {
    fc.assert(
      fc.property(fc.subarray(POOL, { minLength: 1 }), fc.integer({ min: 0, max: 3 }), (picked, layerCount) => {
        const before = destination(CANDIDATES.slice(0, layerCount))
        const copySet = captureCopySet(source, source.views[0]!, picked)
        const review = pasteReviewOf(before, before.views[0]!, copySet)
        fc.pre(review.entityCount > 0)
        const payload = { floorId: DEST_FLOOR, viewId: DEST_VIEW, copySet, includeComments: false as const }
        const next = {
          type: 'renovation.pasteFromProject' as const,
          label: intentLabel('renovation.pasteFromProject'),
          payload,
          ids: idSource('prop')(intentIdCount('renovation.pasteFromProject', payload)),
          now: NOW,
          resolutions: { layers: answers(review, before.drawingLayers ?? []) },
        }
        const first = applyIntent(before, next)
        const second = applyIntent(before, next)
        if (!first.ok) throw new Error(`the paste was refused: ${first.code}`)
        if (!second.ok) throw new Error(`the paste was refused: ${second.code}`)
        expect(canonicalJson(first.patches)).toBe(canonicalJson(second.patches))
      }),
      { timeout: 30_000 },
    )
  })
})
