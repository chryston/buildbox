/**
 * Choosing an owner for the converted floor plan (#43, #14).
 *
 * The converter deliberately hands back floor-plan *content* rather than a Project: which
 * Project the floor plan belongs to is the user's decision, not something the data can
 * say. These two functions are that decision, once it has been made — attach the content
 * to an existing Project's Floor, or stand up a Project of its own.
 *
 * Both revalidate what they produce and both fix ID collisions the same way the converter
 * does — a new ID from the injected allocator, recorded in `regeneratedIds` with a path in
 * the Project that came out — because a legacy floor plan shares no ID namespace with the
 * Project it is being merged into.
 */
import { defaultPlanView, validateProject } from '../../domain'
import type { EntityId, Floor, GenericItemDesign, PlacedItem, Project } from '../../domain'
import { problem, type ValidationProblem } from '../../lib'
import type { IdRegeneration, LegacyFloorPlanContent } from './conversion'
import { FLOOR_ONE_NAME, MIGRATED_PREFERENCES } from './map'

export interface AttachFloorPlanOptions {
  /** Which Floor of the Project receives the content. */
  floorId: EntityId
  newId: () => string
}

export interface FloorPlanProjectOptions {
  projectId: EntityId
  name: string
  floorId: EntityId
  /** Collisions with the content's own IDs are resolved here, as everywhere in #43. */
  newId: () => string
}

export type FloorPlanAttachmentResult =
  | { ok: true; project: Project; regeneratedIds: IdRegeneration[] }
  | { ok: false; problems: ValidationProblem[] }

/**
 * The content as `project`'s Floor `floorId`'s items: Item Designs and Placed Items are
 * appended, the Plan Image goes on the Floor.
 *
 * It reports a problem rather than overwriting a Floor that already has a Plan Image —
 * losing an image nobody asked to lose is worse than a rejected merge.
 */
export function attachFloorPlan(
  project: Project,
  content: LegacyFloorPlanContent,
  options: AttachFloorPlanOptions,
): FloorPlanAttachmentResult {
  const index = project.floors.findIndex((floor) => floor.id === options.floorId)
  if (index < 0) {
    return {
      ok: false,
      problems: [problem('floors', 'missing-floor', `No Floor with id "${options.floorId}" is in this Project.`)],
    }
  }
  const floor = project.floors[index] as Floor
  if (content.planImage !== null && floor.planImage !== null) {
    return {
      ok: false,
      problems: [problem(`floors[${index}].planImage`, 'plan-image-present', 'This Floor already has a Plan Image.')],
    }
  }

  const merged: Project = {
    ...project,
    floors: project.floors.map((each, at) =>
      at === index ? { ...each, planImage: content.planImage ?? each.planImage } : each),
  }
  return appendContent(merged, content, options.floorId, options.newId)
}

/**
 * The content as a Project of its own, with one Floor named "Floor 1" — the shape a
 * converted `Design` has too, so the Migration review offers one choice for both.
 */
export function floorPlanAsProject(
  content: LegacyFloorPlanContent,
  options: FloorPlanProjectOptions,
): FloorPlanAttachmentResult {
  const project: Project = {
    id: options.projectId,
    meta: { name: options.name },
    preferences: { ...MIGRATED_PREFERENCES },
    floors: [{ id: options.floorId, name: FLOOR_ONE_NAME, planImage: content.planImage }],
    views: [
      defaultPlanView(options.newId(), {
        id: options.floorId,
        name: FLOOR_ONE_NAME,
        planImage: content.planImage,
      }),
    ],
    itemDesigns: [],
    existingModel: { placedItems: [], walls: [], wallJunctions: [], openings: [] },
  }
  return appendContent(project, content, options.floorId, options.newId)
}

/**
 * Append the content's items to `project` — IDs resolved against everything the Project
 * already names — and hand back the result only if domain v1 accepts it.
 */
function appendContent(
  project: Project,
  content: LegacyFloorPlanContent,
  floorId: EntityId,
  newId: () => string,
): FloorPlanAttachmentResult {
  const regenerated: IdRegeneration[] = []
  const taken = takenIds(project)

  const designs: GenericItemDesign[] = []
  const designIds = new Map<string, string>()
  content.itemDesigns.forEach((design, offset) => {
    const id = freshId(design.id, `itemDesigns[${project.itemDesigns.length + offset}].id`, taken, newId, regenerated)
    designIds.set(design.id, id)
    designs.push({ ...design, id })
  })

  const placements: PlacedItem[] = []
  content.placements.forEach((placement, offset) => {
    const base = `existingModel.placedItems[${project.existingModel.placedItems.length + offset}]`
    placements.push({
      id: freshId(placement.id, `${base}.id`, taken, newId, regenerated),
      itemDesignId: designIds.get(placement.itemDesignId) ?? placement.itemDesignId,
      floorId,
      translation: { ...placement.translation },
      rotationDeg: placement.rotationDeg,
      baseElevation: placement.baseElevation,
    })
  })

  const merged: Project = {
    ...project,
    itemDesigns: [...project.itemDesigns, ...designs],
    existingModel: {
      placedItems: [...project.existingModel.placedItems, ...placements],
      walls: project.existingModel.walls,
      wallJunctions: project.existingModel.wallJunctions,
      openings: project.existingModel.openings,
    },
  }

  const checked = validateProject(merged)
  return checked.ok
    ? { ok: true, project: checked.project, regeneratedIds: regenerated }
    : { ok: false, problems: checked.problems }
}

/** Every name the Project already uses: domain v1 keeps one namespace for the whole Project. */
function takenIds(project: Project): Set<string> {
  const taken = new Set<string>([project.id])
  for (const floor of project.floors) taken.add(floor.id)
  for (const view of project.views) taken.add(view.id)
  for (const design of project.itemDesigns) taken.add(design.id)
  for (const placed of project.existingModel.placedItems) taken.add(placed.id)
  return taken
}

function freshId(
  oldId: string,
  path: string,
  taken: Set<string>,
  newId: () => string,
  regenerated: IdRegeneration[],
): string {
  if (!taken.has(oldId)) {
    taken.add(oldId)
    return oldId
  }
  let candidate = newId()
  for (let attempt = 0; attempt < 1000 && taken.has(candidate); attempt += 1) candidate = newId()
  taken.add(candidate)
  regenerated.push({ scope: 'floor-plan', path, oldId, newId: candidate })
  return candidate
}
