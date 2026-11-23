/**
 * The Existing Model correction (#69 §12–§13), and
 * reachable only through the flag-gated spreads in `../registry` and `../intents`.
 *
 * Once a Project carries a Design Option, the Existing Model is the baseline every alternative is
 * drawn against, so changing it is a command of its own: `renovation.correctExistingModel` wraps
 * the Existing Model edit the user actually asked for, previews it against **every** Option, and
 * commits it — or nothing — as one Edit Transaction. The guard that makes that the only way in is
 * in `../apply`, which refuses any Intent whose patches land in `existingModel` while Options exist.
 *
 * Two rules decide what each Option's own work does:
 *
 * - **Succession.** A successor follows the correction only when its geometry was identical to its
 *   predecessor's *pre-correction* geometry on the 0.01 mm grid the whole Project is stored on —
 *   the state `Replace…` leaves behind before the user edits it. Then the very patches the baseline
 *   edit wrote are replayed onto it, so the successor ends up in the same relation to the new
 *   baseline as it stood in to the old one, and the Openings cut into it, its joins and the Room
 *   edges riding its faces come along. A successor with geometry of its own is left exactly as it
 *   is: BuildBox never guesses how to map a correction onto work the user shaped.
 * - **Blockers.** Once every write is in place each Option's effective model is measured again —
 *   work of its own left standing on a Wall the correction took down, an Opening that no longer fits
 *   its host, a Wall edit a referenced Room edge cannot follow. Any blocker rejects the whole
 *   correction, naming the Option, because half a baseline is worse than none.
 *
 * `renovation.moveToDesignOption` is the other inner Intent, and it is **not** a succession: it
 * re-owns baseline data that was surveyed by mistake, so the entities keep their IDs and no
 * demolition record or successor is involved. That difference is why it has its own path below
 * rather than sharing the one above.
 */
import { applyPatches, produceWithPatches } from 'immer'
import type { Patch } from 'immer'
import { designOptionsOf, validateProject } from '../../domain'
import type { DesignOption, EntityId, Opening, PlacedItem, Project, Room, Wall, WallJunction } from '../../domain'
import { canonicalJson } from '../../lib'
import type {
  CorrectionEffect,
  CorrectionReview,
  DemolitionDependency,
  DependencyReview,
  Intent,
  IntentType,
  Locator,
  MoveToDesignOption,
  MoveToOptionReview,
  RejectionCode,
  RenovationIntentType,
} from '../intents'
import type { Handler, IntentHandler } from './context'
import { openingsStillFit, requireOpeningsFit } from './openingSupport'
import { effectiveView, IntentRejection, refuse, requireHandler } from './support'
import { scopeAround } from '../validationScope'

/** The correction-table Intent types, written once; `renovationEdits` excludes exactly these. */
export type CorrectionIntentType = Extract<
  RenovationIntentType,
  'renovation.correctExistingModel' | 'renovation.moveToDesignOption'
>

/** One entity of a model, whichever collection it lives in. */
type AnyEntity = Wall | WallJunction | Opening | Room | PlacedItem

/** The five collections a correction can touch, in the order a review reads them. */
const COLLECTIONS = ['walls', 'wallJunctions', 'openings', 'rooms', 'placedItems'] as const
type Collection = (typeof COLLECTIONS)[number]

const collectionOf = (model: { [K in Collection]: AnyEntity[] }, key: Collection): AnyEntity[] => model[key]

/** `Correct Existing Model: W-2` — the label of one correction's Edit Transaction (#69 §12). */
const correctionLabel = (subjectRef: string): string => `Correct Existing Model: ${subjectRef}`

/** What a per-Option check found; `optionId: null` is the baseline edit itself. */
interface Block {
  readonly optionId: EntityId | null
  readonly code: RejectionCode
  readonly path: string
  readonly message: string
}

type Blocker = (block: Block) => void

/** A blocker from inside one Option, with that Option's name on the front. */
const optionBlock = (option: DesignOption, error: IntentRejection): Block => ({
  optionId: option.id,
  // Every blocker of a correction is told the same way, whatever rule inside the Option raised it.
  code: 'option-blocked',
  path: error.problems[0]!.path,
  // The whole correction is refused for the whole Project, so the reader has to be told which
  // alternative to open and fix before sending it again.
  message: `${option.name}: ${error.message}`,
})

/** `W-2`, `Door 1`, `Kitchen`, `Base 600 #1` — what a review line calls a thing. */
function labelOf(project: Project, id: EntityId): string {
  const model = project.existingModel
  const wall = model.walls.find((entry) => entry.id === id)
  if (wall !== undefined) return wall.ref
  const opening = model.openings.find((entry) => entry.id === id)
  if (opening !== undefined) return opening.label
  const room = model.rooms.find((entry) => entry.id === id)
  if (room !== undefined) return room.name
  const placed = model.placedItems.find((entry) => entry.id === id)
  if (placed !== undefined) return project.itemDesigns.find((d) => d.id === placed.itemDesignId)?.name ?? placed.id
  for (const option of designOptionsOf(project)) {
    const entity = collectionOf(option.proposed, 'walls')
      .concat(...COLLECTIONS.slice(1).map((key) => collectionOf(option.proposed, key)))
      .find((entry) => entry.id === id)
    if (entity !== undefined) return entityName(project, entity)
  }
  return id
}

function entityName(project: Project, entity: AnyEntity): string {
  if ('ref' in entity) return entity.ref
  if ('label' in entity) return entity.label
  if ('name' in entity) return entity.name
  return project.itemDesigns.find((design) => design.id === (entity as PlacedItem).itemDesignId)?.name ?? entity.id
}

const dependency = (project: Project, id: EntityId): DemolitionDependency => ({ id, label: labelOf(project, id) })

// --- The successor-follow rule ------------------------------------------------

/** Every number rounded onto the 0.01 mm grid the Project is stored on (#69 §12). */
function quantised(value: unknown): unknown {
  if (typeof value === 'number') return Math.round(value * 100) / 100
  if (Array.isArray(value)) return value.map(quantised)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) out[key] = quantised(entry)
    return out
  }
  return value
}

/**
 * The geometry of an entity: everything about where it stands and how it is built, and nothing
 * about which entity it is. Two entities with the same key stand in the same place, which is the
 * whole of "identical within 0.01 mm" — the grid the numbers are stored on.
 */
function geometryKey(entity: AnyEntity): string {
  const rest = { ...entity } as Record<string, unknown>
  delete rest.id
  delete rest.ref
  delete rest.label
  delete rest.name
  delete rest.predecessorIds
  return canonicalJson(quantised(rest))
}

/** One Existing entity the correction touches, and what it looked like beforehand. */
interface Subject {
  readonly id: EntityId
  readonly collection: Collection
  readonly floorId: EntityId
  readonly geometry: string
}

/**
 * What the inner Intent changed, read off immer's own work: an entity the draft holds by a
 * different reference than the base is one the draft rewrote, and the ID sets say what was added or
 * taken away. No payload field names, so no family of Intents is special-cased here — and a new
 * Intent is covered the day it is written.
 */
function subjectsOf(base: Project, draft: Project): Subject[] {
  const subjects: Subject[] = []
  for (const key of COLLECTIONS) {
    const before = collectionOf(base.existingModel, key)
    const after = new Map(collectionOf(draft.existingModel, key).map((entity) => [entity.id, entity]))
    for (const entity of before) {
      const now = after.get(entity.id)
      // Gone, or rewritten: immer keeps every entity the draft did not touch identical by
      // reference, so a pointer compare is the whole test.
      if (now === undefined || now !== entity) subjects.push(subject(entity, key))
    }
    const wasThere = new Set(before.map((entity) => entity.id))
    for (const entity of after.values()) {
      if (!wasThere.has(entity.id)) subjects.push(subject(entity, key))
    }
  }
  return subjects
}

const subject = (entity: AnyEntity, collection: Collection): Subject => ({
  id: entity.id,
  collection,
  floorId: entity.floorId,
  geometry: geometryKey(entity),
})

/** The successors this Option holds of one subject. */
const successorsOf = (option: DesignOption, subjectId: EntityId, collection: Collection): AnyEntity[] =>
  collectionOf(option.proposed, collection).filter((entity) => (entity.predecessorIds ?? []).includes(subjectId))

/** The Option's proposed work that hangs off a subject: its copies, its joins, its Room edges. */
function dependantsOf(project: Project, option: DesignOption, subjectId: EntityId, collection: Collection): DemolitionDependency[] {
  const proposed = option.proposed
  const ids: EntityId[] = []
  for (const opening of proposed.openings) if (opening.hostWallId === subjectId) ids.push(opening.id)
  for (const junction of proposed.wallJunctions) {
    if (junction.host?.wallId === subjectId || junction.ends.some((end) => end.wallId === subjectId)) ids.push(junction.id)
  }
  for (const room of proposed.rooms) if (room.wallFaceRefs.some((ref) => ref.wallId === subjectId)) ids.push(room.id)
  for (const entity of successorsOf(option, subjectId, collection)) if (!ids.includes(entity.id)) ids.push(entity.id)
  return ids.map((id) => dependency(project, id))
}

// --- Running the inner Intent, and replaying it onto aligned successors --------

/** The handler behind an inner Intent; only an Existing Model edit is correctable. */
function innerHandler(type: IntentType): IntentHandler<IntentType> {
  const wrapped = type === 'renovation.correctExistingModel' || type === 'renovation.moveToDesignOption'
  if (wrapped || type.startsWith('designOption.')) {
    refuse('unknown-target', 'payload.inner', 'A correction wraps one Existing Model edit, never another correction.')
  }
  return requireHandler(type)
}

const isCollection = (key: unknown): key is Collection => (COLLECTIONS as readonly string[]).includes(key as string)

/** Where one Option's copy of a subject sits, ready to be written. */
interface Aligned {
  readonly optionIndex: number
  readonly optionId: EntityId
  readonly collection: Collection
  readonly index: number
}

/**
 * Every successor whose geometry is identical to its predecessor's *before* the correction, on the
 * 0.01 mm grid (#69 §12). This is the whole of the successor-follow rule, read once, before
 * anything is written, so a later patch cannot be judged against geometry that has already moved.
 */
function alignedSuccessors(project: Project, subjects: readonly Subject[]): Map<EntityId, Aligned[]> {
  const aligned = new Map<EntityId, Aligned[]>()
  designOptionsOf(project).forEach((option, optionIndex) => {
    for (const entry of subjects) {
      collectionOf(option.proposed, entry.collection).forEach((successor, index) => {
        if (!(successor.predecessorIds ?? []).includes(entry.id)) return
        if (geometryKey(successor) !== entry.geometry) return
        const list = aligned.get(entry.id) ?? []
        list.push({ optionIndex, optionId: option.id, collection: entry.collection, index })
        aligned.set(entry.id, list)
      })
    }
  })
  return aligned
}

/**
 * The baseline edit, then every Option that has to follow it. Nothing here throws for an Option: a
 * blocker is reported and the caller decides whether that means a rejection (`run`) or a line of a
 * preview (`review`).
 *
 * The follow is a **replay**, not a second run of the handler: the patches the baseline edit
 * produced are applied again, path for path, onto each aligned successor. That is what "the same
 * correction is applied to it" means exactly — the successor had the same geometry, so the same
 * writes leave it in the same relation to the baseline — and it keeps the correction from guessing:
 * no IDs are spent a second time, and no handler is asked to edit an Option's work through a
 * payload written about the survey's.
 */
function runCorrection(project: Project, draft: Project, inner: Intent, ids: string[], report: Blocker): Subject[] {
  const handler = innerHandler(inner.type)
  const [next, patches] = produceWithPatches(project, (produced) => {
    handler.run({ project, draft: produced as unknown as Project, intent: { ...inner, ids } as unknown as Intent })
  })
  applyPatches(draft, patches)
  const subjects = subjectsOf(project, next)
  if (subjects.length === 0) return subjects

  const aligned = alignedSuccessors(project, subjects)
  const replay = new Map<EntityId, Patch[]>()
  // Walking the patches one at a time is what makes the indices mean the same thing they meant to
  // the handler. The running state they are read against is a shallow copy of each collection the
  // patches touch — the entity at an index is all that is ever asked of it, and copying the whole
  // Project once per patch made a correction cost a second per patch (#69 §12).
  const live = new Map<Collection, { id: EntityId }[]>()
  for (const patch of patches) {
    const [root, key, index] = patch.path
    if (root === 'existingModel' && isCollection(key) && typeof index === 'number') {
      let list = live.get(key)
      if (list === undefined) {
        list = collectionOf(project.existingModel, key).slice()
        live.set(key, list)
      }
      const entity = list[index]
      const targets = entity === undefined ? undefined : aligned.get(entity.id)
      if (targets !== undefined) {
        for (const target of targets) {
          const pending = replay.get(target.optionId) ?? []
          pending.push({ ...patch, path: ['designOptions', target.optionIndex, 'proposed', target.collection, target.index, ...patch.path.slice(3) ] })
          replay.set(target.optionId, pending)
        }
      }
      if (patch.op === 'remove') list.splice(index, 1)
      else if (patch.op === 'add') list.splice(index, 0, patch.value as { id: EntityId })
    }
  }
  for (const patchesOfOption of replay.values()) applyPatches(draft, patchesOfOption)

  designOptionsOf(draft).forEach((_option, index) => {
    const before = designOptionsOf(project)[index]!
    // Whatever this Option stands on has to still hold, whether or not it had work to move.
    const problem = optionProblem(project, draft, before, subjects)
    if (problem !== null) report(problem)
  })
  return subjects
}

/**
 * What this Option would be left holding that cannot stand: work of its own standing on a Wall the
 * correction took down, an Opening that no longer fits its host, a join that no longer meets, a Room
 * edge a corrected Wall cannot carry (#69 §12's blockers). The Option is measured as its own
 * effective Project, which is the only way to see baseline work and proposed work in one place.
 */
function optionProblem(base: Project, draft: Project, before: DesignOption, subjects: readonly Subject[]): Block | null {
  const changed = subjects.map((entry) => entry.id)
  const view = effectiveView(draft, null, before.id)
  const block = (path: string, message: string): Block => ({ optionId: before.id, code: 'option-blocked', path, message })
  const standing = new Set(view.existingModel.walls.map((entry) => entry.id))
  for (const opening of before.proposed.openings) {
    if (standing.has(opening.hostWallId)) continue
    return block('designOptions', `${before.name} holds ${labelOf(base, opening.id)} in ${labelOf(base, opening.hostWallId)}, which this correction takes down.`)
  }
  for (const junction of before.proposed.wallJunctions) {
    const named = junction.ends.map((end) => end.wallId).concat(junction.host === undefined ? [] : [junction.host.wallId])
    const gone = named.find((id) => !standing.has(id))
    if (gone !== undefined) return block('designOptions', `${before.name} has a join on ${labelOf(base, gone)}, which this correction takes down.`)
  }
  try {
    requireOpeningsFit(view, new Set(changed))
  } catch (error) {
    if (!(error instanceof IntentRejection)) throw error
    return optionBlock(before, error)
  }
  // The same scoping rule as `applyIntent`, applied to a Project this Transaction built: the
  // correction changed these baseline records, and this Option's own work only matters where it was
  // copied from or attached to one of them. Everything else in the Option was standing before this
  // Transaction and was not written by it (#69 §8, §12).
  const moved = new Set(changed)
  const own = COLLECTIONS.flatMap((key) =>
    collectionOf(before.proposed, key)
      .filter((entity) => (entity.predecessorIds ?? []).some((id) => moved.has(id)))
      .map((entity) => entity.id),
  )
  const scope = scopeAround(view, changed)
  // An Option this correction neither copied work into nor touched with a record of its own cannot
  // have been moved by it — unless the correction moved geometry at all, because a Room the baseline
  // slid is checked against this Option's Rooms by a rule no scope narrows. Every rule that could
  // newly fail on a still record — a Door that no longer fits, an Edge that lost its face, a Join
  // whose Wall went away — reads a proposed record that names, or was copied from, something the
  // correction wrote. The checks above read every proposed record regardless, because "standing on a
  // Wall that came down" is not a reference the scope finds.
  const geometry = subjects.some((entry) => entry.collection !== 'openings' && entry.collection !== 'placedItems')
  const touched =
    geometry ||
    own.length > 0 ||
    COLLECTIONS.some((key) => collectionOf(before.proposed, key).some((entity) => scope.entities.has(entity.id)))
  if (!touched) return null
  const entities = new Set([...scope.entities, ...own])
  const checked = validateProject(asPlainModel(view), { entities })
  if (checked.ok) return null
  return block(checked.problems[0]!.path, `${before.name}: ${checked.problems[0]!.message}`)
}

/**
 * One Option's effective model read as a plain single-model Project: the merge has already decided
 * what stands, so what is left to ask of it is geometry, not provenance — and its own records are
 * checked against the real Project by the same apply that writes this one.
 *
 * Only the records that carry the field are rewritten. `predecessorIds` is a provenance field, so it
 * is meaningless on a record the merge has already placed, and rewriting all 1 500 of them to satisfy
 * a pass over a few dozen cost more than the pass itself (#69 §8). Every record of a merged view that
 * carries the field is one of this Option's own — the Existing Model holds no provenance — and it is
 * stripped whether or not this pass reads it, because a record left carrying it reads as a record the
 * Existing Model invented, which is a blocker this Option did not earn.
 */
function asPlainModel(view: Project): Project {
  const stripped = <T extends { id: EntityId; predecessorIds?: EntityId[] }>(entity: T): T => {
    if (entity.predecessorIds === undefined) return entity
    const rest: Record<string, unknown> = { ...entity }
    delete rest.predecessorIds
    return rest as T
  }
  const model = view.existingModel
  return {
    ...view,
    designOptions: [],
    // The same reason, one level up: a saved view looks through an Option this synthetic Project
    // deliberately does not carry, so a bound view would read as a dangling reference — a blocker
    // this Option did not earn. The pass measures geometry, never which Option a view looks
    // through, so the binding is dropped with the Options it points at (#70 §7b).
    views: view.views.map((each) => (each.designOptionId === undefined ? each : { ...each, designOptionId: null })),
    existingModel: {
      ...model,
      walls: model.walls.map(stripped),
      wallJunctions: model.wallJunctions.map(stripped),
      openings: model.openings.map(stripped),
      rooms: model.rooms.map(stripped),
      placedItems: model.placedItems.map(stripped),
    },
  }
}

// --- Move to a Design Option --------------------------------------------------

/** One Option's line of a move, and the entities that left the Existing Model. */
interface MovePlan {
  readonly moved: readonly EntityId[]
  perOption: {
    optionId: EntityId
    removesDemolitions: readonly DemolitionDependency[]
    detaches: readonly string[]
  }[]
}

const touchesMoved = (junction: WallJunction, moved: ReadonlySet<EntityId>): boolean =>
  junction.ends.some((end) => moved.has(end.wallId)) || (junction.host !== undefined && moved.has(junction.host.wallId))

/**
 * Re-owning baseline data that was surveyed by mistake (#69 §13). Distinct from succession on
 * purpose: the entities keep their IDs — Comments and every other reference to them stay valid —
 * and no demolition record is written, because nothing comes down. The target Option simply owns
 * them from now on, and every Option's record of demolishing them stops making sense.
 */
function runMove(project: Project, draft: Project, payload: MoveToDesignOption, report: Blocker): MovePlan {
  const target = designOptionsOf(draft).find((option) => option.id === payload.targetOptionId)
  if (target === undefined)
    refuse('unknown-target', 'designOptions', `There is no Design Option ${payload.targetOptionId} to move this work into.`)
  if (payload.entityIds.length === 0) refuse('unknown-target', 'payload.entityIds', 'Name at least one Existing item to move.')

  // The set is closed over what hangs off it: an Opening survives only in the Wall it is cut into,
  // so a moved Wall takes its Openings with it.
  const moved = new Set<EntityId>(payload.entityIds)
  for (const wall of draft.existingModel.walls) {
    if (!moved.has(wall.id)) continue
    for (const opening of draft.existingModel.openings) if (opening.hostWallId === wall.id) moved.add(opening.id)
  }

  const perOption: MovePlan['perOption'] = []
  // First the questions, asked of every Option, before a single record moves: half a re-ownership
  // is the same half a baseline.
  const blockers: Block[] = []
  for (const holder of designOptionsOf(project)) {
    const held = collectionOf(holder.proposed, 'walls').concat(
      ...COLLECTIONS.slice(1).map((key) => collectionOf(holder.proposed, key)),
    )
    for (const id of moved) {
      // A successor would be left standing on a predecessor that is no longer Existing work, and
      // only putting that work back can make the record make sense again.
      if (!held.some((entity) => (entity.predecessorIds ?? []).includes(id))) continue
      blockers.push({
        optionId: holder.id,
        code: 'option-blocked',
        path: 'designOptions',
        message: `Restore ${labelOf(project, id)} in ${holder.name} first.`,
      })
    }
  }
  if (blockers.length > 0) {
    for (const block of blockers) report(block)
    return { moved: [...moved], perOption }
  }

  for (const option of designOptionsOf(draft)) {
    // A demolition record can only name Existing work, so the ones naming the moved entities go —
    // in every Option, the target included.
    const removes = option.demolishedIds.filter((id) => moved.has(id))
    option.demolishedIds = option.demolishedIds.filter((id) => !moved.has(id))
    const detaches: string[] = []
    for (const room of option.proposed.rooms) {
      const kept = room.wallFaceRefs.filter((ref) => !moved.has(ref.wallId))
      if (kept.length === room.wallFaceRefs.length) continue
      room.wallFaceRefs = kept
      detaches.push(room.name)
    }
    perOption.push({ optionId: option.id, removesDemolitions: removes.map((id) => dependency(project, id)), detaches })
  }

  const model = draft.existingModel
  const proposed = target.proposed
  // An Existing Room that referenced a Wall which is no longer surveyed is detached rather than
  // silently re-pointed at a Wall the Option may knock down (#69 §13).
  for (const room of model.rooms) {
    const kept = room.wallFaceRefs.filter((ref) => !moved.has(ref.wallId))
    if (kept.length !== room.wallFaceRefs.length) room.wallFaceRefs = kept
  }
  // A Junction that named any moved Wall becomes the Option's own: it now joins proposed work, and
  // work the Option owns cannot be carried by a baseline Junction.
  for (const junction of model.wallJunctions) if (touchesMoved(junction, moved)) proposed.wallJunctions.push({ ...junction, predecessorIds: [] })
  for (const opening of model.openings) if (moved.has(opening.id)) proposed.openings.push({ ...opening, predecessorIds: [] })
  for (const wall of model.walls) if (moved.has(wall.id)) proposed.walls.push({ ...wall, predecessorIds: [] })
  for (const room of model.rooms) if (moved.has(room.id)) proposed.rooms.push({ ...room, predecessorIds: [] })
  for (const item of model.placedItems) if (moved.has(item.id)) proposed.placedItems.push({ ...item, predecessorIds: [] })

  model.walls = model.walls.filter((entity) => !moved.has(entity.id))
  model.openings = model.openings.filter((entity) => !moved.has(entity.id))
  model.rooms = model.rooms.filter((entity) => !moved.has(entity.id))
  model.placedItems = model.placedItems.filter((entity) => !moved.has(entity.id))
  model.wallJunctions = model.wallJunctions.filter((junction) => !touchesMoved(junction, moved))
  return { moved: [...moved], perOption }
}

// --- The catalogue ------------------------------------------------------------

const first = (blocks: readonly Block[]): Block | undefined => blocks[0]

const correctExistingModel: Handler<'renovation.correctExistingModel'> = (ctx) => {
  const inner = ctx.intent.payload.inner
  const blocks: Block[] = []
  const report: Blocker = (block) => blocks.push(block)
  if (inner.type === 'renovation.moveToDesignOption') runMove(ctx.project, ctx.draft, inner.payload as MoveToDesignOption, report)
  else runCorrection(ctx.project, ctx.draft, inner, ctx.intent.ids, report)
  const block = first(blocks)
  if (block !== undefined) refuse(block.code, block.path, block.message)
}

/** How each Option would see this correction, in option order (#69 §12). */
function correctionReview(project: Project, inner: Intent, ids: string[]): CorrectionReview | null {
  const blocks: Block[] = []
  const seen: { subjects: Subject[]; produced: Project | null } = { subjects: [], produced: null }
  try {
    const [produced] = produceWithPatches(project, (draft) => {
      seen.subjects = runCorrection(project, draft as unknown as Project, inner, ids, (block) => blocks.push(block))
      return draft
    })
    seen.produced = produced
    // The same check the commit will run, so a preview never promises a correction the commit refuses.
    openingsStillFit(project, produced)
  } catch (error) {
    if (!(error instanceof IntentRejection)) throw error
    // The baseline edit is impossible on its own; `previewIntent` answers with that rejection, and
    // there is nothing per Option to list against a Project that would not change.
    return null
  }
  const subjects = seen.subjects
  if (subjects.length === 0) return null
  const options = designOptionsOf(project).map((option) => ({
    optionId: option.id,
    optionName: option.name,
    effect: strongest(subjects.map((entry) => effectOf(option, entry))),
    dependants: subjects.flatMap((entry) => dependantsOf(project, option, entry.id, entry.collection)),
    blockers: blocks.filter((block) => block.optionId === option.id).map((block) => block.message),
  }))
  // A move drags the Walls joined to it as well; the transaction is named for the thing the user
  // pointed at, which is the one the wrapped Intent carries in its payload.
  const entityId = namedSubject(inner, subjects)
  // A survey tool drawing something new has no label for it before the fact — the record does not
  // exist yet — so the name the dialog and the transaction carry is the one the finished Project
  // gives it: `W-7`, not the id the Intent invented (#70 §7e).
  const named = labelOf(project, entityId)
  const entityRef = named === entityId ? labelOf(seen.produced ?? project, entityId) : named
  return { kind: 'correct-existing-model', entityId, entityRef, options, message: correctionLabel(entityRef) }
}

/** The subject the wrapped Intent points at, or the first one it touched when it names none. */
function namedSubject(inner: Intent, subjects: Subject[]): EntityId {
  const named = Object.values(inner.payload as Record<string, unknown>).find(
    (value) => typeof value === 'string' && subjects.some((entry) => entry.id === value),
  )
  const found = subjects.find((entry) => entry.id === named)
  return (found ?? subjects[0])!.id
}

function effectOf(option: DesignOption, entry: Subject): CorrectionEffect {
  const successors = successorsOf(option, entry.id, entry.collection)
  if (successors.length === 0) return option.demolishedIds.includes(entry.id) ? 'demolishes' : 'retains'
  return successors.some((successor) => geometryKey(successor) === entry.geometry)
    ? 'demolishes; successor stays aligned'
    : 'demolishes; successor keeps its own geometry'
}

const PRECEDENCE: readonly CorrectionEffect[] = [
  'retains',
  'demolishes',
  'demolishes; successor keeps its own geometry',
  'demolishes; successor stays aligned',
]

/** One Option, one answer: the most consequential of its subjects' effects. */
const strongest = (effects: readonly CorrectionEffect[]): CorrectionEffect =>
  effects.reduce((best, effect) => (PRECEDENCE.indexOf(effect) > PRECEDENCE.indexOf(best) ? effect : best), 'retains')

function moveReview(project: Project, payload: MoveToDesignOption): MoveToOptionReview {
  const blocks: Block[] = []
  const holder: { plan: MovePlan | null } = { plan: null }
  try {
    produceWithPatches(project, (draft) => {
      holder.plan = runMove(project, draft as unknown as Project, payload, (block) => blocks.push(block))
    })
  } catch (error) {
    if (!(error instanceof IntentRejection)) throw error
    holder.plan = null
  }
  const target = designOptionsOf(project).find((option) => option.id === payload.targetOptionId)
  const plan = holder.plan
  const moved = plan?.moved ?? payload.entityIds
  return {
    kind: 'move-to-design-option',
    targetOptionId: payload.targetOptionId,
    targetOptionName: target?.name ?? payload.targetOptionId,
    moves: moved.map((id) => dependency(project, id)),
    options: designOptionsOf(project).map((option) => {
      const entry = plan?.perOption.find((each) => each.optionId === option.id)
      return {
        optionId: option.id,
        optionName: option.name,
        removesDemolitions: entry?.removesDemolitions ?? [],
        detaches: entry?.detaches ?? [],
        blockers: blocks.filter((block) => block.optionId === option.id).map((block) => block.message),
      }
    }),
    message: `Move ${moved.length} item${moved.length === 1 ? '' : 's'} to ${target?.name ?? 'a Design Option'}?`,
  }
}

/** Where an inner Intent's subject lives, so undo can navigate to the correction (#48). */
function locateOn(project: Project, floorId: EntityId | null, placedItemId?: EntityId): Locator {
  const placed = placedItemId === undefined ? undefined : project.existingModel.placedItems.find((entry) => entry.id === placedItemId)
  return {
    floorId,
    viewId: null,
    view: 'plan',
    itemDesignIds: placed === undefined ? [] : [placed.itemDesignId],
    placedItemIds: placed === undefined ? [] : [placed.id],
  }
}

/** The Floor one of these entities stands on, whichever collection holds it. */
function floorOf(project: Project, id: EntityId): EntityId | null {
  const model = project.existingModel
  return (
    model.walls.find((entry) => entry.id === id)?.floorId ??
    model.openings.find((entry) => entry.id === id)?.floorId ??
    model.rooms.find((entry) => entry.id === id)?.floorId ??
    model.placedItems.find((entry) => entry.id === id)?.floorId ??
    null
  )
}

export const CORRECTION_HANDLERS: { [T in CorrectionIntentType]: IntentHandler<T> } = {
  'renovation.correctExistingModel': {
    run: correctExistingModel,
    locate: (project, intent) => {
      const inner = intent.payload.inner
      const payload = inner.payload as { floorId?: EntityId; wallId?: EntityId; placedItemId?: EntityId; entityId?: EntityId }
      const subjectId = payload.wallId ?? payload.placedItemId ?? payload.entityId
      return locateOn(project, payload.floorId ?? (subjectId === undefined ? null : floorOf(project, subjectId)), payload.placedItemId)
    },
    review: (project, intent): DependencyReview | null => {
      const inner = intent.payload.inner
      if (inner.type === 'renovation.moveToDesignOption') return moveReview(project, inner.payload as MoveToDesignOption)
      return correctionReview(project, inner, intent.ids)
    },
    // The corrected Wall and every successor the replay moved: the Openings standing on them are
    // re-checked against the Project this Transaction finished with (#65 §7).
    after: openingsStillFit,
  },
  'renovation.moveToDesignOption': {
    // Only ever the inner Intent of a correction: on its own it would move baseline data with
    // neither the preview every Option is owed nor the atomicity that keeps them agreeing.
    run: () => refuse('unknown-target', 'payload', 'Moving work to a Design Option runs inside a correction.'),
    locate: (project, intent) => locateOn(project, floorOf(project, intent.payload.entityIds[0] ?? ''), intent.payload.entityIds.find((id) => project.existingModel.placedItems.some((item) => item.id === id))),
    review: (project, intent) => moveReview(project, intent.payload),
  },
}

export const CORRECTION_INTENT_ID_ORDER: { [T in CorrectionIntentType]: readonly string[] } = {
  // What the wrapped edit spends, and nothing more: a correction creates no records of its own, and
  // an aligned successor is written by replay, which spends nothing.
  'renovation.correctExistingModel': ['inner…'],
  'renovation.moveToDesignOption': [],
}

export const CORRECTION_INTENT_LABELS: { [T in CorrectionIntentType]: string } = {
  'renovation.correctExistingModel': 'Correct Existing Model',
  'renovation.moveToDesignOption': 'Move to a Design Option',
}
