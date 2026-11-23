/**
 * The shared machinery every handler stands on (#47).
 *
 * Two rules shape it. A handler either finishes its work on the draft or throws an
 * {@link IntentRejection}, which `applyIntent` turns into a `Rejection` — so no handler
 * needs a result type of its own. And a handler reads the Project it was given and writes
 * only the draft: it never generates an ID and never reads the clock (#42 §3).
 */
import { findNode } from '../../cabinet'
import { effectiveModel } from '../../derive'
import { designOptionsOf } from '../../domain'
import type { CabinetItemDesign, CabinetNode, EntityId, Floor, GenericItemDesign, ItemDesign, PlacedItem, ProposedModel, Project } from '../../domain'
import { problem } from '../../lib'
import type { ValidationProblem } from '../../lib'
import type { RejectionCode } from '../intents'
import type { IntentType } from '../intents'
import type { IntentHandler } from './context'

/**
 * Thrown by a handler to refuse an Intent. It never escapes `applyIntent`, which catches
 * it and answers with a `Rejection` carrying no patches.
 */
export class IntentRejection extends Error {
  readonly code: RejectionCode
  readonly problems: ValidationProblem[]

  constructor(code: RejectionCode, path: string, message: string) {
    super(message)
    this.name = 'IntentRejection'
    this.code = code
    this.problems = [problem(path, code, message)]
  }
}

/** Refuse the whole Intent; `path` locates the entity that made it impossible. */
export function refuse(code: RejectionCode, path: string, message: string): never {
  throw new IntentRejection(code, path, message)
}

/**
 * The catalogue, for the one handler that has to run another Intent whole: a correction replays the
 * edit it wraps, in the baseline and again inside an Option (#69 §12). `registry` installs it as it
 * is built, which keeps the dependency one-way — a handler reaching for the registry itself would
 * close a cycle through `intents`.
 */
let catalogue: Partial<Record<IntentType, IntentHandler<IntentType>>> | null = null

export function installCatalogue(handlers: Partial<Record<IntentType, IntentHandler<IntentType>>>): void {
  catalogue = handlers
}

/** The handler behind one Intent type, or the rejection an unknown type always gets. */
export function requireHandler(type: IntentType): IntentHandler<IntentType> {
  const handler = catalogue?.[type]
  if (handler === undefined) refuse('unknown-target', 'type', `No Intent type ${type} is in the catalogue.`)
  return handler
}

/**
 * The first `count` IDs the caller allocated, in the order `INTENT_ID_ORDER` states. Too
 * few is a rejection, never a fallback to `nanoid` (#42 §3).
 */
export function spendIds(ids: readonly string[], count: number, type: string): string[] {
  if (ids.length < count) {
    refuse(
      'missing-ids',
      'ids',
      `${type} spends ${count} pre-allocated ID${count === 1 ? '' : 's'}; this Intent carried ${ids.length}.`,
    )
  }
  return ids.slice(0, count)
}

/** The path of one entity, in the validator's vocabulary: `itemDesigns[cabinet-7]`. */
export const designPath = (itemDesignId: EntityId): string => `itemDesigns[${itemDesignId}]`
export const placedPath = (placedItemId: EntityId): string => `existingModel.placedItems[${placedItemId}]`
export const floorPath = (floorId: EntityId): string => `floors[${floorId}]`

// --- Reading the Project ------------------------------------------------------

export function findFloor(project: Project, floorId: EntityId): Floor | undefined {
  return project.floors.find((floor) => floor.id === floorId)
}

/** The Floor every cabinet stands on: the first one, the way #43 converted a Design. */
export function firstFloor(project: Project): Floor | undefined {
  return project.floors[0]
}

export function findDesign(project: Project, itemDesignId: EntityId): ItemDesign | undefined {
  return project.itemDesigns.find((design) => design.id === itemDesignId)
}

/** A cabinet Item Design, or a rejection: every `cabinet.*` Intent starts here. */
export function requireCabinetDesign(project: Project, itemDesignId: EntityId): CabinetItemDesign {
  const design = findDesign(project, itemDesignId)
  if (design === undefined) refuse('unknown-target', designPath(itemDesignId), `No Item Design ${itemDesignId} is in this Project.`)
  if (design.kind !== 'cabinet') refuse('unknown-target', designPath(itemDesignId), `Item Design ${itemDesignId} is not a cabinet.`)
  return design
}

export function requireFloor(project: Project, floorId: EntityId): Floor {
  const floor = findFloor(project, floorId)
  if (floor === undefined) refuse('unknown-target', floorPath(floorId), `No Floor ${floorId} is in this Project.`)
  return floor
}

export function requirePlacement(project: Project, placedItemId: EntityId): PlacedItem {
  const placed = project.existingModel.placedItems.find((item) => item.id === placedItemId)
  if (placed === undefined) refuse('unknown-target', placedPath(placedItemId), `No Placed Item ${placedItemId} is in this Project.`)
  return placed
}

/**
 * A generic Item Design, or a rejection: the Intents about a design that owns its own
 * footprint, origin and colour — which a cabinet does not, because those three are derived
 * from its construction (#42 §2).
 */
export function requireGenericDesign(project: Project, itemDesignId: EntityId): GenericItemDesign {
  const design = findDesign(project, itemDesignId)
  if (design === undefined) refuse('unknown-target', designPath(itemDesignId), `No Item Design ${itemDesignId} is in this Project.`)
  if (design.kind !== 'generic') refuse('unknown-target', designPath(itemDesignId), `Item Design ${itemDesignId} is not a floor-plan object.`)
  return design
}

/** Every placement of one Item Design, in placement order. */
export function placementsOf(project: Project, itemDesignId: EntityId): PlacedItem[] {
  return project.existingModel.placedItems.filter((item) => item.itemDesignId === itemDesignId)
}

/** The cabinet placements on one Floor — the units the legacy store kept in `Design.units`. */
export function cabinetPlacementsOn(project: Project, floorId: EntityId): PlacedItem[] {
  return project.existingModel.placedItems.filter(
    (item) => item.floorId === floorId && findDesign(project, item.itemDesignId)?.kind === 'cabinet',
  )
}

/** The generic placements on one Floor: the legacy `floorPlan.objects`. */
export function genericPlacementsOn(project: Project, floorId: EntityId): PlacedItem[] {
  return project.existingModel.placedItems.filter(
    (item) => item.floorId === floorId && findDesign(project, item.itemDesignId)?.kind === 'generic',
  )
}

/**
 * Drop an Item Design and the placements that were its only use. Writes the draft.
 *
 * A plan object's design is 1:1, so removing the object removes the design; a design
 * something else still places — a template, or a second placement — stays (#20 §3).
 */
export function removePlacementAndDesign(draft: Project, placedItemId: EntityId): void {
  const placement = requirePlacement(draft, placedItemId)
  const remaining = placementsOf(draft, placement.itemDesignId).filter((item) => item.id !== placedItemId)
  draft.existingModel.placedItems = draft.existingModel.placedItems.filter((item) => item.id !== placedItemId)
  if (remaining.length === 0) {
    draft.itemDesigns = draft.itemDesigns.filter((design) => design.id !== placement.itemDesignId)
  }
}

// --- Cabinet trees ------------------------------------------------------------

/**
 * Run one of `cabinet`'s pure tree operations. It still throws where the old store let the
 * error bubble up — splitting an already split space, a drawer in a void, a tree deeper
 * than `MAX_TREE_DEPTH` — so a thrown Intent stays a Rejection instead of a crash.
 */
export function runCabinet<T>(operation: () => T, itemDesignId: EntityId): T {
  try {
    return operation()
  } catch (error) {
    refuse(
      'invalid-tree',
      `${designPath(itemDesignId)}.construction.root`,
      error instanceof Error ? error.message : 'cabinet refused this tree operation.',
    )
  }
}

/** A space the Intent names, or a rejection. */
export function requireNode(design: CabinetItemDesign, nodeId: string, itemDesignId: EntityId): CabinetNode {
  const node = findNode(design.construction.root, nodeId)
  if (node === null) {
    refuse('unknown-target', `${designPath(itemDesignId)}.construction.root`, `No space ${nodeId} is in this cabinet.`)
  }
  return node
}

/** Every space ID in depth-first order. */
export function nodeIds(node: CabinetNode, into: string[] = []): string[] {
  into.push(node.id)
  if (node.children !== undefined) {
    nodeIds(node.children[0], into)
    nodeIds(node.children[1], into)
  }
  return into
}

/** The IDs `next` introduced over `before`, in depth-first order. */
export function newNodeIds(next: CabinetNode, before: ReadonlySet<string>): string[] {
  const found: string[] = []
  const walk = (node: CabinetNode): void => {
    if (!before.has(node.id)) found.push(node.id)
    if (node.children !== undefined) {
      walk(node.children[0])
      walk(node.children[1])
    }
  }
  walk(next)
  return found
}

/**
 * Rename exactly the spaces `mutate` introduced to the caller's IDs, in depth-first order
 * (#47: `cabinet` keeps its `nanoid` and stays untouched; the handler renames after it).
 *
 * Only the new spaces and the path to them are copied — a space the caller already knows
 * keeps its identity, and nothing is mutated in place.
 */
export function renameNewNodeIds(
  next: CabinetNode,
  before: ReadonlySet<string>,
  ids: readonly string[],
): CabinetNode {
  let taken = 0
  const walk = (node: CabinetNode): CabinetNode => {
    if (before.has(node.id)) {
      if (node.children === undefined) return node
      const left = walk(node.children[0])
      const right = walk(node.children[1])
      return left === node.children[0] && right === node.children[1]
        ? node
        : { ...node, children: [left, right] }
    }
    return { ...node, id: ids[taken++] as string }
  }
  return walk(next)
}

/**
 * Structural equality with JSON semantics: a key holding `undefined` is the same as no key
 * at all, which is how `cabinet`'s mutations write an absent `fixedSize`.
 *
 * `applyIntent` needs it for one thing: `cabinet`'s `mapNode` always returns a fresh tree,
 * so a no-op edit has to be recognised before it is written back, or history would record
 * a step that changed nothing.
 */
export function sameJsonValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, index) => sameJsonValue(item, b[index]))
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const leftKeys = Object.keys(left).filter((key) => left[key] !== undefined)
  const rightKeys = Object.keys(right).filter((key) => right[key] !== undefined)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every((key) => sameJsonValue(left[key], right[key]))
}

/** One JSON object's fields, as the walk below meets them. */
type Fields = Record<string, unknown>

/**
 * Copy a freshly computed value into an immer draft field by field, touching only what
 * actually differs.
 *
 * `cabinet`'s operations return a new tree object even when they changed one number, and
 * assigning that whole object into the draft makes immer diff — and therefore patch — the
 * entire subtree: on the depth-8 reference tree that is thousands of patch operations and
 * 17 ms for a one-field edit (#47 criterion 6). Walking the two values instead means the
 * draft is told only about the fields that changed, and the patches stay as small as the
 * edit. Immer still produces them; nothing here reads or writes a patch.
 *
 * Arrays are assigned whole: immer compares them element by element against the current
 * value, and an untouched child is the same object, so it costs nothing.
 */
export function assignChanged(draftValue: object, nextValue: object): void {
  const draftFields = draftValue as Fields
  const nextFields = nextValue as Fields
  for (const [key, next] of Object.entries(nextFields)) {
    const current = draftFields[key]
    if (current === next) continue
    if (next === undefined && !(key in draftFields)) continue
    const nested =
      typeof current === 'object' && current !== null && !Array.isArray(current) &&
      typeof next === 'object' && next !== null && !Array.isArray(next)
    if (nested) {
      assignChanged(current as object, next as object)
      continue
    }
    draftFields[key] = next
  }
  for (const key of Object.keys(draftFields)) {
    if (!(key in nextFields)) delete draftFields[key]
  }
}

// --- Which container an edit writes into -------------------------------------

/**
 * The container an edit writes into: the Existing Model, or one Design Option's proposed model
 * when the Intent carries a `target` (#69 §7). This is the whole of what a renovation edit adds to
 * an S7 Intent — the checks, the messages and the writes are the same code, and no handler is
 * forked into an “existing” and a “proposed” copy.
 *
 * With the flag off the guard folds to the Existing Model alone, so the Option half is dead code
 * in a released bundle.
 */
export function containerOf(draft: Project, designOptionId: EntityId | null | undefined): ProposedModel {
  if (designOptionId === null || designOptionId === undefined) return draft.existingModel
  const option = designOptionsOf(draft).find((entry) => entry.id === designOptionId)
  if (option === undefined)
    refuse('unknown-target', 'designOptions', `There is no Design Option ${designOptionId} to hold this edit.`)
  return option.proposed
}

/**
 * The Project as one Design Option sees it: that Option's effective collections standing in for
 * the Existing Model's, so an existing check — a usable interval, a join, the next free reference
 * — reads what the user is looking at rather than the survey. With no target, or with the flag
 * off, this is the Project itself.
 */
export function effectiveView(project: Project, floorId: EntityId | null, designOptionId: EntityId | null | undefined): Project {
  if (designOptionId === null || designOptionId === undefined) return project
  const model = effectiveModel(project, floorId, designOptionId)
  return {
    ...project,
    existingModel: {
      ...project.existingModel,
      walls: [...model.standingWalls],
      wallJunctions: [...model.standingWallJunctions],
      openings: [...model.standingOpenings],
      rooms: [...model.standingRooms],
      placedItems: [...model.standingPlacedItems],
    },
  }
}

/** Whether a container is a Design Option's rather than the Existing Model's. */
export const isInOption = (container: ProposedModel, draft: Project): boolean => container !== draft.existingModel

/**
 * The provenance a record written into a Design Option carries: work invented from nothing has an
 * empty list, which is not the same as the field being absent — that stands for Existing work
 * (#69 §3).
 */
export const proposedProvenance = (inOption: boolean): { predecessorIds?: EntityId[] } =>
  inOption ? { predecessorIds: [] } : {}

/**
 * The next free `W-n`. The Project keeps no counter of its own, so this is one past the highest
 * number in use among the Walls that exist; a deleted Wall's number is spent only until the
 * Walls above it are deleted too (#64 §1).
 */
export const nextWallRef = (project: Project): string => {
  let highest = 0
  for (const wall of project.existingModel.walls) {
    const digits = /\d+/.exec(wall.ref)
    if (digits !== null) highest = Math.max(highest, Number(digits[0]))
  }
  return `W-${highest + 1}`
}
