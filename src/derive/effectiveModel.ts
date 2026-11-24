/**
 * The effective model: what one Floor holds under one Design Option, and what to call it (#69 §5).
 *
 * A Design Option owns a delta, so the model a Floor shows is arithmetic over two containers — the
 * shared Existing Model minus the Option's demolition records, plus the Option's own entities. Three
 * rules decide everything here:
 *
 * - **Existing** is an Existing Model entity the Option leaves alone, **Demolition** one it names in
 *   `demolishedIds`, and **Proposed** one of the Option's own. The State is derived from ownership
 *   plus the active Option and is never tagged by the user (#18), which is why nothing in the domain
 *   carries it.
 * - Faces, joins, usable Opening intervals, Room overlap, membership, warnings and quantities are
 *   computed on the **standing** set — everything not demolished. Demolished entities come back for
 *   display and selection only, so a Wall the Option knocks out is still on screen and still
 *   clickable, and still not something a Room can stand on.
 * - `optionId` of `null` is the Existing Model alone: no Option is in force, so the standing set is
 *   exactly what the Project already holds (#69 §1).
 *
 * Order is Existing-Model order, then the Option's, so a re-derive never reorders what is on screen
 * and a Floor with no Option is the same array `project.existingModel` already holds.
 */
import { beamsOf, designOptionsOf, servicesOf, type Beam, type EntityId, type Opening, type PlacedItem, type Project, type Room, type Service, type Skirting, type Wall, type WallJunction, skirtingOf } from '../domain'
import type { RenovationState } from './quantities/scope'

/** One entity of the effective model, and the Renovation State it is seen in. */
export interface EffectiveEntity<T> {
  readonly entity: T
  readonly renovationState: RenovationState
}

/** Everything one Floor holds under one Design Option, in the six collections of a container. */
export interface EffectiveModel {
  /** The Option whose delta was read, or `null` for the Existing Model alone. */
  readonly optionId: EntityId | null
  readonly walls: readonly EffectiveEntity<Wall>[]
  readonly wallJunctions: readonly EffectiveEntity<WallJunction>[]
  readonly openings: readonly EffectiveEntity<Opening>[]
  readonly rooms: readonly EffectiveEntity<Room>[]
  readonly placedItems: readonly EffectiveEntity<PlacedItem>[]
  /** Every Beam of the Floor (#77 §4), an ordinary Building Element under the same three rules. */
  readonly beams: readonly EffectiveEntity<Beam>[]
  /** Every Skirting of the Floor (#78 §4), under the same three rules. */
  readonly skirting: readonly EffectiveEntity<Skirting>[]
  /** Every Service of the Floor (#79 §4), under the same three rules. */
  readonly services: readonly EffectiveEntity<Service>[]
  /** The entities that are not Demolition: what every measurement, warning and count runs on. */
  readonly standingWalls: readonly Wall[]
  readonly standingWallJunctions: readonly WallJunction[]
  readonly standingOpenings: readonly Opening[]
  readonly standingRooms: readonly Room[]
  readonly standingPlacedItems: readonly PlacedItem[]
  readonly standingBeams: readonly Beam[]
  readonly standingSkirting: readonly Skirting[]
  readonly standingServices: readonly Service[]
}

/** Every collection has an `id` and the `Floor` it belongs to; that is all the funnel needs to know. */
interface Entity {
  readonly id: EntityId
  readonly floorId: EntityId
}

/** The entities of one collection that belong to `floorId`; `null` is every Floor at once. */
function onFloor<T extends Entity>(items: readonly T[], floorId: EntityId | null): readonly T[] {
  return floorId === null ? items : items.filter((item) => item.floorId === floorId)
}

/** Existing entities in stored order, then the Option's, each carrying the State its owner gives it. */
function tag<T extends Entity>(
  existing: readonly T[],
  demolished: ReadonlySet<EntityId>,
  proposed: readonly T[],
): EffectiveEntity<T>[] {
  const rows: EffectiveEntity<T>[] = []
  for (const entity of existing) rows.push({ entity, renovationState: demolished.has(entity.id) ? 'demolition' : 'existing' })
  for (const entity of proposed) rows.push({ entity, renovationState: 'proposed' })
  return rows
}

/** What is left once everything the Option demolishes is set aside. */
function standing<T>(rows: readonly EffectiveEntity<T>[]): T[] {
  const kept: T[] = []
  for (const row of rows) if (row.renovationState !== 'demolition') kept.push(row.entity)
  return kept
}

/**
 * A Junction is nothing but a claim that two Wall ends meet, so the Option that takes one of those
 * Walls down takes the claim down with it — the join it carries in its own records is what stands
 * in its place. Junctions are never listed as dependants of a demolition the way an Opening is,
 * because there is nothing to detach: the join simply stops meaning anything.
 */
function standingJunctions(rows: readonly EffectiveEntity<WallJunction>[], demolished: ReadonlySet<EntityId>): WallJunction[] {
  return standing(rows).filter(
    (junction) =>
      !(junction.host !== undefined && demolished.has(junction.host.wallId)) &&
      !junction.ends.some((end) => demolished.has(end.wallId)),
  )
}

/**
 * The effective model of one Floor under one Design Option.
 *
 * `floorId` of `null` is every Floor at once, which is what a project-wide lookup — a Wall table
 * that spans Floors, the Room that references this face — asks for; a Floor's own derive pass names
 * the Floor it draws. `optionId` of `null`, or any Option in a build without the flag, is the
 * Existing Model alone.
 */
export function effectiveModel(
  project: Project,
  floorId: EntityId | null,
  optionId: EntityId | null,
): EffectiveModel {
  const option = optionId !== null ? designOptionsOf(project).find((candidate) => candidate.id === optionId) ?? null : null
  const demolished = new Set<EntityId>(option?.demolishedIds ?? [])
  const proposed = option?.proposed
  const walls = tag(onFloor(project.existingModel.walls, floorId), demolished, proposed === undefined ? [] : onFloor(proposed.walls, floorId))
  const wallJunctions = tag(
    onFloor(project.existingModel.wallJunctions, floorId),
    demolished,
    proposed === undefined ? [] : onFloor(proposed.wallJunctions, floorId),
  )
  const openings = tag(onFloor(project.existingModel.openings, floorId), demolished, proposed === undefined ? [] : onFloor(proposed.openings, floorId))
  const rooms = tag(onFloor(project.existingModel.rooms, floorId), demolished, proposed === undefined ? [] : onFloor(proposed.rooms, floorId))
  const placedItems = tag(
    onFloor(project.existingModel.placedItems, floorId),
    demolished,
    proposed === undefined ? [] : onFloor(proposed.placedItems, floorId),
  )
  const beams = tag(onFloor(beamsOf(project.existingModel), floorId), demolished, proposed === undefined ? [] : onFloor(beamsOf(proposed), floorId))
  const skirting = tag(onFloor(skirtingOf(project.existingModel), floorId), demolished, proposed === undefined ? [] : onFloor(skirtingOf(proposed), floorId))
  const services = tag(onFloor(servicesOf(project.existingModel), floorId), demolished, proposed === undefined ? [] : onFloor(servicesOf(proposed), floorId))
  return {
    optionId: option?.id ?? null,
    walls,
    wallJunctions,
    openings,
    rooms,
    placedItems,
    beams,
    skirting,
    services,
    standingWalls: standing(walls),
    standingWallJunctions: standingJunctions(wallJunctions, demolished),
    standingOpenings: standing(openings),
    standingRooms: standing(rooms),
    standingPlacedItems: standing(placedItems),
    standingBeams: standing(beams),
    standingSkirting: standing(skirting),
    standingServices: standing(services),
  }
}

/**
 * The name to write in a Design Option column, or `''` for the Existing Model alone.
 *
 * Both option columns are empty for the Existing Model (export contract §7), and an Option the
 * Project does not have is the Existing Model as far as a table is concerned — a row naming an
 * Option nobody can see would be read as a data error rather than as a scope that went stale.
 */
export function designOptionName(project: Project, optionId: EntityId | null): string {
  if (optionId === null) return ''
  return designOptionsOf(project).find((candidate) => candidate.id === optionId)?.name ?? ''
}
