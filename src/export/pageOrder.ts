/**
 * Which page shows which view (#85 §1.2).
 *
 * A Drawing Set is an ordered list of views, and the order is a thing the person chooses: the
 * contractor who opens the PDF reads page 1 first, so a set whose pages arrive in the order the
 * tick-boxes happened to be clicked is a set that says nothing. Two rules decide it.
 *
 * **The default** is the order the Project itself states: every Floor in display order, and inside
 * a Floor the views in the order the Floor's own view list holds them — Plan Views first, then the
 * Elevation Views, because that is the order the view picker lists them in. Item Detail Views come
 * last, in Item Design order: they belong to no Floor, and a detail of a cabinet is read after the
 * plan the cabinet sits on.
 *
 * **The override** is the recorded `pageOrder`. It is a list of view keys, and it is merged with
 * the default rather than replacing it: the keys the person has ordered come first in the order they
 * gave them, and anything ticked since then joins at its default place. A view deleted since the
 * recipe was remembered simply drops out, and a key that names nothing the Project has is ignored —
 * a remembered order is a preference, and a preference that cannot be honoured is not a reason to
 * refuse the export.
 *
 * The key of a view lives here and nowhere else. The dialog remembers a recipe under it, the page
 * order names views by it, and the per-page orientation is keyed by it; a second spelling of the
 * same key in `ui` would be a third thing that has to agree.
 */

import { elevationViewsOf } from '../domain'
import type { Project } from '../domain'
import type { Recipe, RecipeViewRef } from './types'

/** The stable key of one view: its kind and the ID of the view or Item Design it draws. */
export function viewKey(ref: RecipeViewRef): string {
  if (ref.kind === 'plan') return `plan:${ref.viewId}`
  return ref.kind === 'elevation' ? `elevation:${ref.viewId}` : `item:${ref.itemDesignId}`
}

/**
 * The rank one view takes in the default page order: lower is earlier.
 *
 * A view whose Floor has gone, or an Item Design that no longer exists, ranks after everything the
 * Project still has — `exportFiles` then reports it as an unknown view rather than silently
 * dropping a page the person ticked.
 */
function rankOf(project: Project, ref: RecipeViewRef): number {
  const plans = project.views
  const elevations = elevationViewsOf(project)
  // Each Floor owns a block of ranks wide enough for every view of either kind, so a Floor's
  // Elevation Views always follow its Plan Views and never a later Floor's.
  const width = plans.length + elevations.length
  if (ref.kind === 'item-detail') {
    const at = project.itemDesigns.findIndex((design) => design.id === ref.itemDesignId)
    // Item Detail Views belong to no Floor, so they take the block after every Floor has had its
    // say; the order among them is Item Design order, which is their index.
    return at < 0 ? Number.MAX_SAFE_INTEGER : project.floors.length * width + at
  }
  const floorAt = (floorId: string): number => project.floors.findIndex((floor) => floor.id === floorId)
  const held = ref.kind === 'plan'
    ? plans.find((view) => view.id === ref.viewId)
    : elevations.find((view) => view.id === ref.viewId)
  const floor = floorAt(held?.floorId ?? '')
  if (held === undefined || floor < 0) return Number.MAX_SAFE_INTEGER
  const siblings = ref.kind === 'plan'
    ? plans.filter((view) => view.floorId === held.floorId)
    : elevations.filter((view) => view.floorId === held.floorId)
  return floor * width + (ref.kind === 'elevation' ? plans.length : 0) + siblings.findIndex((view) => view.id === held.id)
}

/** The contract's default page order for these views: Floor, then the Floor's view list, then Items. */
export function defaultPageOrder(project: Project, views: readonly RecipeViewRef[]): string[] {
  return views
    .map((ref, index) => ({ key: viewKey(ref), rank: rankOf(project, ref), index }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((each) => each.key)
}

/**
 * The page order to draw in: the recorded one where it still names a selected view, then the rest
 * in the Project's own order.
 */
export function pageOrderOf(
  project: Project,
  views: readonly RecipeViewRef[],
  recorded: readonly string[] | undefined,
): string[] {
  const selected = views.map(viewKey)
  const held = (recorded ?? []).filter((key) => selected.includes(key))
  return [...held, ...defaultPageOrder(project, views).filter((key) => !held.includes(key))]
}

/** The views a recipe asks for, in the order their pages are drawn. */
export function orderedViews(project: Project, recipe: Recipe): readonly RecipeViewRef[] {
  const order = pageOrderOf(project, recipe.views, recipe.pageOrder)
  const byKey = new Map(recipe.views.map((ref) => [viewKey(ref), ref]))
  return order.map((key) => byKey.get(key)!).filter((ref) => ref !== undefined)
}
