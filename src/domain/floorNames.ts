/**
 * The rules Floors and Plan Views share about their names (#56).
 *
 * "Unique ignoring case" is one rule with three callers — the validator refusing a bad
 * Project, the handler choosing the next free `Floor N`, and the dialog saying
 * "Another Floor is already called Kitchen level" before anything is dispatched — so the
 * comparison lives here rather than in three near-copies of `toLowerCase()`.
 *
 * Trimming and Unicode normalisation are part of the same decision: ` Kitchen ` and
 * `kitchen` and `ＫＩＴＣＨＥＮ` (NFC) are the same name typed differently, and a Project
 * that holds two of them cannot be renamed out of it.
 */
import type { EntityId, Floor, PlanView, Project } from './project'

/** The comparison key every uniqueness rule uses. */
export const nameKey = (name: string): string => name.trim().normalize('NFC').toLowerCase()

/** Whether another Floor already answers to `name`, ignoring case. */
export function floorNameTaken(project: Project, name: string, exceptFloorId: EntityId | null = null): boolean {
  const key = nameKey(name)
  return project.floors.some((floor) => floor.id !== exceptFloorId && nameKey(floor.name) === key)
}

/**
 * `Floor N` for the lowest `N` no Floor is using (#56). A Project with "Floor 1" and
 * "Floor 3" gets "Floor 2", because the gap is the number the user is looking for.
 */
export function nextFloorName(project: Project): string {
  const taken = new Set(project.floors.map((floor) => nameKey(floor.name)))
  for (let n = 1; ; n += 1) {
    const candidate = `Floor ${n}`
    if (!taken.has(nameKey(candidate))) return candidate
  }
}

/**
 * The Plan View a Floor comes with: named after the Floor, drawing its Plan Image until the
 * user says otherwise. Every Floor has exactly one, in the same transaction that created
 * the Floor — new, converted, migrated or duplicated.
 */
export const defaultPlanView = (viewId: EntityId, floor: Floor): PlanView => ({
  id: viewId,
  kind: 'plan',
  floorId: floor.id,
  name: floor.name,
  isDefault: true,
  showPlanImage: true,
})

/** Whether another Plan View of the same Floor already answers to `name`, ignoring case. */
export function planViewNameTaken(
  project: Project,
  floorId: EntityId,
  name: string,
  exceptViewId: EntityId | null = null,
): boolean {
  const key = nameKey(name)
  return project.views.some(
    (view) => view.floorId === floorId && view.id !== exceptViewId && nameKey(view.name) === key,
  )
}
