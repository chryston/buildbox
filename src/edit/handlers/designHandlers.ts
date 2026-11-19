/**
 * The Item Design half of the catalogue (#57 §2, §5).
 *
 * An Item Design is a Project-owned definition, so an edit here is an edit everywhere:
 * every Placed Item that references it moves with it, which is why the view previews the
 * change and says how many placements it affects before it commits. Three Intent types
 * cover the whole surface — restate the design's own properties, move its Item Origin, or
 * fork one placement onto a copy of its own (#13: different construction needs a new
 * identity, and D11 makes `Fork design…` the only per-placement route to one).
 *
 * The D3 rewrite lives here rather than in the view because it is one Edit Transaction:
 * moving the Origin and rewriting every placement's translation must land in the same
 * patch set, so that one undo restores both. The arithmetic itself is `derive`'s, so the
 * preview on screen and the committed result cannot drift apart.
 */
import { designFootprintSize, designOrigin } from '../../domain'
import type { EntityId, ItemDesign, Project } from '../../domain'
import { localPointValid, originMoveTranslations } from '../../derive'
import { TOLERANCE_MM } from '../../geometry'
import type { Handler, IntentHandler } from './context'
import type { IntentType, Locator } from '../intents'
import { MIN_PLAN_SIZE_MM } from './planHandlers'
import { designPath, findDesign, placementsOf, refuse, requireGenericDesign, requirePlacement, spendIds } from './support'

/** The `design.*` handlers; `INTENT_HANDLERS` is the completeness check over them. */
type DesignHandlers = { [T in Extract<IntentType, `design.${string}`>]: IntentHandler<T> }

/** An Item Design of either kind, or a rejection. */
function requireDesign(project: Project, itemDesignId: EntityId): ItemDesign {
  const design = findDesign(project, itemDesignId)
  if (design === undefined) refuse('unknown-target', designPath(itemDesignId), `No Item Design ${itemDesignId} is in this Project.`)
  return design
}

/** Whether the Item Origin sits at the centre of a `width × depth` footprint. */
function isCentred(origin: { x: number; y: number }, width: number, depth: number): boolean {
  return Math.abs(origin.x - width / 2) <= TOLERANCE_MM && Math.abs(origin.y - depth / 2) <= TOLERANCE_MM
}

/**
 * The design-level fields: name, colour and, for a rectangle footprint, size.
 *
 * A cabinet's size is its `construction.settings` and belongs to `cabinet.updateSettings`,
 * which owns the tree consequences of a new width; asking this Intent to change one is a
 * view that has lost track of which section it is in, so it is refused rather than
 * silently forwarded.
 *
 * A resize keeps the Item Origin where it is — the footprint grows about the point every
 * placement is pinned to, so nothing on any Floor jumps — unless the Origin was the old
 * centre, in which case it follows the new one so `Centre` keeps meaning centre.
 */
const updateDesign: Handler<'design.update'> = (ctx) => {
  const { itemDesignId, patch } = ctx.intent.payload
  const design = requireDesign(ctx.project, itemDesignId)
  const resizing = patch.width !== undefined || patch.depth !== undefined
  if (design.kind === 'cabinet') {
    // A cabinet's size is its `construction.settings`, which `cabinet.updateSettings` owns
    // with the tree consequences of a new width, and it has no colour of its own. Asking
    // this Intent for either is a view that lost track of which section it is in.
    if (resizing || patch.color !== undefined) {
      refuse(
        'unknown-target',
        designPath(itemDesignId),
        `Item Design ${itemDesignId} is a cabinet: its size is its construction and it has no colour of its own.`,
      )
    }
    if (patch.name !== undefined) requireDesign(ctx.draft, itemDesignId).name = patch.name
    return
  }
  const { width, depth } = designFootprintSize(design)
  const nextWidth = patch.width ?? width
  const nextDepth = patch.depth ?? depth
  if (nextWidth < MIN_PLAN_SIZE_MM || nextDepth < MIN_PLAN_SIZE_MM) {
    refuse(
      'invalid-size',
      designPath(itemDesignId),
      `An Item Footprint is at least ${MIN_PLAN_SIZE_MM} mm across; this one asked for ${Math.min(nextWidth, nextDepth)} mm.`,
    )
  }
  const draftDesign = requireGenericDesign(ctx.draft, itemDesignId)
  if (patch.name !== undefined) draftDesign.name = patch.name
  if (patch.color !== undefined) draftDesign.color = patch.color
  if (patch.width !== undefined) draftDesign.footprint.width = patch.width
  if (patch.depth !== undefined) draftDesign.footprint.depth = patch.depth
  if (resizing && isCentred(design.origin, width, depth)) {
    draftDesign.origin.x = nextWidth / 2
    draftDesign.origin.y = nextDepth / 2
  }
}

/**
 * Move the Item Origin inside the footprint (#57 behaviour 31, D3).
 *
 * Every placement of the design — on every Floor — takes the same turn the Origin did, so
 * each Item Footprint stays exactly where it is and only the point future rotations turn
 * about changes. The rotations themselves are untouched, and the placement still owns no
 * pivot of its own: the rewrite is derived from the design's old and new Origin, never
 * stored per placement.
 *
 * A cabinet's Item Origin is derived from its construction (#42 §2) and has nowhere to be
 * stored in domain v1, so this Intent is about a design that owns an Origin.
 */
const setOrigin: Handler<'design.setOrigin'> = (ctx) => {
  const { itemDesignId, origin } = ctx.intent.payload
  const design = requireDesign(ctx.project, itemDesignId)
  if (design.kind !== 'generic') {
    refuse(
      'unknown-target',
      designPath(itemDesignId),
      `Item Design ${itemDesignId} is a cabinet: its Item Origin is derived from its construction.`,
    )
  }
  const next = { x: origin.x, y: origin.y }
  if (!localPointValid(design, next)) {
    refuse(
      'invalid-origin',
      designPath(itemDesignId),
      `An Item Origin sits inside the Item Footprint; ${next.x}, ${next.y} is outside it.`,
    )
  }
  const draftDesign = requireGenericDesign(ctx.draft, itemDesignId)
  draftDesign.origin.x = next.x
  draftDesign.origin.y = next.y
  const moves = new Map(
    originMoveTranslations(placementsOf(ctx.project, itemDesignId), designOrigin(design), next).map(
      (move) => [move.placedItemId, move.translation] as const,
    ),
  )
  for (const placed of ctx.draft.existingModel.placedItems) {
    const translation = moves.get(placed.id)
    if (translation === undefined) continue
    placed.translation.x = translation.x
    placed.translation.y = translation.y
  }
}

/** A deep copy of one design under a new identity, keeping nothing that says where it came from. */
function copyAsDesign(design: ItemDesign, itemDesignId: EntityId, name: string): ItemDesign {
  const copy = structuredClone(design)
  copy.id = itemDesignId
  copy.name = name
  if (copy.kind === 'generic') {
    delete copy.catalogKey
    delete copy.isCustom
  }
  return copy
}

/**
 * Fork one Placed Item onto its own copy of the Item Design (#57 §2, D11).
 *
 * The copy is deep — footprint, origin, colour, height and, for a cabinet, the whole
 * construction payload, cabinet node IDs included because they are scoped per Item Design
 * (ADR 0004) — and only the chosen placement is repointed, so the other placements keep the
 * design they had. The copy is a design in its own right, so it stops claiming the catalog
 * entry or the legacy custom-shape flag the original carried.
 */
const forkDesign: Handler<'design.fork'> = (ctx) => {
  const { placedItemId, name } = ctx.intent.payload
  const placement = requirePlacement(ctx.project, placedItemId)
  const design = requireDesign(ctx.project, placement.itemDesignId)
  const [itemDesignId] = spendIds(ctx.intent.ids, 1, ctx.intent.type)
  ctx.draft.itemDesigns.push(copyAsDesign(design, itemDesignId, name))
  requirePlacement(ctx.draft, placedItemId).itemDesignId = itemDesignId
}

// --- Where a design edit lands ----------------------------------------------

/**
 * The Floor the edit is seen on: whichever one holds the design's first placement. A design
 * placed on several Floors has no single one, and #48's undo only needs somewhere to land.
 *
 * A cabinet design reports the cabinet view, because that is where its construction is
 * edited; everything else reports the Plan View, where its outline is.
 */
function designLocator(project: Project, itemDesignId: EntityId, placedItemIds: EntityId[]): Locator {
  const design = findDesign(project, itemDesignId)
  const placements = placementsOf(project, itemDesignId)
  return {
    floorId: placements[0]?.floorId ?? null,
    viewId: null,
    view: design?.kind === 'cabinet' ? 'cabinet' : 'plan',
    itemDesignIds: [itemDesignId],
    placedItemIds,
  }
}

export const DESIGN_HANDLERS: DesignHandlers = {
  'design.update': {
    run: updateDesign,
    locate: (project, intent) => designLocator(project, intent.payload.itemDesignId, placementsOf(project, intent.payload.itemDesignId).map((item) => item.id)),
  },
  'design.setOrigin': {
    run: setOrigin,
    locate: (project, intent) =>
      designLocator(project, intent.payload.itemDesignId, placementsOf(project, intent.payload.itemDesignId).map((item) => item.id)),
  },
  'design.fork': {
    run: forkDesign,
    locate: (project, intent) => {
      const placement = project.existingModel.placedItems.find((item) => item.id === intent.payload.placedItemId)
      // Undoing a fork leaves the original design, so that is the one the Locator names.
      return placement === undefined
        ? { floorId: null, viewId: null, view: 'plan', itemDesignIds: [], placedItemIds: [intent.payload.placedItemId] }
        : designLocator(project, placement.itemDesignId, [placement.id])
    },
  },
}
