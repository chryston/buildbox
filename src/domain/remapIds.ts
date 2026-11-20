/**
 * A brand-new identity for a whole Project (#50).
 *
 * Importing a Project Backup whose Project ID already belongs to a local Project has to
 * produce a second, independent Project: every entity ID in the copy differs from the
 * original and every reference still resolves. Only `domain` can say what that takes.
 * Which field is an ID, which is a reference to one, and which merely looks like either
 * is the domain schema (#42 §2) — `package` and `session` move bytes, they do not know
 * that a `Divider` carries an ID and a Plan Image does not.
 *
 * `allocate` is a parameter for the same reason `IntentFields.ids` is (#42 §3): a pure
 * module never mints an ID, it spends ones the caller brought. It is called exactly once,
 * with the number of IDs the walk below found, so the caller sizes a single batch —
 * `count` UUIDs, or one counter — instead of being asked per field, and one that cannot
 * supply that many fails before anything has been half-rewritten.
 *
 * The walk order is fixed and stated in full, because it is the contract between the
 * collection and the rebuild the way `INTENT_ID_ORDER` is between caller and handler
 * (#20 §4): `project.id`, then the Floors in array order, then the Plan Views in array
 * order, then each Item Design in array
 * order followed — for a cabinet — by its tree in pre-order (a space, then its dividers,
 * then its accessories, then its left subtree, then its right), then the Placed Items in
 * array order, then the Walls in array order, then the Wall Junctions in array order
 * (#64). Slot 0 belongs to the Project and is filled by `newId`, which the caller
 * minted; every later slot takes the allocator's ID at the same index. A test that finds
 * one ID it cannot explain can name the position it went wrong at, and remapping the same
 * Project twice gives the same copy rather than one shaped by enumeration order.
 *
 * Strings that look like IDs and are not are left exactly where they are on purpose:
 * `GlobalSettings.material` and `Divider.materialId` name a material, `catalogKey` names a
 * catalog entry, and an `assetHash` is content-addressed. Rewriting any of them would
 * corrupt the copy rather than rename it.
 */
import type { CabinetNode } from './cabinetPayload'
import type { EntityId, ItemDesign, Project } from './project'

/** Fresh IDs, `count` at a time (#42 §3: domain never mints one). */
export type IdAllocator = (count: number) => EntityId[]

/** An entity's old ID in, its replacement out — the one lookup every rebuild shares. */
type Replace = (id: EntityId) => EntityId

/**
 * A copy of `project` in which every entity ID is new: the Project's own identity is
 * `newId`, everything else is replaced in the walk order {@link IdAllocator} is paid in.
 * References — `PlacedItem.itemDesignId` and `.floorId` — go through the same map, so a
 * Project that validated before still validates after. The input is never mutated; parts
 * that hold no ID at all, such as a Floor's Plan Image or a cabinet's
 * `construction.settings`, are carried over as they are.
 */
export function remapIds(project: Project, newId: EntityId, allocate: IdAllocator): Project {
  const walk = entityIds(project)
  const fresh = allocate(walk.length)
  if (fresh.length < walk.length) {
    throw new Error(`remapIds needs ${walk.length} fresh IDs; the allocator returned ${fresh.length}.`)
  }

  // Keyed by the old ID, so an ID the input repeats is replaced by one ID everywhere, not
  // by a different one per occurrence. Slot 0 is the Project itself, whose new identity
  // the caller brought rather than allocated.
  const map = new Map<EntityId, EntityId>([[project.id, newId]])
  walk.forEach((id, index) => {
    if (!map.has(id)) map.set(id, fresh[index])
  })
  // An ID the walk did not collect is a walk that no longer matches the schema.
  const next: Replace = (id) => {
    const mapped = map.get(id)
    if (mapped === undefined) {
      throw new Error(`remapIds found no replacement for ${id}: the walk missed a field.`)
    }
    return mapped
  }

  return {
    ...project,
    id: newId,
    floors: project.floors.map((floor) => ({ ...floor, id: next(floor.id) })),
    views: project.views.map((view) => ({ ...view, id: next(view.id), floorId: next(view.floorId) })),
    itemDesigns: project.itemDesigns.map((design) => remapDesign(design, next)),
    existingModel: {
      ...project.existingModel,
      placedItems: project.existingModel.placedItems.map((item) => ({
        ...item,
        id: next(item.id),
        itemDesignId: next(item.itemDesignId),
        floorId: next(item.floorId),
      })),
      // A Wall and its Junctions are entities too (#64): each carries its own ID, stands on
      // a Floor, and a Junction names the Walls it joins.
      walls: project.existingModel.walls.map((wall) => ({ ...wall, id: next(wall.id), floorId: next(wall.floorId) })),
      wallJunctions: project.existingModel.wallJunctions.map((junction) => ({
        ...junction,
        id: next(junction.id),
        floorId: next(junction.floorId),
        ends: junction.ends.map((end) => ({ ...end, wallId: next(end.wallId) })),
        ...(junction.host === undefined ? {} : { host: { ...junction.host, wallId: next(junction.host.wallId) } }),
      })),
    },
  }
}

/** Every entity ID the Project carries, in the order the copy is built in. */
function entityIds(project: Project): EntityId[] {
  const ids: EntityId[] = [project.id]
  for (const floor of project.floors) ids.push(floor.id)
  for (const view of project.views) ids.push(view.id)
  for (const design of project.itemDesigns) {
    ids.push(design.id)
    if (design.kind === 'cabinet') collectSpace(design.construction.root, ids)
  }
  for (const item of project.existingModel.placedItems) ids.push(item.id)
  for (const wall of project.existingModel.walls) ids.push(wall.id)
  for (const junction of project.existingModel.wallJunctions) ids.push(junction.id)
  return ids
}

/** One space, the boards and hardware it carries, then its two sub-spaces. */
function collectSpace(node: CabinetNode, ids: EntityId[]): void {
  ids.push(node.id)
  for (const divider of node.dividers ?? []) ids.push(divider.id)
  for (const accessory of node.accessories ?? []) ids.push(accessory.id)
  if (node.children !== undefined) {
    collectSpace(node.children[0], ids)
    collectSpace(node.children[1], ids)
  }
}

/**
 * The same tree, one space at a time. A Project reaches here already validated, so its
 * trees are at most `MAX_TREE_DEPTH` deep (#42 §4) and the recursion is bounded; the
 * untrusted-bytes walk with its explicit stack is `validateProject`'s job.
 */
function remapSpace(node: CabinetNode, next: Replace): CabinetNode {
  const copy: CabinetNode = { ...node, id: next(node.id) }
  if (node.dividers !== undefined) {
    copy.dividers = node.dividers.map((divider) => ({ ...divider, id: next(divider.id) }))
  }
  if (node.accessories !== undefined) {
    copy.accessories = node.accessories.map((accessory) => ({ ...accessory, id: next(accessory.id) }))
  }
  if (node.children !== undefined) {
    copy.children = [remapSpace(node.children[0], next), remapSpace(node.children[1], next)]
  }
  return copy
}

/** A cabinet rebuilds its tree; a generic design only had its own ID to lose. */
function remapDesign(design: ItemDesign, next: Replace): ItemDesign {
  if (design.kind !== 'cabinet') return { ...design, id: next(design.id) }
  return {
    ...design,
    id: next(design.id),
    construction: { ...design.construction, root: remapSpace(design.construction.root, next) },
  }
}
