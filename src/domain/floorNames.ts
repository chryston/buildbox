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
import type { EntityId, Floor, PlanView, Project, RenovationDisplay } from './project'
import { defaultPlanViewRange } from './planViewRange'

/** The comparison key every uniqueness rule uses. */
export const nameKey = (name: string): string => name.trim().normalize('NFC').toLowerCase()

/** The character no ID or name can hold, so it separates the halves of a key unambiguously. */
const KEY_SEPARATOR = String.fromCharCode(0)

/**
 * The key that says "this Floor already has a view called this" (#56, #75 §1).
 *
 * A view's name is unique among the views of one Floor and nothing else, so the Floor is half the key.
 * The separator splits the halves because an ID may hold any character a name may hold, and the pair has
 * to be unambiguous: `a` + `b` is never the key of `ab` + `` or `a` + `bc`.
 */
export const viewNameKey = (floorId: EntityId | null | undefined, name: string): string =>
  `${floorId ?? ''}${KEY_SEPARATOR}${nameKey(name)}`

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
 *
 * It looks at the Existing Model through no Design Option and the Existing Display (#70 §1):
 * a Floor that has just arrived has nothing else to look through. `view` restates both for the
 * one caller that copies a view rather than inventing one — `floor.duplicate` carries the
 * Option and Display of the Floor it duplicated, because a duplicate the user has to re-aim is
 * a duplicate that lost the thing they were looking at.
 */
export const defaultPlanView = (
  viewId: EntityId,
  floor: Floor,
  view?: { designOptionId: EntityId | null; renovationDisplay: RenovationDisplay },
): PlanView => ({
  id: viewId,
  kind: 'plan',
  floorId: floor.id,
  name: floor.name,
  isDefault: true,
  showPlanImage: true,
  // The whole storey, which is what a Floor's own view has always shown (#74 behaviour 4).
  planViewRange: defaultPlanViewRange(floor.limits),
  designOptionId: view?.designOptionId ?? null,
  renovationDisplay: view?.renovationDisplay ?? 'existing',
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
