/**
 * What a data export includes that the view it was opened from hides (#73 §2, export contract §3).
 *
 * A machine-readable export never inherits visual hiding: a Furniture Layer muted on the screen to
 * see the walls better does not remove the appliances from a schedule. So the rows can legitimately
 * hold things the person cannot currently see, and the dialog has to say so rather than let the CSV
 * be a surprise — `4 items included that are hidden in this view`, with a disclosure naming them.
 *
 * The two halves are deliberately computed by different rules, which is the whole point of the file:
 * the rows come from {@link tables} with the explicit scope and nothing else, and the hiding comes
 * from the originating view's own effective layer settings. Nothing here reads a Design Option or a
 * Renovation Display, because hiding is a Layer fact and the scope has already settled the rest.
 */
import type { EntityId, PlanView, Project } from '../domain'
import { UNLAYERED_LAYER_KEY } from '../domain'
import { compareCodePoints, stableSort } from '../lib'
import { deriveWalls, effectiveLayerOrder, effectiveLayerSetting, tables } from '../derive'
import type { ElementColumns, QuantityScope } from '../derive'

/** The notice's payload: how many, and which. */
export interface HiddenInView {
  readonly count: number
  /** Each entity named the way the app names it, in the order the tables publish them. */
  readonly refs: readonly string[]
}

/** One in-scope row the view hides, with the two keys the table's own order sorts by. */
interface HiddenRow extends ElementColumns {
  readonly ref: string
}

/**
 * The in-scope entities the given view hides, or none when there is no view to hide anything.
 *
 * `scope` is the Lists scope exactly as the dialog holds it — the same object the CSVs are written
 * with — so the count is a statement about *this* export rather than about the Project. An entity on
 * a Layer the view has hidden is counted whether the Layer is muted, non-selectable or set to a
 * different colour: only `visible: false` hides, which is the one setting that takes pixels away.
 */
export function hiddenInView(project: Project, scope: QuantityScope, view: PlanView | null): HiddenInView {
  if (view === null) return { count: 0, refs: [] }
  const order = effectiveLayerOrder(project, view)
  const hidden = new Set(order.filter((layerKey) => !effectiveLayerSetting(project, view, layerKey).visible))
  if (hidden.size === 0) return { count: 0, refs: [] }

  const rows = tables(project, scope, { warningMessages: null })
  const onHiddenLayer = (row: ElementColumns): boolean =>
    hidden.has(row.drawingLayerId === '' ? UNLAYERED_LAYER_KEY : row.drawingLayerId)
  // A Wall has no name column: `W-2` is what the Plan View, the inspector and the Warnings List call
  // it, and the only honest source for it is the derive pass that draws the reference.
  const wallRefs = new Map<EntityId, string>()
  const wallRef = (floorId: EntityId, optionId: string, wallId: EntityId): string => {
    const key = `${optionId}\u0000${wallId}`
    const held = wallRefs.get(key)
    if (held !== undefined) return held
    const ref = deriveWalls(project, floorId, optionId === '' ? null : optionId).byId.get(wallId)?.ref ?? wallId
    wallRefs.set(key, ref)
    return ref
  }

  const hiddenRows: HiddenRow[] = [
    ...rows.rooms.filter(onHiddenLayer).map((row) => ({ ...row, ref: row.name })),
    ...rows.walls.filter(onHiddenLayer).map((row) => ({ ...row, ref: wallRef(row.floorId, row.designOptionId, row.stableId) })),
    ...rows.openings.filter(onHiddenLayer).map((row) => ({ ...row, ref: row.label === '' ? row.stableId : row.label })),
    ...rows.placedItems.filter(onHiddenLayer).map((row) => ({ ...row, ref: row.label })),
  ]

  // The disclosure is in the order the tables themselves are in — Floor, then Design Option, then
  // `stable_id` — so a person reading it down finds the same order they will read the CSV in.
  const floorIds = project.floors.map((floor) => floor.id)
  const optionIds = scope.designOptionIds === 'existing-only' ? [''] : [...scope.designOptionIds]
  const sorted = stableSort(hiddenRows, (a, b) =>
    floorIds.indexOf(a.floorId) - floorIds.indexOf(b.floorId) ||
    optionIds.indexOf(a.designOptionId) - optionIds.indexOf(b.designOptionId) ||
    compareCodePoints(a.stableId, b.stableId))
  return { count: sorted.length, refs: sorted.map((row) => row.ref) }
}
