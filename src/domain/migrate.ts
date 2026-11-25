/**
 * The domain schema version and its migrator chain (#42 §5).
 *
 * `DOMAIN_SCHEMA_VERSION` is one of three independent version constants (#20 §12): the
 * workspace file version and the IndexedDB `schemaVersion` say nothing about it. It says
 * what shape a Project has.
 *
 * Migration is explicit and sequential (#14): one pure migrator per version bump, never
 * a best-effort cast, always on a copy, and a version this build does not know is
 * refused before anything is mutated. `MIGRATIONS.md` next door is the rule for the
 * issue that adds the next one.
 */
import type { ValidationProblem } from '../lib'
import type { IdAllocator } from './remapIds'
import type { Floor, PlanView, Project } from './project'
import { DEFAULT_DRAWING_LAYERS } from './project'
import type { PlanViewRange } from './planViewRange'
import { DEFAULT_PLAN_VIEW_RANGE, defaultPlanViewRange } from './planViewRange'
import { validateProject } from './validate'

/**
 * The domain schema this build writes and understands at the top of the chain.
 *
 * The sixteenth step (#81 §1) is the Annotation: the Project gains the `annotations` collection and
 * the `A-` reference counter beside it, both Project-level, because a drawing note belongs to the
 * record rather than to any one view's copy of it. The fifteenth before it (#80 §1) is the Comment:
 * the Project gains the `comments` collection and the
 * `C-` reference counter beside it, both Project-level, because a note belongs to the record rather
 * than to any one Floor or Design Option. The fourteenth before it (#79 §1) is the Service: the
 * Existing Model gains the Service collection, and so does every Design Option's proposed work. The
 * thirteenth before it (#78 §1) is the Skirting: the Existing Model gains the Skirting collection,
 * and so does every Design Option's proposed work. The
 * twelfth before it (#77 §1) is the Beam: the Existing Model gains the Beam collection, and so does
 * every Design Option's proposed work. The
 * eleventh before that (#76 §4) is the Clearance Envelope: every Item Design gains the one envelope
 * it may carry, `null` for every design that has none. The tenth before that (#75 §1) is the
 * Elevation View: the Project gains the list of saved sideways looks, empty for every Project that
 * predates them. The ninth (#74 §1) is the Plan View Range: every saved view gains the height it
 * draws at. The eighth (#69 §1, #73) is the renovation model: Design Options, the Drawing Layers
 * every Project starts with, and the four settings a saved view gained. A Project saved by an older
 * build carries `schemaVersion: 15` and comes up the chain; a Project saved by a newer one is
 * refused as `newer-schema` rather than opened and quietly stripped of its Annotations.
 */
export const DOMAIN_SCHEMA_VERSION = 16

/**
 * One pure vN → vN+1 step. Its input is already a copy; it never reads the clock, and a
 * step that needs new IDs is handed an allocator rather than minting one (#42 §3).
 */
export type Migrator = (data: unknown, allocateId: IdAllocator) => unknown

/**
 * `MIGRATORS[i]` migrates v(i+1) → v(i+2), so index 0 is v1 → v2.
 *
 * Sixteen steps, the last of which is the Annotation collection and its reference counter (#81), the
 * one before it the Comment collection and its reference counter (#80), the
 * one before it the Service
 * collection (#79), the one before it the Skirting
 * collection (#78), the one before that the Beam
 * collection (#77), the one before that the Clearance Envelope field (#76), the one before that the Elevation View list (#75), the one before that the
 * Plan View Range (#74) and the one before that the renovation model (#69, #71, #73).
 */
export const MIGRATORS: readonly Migrator[] = [
  migrateV1toV2,
  migrateV2toV3,
  migrateV3toV4,
  migrateV4toV5,
  migrateV5toV6,
  migrateV6toV7,
  migrateV7toV8,
  migrateV8toV9,
  migrateV9toV10,
  migrateV10toV11,
  migrateV11toV12,
  migrateV12toV13,
  migrateV13toV14,
  migrateV14toV15,
  migrateV15toV16,
]

/**
 * v1 → v2 (#56): the Project gains `views`, and each Floor gains the one default Plan
 * View that shows it.
 *
 * Nothing else moves. `Floor.limits` is absent rather than defaulted — a Floor whose
 * extent nobody typed has no limits, and inventing `0` would be a claim about the
 * building. The view takes its name from the Floor it shows, because that is the label
 * the switcher would otherwise have to invent per render, and it shows the Plan Image,
 * which is what every v1 Plan View did. IDs come from `allocateId`, called once with the
 * number of Floors, so a migrated Project is fully determined by its input plus the IDs
 * the caller brought.
 *
 * A value that is not a Project shape comes back with `views: []` added and is left for
 * `validateProject` to refuse: a migrator repairs versions, it never repairs data.
 */
export function migrateV1toV2(data: unknown, allocateId: IdAllocator): unknown {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return data
  const record = data as Record<string, unknown>
  const floors: readonly unknown[] = Array.isArray(record.floors) ? record.floors : []
  const shaped = floors.filter(
    (floor): floor is Floor =>
      floor !== null && typeof floor === 'object' && typeof (floor as Floor).id === 'string',
  )
  const ids = allocateId(shaped.length)
  // The view as v2 wrote it: `planViewRange` belongs to v9 (#74) and a step never writes a field its
  // own version does not have, so this is the shape minus that one field.
  const views: Omit<PlanView, 'planViewRange'>[] = shaped.map((floor, index) => ({
    id: ids[index] as string,
    kind: 'plan',
    floorId: floor.id,
    name: typeof floor.name === 'string' ? floor.name : '',
    isDefault: true,
    showPlanImage: true,
  }))
  return { ...record, views }
}

/**
 * v2 → v3 (#58): an Item Footprint becomes a shape rather than a pair of numbers.
 *
 * Every v2 footprint is the same Rectangle preset, placed so that it draws exactly what v2
 * drew: local corners `(0,0)` to `(width,depth)`, which is what a Rectangle centred at
 * `(width / 2, depth / 2)` with no turn evaluates to. The geometry is therefore identical,
 * which is the whole point — a Project that never opens the shape editor keeps the outline,
 * the measurements and the Item Origin it had, and only the *description* of the shape has
 * changed.
 *
 * A footprint this build cannot read is left exactly as it is for `validateProject` to
 * refuse: a migrator repairs versions, it never repairs data. Nothing else moves, and no ID
 * is spent.
 */
export function migrateV2toV3(data: unknown): unknown {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return data
  const record = data as Record<string, unknown>
  if (!Array.isArray(record.itemDesigns)) return data
  return {
    ...record,
    itemDesigns: record.itemDesigns.map((design) => {
      if (design === null || typeof design !== 'object' || Array.isArray(design)) return design
      const entry = design as Record<string, unknown>
      const footprint = entry.footprint
      if (footprint === null || typeof footprint !== 'object' || Array.isArray(footprint)) return design
      const shape = footprint as Record<string, unknown>
      if (shape.kind !== 'rectangle') return design
      const { width, depth } = shape
      if (typeof width !== 'number' || typeof depth !== 'number') return design
      return {
        ...entry,
        footprint: {
          kind: 'preset',
          preset: { kind: 'rectangle', width, depth },
          centre: { x: width / 2, y: depth / 2 },
          orientationDeg: 0,
        },
      }
    }),
  }
}

/**
 * The Wall height a Project without one gets: the HDB BTO typical ceiling height from the
 * pack entry `height.ceiling` (#33, #63).
 *
 * The number is written here rather than read from the pack because a migrator is a record
 * of what this release did: if the pack's typical ceiling ever changed, projects migrated
 * from v3 would silently change height. `migrate.test.ts` pins it to the pack entry it came
 * from, so the two cannot drift unnoticed.
 */
export const DEFAULT_WALL_HEIGHT_MM = 2600

/**
 * v3 → v4 (#64): the Existing Model gains the two Wall collections, and the Project gains a
 * default Wall height.
 *
 * `existingModel.walls` and `existingModel.wallJunctions` start empty — no v3 data describes
 * a Wall, and the legacy `wall-hack` sketch stays discarded rather than becoming a Wall
 * (#20 §12) — and `preferences.defaultWallHeight` is the pack's ceiling height, which is what
 * a Wall drawn by this build's Wall tool gets unless the Floor says otherwise. A Floor's own
 * `defaultWallHeight` stays absent: nobody measured a Floor in v3 that had one.
 *
 * Nothing else moves, no ID is spent, and a value that is not a Project shape is left for
 * `validateProject` to refuse. The step is idempotent: a record that already carries Walls,
 * Junctions or a chosen default height keeps them, so running it twice — or running it on a
 * record that only needed the other half of the step — cannot empty a Project of its Walls.
 */
export function migrateV3toV4(data: unknown): unknown {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return data
  const record = data as Record<string, unknown>
  const next: Record<string, unknown> = { ...record }
  if (record.preferences !== null && typeof record.preferences === 'object' && !Array.isArray(record.preferences)) {
    const preferences = record.preferences as Record<string, unknown>
    // A height already stored is a height somebody chose; a step that adds a field never
    // overwrites the one it was meant to add.
    next.preferences = { ...preferences, defaultWallHeight: preferences.defaultWallHeight ?? DEFAULT_WALL_HEIGHT_MM }
  }
  if (record.existingModel !== null && typeof record.existingModel === 'object' && !Array.isArray(record.existingModel)) {
    const existingModel = record.existingModel as Record<string, unknown>
    const kept = (key: 'walls' | 'wallJunctions'): unknown[] =>
      Array.isArray(existingModel[key]) ? (existingModel[key] as unknown[]) : []
    next.existingModel = {
      ...existingModel,
      walls: kept('walls'),
      wallJunctions: kept('wallJunctions'),
    }
  }
  return next
}

/**
 * v4 → v5 (#65): the Existing Model gains the Opening collection.
 *
 * `existingModel.openings` starts empty — no v4 data describes a door or a window, and an
 * Opening is an absence in a Wall rather than a thing that can be inferred from a floor
 * plan — and nothing else moves. Every v4 field keeps its meaning: an Opening is hosted by
 * a Wall, and Walls arrived with v4, so there is no older shape to carry forward. No ID is
 * spent, and a value that is not a Project shape is left for `validateProject` to refuse.
 */
export function migrateV4toV5(data: unknown): unknown {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return data
  const record = data as Record<string, unknown>
  if (record.existingModel === null || typeof record.existingModel !== 'object' || Array.isArray(record.existingModel)) {
    return record
  }
  const existingModel = record.existingModel as Record<string, unknown>
  // A record that already carries the collection keeps it: a step that adds a field never
  // overwrites the one it was meant to add.
  return {
    ...record,
    existingModel: {
      ...existingModel,
      openings: Array.isArray(existingModel.openings) ? existingModel.openings : [],
    },
  }
}

/**
 * v5 → v6 (#66): the Project gains the warning acknowledgement collection.
 *
 * `warningAcknowledgements` starts empty — no v5 data records that a user saw a warning, and
 * inventing one would be inventing a decision nobody made. Nothing else moves: an
 * acknowledgement refers to entities by ID and to a Design Option that does not exist yet, so
 * there is no older shape to carry forward. No ID is spent, and a value that is not a Project
 * shape is left for `validateProject` to refuse.
 *
 * The step is idempotent: a record that already carries the collection keeps it, so running it
 * twice cannot empty a Project of the acknowledgements it was given.
 */
export function migrateV5toV6(data: unknown): unknown {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return data
  const record = data as Record<string, unknown>
  return {
    ...record,
    warningAcknowledgements: Array.isArray(record.warningAcknowledgements) ? record.warningAcknowledgements : [],
  }
}

/**
 * v6 → v7 (#67): Rooms.
 *
 * `existingModel.rooms` is the only change, and an older file simply has none. Nothing else
 * moves: a Room is a new kind of element rather than a change to one, so no Wall, Opening or
 * Placement is rewritten and no ID is spent.
 *
 * A v6 file cannot already carry the field — the strict validator rejected unknown fields on
 * every write — so an array found here came from a newer build, and is left exactly as it is.
 */
export function migrateV6toV7(data: unknown): unknown {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return data
  const record = data as Record<string, unknown>
  const existing = record.existingModel
  if (existing === null || typeof existing !== 'object' || Array.isArray(existing)) return data
  const model = existing as Record<string, unknown>
  if (Array.isArray(model.rooms)) return data
  return { ...record, existingModel: { ...model, rooms: [] } }
}

/**
 * v7 → v8 (#69, #70, #71): Design Options, and the saved-view settings that look through one.
 *
 * `designOptions: []` is the only change to the containers, and an older file simply has none —
 * which is also how a migrated Project behaves: no Options means the Existing Model is the whole
 * model, exactly as it was in S7. Every saved view then gains the pair of fields that say how it
 * looks at that model (#70 §1): `designOptionId: null` and `renovationDisplay: 'existing'`, which
 * is the way every view already looked — the Existing Model, and nothing of anyone's Option.
 *
 * #71 adds the Drawing Layers to the same step, because one version was already carrying two model
 * changes and a third did not need its own; #73 split the golden evidence. A Project
 * that arrives without a `drawingLayers` array gains the three defaults — `Structure`, `Services`,
 * `Furniture` — and every Wall, Opening and Room in the Existing Model and in every Design Option is
 * filed on `Structure`, every Placed Item on `Furniture`, which is the grouping the user would get
 * by hand. Each saved view says it overrides nothing, follows the Project order, has no Active Layer
 * beyond `Structure` and does not snap to hidden content. This is the one part of the step that
 * spends IDs — three of them, from the allocator the chain was handed (#42 §3).
 *
 * A Project that already carries the array keeps it exactly as it is, empty included: an empty array
 * is a Project whose content is all Unlayered, and re-adding the three defaults would invent layers
 * somebody deleted. Nothing else moves and no clock is read.
 *
 * The eighth golden step (#69 §1, #71 §1, #73): Design Options, the three default Drawing Layers,
 * and the four settings every saved view was written without.
 */
export function migrateV7toV8(data: unknown, allocateId: IdAllocator): unknown {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return data
  const record = data as Record<string, unknown>
  const views: readonly unknown[] | null = Array.isArray(record.views) ? record.views : null
  // A view that already carries both fields is carried over untouched, so the step is idempotent
  // and a v8 file comes back as the same object it arrived as.
  const needsView = (view: unknown): view is Record<string, unknown> =>
    view !== null &&
    typeof view === 'object' &&
    !Array.isArray(view) &&
    ((view as Record<string, unknown>).designOptionId === undefined ||
      (view as Record<string, unknown>).renovationDisplay === undefined ||
      (view as Record<string, unknown>).layerSettings === undefined ||
      (view as Record<string, unknown>).layerOrder === undefined ||
      (view as Record<string, unknown>).activeLayerId === undefined ||
      (view as Record<string, unknown>).snapToHiddenContent === undefined)
  const hasOptions = Array.isArray(record.designOptions)
  // The layers (#71 §1): a Project that already carries the array has them, whatever is in it — an
  // empty array is a Project whose content is all Unlayered, and re-adding the three defaults to it
  // would invent layers the user deleted.
  const needsLayers = !Array.isArray(record.drawingLayers)
  if (hasOptions && !needsLayers && (views === null || !views.some(needsView))) return data
  const next: Record<string, unknown> = { ...record }
  if (!hasOptions) next.designOptions = []
  // The three layers come first, because the view defaults below name one of them and every entity
  // in the model is filed on one of them.
  const layers = needsLayers ? newDrawingLayers(allocateId) : null
  if (layers !== null) next.drawingLayers = layers
  if (views !== null) next.views = views.map((view) => (needsView(view) ? completedView(view, layers ?? asLayers(record.drawingLayers)) : view))
  if (layers !== null) fileExistingContent(next, layers)
  return next
}

/**
 * v8 → v9 (#74 §1): every saved view gains the Plan View Range it draws at.
 *
 * The rule is the one a new Plan View gets (#74 behaviour 4), read from the Floor the view shows
 * *at migration time*: the Floor's lower limit, or 0 when it has none, up to its upper limit, or
 * 2 600 mm when it has none. That is the whole storey, so a migrated Project draws exactly what it
 * drew before — nothing appears, nothing is styled differently, and no warning reopens, because no
 * entity was touched.
 *
 * Two details the shape forces:
 *
 *  - A view whose `floorId` names no Floor — which the validator refuses, but a file on disk can
 *    still say — takes the plain 0–2 600, because there is no Floor to read limits from.
 *  - A Floor whose own limits do not rise (`lowerMm` at or above `upperMm`, which the validator
 *    allows as equal) cannot give a range, since a range must rise. Such a Floor falls back to
 *    0–2 600 rather than producing a view the validator would reject.
 *
 * A view that already carries `planViewRange` is carried over untouched, so the step is idempotent
 * and a v9 file comes back as the same object it arrived as. Nothing else moves and no clock is read.
 */
export function migrateV8toV9(data: unknown): unknown {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return data
  const record = data as Record<string, unknown>
  const views: readonly unknown[] | null = Array.isArray(record.views) ? record.views : null
  if (views === null || !views.some(needsRange)) return data
  const defaults = floorRanges(record.floors)
  return {
    ...record,
    views: views.map((view) => (needsRange(view) ? { ...view, planViewRange: rangeForView(view, defaults) } : view)),
  }
}

/**
 * v9 → v10 (#75 §1): the Project gains `elevationViews`, and every Floor keeps the views it has.
 *
 * The list is empty for every Project that arrives, because an Elevation View is always one a person
 * made — there is nothing to invent for them, and inventing a view of the longest Wall would be a
 * drawing of something nobody asked to look at. The step reads no clock and mints no ID, and a record
 * that already carries the list comes back as the same object it arrived as, so the step is idempotent
 * and a v10 file is untouched by it.
 */
export function migrateV9toV10(data: unknown): unknown {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return data
  const record = data as Record<string, unknown>
  if (Array.isArray(record.elevationViews)) return data
  return { ...record, elevationViews: [] }
}

/**
 * v10 → v11 (#76 §4): every Item Design gains the Clearance Envelope field it was written without.
 *
 * The value is `null` for every design that arrives, because a Clearance Envelope is always one a
 * person drew or measured — there is no built-in depth to invent and no kind that implies one
 * (#15 supplies no implicit rules). A design that already carries the field, `null` or an envelope,
 * is carried over untouched, so the step is idempotent and a v11 file comes back as the same object
 * it arrived as. The step reads no clock, mints no ID and touches no other record: no placement
 * moves, no warning reopens, because no measurement and no entity changed.
 */
export function migrateV10toV11(data: unknown): unknown {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return data
  const record = data as Record<string, unknown>
  if (!Array.isArray(record.itemDesigns) || !record.itemDesigns.some(needsEnvelope)) return data
  return {
    ...record,
    itemDesigns: record.itemDesigns.map((design) => (needsEnvelope(design) ? { ...design, clearanceEnvelope: null } : design)),
  }
}

/** An Item Design that has no Clearance Envelope field yet. */
const needsEnvelope = (design: unknown): design is Record<string, unknown> =>
  design !== null && typeof design === 'object' && !Array.isArray(design) && (design as Record<string, unknown>).clearanceEnvelope === undefined

/**
 * v11 → v12 (#77 §1): the Beam collection.
 *
 * `existingModel.beams` and every Design Option's `proposed.beams` are the only changes, and an
 * older file simply has no Beams — no legacy beam data exists (#20 §3), so there is nothing to
 * translate and no Wall to read a Beam out of. Nothing else moves: a Beam is a new kind of element
 * rather than a change to one, so no Wall, Opening, Room or Placement is rewritten and no ID is
 * spent.
 *
 * A v11 file cannot already carry either field — the strict validator rejected unknown fields on
 * every write — so an array found here came from a newer build, and is left exactly as it is. The
 * step is therefore idempotent: a v12 file comes back as the same object it arrived as.
 */
export function migrateV11toV12(data: unknown): unknown {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return data
  const record = data as Record<string, unknown>
  // A model that already carries the field came from a build that knows Beams; leave it alone.
  const missing = (model: unknown): model is Record<string, unknown> | undefined | null =>
    !isRecordLike(model) || !Array.isArray(model.beams)
  const existing = isRecordLike(record.existingModel) ? record.existingModel : null
  const options = Array.isArray(record.designOptions) ? record.designOptions : []
  if (!missing(existing) && !options.some((option) => isRecordLike(option) && missing(option.proposed))) return data
  const next: Record<string, unknown> = { ...record }
  if (missing(existing)) next.existingModel = { ...(existing ?? {}), beams: [] }
  if (options.length > 0) {
    next.designOptions = options.map((option) =>
      isRecordLike(option) && missing(option.proposed) ? { ...option, proposed: { ...(option.proposed as object | null | undefined), beams: [] } } : option,
    )
  }
  return next
}

/**
 * v12 → v13 (#78): the Skirting collection.
 *
 * The Existing Model and every Design Option's proposed work gain `skirting: []`. A v12 Project has
 * never seen a Skirting, and there is nothing in it one could be derived from: a Skirting is a
 * range on a Wall face, and which face a homeowner would have chosen — in a room with two long
 * walls and a bay — is a decision, not an inference. Inventing one would draw a body on a drawing
 * nobody drew, so the honest default is the empty list.
 *
 * Nothing else moves. A Skirting stores no geometry and points at nothing but its host, so no
 * Wall, Opening, Room or Placement is rewritten, no ID is spent, and no view changes. A v13 file
 * cannot already carry the field on a write this build made, and an array found here came from a
 * newer build, so it is left exactly as it is: the step is idempotent, and a v13 record comes back
 * as the same object it arrived as.
 */
export function migrateV12toV13(data: unknown): unknown {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return data
  const record = data as Record<string, unknown>
  // A model that already carries the field came from a build that knows Skirting; leave it alone.
  const missing = (model: unknown): model is Record<string, unknown> | undefined | null =>
    !isRecordLike(model) || !Array.isArray(model.skirting)
  const existing = isRecordLike(record.existingModel) ? record.existingModel : null
  const options = Array.isArray(record.designOptions) ? record.designOptions : []
  if (!missing(existing) && !options.some((option) => isRecordLike(option) && missing(option.proposed))) return data
  const next: Record<string, unknown> = { ...record }
  if (missing(existing)) next.existingModel = { ...(existing ?? {}), skirting: [] }
  if (options.length > 0) {
    next.designOptions = options.map((option) =>
      isRecordLike(option) && missing(option.proposed)
        ? { ...option, proposed: { ...(option.proposed as object | null | undefined), skirting: [] } }
        : option,
    )
  }
  return next
}

/** Whether this is an object a field can be added to. */
const isRecordLike = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * v13 → v14 (#79): the Service collection.
 *
 * The Existing Model and every Design Option's proposed work gain `services: []`. A v13 Project has
 * never seen a Service, and no legacy service data exists (#20 §7), so there is nothing to translate
 * and nothing to infer: a pipe nobody drew is not a record of a pipe, and guessing where one ran
 * would put a body on a drawing that nobody documented. The honest default is the empty list.
 *
 * Nothing else moves. A Service stores its own line or its own point and points at nothing, so no
 * Wall, Opening, Room or Placement is rewritten, no ID is spent, and no view changes. A v14 file
 * cannot already carry the field on a write this build made, and an array found here came from a
 * newer build, so it is left exactly as it is: the step is idempotent, and a v14 record comes back
 * as the same object it arrived as.
 */
export function migrateV13toV14(data: unknown): unknown {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return data
  const record = data as Record<string, unknown>
  // A model that already carries the field came from a build that knows Services; leave it alone.
  const missing = (model: unknown): model is Record<string, unknown> | undefined | null =>
    !isRecordLike(model) || !Array.isArray(model.services)
  const existing = isRecordLike(record.existingModel) ? record.existingModel : null
  const options = Array.isArray(record.designOptions) ? record.designOptions : []
  if (!missing(existing) && !options.some((option) => isRecordLike(option) && missing(option.proposed))) return data
  const next: Record<string, unknown> = { ...record }
  if (missing(existing)) next.existingModel = { ...(existing ?? {}), services: [] }
  if (options.length > 0) {
    next.designOptions = options.map((option) =>
      isRecordLike(option) && missing(option.proposed)
        ? { ...option, proposed: { ...(option.proposed as object | null | undefined), services: [] } }
        : option,
    )
  }
  return next
}

/**
 * The Project gains the Comment collection and the `C-` reference counter beside it (#80 §1).
 *
 * Both arrive empty and zero. A v14 Project has never seen a Comment, and no legacy notes exist —
 * the legacy `wall-hack` and `tile-zone` sketches were discarded during migration (#20 §7) — so
 * there is nothing to translate and nothing to infer: a note nobody wrote is not a record of one.
 * The counter starts at zero rather than one because it counts what has been *handed out*, and the
 * first Comment of a migrated Project therefore takes `C-001`.
 *
 * Nothing else moves. A Comment points at the record rather than standing in it, so no Floor, entity
 * or view is rewritten, no ID is spent, and no clock is read: the timestamps of a Comment arrive with
 * the Intent that creates it (#42 §3). A record that already carries both fields came from a build
 * that knows Comments and is returned as the same object it arrived as, so the step is idempotent.
 */
export function migrateV14toV15(data: unknown): unknown {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return data
  const record = data as Record<string, unknown>
  const hasComments = Array.isArray(record.comments)
  const hasCounter = typeof record.commentReferenceCounter === 'number'
  if (hasComments && hasCounter) return data
  return {
    ...record,
    ...(hasComments ? {} : { comments: [] }),
    ...(hasCounter ? {} : { commentReferenceCounter: 0 }),
  }
}

/**
 * The Project gains the Annotation collection and the `A-` reference counter beside it (#81 §1).
 *
 * Both arrive empty and zero, for the same reason the Comment step did: a v15 Project has never
 * seen an Annotation, and no legacy ones exist — the legacy `wall-hack` and `tile-zone` sketches
 * were discarded during migration (#20 §7) and must not reappear as Annotations — so there is
 * nothing to translate. The counter starts at zero because it counts what has been handed out, and
 * the first Annotation of a migrated Project therefore takes `A-001`.
 *
 * Nothing else moves: an Annotation points at its owning view rather than standing in it, so no
 * Floor, entity or view is rewritten, no ID is spent, and no clock is read. A record that already
 * carries both fields came from a build that knows Annotations and is returned as the same object
 * it arrived as, so the step is idempotent.
 */
export function migrateV15toV16(data: unknown): unknown {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return data
  const record = data as Record<string, unknown>
  const hasAnnotations = Array.isArray(record.annotations)
  const hasCounter = typeof record.annotationReferenceCounter === 'number'
  if (hasAnnotations && hasCounter) return data
  return {
    ...record,
    ...(hasAnnotations ? {} : { annotations: [] }),
    ...(hasCounter ? {} : { annotationReferenceCounter: 0 }),
  }
}

/** A saved view that has no Plan View Range yet. */
const needsRange = (view: unknown): view is Record<string, unknown> =>
  view !== null && typeof view === 'object' && !Array.isArray(view) && (view as Record<string, unknown>).planViewRange === undefined

/** The default range of every Floor in the record, by ID. */
function floorRanges(floors: unknown): Map<string, PlanViewRange> {
  const ranges = new Map<string, PlanViewRange>()
  if (!Array.isArray(floors)) return ranges
  for (const floor of floors) {
    if (floor === null || typeof floor !== 'object' || Array.isArray(floor)) continue
    const shaped = floor as Floor
    if (typeof shaped.id !== 'string') continue
    ranges.set(shaped.id, defaultPlanViewRange(shaped.limits))
  }
  return ranges
}

/** The range a view of this Floor starts at; the plain 0–2 600 when its Floor says nothing usable. */
function rangeForView(view: unknown, defaults: ReadonlyMap<string, PlanViewRange>): PlanViewRange {
  const floorId = (view as Record<string, unknown>).floorId
  return (typeof floorId === 'string' ? defaults.get(floorId) : undefined) ?? DEFAULT_PLAN_VIEW_RANGE
}

/** A `drawingLayers` value read as records, ignoring anything the shape does not describe. */
function asLayers(value: unknown): { id: string; name: string }[] {
  if (!Array.isArray(value)) return []
  const layers: { id: string; name: string }[] = []
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
    const id = (entry as Record<string, unknown>).id
    const name = (entry as Record<string, unknown>).name
    if (typeof id === 'string' && typeof name === 'string') layers.push({ id, name })
  }
  return layers
}

/**
 * The three default layers, in the Project layer order — back to front, so `Structure` sits behind
 * `Services` and `Furniture` (#71 §1).
 *
 * The IDs are the caller's to give: a migrator never invents one (#42 §3), which is why this step
 * takes the allocator the chain was started with and spends exactly three.
 */
function newDrawingLayers(allocateId: IdAllocator): { id: string; name: string; color: string }[] {
  const ids = allocateId(DEFAULT_DRAWING_LAYERS.length)
  return DEFAULT_DRAWING_LAYERS.map((layer, index) => ({ id: ids[index]!, name: layer.name, color: layer.color }))
}

/**
 * One saved view with the four settings it was written without, each of which says what the view
 * already did: no overrides of its own, the Project's layer order, nothing Active, no snapping to
 * hidden content.
 *
 * The Active Layer is `Structure` where the Project has a layer by that name — Walls, Openings and
 * Rooms are created on it (#71 §2), so a migrated Project keeps drawing new work the way it always
 * did — and Unlayered otherwise, which is what a Project with no layers has to say.
 */
function completedView(view: Record<string, unknown>, layers: readonly { id: string; name: string }[]): Record<string, unknown> {
  const structure = layers.find((layer) => layer.name === 'Structure') ?? null
  return {
    designOptionId: null,
    renovationDisplay: 'existing',
    layerSettings: {},
    layerOrder: null,
    activeLayerId: structure?.id ?? null,
    snapToHiddenContent: false,
    ...view,
  }
}

/**
 * File the content a Project already holds onto the layers it is named for (#71 §1): Walls, Openings
 * and Rooms on `Structure`, Placed Items on `Furniture`, in the Existing Model and in every Design
 * Option's proposed work alike.
 *
 * `Services` starts empty — it is the layer the user puts the things they add later on — and an
 * entity that already carries the field keeps what it has, so the step is idempotent. The subtype
 * rule is by layer NAME, the same rule creation follows, because a Project whose user renamed
 * `Structure` to `Shell` still has its Walls filed on the layer they were drawn on rather than a
 * fresh one called `Structure`.
 */
function fileExistingContent(next: Record<string, unknown>, layers: readonly { id: string; name: string }[]): void {
  const byName = (name: string): string | null => layers.find((layer) => layer.name === name)?.id ?? null
  const structure = byName('Structure')
  const furniture = byName('Furniture')
  /** One model's five collections, filing each record that has no layer of its own yet. */
  const fileModel = (model: unknown): void => {
    if (model === null || typeof model !== 'object' || Array.isArray(model)) return
    const container = model as Record<string, unknown>
    for (const key of ['walls', 'openings', 'rooms'] as const) fileCollection(container[key], structure)
    fileCollection(container.placedItems, furniture)
  }
  fileModel(next.existingModel)
  if (Array.isArray(next.designOptions)) {
    for (const option of next.designOptions) {
      if (option === null || typeof option !== 'object' || Array.isArray(option)) continue
      fileModel((option as Record<string, unknown>).proposed)
    }
  }
}

/** Every record of one collection, given the layer its kind starts on. */
function fileCollection(value: unknown, layerId: string | null): void {
  if (!Array.isArray(value)) return
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    if (record.drawingLayerId !== undefined) continue
    // A Project with no `Structure` layer — the user deleted it before this build ever saw the
    // file — leaves its content Unlayered rather than inventing a layer to hold it.
    record.drawingLayerId = layerId
  }
}

export type MigrateError =
  /** Data from a newer BuildBox: refused, never guessed at (#20 §5). */
  | { kind: 'newer-schema'; found: number; supported: number; message: string }
  /** No usable version on the envelope at all. */
  | { kind: 'unknown-schema'; found: unknown; message: string }
  /** Migrated, but still not a valid Project. */
  | { kind: 'invalid'; problems: ValidationProblem[]; message: string }

export type MigrateResult =
  | { ok: true; project: Project; migratedFrom: number }
  | { ok: false; error: MigrateError }

/**
 * Apply `chain` to `data` from version `from` up to the top, on a copy.
 *
 * Exported separately from {@link migrateProject} so a test can drive a synthetic
 * multi-step chain without shipping fake schema versions. `from` is assumed to be an
 * integer of 1 or more; a chain shorter than `from` applies no steps.
 */
export function runMigrationChain(
  data: unknown,
  from: number,
  chain: readonly Migrator[],
  allocateId: IdAllocator,
): unknown {
  // Migration always runs on a copy: the caller's value is never mutated (#14).
  let current = structuredClone(data)
  for (let index = from - 1; index < chain.length; index += 1) {
    current = (chain[index] as Migrator)(current, allocateId)
  }
  return current
}

/**
 * Bring `data`, recorded as arriving at `fromVersion`, up to {@link DOMAIN_SCHEMA_VERSION}
 * and validate it. `fromVersion` is `unknown` because it comes off an untrusted envelope.
 *
 * `allocateId` is only spent when a step actually runs, but it is always a parameter: the
 * caller decides where new IDs come from, and a Project already at the top of the chain
 * simply never asks (#42 §3).
 */
export function migrateProject(data: unknown, fromVersion: unknown, allocateId: IdAllocator): MigrateResult {
  if (typeof fromVersion !== 'number' || !Number.isInteger(fromVersion) || fromVersion < 1) {
    return {
      ok: false,
      error: {
        kind: 'unknown-schema',
        found: fromVersion,
        message: `This Project's schema version is missing or unreadable — expected a whole number of 1 or more, found ${String(fromVersion)}.`,
      },
    }
  }

  if (fromVersion > DOMAIN_SCHEMA_VERSION) {
    return {
      ok: false,
      error: {
        kind: 'newer-schema',
        found: fromVersion,
        supported: DOMAIN_SCHEMA_VERSION,
        message: `This Project was saved by a newer BuildBox (schema ${fromVersion}). This version opens schema ${DOMAIN_SCHEMA_VERSION} and older.`,
      },
    }
  }

  const migrated = runMigrationChain(data, fromVersion, MIGRATORS, allocateId)
  const result = validateProject(migrated)
  if (!result.ok) {
    return {
      ok: false,
      error: {
        kind: 'invalid',
        problems: result.problems,
        message: `This Project does not match BuildBox domain schema ${DOMAIN_SCHEMA_VERSION}.`,
      },
    }
  }

  return { ok: true, project: result.project, migratedFrom: fromVersion }
}
