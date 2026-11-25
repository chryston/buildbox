/**
 * The Elevation View half of the catalogue (#75 §3).
 *
 * Reachable from exactly one place: `../registry`'s catalogue, which keeps it out of every other
 * module's import list.
 *
 * Three rules hold across all three handlers, and they are the rules the issue states as the
 * contract rather than the panel's habit:
 *
 *  - **An Elevation View is a saved view, not a drawing.** It holds a view line, a side, a depth and
 *    the settings every saved view shares. It stores no copy of anything it looks at, so no handler
 *    here reads or writes a Wall, an Opening or a Placed Item — criterion 12 measures the Existing
 *    Model and the Item Designs byte for byte across all three.
 *  - **Nothing cascades.** Deleting one Elevation View deletes the view and nothing else, and a Floor
 *    whose Elevation Views are still there refuses to be deleted (#56's rule, one kind wider).
 *  - **The name is the Floor's business.** Names are unique per Floor among the Floor's Elevation
 *    Views, folded the way every other name in the Project is folded, and a name the user left blank
 *    is filled with the next free `Elevation N` in the same step that made the view.
 */
import {
  ELEVATION_VIEW_SIDES,
  elevationViewNameTaken,
  elevationViewsOf,
  nextElevationViewName,
  savedViewById,
  viewDesignOptionId,
  viewRenovationDisplay,
} from '../../domain'
import type { ElevationView, ElevationViewLine, ElevationViewSide, EntityId, Project } from '../../domain'
import type { Locator, RenovationIntentType } from '../intents'
import type { Handler, IntentHandler } from './context'
import { guardViewAnnotations, refuse, requireFloor, spendIds } from './support'

/** The Elevation View half of the renovation set. */
type ElevationIntentType = Extract<RenovationIntentType, `elevationView.${string}`>

/** The IDs each Elevation View Intent spends — only a new view needs one. */
export const ELEVATION_INTENT_ID_ORDER: { [T in ElevationIntentType]: readonly string[] } = {
  'elevationView.create': ['elevationViewId'],
  'elevationView.edit': [],
  'elevationView.delete': [],
}

/**
 * The default label per Elevation View Intent.
 *
 * `New Elevation View` is the whole row for a create, because the name the view gets is Project data
 * the row cannot hold; the edit and the delete name the thing they touched and nothing more (#75 §3).
 */
export const ELEVATION_INTENT_LABELS: { [T in ElevationIntentType]: string } = {
  'elevationView.create': 'New Elevation View',
  'elevationView.edit': 'Edit Elevation View',
  'elevationView.delete': 'Delete Elevation View',
}

/** The path of one Elevation View, in the validator's vocabulary. */
export const elevationViewPath = (viewId: EntityId): string => `elevationViews[${viewId}]`

/** An Elevation View, or a rejection that names it. */
export function requireElevationView(project: Project, viewId: EntityId): ElevationView {
  const view = elevationViewsOf(project).find((candidate) => candidate.id === viewId)
  if (view === undefined) refuse('unknown-target', elevationViewPath(viewId), `There is no Elevation View ${viewId} to change.`)
  return view
}

/** A view line that can be stored: two real places that are not the same place. */
function lineProblem(line: ElevationViewLine): string | null {
  for (const point of [line.start, line.end]) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return 'Enter a number for both ends of the view line.'
  }
  return line.start.x === line.end.x && line.start.y === line.end.y
    ? 'The view line needs two different places to run between.'
    : null
}

/** How far the view reaches: a real distance in front of the view line, and never none. */
function depthProblem(depth: number): string | null {
  return Number.isFinite(depth) && depth > 0 ? null : 'The distance needs to be more than zero.'
}

/** Which side of the view line the view looks from. */
function sideProblem(side: ElevationViewSide): string | null {
  return (ELEVATION_VIEW_SIDES as readonly string[]).includes(side) ? null : 'Choose which side of the view line to look from.'
}

/**
 * A name that can be used on this Floor, or the sentence saying why it cannot (#75 §1).
 *
 * Folded case and folded whitespace, one per Floor, among the Floor's Elevation Views only: the picker
 * lists Plan Views and Elevation Views as two groups, so a Floor may hold a Plan View and an Elevation
 * View that read the same, and nothing is ambiguous at a glance.
 */
function nameProblem(project: Project, floorId: EntityId, name: string, except: EntityId | null): string | null {
  if (name.trim() === '') return 'An Elevation View needs a name.'
  return elevationViewNameTaken(project, floorId, name, except)
    ? `This Floor already has an Elevation View called "${name.trim()}".`
    : null
}

/** An Elevation View's own Locator: the Floor it looks along, and the view itself. */
function elevationLocatorOf(project: Project, viewId: EntityId | null, floorId: EntityId | null): Locator {
  const view = viewId === null ? undefined : elevationViewsOf(project).find((candidate) => candidate.id === viewId)
  return {
    floorId: view?.floorId ?? floorId,
    viewId: viewId,
    view: 'plan',
    itemDesignIds: [],
    placedItemIds: [],
  }
}

const createElevationView: Handler<'elevationView.create'> = (ctx) => {
  const { floorId, line, side, depth, name, fromViewId } = ctx.intent.payload
  requireFloor(ctx.project, floorId)
  const problem = sideProblem(side) ?? lineProblem(line) ?? depthProblem(depth)
  if (problem !== null) refuse('invalid-project', 'elevationViews', problem)
  const trimmed = name?.trim() ?? ''
  if (trimmed !== '') {
    const named = nameProblem(ctx.project, floorId, trimmed, null)
    if (named !== null) refuse('invalid-project', 'elevationViews', named)
  }
  const [viewId] = spendIds(ctx.intent.ids, 1, ctx.intent.type)
  // The new view starts where the user was looking (#70 §1): the Design Option and the Renovation
  // Display carry over from the view named in the payload, or from the Floor's own Plan View when no
  // view was named or that view is gone. What does not carry over is anything the Plan View has that
  // an Elevation View has no meaning for — its Vertical Range and whether the Plan Image shows.
  const source =
    savedViewById(ctx.project, fromViewId) ??
    savedViewById(ctx.project, ctx.project.views.find((view) => view.floorId === floorId && view.isDefault)?.id)
  if (ctx.draft.elevationViews === undefined) ctx.draft.elevationViews = []
  ctx.draft.elevationViews.push({
    id: viewId,
    kind: 'elevation',
    floorId,
    name: trimmed === '' ? nextElevationViewName(ctx.draft, floorId) : trimmed,
    line,
    side,
    depth,
    designOptionId: source === null ? null : viewDesignOptionId(source),
    renovationDisplay: source === null ? 'existing' : viewRenovationDisplay(source),
  })
}

const editElevationView: Handler<'elevationView.edit'> = (ctx) => {
  const { viewId, name, side, depth, line } = ctx.intent.payload
  const view = requireElevationView(ctx.draft, viewId)
  const path = elevationViewPath(viewId)
  const trimmed = name?.trim()
  if (trimmed !== undefined && trimmed !== view.name) {
    const named = nameProblem(ctx.draft, view.floorId, trimmed, viewId)
    if (named !== null) refuse('invalid-project', path, named)
  }
  if (side !== undefined && side !== view.side) {
    const problem = sideProblem(side)
    if (problem !== null) refuse('invalid-project', path, problem)
  }
  if (depth !== undefined && depth !== view.depth) {
    const problem = depthProblem(depth)
    if (problem !== null) refuse('invalid-project', path, problem)
  }
  if (line !== undefined && (line.start.x !== view.line.start.x || line.start.y !== view.line.start.y || line.end.x !== view.line.end.x || line.end.y !== view.line.end.y)) {
    const problem = lineProblem(line)
    if (problem !== null) refuse('invalid-project', `${path}.line`, problem)
  }
  // An edit that changes nothing is refused rather than recorded: history would hold a step that
  // undoes nothing, and the row would say `Edit Elevation View` about a Project that reads the same.
  if (
    (trimmed === undefined || trimmed === view.name) &&
    (side === undefined || side === view.side) &&
    (depth === undefined || depth === view.depth) &&
    (line === undefined || sameLine(line, view.line))
  ) {
    refuse('no-change', path, 'That Elevation View already reads this way.')
  }
  if (trimmed !== undefined && trimmed !== view.name) view.name = trimmed
  if (side !== undefined && side !== view.side) view.side = side
  if (depth !== undefined && depth !== view.depth) view.depth = depth
  if (line !== undefined && !sameLine(line, view.line)) view.line = { start: { ...line.start }, end: { ...line.end } }
}

/** Two view lines that are the same two places, read by value rather than by reference. */
function sameLine(a: ElevationViewLine, b: ElevationViewLine): boolean {
  return a.start.x === b.start.x && a.start.y === b.start.y && a.end.x === b.end.x && a.end.y === b.end.y
}

const deleteElevationView: Handler<'elevationView.delete'> = (ctx) => {
  const { viewId } = ctx.intent.payload
  const view = requireElevationView(ctx.project, viewId)
  // #81 §8.1: an Annotation draws in exactly one saved view, Elevation included, and a Reference
  // Marker navigates into one; nothing here retargets or deletes them for the user.
  guardViewAnnotations(ctx.project, viewId, view.name, `elevationViews[${viewId}]`)
  // No cascade, in either direction: the view goes and the world it looks at stays exactly as it was.
  ctx.draft.elevationViews = elevationViewsOf(ctx.draft).filter((candidate) => candidate.id !== viewId)
}

export const ELEVATION_HANDLERS: { [T in ElevationIntentType]: IntentHandler<T> } = {
  'elevationView.create': {
    run: createElevationView,
    locate: (_project, intent) => elevationLocatorOf(_project, intent.ids[0] ?? null, intent.payload.floorId),
  },
  'elevationView.edit': {
    run: editElevationView,
    locate: (project, intent) => elevationLocatorOf(project, intent.payload.viewId, null),
  },
  'elevationView.delete': {
    run: deleteElevationView,
    locate: (project, intent) => elevationLocatorOf(project, intent.payload.viewId, null),
  },
}
