/**
 * What `Paste from other Project…` asks before it writes anything (#72 §5) — dark until
 * `VITE_FF_RENOVATION` is on.
 *
 * A Copy Set names its Drawing Layers and its Walls by the **source** Project's IDs, and none of
 * those exist here. So the paste is not one click but a review: one row per source layer actually
 * used, each answered with an existing layer, a new one, or `Unlayered`. A matching name is a
 * suggestion and nothing more — two Projects can call one layer `Services` and mean two different
 * things by it, which is exactly the collision the review exists to make visible.
 *
 * The same review answers the two questions a partial selection always leaves: what will not come
 * across (an Opening whose Wall stayed behind), and what will come across detached (a Room edge
 * whose Wall stayed behind). Both are decided here rather than at write time, so the person reads
 * the loss before the Transaction rather than after it.
 *
 * The pure half of the pair: `previewIntent` reaches it through the Intent's `review` seam, and the
 * handler re-reads it when the answer comes back, so a dialog opened against an old Project cannot
 * paste into a new one.
 */
import { designOptionsOf, nameKey, viewDesignOptionId, viewRenovationDisplay } from '../domain'
import type { EntityId, PlanView, Project } from '../domain'
import { roomEdgeName } from '../derive'
import type { PasteDestination, PasteLayerRow, PasteLoss, PasteReview } from './intents'
import type { CopySet } from './copySet'

/** The one sentence a display that cannot take new work answers with (#72 Scope 2). */
export const PASTE_BLOCKED = 'Switch to Proposed or Combined display to paste new work.'

/** Why a record will not come across, in the two words the dialog prints beside its name. */
export const PASTE_LOSS_HOST = 'its host Wall was not copied'
export const PASTE_DETACH_FACE = 'its Wall was not copied'

/**
 * Where the active view says new work belongs (#72 Scope 2).
 *
 * The display decides, not the caller: a Demolition display is a claim about what comes down, and a
 * Proposed display with no Option chosen has no container to put anything in.
 */
export function pasteDestinationOf(project: Project, view: PlanView): PasteDestination {
  const display = viewRenovationDisplay(view)
  const optionId = viewDesignOptionId(view)
  if (display === 'proposed' || display === 'combined') {
    const option = designOptionsOf(project).find((entry) => entry.id === optionId)
    if (option === undefined) return { kind: 'blocked', reason: PASTE_BLOCKED }
    return { kind: 'option', designOptionId: option.id, designOptionName: option.name }
  }
  if (display === 'demolition') return { kind: 'blocked', reason: PASTE_BLOCKED }
  return designOptionsOf(project).length === 0 ? { kind: 'existing' } : { kind: 'correct-existing' }
}

/**
 * The review of pasting `copySet` into `project` as the saved view `view` draws it.
 *
 * `copySet` came from another Project, so nothing in it is looked up here by identity: the only
 * source IDs that matter are the ones the person has not yet mapped, and the only destination
 * lookup is the name match the row suggests.
 */
export function pasteReviewOf(project: Project, view: PlanView, copySet: CopySet): PasteReview {
  const destination = pasteDestinationOf(project, view)
  const copiedWalls = new Set<EntityId>(copySet.entities.walls.map((wall) => wall.id))

  // An Opening whose Wall stayed in the other Project has nothing to be cut into here. It is not
  // pasted, and the review says so under the heading the person will read before pressing anything.
  const stranded = copySet.entities.openings.filter((opening) => !copiedWalls.has(opening.hostWallId))
  const openings = copySet.entities.openings.filter((opening) => copiedWalls.has(opening.hostWallId))

  // A Room edge whose Wall stayed behind is dropped and the edge is left unattached — the outline
  // still stands, it just stops following a face that is not here (#72 §5).
  const detached: PasteLoss[] = copySet.entities.rooms.flatMap((room) =>
    room.wallFaceRefs
      .filter((reference) => !copiedWalls.has(reference.wallId))
      .map((reference) => ({ ref: roomEdgeName(room, reference.segmentId), reason: PASTE_DETACH_FACE })),
  )

  // Everything that actually lands, in one list: the count the transaction label prints and the
  // per-layer counts the rows print are both read off it, so the two cannot drift apart.
  const pasted = [
    ...copySet.entities.walls,
    ...copySet.entities.wallJunctions,
    ...openings,
    ...copySet.entities.rooms,
    ...copySet.entities.placedItems,
  ]

  const counts = new Map<EntityId, number>()
  let unlayeredCount = 0
  // A Wall Junction carries no layer of its own — it is a claim between two Walls, filed under
  // theirs — so the rows count the four kinds that are filed anywhere.
  for (const entity of [...copySet.entities.walls, ...openings, ...copySet.entities.rooms, ...copySet.entities.placedItems]) {
    const layerId = entity.drawingLayerId
    if (layerId === undefined || layerId === null) unlayeredCount += 1
    else counts.set(layerId, (counts.get(layerId) ?? 0) + 1)
  }

  const layers = project.drawingLayers ?? []
  const rows: PasteLayerRow[] = copySet.layers
    .filter((layer) => (counts.get(layer.id) ?? 0) > 0)
    .map((layer) => {
      const suggested = layers.find((candidate) => nameKey(candidate.name) === nameKey(layer.name))
      return {
        sourceLayerId: layer.id,
        sourceLayerName: layer.name,
        sourceLayerColor: layer.color,
        itemCount: counts.get(layer.id) ?? 0,
        suggestedLayerId: suggested?.id ?? null,
        suggestedLayerName: suggested?.name ?? null,
      }
    })

  return {
    kind: 'paste-from-project',
    sourceProjectId: copySet.sourceProjectId,
    sourceProjectName: copySet.sourceProjectName,
    entityCount: pasted.length,
    unlayeredCount,
    rows,
    notComingAcross: stranded.map((opening) => ({ ref: opening.label, reason: PASTE_LOSS_HOST })),
    detached,
    destination,
  }
}
