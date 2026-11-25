/**
 * Floors and Plan Views (#56): the half of the catalogue that owns the Project's spatial
 * silos and the saved ways of looking at them.
 *
 * Three rules hold across every handler here, because #25 made them the contract rather
 * than the UI's habit:
 *
 * - **No cascade.** Deleting a Floor is refused while anything leans on it; the registry in
 *   `domain/floorDependencies` is what says so, and the only thing a delete takes with the
 *   Floor is its own default Plan View.
 * - **No shared coordinates.** A duplicate or a cross-Floor copy copies values, never
 *   references, and infers no alignment: what the preview dialog confirmed is what lands.
 * - **Reordering is not editing.** `floor.reorder` moves one array entry and touches no
 *   geometry, which is what criterion 2 measures byte for byte.
 */
import { defaultPlanView, defaultPlanViewRange, elevationViewsOf, floorHasDependencies, formatCommentReference, nextFloorName, viewDesignOptionId, viewRenovationDisplay } from '../../domain'
import type { CommentAnchor, EntityId, Floor, PlanView, Project } from '../../domain'
import type { FloorIntent, Locator, PlanIntent, TransferPlanObjectsToFloor, ViewIntent } from '../intents'
import type { Handler, IntentHandler } from './context'
import { elevationViewPath } from './elevationHandlers'
import { floorPath, guardViewAnnotations, refuse, requireFloor, requirePlacement, spendIds } from './support'

/** The path of one saved Plan View, in the validator's vocabulary. */
export const viewPath = (viewId: EntityId): string => `views[${viewId}]`

/** The Floor's default Plan View, which every valid Project has exactly one of. */
function defaultViewOf(project: Project, floorId: EntityId): PlanView | undefined {
  return project.views.find((view) => view.floorId === floorId && view.isDefault)
}

/**
 * A Plan View, or a rejection.
 *
 * The Plan Image and the Vertical Range are Plan View words (#75 criterion 11): an Elevation View has
 * neither, so it is refused by name rather than reported as an id nobody knows.
 */
function requireView(project: Project, viewId: EntityId): PlanView {
  const view = project.views.find((candidate) => candidate.id === viewId)
  if (view !== undefined) return view
  if (elevationViewsOf(project).some((candidate) => candidate.id === viewId)) {
    refuse(
      'unknown-target',
      elevationViewPath(viewId),
      'That is an Elevation View, which has no Plan Image and no Vertical Range to change.',
    )
  }
  refuse('unknown-target', viewPath(viewId), `No Plan View is called ${viewId}.`)
}

/** The IDs `floor.duplicate` spends, in `INTENT_ID_ORDER` order. */
function requireCopiedIds(
  ids: readonly string[],
  placedItemCount: number,
  commentCount: number,
  type: string,
): { floorId: string; viewId: string; placedItemIds: string[]; commentIds: string[] } {
  const [floorId, viewId] = spendIds(ids, 2, type)
  const placedItemIds = spendIds(ids.slice(2), placedItemCount, type)
  const commentIds = spendIds(ids.slice(2 + placedItemCount), commentCount, type)
  return { floorId, viewId, placedItemIds, commentIds }
}

// --- Floors -------------------------------------------------------------------

/**
 * A new Floor, and the one default Plan View that shows it — always both, in one
 * transaction, because a Floor nobody can look at is not a valid Project.
 *
 * The name is the caller's when it brought one; otherwise the lowest unused `Floor N`.
 * A name another Floor already has is left for the strict validator to refuse, which is
 * the same refusal the Library's rename box is checking against.
 */
const createFloor: Handler<'floor.create'> = (ctx) => {
  const [floorId, viewId] = spendIds(ctx.intent.ids, 2, ctx.intent.type)
  const name = ctx.intent.payload.name?.trim() ?? ''
  const finalName = name === '' ? nextFloorName(ctx.project) : name
  ctx.draft.floors.push({ id: floorId, name: finalName, planImage: null })
  // The Floor and the view that shows it are one transaction, and the view is the one
  // `defaultPlanView` describes: the Existing Model, through no Design Option, on the Existing
  // Display (#70 §1) — a Floor that has just arrived has nothing else to look through.
  ctx.draft.views.push(defaultPlanView(viewId, { id: floorId, name: finalName, planImage: null }))
}

/** Renaming a Floor never renames its default Plan View: the two are separate names. */
const renameFloor: Handler<'floor.rename'> = (ctx) => {
  const { floorId, name } = ctx.intent.payload
  requireFloor(ctx.project, floorId)
  const draftFloor = requireFloor(ctx.draft, floorId)
  const trimmed = name.trim()
  if (draftFloor.name !== trimmed) draftFloor.name = trimmed
}

/**
 * Move one Floor to another index. Everything else about the Project is untouched — no
 * Placed Item, no reference, no Plan Image is read, let alone rewritten (#25: reordering
 * changes no geometry).
 */
const reorderFloor: Handler<'floor.reorder'> = (ctx) => {
  const { floorId, toIndex } = ctx.intent.payload
  requireFloor(ctx.project, floorId)
  const floors = ctx.draft.floors
  const from = floors.findIndex((floor) => floor.id === floorId)
  if (from < 0) refuse('unknown-target', floorPath(floorId), `No Floor is called ${floorId}.`)
  const to = Math.max(0, Math.min(floors.length - 1, toIndex))
  if (from === to) return
  const [moved] = floors.splice(from, 1)
  floors.splice(to, 0, moved as Floor)
}

/**
 * The Floor's own coordination limits. Clearing both removes the `limits` key entirely
 * rather than leaving an empty object behind, so a Floor that never had limits keeps the
 * exact bytes it had before.
 */
const setFloorLimits: Handler<'floor.setLimits'> = (ctx) => {
  const { floorId, lowerMm, upperMm } = ctx.intent.payload
  requireFloor(ctx.project, floorId)
  const draftFloor = requireFloor(ctx.draft, floorId)
  if (lowerMm === null && upperMm === null) {
    delete draftFloor.limits
    return
  }
  const next = { ...(lowerMm === null ? {} : { lowerMm }), ...(upperMm === null ? {} : { upperMm }) }
  draftFloor.limits = next
}

/**
 * `Default wall height` for one Floor (#64 §16). `null` removes the override, which hands the
 * decision back to the Project — the Floor never restates the Project's number as its own.
 */
const setFloorDefaultWallHeight: Handler<'floor.setDefaultWallHeight'> = (ctx) => {
  const { floorId, defaultWallHeight } = ctx.intent.payload
  requireFloor(ctx.project, floorId)
  const draftFloor = requireFloor(ctx.draft, floorId)
  if (defaultWallHeight === null) delete draftFloor.defaultWallHeight
  else draftFloor.defaultWallHeight = defaultWallHeight
}

/**
 * Delete a Floor, and with it only the default Plan View that is part of it.
 *
 * Anything else still on the Floor — Placed Items, a Plan Image, a named Plan View — is a
 * refusal, not a cascade (#25, #13). The counts the dialog showed and this check read the
 * same registry, so the button and the handler cannot disagree.
 */
const deleteFloor: Handler<'floor.delete'> = (ctx) => {
  const { floorId } = ctx.intent.payload
  requireFloor(ctx.project, floorId)
  if (floorHasDependencies(ctx.project, floorId)) {
    refuse(
      'has-dependants',
      floorPath(floorId),
      'This Floor still has things on it. Delete them first — nothing here deletes them for you.',
    )
  }
  ctx.draft.floors = ctx.draft.floors.filter((floor) => floor.id !== floorId)
  ctx.draft.views = ctx.draft.views.filter((view) => view.floorId !== floorId)
}

/**
 * Duplicate a Floor: new IDs for the Floor, its default Plan View and every copied Placed
 * Item, and the same `itemDesignId` references the source used — reuse by reference, which
 * is why editing the shared Item Design afterwards moves both.
 *
 * The copies keep the source's local coordinates exactly. Floors share no coordinates, so
 * there is nothing to translate them into, and the preview showed them where they are.
 */
const duplicateFloor: Handler<'floor.duplicate'> = (ctx) => {
  const { floorId, name, toIndex, placedItemIds, includePlanImage, commentIds } = ctx.intent.payload
  const source = requireFloor(ctx.project, floorId)
  const selected = new Set(placedItemIds)
  const copied = ctx.project.existingModel.placedItems.filter((item) => item.floorId === floorId && selected.has(item.id))
  // The Comments the caller asked to bring across, read out of the Project. An ID that names no Comment
  // is a caller that has been overtaken by an undo, and is refused rather than quietly skipped.
  const carried = commentIds.map((id) => {
    const comment = ctx.project.comments.find((candidate) => candidate.id === id)
    if (comment === undefined) refuse('unknown-target', `comments[${id}]`, `There is no Comment ${id} to duplicate.`)
    return comment
  })
  const { floorId: newFloorId, viewId: newViewId, placedItemIds: newPlacedIds, commentIds: freshCommentIds } = requireCopiedIds(
    ctx.intent.ids,
    copied.length,
    carried.length,
    ctx.intent.type,
  )
  if (copied.length !== placedItemIds.length) {
    refuse(
      'unknown-target',
      floorPath(floorId),
      'Some of the Placed Items this duplicate asked for are not on that Floor.',
    )
  }

  const trimmed = name.trim()
  const copy: Floor = {
    id: newFloorId,
    name: trimmed,
    planImage: includePlanImage && source.planImage !== null ? { ...source.planImage } : null,
    ...(source.limits === undefined ? {} : { limits: { ...source.limits } }),
  }
  const at = Math.max(0, Math.min(ctx.draft.floors.length, toIndex))
  ctx.draft.floors.splice(at, 0, copy)
  // The duplicate is looked at the same way as the original (#70 §1): the Design Option and the
  // Renovation Display travel with it, because duplicating the Kitchen level while looking at
  // `Option A · Open kitchen` in Combined is a request for the same view of a copy, not for a
  // second Floor that has to be re-aimed by hand before it shows anything.
  const sourceView = defaultViewOf(ctx.project, floorId)
  ctx.draft.views.push(
    defaultPlanView(newViewId, copy, {
      designOptionId: sourceView === undefined ? null : viewDesignOptionId(sourceView),
      renovationDisplay: sourceView === undefined ? 'existing' : viewRenovationDisplay(sourceView),
    }),
  )
  copied.forEach((item, index) => {
    ctx.draft.existingModel.placedItems.push({ ...item, id: newPlacedIds[index] as string, floorId: newFloorId })
  })
  // `Include Comments` (#80 §13). What travels is what the duplicate is a copy *of*: a note about the
  // Floor itself, about a point on it, or about one of the Placed Items coming across. A note about the
  // Item Design does not — the duplicate shares that design, and a second copy of the same note about
  // the same shared thing would be a second answer to the same question. Each one arrives under a new
  // `C-` number, because within one Project a reference names one Comment and only one.
  const copiedItemIds = new Map<EntityId, EntityId>(
    copied.map((item, index) => [item.id, newPlacedIds[index] as EntityId]),
  )
  carried.forEach((comment, index) => {
    const id = freshCommentIds[index]
    if (id === undefined) {
      refuse('unknown-target', floorPath(floorId), 'This duplicate needs one fresh ID per Comment it brings across.')
    }
    ctx.draft.commentReferenceCounter += 1
    ctx.draft.comments.push({
      ...comment,
      id,
      reference: formatCommentReference(ctx.draft.commentReferenceCounter),
      anchor: remapCommentOntoFloor(comment.anchor, newFloorId, copiedItemIds),
    })
  })
}

/**
 * The Anchor of a duplicated Comment, aimed at the duplicate rather than the original (#80 §13). A
 * Floor anchor follows the new Floor; an entity anchor follows the copy of the thing it named, and an
 * Anchor whose subject was not part of the copy is left pointing at the original, which is the truth.
 */
function remapCommentOntoFloor(
  anchor: CommentAnchor,
  newFloorId: EntityId,
  copiedItemIds: ReadonlyMap<EntityId, EntityId>,
): CommentAnchor {
  if (anchor.kind === 'floor' || anchor.kind === 'floor_point') return { ...anchor, floorId: newFloorId }
  if (anchor.kind !== 'entity') return anchor
  const copy = copiedItemIds.get(anchor.entityId)
  return copy === undefined ? anchor : { ...anchor, entityId: copy }
}

// --- Plan Images on another Floor ---------------------------------------------

/** Removing the Plan Image leaves every Placed Item exactly where it was (#56). */
const removePlanImage: Handler<'plan.removeImage'> = (ctx) => {
  const { floorId } = ctx.intent.payload
  requireFloor(ctx.project, floorId)
  const draftFloor = requireFloor(ctx.draft, floorId)
  if (draftFloor.planImage !== null) draftFloor.planImage = null
}

/**
 * Copy or Move a selection to another Floor.
 *
 * The dialog confirmed one destination point and one elevation, for the first item of the
 * selection; the rest travel by the same delta, so confirming without edits moves nothing.
 * Copy spends a new ID per item and keeps the source; Move keeps every ID and rewrites only
 * the `floorId` — one entity, one transaction, undoable as the gesture it was.
 */
function transferToFloor(
  project: Project,
  draft: Project,
  payload: TransferPlanObjectsToFloor,
  freshIds: readonly string[],
  copy: boolean,
): void {
  requireFloor(project, payload.toFloorId)
  const sources = payload.placedItemIds.map((id) => requirePlacement(project, id))
  if (sources.length === 0) {
    refuse('unknown-target', 'existingModel.placedItems', 'Nothing was selected to move to another Floor.')
  }
  const first = sources[0] as (typeof sources)[number]
  const deltaX = payload.translation.x - first.translation.x
  const deltaY = payload.translation.y - first.translation.y
  const deltaBase = payload.baseElevation - first.baseElevation

  sources.forEach((item, index) => {
    if (copy) {
      draft.existingModel.placedItems.push({
        ...item,
        id: freshIds[index] as string,
        floorId: payload.toFloorId,
        translation: { x: item.translation.x + deltaX, y: item.translation.y + deltaY },
        baseElevation: item.baseElevation + deltaBase,
      })
      return
    }
    const draftItem = requirePlacement(draft, item.id)
    draftItem.floorId = payload.toFloorId
    draftItem.translation = { x: item.translation.x + deltaX, y: item.translation.y + deltaY }
    draftItem.baseElevation = item.baseElevation + deltaBase
  })
}

const copyToFloor: Handler<'plan.copyToFloor'> = (ctx) => {
  const { placedItemIds } = ctx.intent.payload
  const freshIds = spendIds(ctx.intent.ids, placedItemIds.length, ctx.intent.type)
  transferToFloor(ctx.project, ctx.draft, ctx.intent.payload, freshIds, true)
}

const moveToFloor: Handler<'plan.moveToFloor'> = (ctx) => {
  transferToFloor(ctx.project, ctx.draft, ctx.intent.payload, [], false)
}

// --- Plan Views ---------------------------------------------------------------

/**
 * A named Plan View on a Floor, showing the same thing the view it was made from shows (#70 §1).
 *
 * "New view" means "this, differently", so the Design Option and the Renovation Display are copied
 * from `fromViewId` — the view the user was looking at when they pressed New view — and not reset
 * to the Existing Model. A view that arrives back at the Existing Display makes them re-aim the
 * card before they can see what they duplicated, which is the opposite of why they asked. With no
 * `fromViewId`, or one that no longer names a view, the Floor's own default view is the source; a
 * Floor with no default view at all is not a valid Project, so the fallback is the Existing Model.
 */
const createPlanView: Handler<'view.create'> = (ctx) => {
  const { floorId, name, fromViewId } = ctx.intent.payload
  const floor = requireFloor(ctx.project, floorId)
  const [viewId] = spendIds(ctx.intent.ids, 1, ctx.intent.type)
  const source =
    ctx.project.views.find((candidate) => candidate.id === fromViewId) ?? defaultViewOf(ctx.project, floorId)
  ctx.draft.views.push({
    id: viewId,
    kind: 'plan',
    floorId,
    name: name.trim(),
    isDefault: false,
    showPlanImage: true,
    // A new view starts at the whole storey (#74 behaviour 4), not at the range of the view it was
    // made from: the range is the one setting that says where you are looking *up* from, and a new
    // view has not been aimed anywhere yet.
    planViewRange: defaultPlanViewRange(floor.limits),
    designOptionId: source === undefined ? null : viewDesignOptionId(source),
    renovationDisplay: source === undefined ? 'existing' : viewRenovationDisplay(source),
  })
}

const renamePlanView: Handler<'view.rename'> = (ctx) => {
  const { viewId, name } = ctx.intent.payload
  requireView(ctx.project, viewId)
  const draftView = requireView(ctx.draft, viewId)
  const trimmed = name.trim()
  if (draftView.name !== trimmed) draftView.name = trimmed
}

/**
 * The Plan View Range (#74 §4): two elevations on one saved view, and nothing else.
 *
 * This writes one field of one record in `views`. No entity moves, which is what lets an undo put the
 * old range back and leave the model byte-identical (criterion 3), and what makes a range change
 * unable to reopen a warning: warnings are derived from entities, and an entity that has not moved
 * derives exactly the warning it derived before, acknowledged or not (#66).
 *
 * The two numbers are this view's own. Another Plan View of the same Floor keeps the range it was aimed
 * with, because the range says where this view is looking up from and no other view is.
 */
const setPlanViewRange: Handler<'view.setPlanViewRange'> = (ctx) => {
  const { viewId, lowerMm, upperMm } = ctx.intent.payload
  requireView(ctx.project, viewId)
  const draftView = requireView(ctx.draft, viewId)
  const path = `${viewPath(viewId)}.planViewRange`
  if (!Number.isFinite(lowerMm) || !Number.isFinite(upperMm)) refuse('invalid-extent', path, 'Enter a number.')
  if (!(lowerMm < upperMm)) refuse('invalid-extent', path, 'Lower needs to be below Upper.')
  draftView.planViewRange = { lowerMm, upperMm }
}

/**
 * The default Plan View is part of its Floor and goes only with it (#56). Deleting the
 * last named view of a Floor is fine; deleting the one that came with the Floor is not.
 */
const deletePlanView: Handler<'view.delete'> = (ctx) => {
  const { viewId } = ctx.intent.payload
  const view = requireView(ctx.project, viewId)
  if (view.isDefault) {
    refuse(
      'default-view',
      viewPath(viewId),
      'This is the Floor’s own Plan View. It goes when the Floor does, and not before.',
    )
  }
  // #81 §8.1: Annotations draw in this view and Reference Markers navigate into it; nothing here
  // retargets or deletes them for the user.
  guardViewAnnotations(ctx.project, viewId, view.name, viewPath(viewId))
  ctx.draft.views = ctx.draft.views.filter((candidate) => candidate.id !== viewId)
}

/** Whether this saved view draws the Plan Image (#19 §4) — per view, canonical, undoable. */
const setPlanViewShowsPlanImage: Handler<'view.setShowPlanImage'> = (ctx) => {
  const { viewId, showPlanImage } = ctx.intent.payload
  requireView(ctx.project, viewId)
  const draftView = requireView(ctx.draft, viewId)
  if (draftView.showPlanImage !== showPlanImage) draftView.showPlanImage = showPlanImage
}

// --- Where these edits land ---------------------------------------------------

/** The Floor's default view, so a Floor-level edit navigates to a view that exists. */
function floorLocator(project: Project, floorId: EntityId, placedItemIds: EntityId[] = []): Locator {
  return {
    floorId,
    viewId: defaultViewOf(project, floorId)?.id ?? null,
    view: 'plan',
    itemDesignIds: [],
    placedItemIds,
  }
}

function viewLocator(project: Project, viewId: EntityId): Locator {
  const view = project.views.find((candidate) => candidate.id === viewId)
  return {
    floorId: view?.floorId ?? null,
    viewId,
    view: 'plan',
    itemDesignIds: [],
    placedItemIds: [],
  }
}

const transferLocator = (project: Project, intent: PlanIntent & { type: 'plan.copyToFloor' | 'plan.moveToFloor' }): Locator => {
  const { placedItemIds, toFloorId } = intent.payload
  return {
    floorId: toFloorId,
    viewId: defaultViewOf(project, toFloorId)?.id ?? null,
    view: 'plan',
    itemDesignIds: project.existingModel.placedItems
      .filter((item) => placedItemIds.includes(item.id))
      .map((item) => item.itemDesignId),
    placedItemIds: [...placedItemIds],
  }
}

export const FLOOR_HANDLERS: { [T in FloorIntent['type']]: IntentHandler<T> } = {
  'floor.create': {
    run: createFloor,
    locate: (_project, intent) => ({
      floorId: intent.ids[0] ?? null,
      viewId: intent.ids[1] ?? null,
      view: 'plan',
      itemDesignIds: [],
      placedItemIds: [],
    }),
  },
  'floor.rename': { run: renameFloor, locate: (_project, intent) => floorLocator(_project, intent.payload.floorId) },
  'floor.reorder': { run: reorderFloor, locate: (project, intent) => floorLocator(project, intent.payload.floorId) },
  'floor.setLimits': { run: setFloorLimits, locate: (project, intent) => floorLocator(project, intent.payload.floorId) },
  'floor.setDefaultWallHeight': {
    run: setFloorDefaultWallHeight,
    locate: (project, intent) => floorLocator(project, intent.payload.floorId),
  },
  'floor.delete': { run: deleteFloor, locate: (project, intent) => floorLocator(project, intent.payload.floorId) },
  'floor.duplicate': {
    run: duplicateFloor,
    locate: (project, intent) => {
      const { placedItemIds } = intent.payload
      return {
        floorId: intent.ids[0] ?? null,
        viewId: intent.ids[1] ?? null,
        view: 'plan',
        itemDesignIds: [],
        placedItemIds: project.existingModel.placedItems
          .filter((item) => placedItemIds.includes(item.id))
          .map((item) => item.id),
      }
    },
  },
}

export const VIEW_HANDLERS: { [T in ViewIntent['type']]: IntentHandler<T> } = {
  'view.create': {
    run: createPlanView,
    locate: (_project, intent) => ({
      floorId: intent.payload.floorId,
      viewId: intent.ids[0] ?? null,
      view: 'plan',
      itemDesignIds: [],
      placedItemIds: [],
    }),
  },
  'view.rename': { run: renamePlanView, locate: (project, intent) => viewLocator(project, intent.payload.viewId) },
  'view.delete': { run: deletePlanView, locate: (project, intent) => viewLocator(project, intent.payload.viewId) },
  'view.setShowPlanImage': {
    run: setPlanViewShowsPlanImage,
    locate: (project, intent) => viewLocator(project, intent.payload.viewId),
  },
  'view.setPlanViewRange': {
    run: setPlanViewRange,
    locate: (project, intent) => viewLocator(project, intent.payload.viewId),
  },
}

export const PLAN_FLOOR_HANDLERS: { [T in 'plan.removeImage' | 'plan.copyToFloor' | 'plan.moveToFloor']: IntentHandler<T> } = {
  'plan.removeImage': {
    run: removePlanImage,
    locate: (project, intent) => floorLocator(project, intent.payload.floorId),
  },
  'plan.copyToFloor': { run: copyToFloor, locate: (project, intent) => transferLocator(project, intent) },
  'plan.moveToFloor': { run: moveToFloor, locate: (project, intent) => transferLocator(project, intent) },
}
