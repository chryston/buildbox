/**
 * What `Copy` takes out of a Project (#72 §4).
 *
 * A Copy Set is a **by-value snapshot**: the records as they stood in the source Project at the
 * moment of the copy, in the shape a container holds them. The clipboard lives in the UI session
 * layer and outlives a Project switch, so the snapshot is cloned on the way out — a copy that
 * pointed at the source's own nodes would quietly follow every later edit of the Project it came
 * from, and the paste review would describe a drawing the person has since changed.
 *
 * What is copied is what the **active view draws**: the effective model of the view's Design
 * Option, so Proposed work comes across as itself and Existing work comes across as work the
 * destination will own outright. Entities in Demolition state are the one thing drawn that does
 * not come — a demolition is a claim about a record the destination does not have — and they are
 * counted so the notice can say so rather than be silent.
 *
 * Nothing here creates a Transaction, mints an ID or reads a clock. The paste side (#72 §5) is
 * what allocates; this half only reads.
 */
import { effectiveModel } from '../derive'
import type { EffectiveEntity } from '../derive'
import type { DrawingLayer, EntityId, ItemDesign, PlanView, Project, ProposedModel, WallJunction } from '../domain'
import { viewDesignOptionId } from '../domain'

/**
 * The extension point of #80 and #81: Comments and Annotations travel the same way a Wall does,
 * and the clipboard format is written once. Until those Issues land the slot stays empty, which
 * is why it is a type a caller cannot put anything in rather than an `unknown` someone will
 * mis-fill.
 */
export interface CopySet {
  readonly sourceProjectId: EntityId
  readonly sourceProjectName: string
  /**
   * The copied records, in the five collections one container holds — the same shape a Design
   * Option's proposed model and the Existing Model use, because that is where they land.
   */
  readonly entities: ProposedModel
  /** Every Item Design a copied Placed Item names, once each, with its cabinet construction. */
  readonly itemDesigns: readonly ItemDesign[]
  /** The Drawing Layer records the copied entities file under, in the source's own order. */
  readonly layers: readonly DrawingLayer[]
  /** The copied entities that were in Demolition state and so came across as nothing. */
  readonly demolishedCount: number
  readonly notes: readonly []
}

/** The Walls one Junction claims: its ends, and the Wall it is hosted on when it has one. */
const junctionWalls = (junction: WallJunction): EntityId[] => [
  ...junction.ends.map((end) => end.wallId),
  ...(junction.host === undefined ? [] : [junction.host.wallId]),
]

/**
 * The Copy Set of `selection`, as the saved view `view` draws it.
 *
 * An ID the view does not draw — a record on another Floor, one the Option demolished, one the
 * selection carried over from a view the person has left — is skipped rather than refused: the
 * selection is UI state and can be older than the Project under it.
 */
export function captureCopySet(project: Project, view: PlanView, selection: readonly EntityId[]): CopySet {
  const chosen = new Set<EntityId>(selection)
  const model = effectiveModel(project, view.floorId, viewDesignOptionId(view))

  const walls = model.walls.filter((row) => chosen.has(row.entity.id))
  const openings = model.openings.filter((row) => chosen.has(row.entity.id))
  const rooms = model.rooms.filter((row) => chosen.has(row.entity.id))
  const placedItems = model.placedItems.filter((row) => chosen.has(row.entity.id))

  /** The Walls of this selection that come across — the only ones a join may stand on. */
  const copiedWallIds = new Set<EntityId>(
    walls.filter((row) => row.renovationState !== 'demolition').map((row) => row.entity.id),
  )
  // A join comes along only when every Wall it names comes along: a Junction with a free end is
  // not a record, and the paste side has nothing to attach it to (#72 §5). It is carried whether or
  // not it was itself selected, because the join is what makes two Walls one run and leaving it
  // behind would paste a run that falls apart at the seam.
  const junctions = model.wallJunctions.filter(
    (row) => row.renovationState !== 'demolition' && junctionWalls(row.entity).every((wallId) => copiedWallIds.has(wallId)),
  )

  const kept = <T>(rows: readonly EffectiveEntity<T>[]): T[] =>
    rows.filter((row) => row.renovationState !== 'demolition').map((row) => row.entity)

  const entities: ProposedModel = {
    walls: structuredClone(kept(walls)),
    wallJunctions: structuredClone(junctions.map((row) => row.entity)),
    openings: structuredClone(kept(openings)),
    rooms: structuredClone(kept(rooms)),
    placedItems: structuredClone(kept(placedItems)),
  }

  const designIds = new Set<EntityId>(entities.placedItems.map((item) => item.itemDesignId))
  const itemDesigns = structuredClone(project.itemDesigns.filter((design) => designIds.has(design.id)))

  // The Project's own layer order, not the order the entities were met in: the mapping dialog lists
  // its rows in the order the source's Layers list shows them.
  const usedLayerIds = new Set<EntityId>(
    [...entities.walls, ...entities.openings, ...entities.rooms, ...entities.placedItems]
      .map((entity) => entity.drawingLayerId)
      .filter((layerId): layerId is EntityId => layerId !== undefined && layerId !== null),
  )
  const layers = structuredClone((project.drawingLayers ?? []).filter((layer) => usedLayerIds.has(layer.id)))

  // What the person selected that comes across as nothing. A Junction the Option took down is
  // counted only when it was selected: one dropped because its Walls stayed behind was never in the
  // selection, and calling it a demolition would tell the person their own list held it.
  const demolishedCount =
    [...walls, ...openings, ...rooms, ...placedItems].filter((row) => row.renovationState === 'demolition').length +
    model.wallJunctions.filter((row) => chosen.has(row.entity.id) && row.renovationState === 'demolition').length

  return {
    sourceProjectId: project.id,
    sourceProjectName: project.meta.name,
    entities,
    itemDesigns,
    layers,
    demolishedCount,
    notes: [],
  }
}

/** How many records a Copy Set carries — the `<n>` of `Paste <n> entities from …` (#72 §5). */
export const copySetSize = (copySet: CopySet): number =>
  copySet.entities.walls.length +
  copySet.entities.wallJunctions.length +
  copySet.entities.openings.length +
  copySet.entities.rooms.length +
  copySet.entities.placedItems.length
