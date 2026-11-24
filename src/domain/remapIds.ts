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
 * order, then the Elevation Views in array order (#75 §1), then each Item Design in array
 * order followed — for a cabinet — by its tree in pre-order (a space, then its dividers,
 * then its accessories, then its left subtree, then its right), then the Placed Items in
 * array order, then the Walls in array order, then the Wall Junctions in array order
 * (#64), then the Openings, then the Rooms (#67), then the warning acknowledgements, then the Comments
 * (#80 §1). Slot 0
 * belongs to the Project and is filled by `newId`, which the caller
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
import type { CommentAnchor } from './comments'
import { beamsOf, elevationViewsOf, servicesOf, skirtingOf } from './project'
import type { EntityId, ItemDesign, Project, ProposedModel } from './project'

/** Fresh IDs, `count` at a time (#42 §3: domain never mints one). */
export type IdAllocator = (count: number) => EntityId[]

/** An entity's old ID in, its replacement out — the one lookup every rebuild shares. */
export type IdReplacement = (id: EntityId) => EntityId

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
  const next: IdReplacement = (id) => {
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
    // An Elevation View is a saved view of the same kind (#75 §1): its own ID and the Floor it looks
    // along are both rewritten, and the line it stands on is a measurement, not a reference. A Project
    // that carries no list at all — every Project written before #75 — comes back carrying no list,
    // because a copy that invents a field is not the same Project under different IDs.
    ...(project.elevationViews === undefined
      ? {}
      : {
          elevationViews: elevationViewsOf(project).map((view) => ({
            ...view,
            id: next(view.id),
            floorId: next(view.floorId),
          })),
        }),
    itemDesigns: project.itemDesigns.map((design) => remapDesign(design, next)),
    existingModel: { ...project.existingModel, ...remapEntities(project.existingModel, next) },
    // An acknowledgement names its subjects by ID (#66), so a copy that did not rewrite them
    // would come back with a note about a Wall that belongs to the Project it was copied from.
    // `designOptionId` is `null` in every Project written today, and stays whatever it was.
    warningAcknowledgements: project.warningAcknowledgements.map((acknowledgement) => ({
      ...acknowledgement,
      id: next(acknowledgement.id),
      subjectIds: acknowledgement.subjectIds.map(next),
    })),
    // A Comment travels with the Project it was written in (#80 §1), and its Anchor names records of
    // that Project, so the copy has to name its own. The `C-` reference is not an ID and does not move:
    // a whole Project copied under new IDs is a different Project, where `C-004` is nobody else's name.
    // A Design Option ID is not an entity ID either — the walk does not renumber Options — so an Anchor
    // or a scope naming one is carried over as it stands, which is the Option the copy also has.
    comments: project.comments.map((comment) => ({ ...comment, id: next(comment.id), anchor: remapAnchor(comment.anchor, next) })),
  }
}

/**
 * The one place that knows which field of a {@link CommentAnchor} is an entity ID. A Design Option ID
 * is not one, and neither is a feature ID: `leftFace` is a name the owner's kind registers, not a
 * record, and a node ID belongs to the Item Design's tree, which the owner field already reaches.
 */
export function remapAnchor(anchor: CommentAnchor, next: IdReplacement): CommentAnchor {
  switch (anchor.kind) {
    case 'project':
      return anchor
    case 'floor':
    case 'floor_point':
      return { ...anchor, floorId: next(anchor.floorId) }
    case 'item_design':
      return { ...anchor, itemDesignId: next(anchor.itemDesignId) }
    case 'design_option':
      return anchor
    case 'entity':
      return { ...anchor, entityId: next(anchor.entityId) }
    case 'feature':
      return { ...anchor, ownerId: next(anchor.ownerId) }
  }
}

/**
 * The same five collections with every ID and every reference inside them replaced through `next`.
 *
 * The one place that knows which field of a plan record is an ID. `remapIds` pays for a whole
 * Project with it; a paste that brings a handful of records across from another Project (#72)
 * brings their references with them and nothing else, so it brings its own map. Both walk this
 * function, so the field list cannot drift from the schema in one of the two.
 *
 * `predecessorIds` is provenance, not a reference that has to resolve: it names records of the
 * Project the work was copied *from*, which is a different Project by the time this is called, so
 * the caller decides what happens to it — `remapIds` leaves it alone, a paste drops it.
 */
export function remapEntities(model: ProposedModel, next: IdReplacement): ProposedModel {
  return {
    placedItems: model.placedItems.map((item) => ({
      ...item,
      id: next(item.id),
      itemDesignId: next(item.itemDesignId),
      floorId: next(item.floorId),
    })),
    // A Wall and its Junctions are entities too (#64): each carries its own ID, stands on
    // a Floor, and a Junction names the Walls it joins.
    walls: model.walls.map((wall) => ({ ...wall, id: next(wall.id), floorId: next(wall.floorId) })),
    wallJunctions: model.wallJunctions.map((junction) => ({
      ...junction,
      id: next(junction.id),
      floorId: next(junction.floorId),
      ends: junction.ends.map((end) => ({ ...end, wallId: next(end.wallId) })),
      ...(junction.host === undefined ? {} : { host: { ...junction.host, wallId: next(junction.host.wallId) } }),
    })),
    // An Opening keeps its host: the copy's Wall it is cut into is the copy's own (#65).
    openings: model.openings.map((opening) => ({
      ...opening,
      id: next(opening.id),
      floorId: next(opening.floorId),
      hostWallId: next(opening.hostWallId),
    })),
    // A Room owns its outline (#67): the Edge IDs are its own, and each face reference names the
    // Wall that edge is attached to.
    rooms: model.rooms.map((room) => ({
      ...room,
      id: next(room.id),
      floorId: next(room.floorId),
      wallFaceRefs: room.wallFaceRefs.map((reference) => ({ ...reference, wallId: next(reference.wallId) })),
    })),
    // A Beam names nothing but its Floor (#77 §1): no host, no junction, no face reference.
    beams: beamsOf(model).map((beam) => ({ ...beam, id: next(beam.id), floorId: next(beam.floorId) })),
    // A Skirting names its Floor and the one Wall it is drawn against (#78 §1), so both move.
    skirting: skirtingOf(model).map((entry) => ({
      ...entry,
      id: next(entry.id),
      floorId: next(entry.floorId),
      hostWallId: next(entry.hostWallId),
    })),
    // A Service names nothing but its Floor (#79 §1): no host, no junction, no face reference.
    services: servicesOf(model).map((service) => ({ ...service, id: next(service.id), floorId: next(service.floorId) })),
  }
}

/** Every entity ID the Project carries, in the order the copy is built in. */
function entityIds(project: Project): EntityId[] {
  const ids: EntityId[] = [project.id]
  for (const floor of project.floors) ids.push(floor.id)
  for (const view of project.views) ids.push(view.id)
  for (const view of elevationViewsOf(project)) ids.push(view.id)
  for (const design of project.itemDesigns) {
    ids.push(design.id)
    if (design.kind === 'cabinet') collectSpace(design.construction.root, ids)
  }
  for (const item of project.existingModel.placedItems) ids.push(item.id)
  for (const wall of project.existingModel.walls) ids.push(wall.id)
  for (const junction of project.existingModel.wallJunctions) ids.push(junction.id)
  for (const opening of project.existingModel.openings) ids.push(opening.id)
  for (const room of project.existingModel.rooms) ids.push(room.id)
  for (const beam of beamsOf(project.existingModel)) ids.push(beam.id)
  for (const entry of skirtingOf(project.existingModel)) ids.push(entry.id)
  for (const service of servicesOf(project.existingModel)) ids.push(service.id)
  for (const acknowledgement of project.warningAcknowledgements) ids.push(acknowledgement.id)
  // A Comment has an ID of its own and an Anchor naming one, so it is a record like any other (#80 §1).
  for (const comment of project.comments) ids.push(comment.id)
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
function remapSpace(node: CabinetNode, next: IdReplacement): CabinetNode {
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
function remapDesign(design: ItemDesign, next: IdReplacement): ItemDesign {
  if (design.kind !== 'cabinet') return { ...design, id: next(design.id) }
  return {
    ...design,
    id: next(design.id),
    construction: { ...design.construction, root: remapSpace(design.construction.root, next) },
  }
}
