/**
 * Project → the legacy view-models, memoised (#49, #20 §10).
 *
 * The cabinet scene is rebuilt from the Project, and rebuilt *once per Project*: a
 * `useSyncExternalStore` selector that returned a fresh array on every call would make
 * React re-render forever, so the projection is cached against the Project object it came
 * from. A commit replaces the Project, which is exactly the granularity the cache wants —
 * the same Project always gives the same view-model.
 *
 * The floor-plan projection left with #55: the Plan View builds its own view-models in
 * `src/ui/workspace/planModel.ts`.
 */
import type { CabinetUnit } from '../../cabinet'
import { cabinetSceneUnits } from '../../derive'
import type { Project } from '../../domain'

const unitsCache = new WeakMap<Project, CabinetUnit[]>()

/** The cabinet scene of Floor 1, stable while `project` is the same object. */
export function projectUnits(project: Project): CabinetUnit[] {
  const cached = unitsCache.get(project)
  if (cached !== undefined) return cached
  const floorId = project.floors[0]?.id ?? null
  const units = floorId === null ? [] : cabinetSceneUnits(project, floorId)
  unitsCache.set(project, units)
  return units
}
