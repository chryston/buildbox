/**
 * The Plan View Range: the two elevations one Plan View draws between (#74 §3).
 *
 * Its own module because the default rule is needed by three callers that must not import each
 * other — `project` for the type, `floorNames` when a Floor's default view is built, and the v8 → v9
 * migrator when every existing view is given one — and a second copy of a default is a second rule.
 */
import type { FloorLimits } from './project'

/**
 * The Vertical Range of a Plan View, in millimetres above the Floor Datum, both ends inclusive and
 * `lowerMm` strictly below `upperMm`.
 *
 * The same two numbers as {@link FloorLimits}, and the same rule that a missing limit is never
 * unbounded — except that a Plan View Range is never missing and never unbounded: every Plan View
 * carries both ends, and its lower end is strictly below its upper one. It is a *view* property: two
 * Plan Views of one Floor may cut at different heights, and moving one touches no entity, reopens no
 * warning and hides nothing (#74 §3).
 *
 * Whether an entity is In range, Above range or Below range is decided by overlap, not by
 * containment, so a half-open interval would only make an entity standing exactly on `upperMm`
 * ambiguous. It is closed, and `derive` decides the boundary case with the tolerance #29 §D1 fixes at
 * 0.01 mm.
 */
export interface PlanViewRange {
  lowerMm: number
  upperMm: number
}

/** The range of a Floor that gives no usable pair of limits: the storey as BuildBox assumes it. */
export const DEFAULT_PLAN_VIEW_RANGE: PlanViewRange = { lowerMm: 0, upperMm: 2600 }

/**
 * The range a Plan View of a Floor with these limits starts at (#74 behaviour 4): the Floor's lower
 * limit, or 0 when it has none, up to its upper limit, or 2 600 mm when it has none — the whole
 * storey, so a new view shows everything the Floor has.
 *
 * One function because two places need exactly this rule — `edit` when a Plan View is created, and
 * the v8 → v9 migrator when every existing view is given one — and a second copy of a default is a
 * second rule. A Floor whose own limits do not rise cannot give a range, since a range must rise, so
 * such a Floor falls back to the plain 0–2 600 rather than producing a view the validator would
 * reject. A `floorId` that names no Floor is the same case from the other side.
 */
export const defaultPlanViewRange = (limits?: FloorLimits): PlanViewRange => {
  const lower = typeof limits?.lowerMm === 'number' && Number.isFinite(limits.lowerMm) ? limits.lowerMm : DEFAULT_PLAN_VIEW_RANGE.lowerMm
  const upper = typeof limits?.upperMm === 'number' && Number.isFinite(limits.upperMm) ? limits.upperMm : DEFAULT_PLAN_VIEW_RANGE.upperMm
  return lower < upper ? { lowerMm: lower, upperMm: upper } : DEFAULT_PLAN_VIEW_RANGE
}
