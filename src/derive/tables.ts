/**
 * `tables(scope)`: the Rooms, Walls, Openings, Placed Items and Warnings List rows (#68).
 *
 * These are the element tables of the export contract §7 — one row per element, never a summary
 * row, never a coordinate — plus the Warnings List of §5. They are built from the same derive
 * stages the screen and the drawings already use, which is the only way a CSV and the Plan View
 * can be trusted to say the same thing about the same revision:
 *
 *   - Rooms come from {@link deriveRooms}, the same evaluation the Rooms panel and the crossing
 *     warning read, so `area_m2` and `perimeter_mm` are the analytic measures the inspector shows;
 *   - Walls come from {@link deriveWalls}, so `length_mm` is the reference-line length the Plan
 *     View measures — arc length on a curve;
 *   - Openings are measured along their host's reference line by the same `openingSpan` the
 *     jamb lines are drawn with;
 *   - Placed Items come from {@link effectiveFloor} and the membership map of {@link deriveRooms},
 *     which is the function the inspector's `in Kitchen` line uses. Containment is never
 *     recomputed here (#68 Notes);
 *   - warnings come from {@link deriveWarnings}, the strip's own stage, for every Floor in scope.
 *
 * **What the rows are not.** No row holds an X, a Y, a path vertex or a translation: the tables
 * are for a builder, a supplier and a spreadsheet, and geometry interchange is `#87` (export
 * contract §7). No row is summed, averaged or counted into a total — a reader adds a column in a
 * spreadsheet when they want one, and a total baked in here would be a number that can disagree
 * with the rows above it.
 *
 * **Scope.** Element tables honour the whole scope: Floor, Design Option, Renovation State,
 * Drawing Layer. The Warnings List is scoped by Floor and Design Option *only* and ignores layers
 * and Renovation States entirely (export contract §3) — a warning is a statement about the model,
 * not about a layer of it, and hiding a warning by deselecting a layer would be hiding a defect.
 * Hidden, non-selectable and acknowledged content is always included (§8): the tables say what the
 * building has, not what the screen currently shows.
 *
 * **The one sentence this module cannot build.** `message` is "exactly the in-app copy" (#68
 * Scope 3), and that copy lives in `ui/strings`, which `derive` may not import. So the caller hands
 * over the sentences it has already rendered: {@link warningMessages} turns a scope's warnings into
 * a map with the builder `app` supplies, and {@link TableDeps.warningMessages} is that map. A row
 * that built its own English here would be a second copy of that sentence, and the strip and the
 * CSV would drift the first time one of them was reworded.
 */
import { beamLabel, beamTop, designHeight, drawingLayerById, entityLayerId, openingHeight, openingSpan, type EntityId, type HingeSide, type OpeningSwing, type Project, type Wall, type WallClassification } from '../domain'
import { arcFromThrough, refLength } from '../geometry'
import { compareCodePoints, stableSort } from '../lib'
import { layerMatches, type OptionColumns, type QuantityScope, type RenovationState } from './quantities/scope'
import { derivePlacement, effectiveFloor, placementLabels, type DerivedPlacement } from './effective'
import { designOptionName, effectiveModel, type EffectiveModel } from './effectiveModel'
import { derivedRoomsOf, deriveRooms, roomMembershipOf, type FloorRooms, type RoomMembership } from './rooms'
import { deriveWalls, type FloorWalls } from './walls'
import { deriveBeams, type FloorBeams } from './beams'
import { deriveWarnings } from './warnings/engine'
import type { WarningParams, WarningSubjectKind } from './warnings/types'

/**
 * The `drawing_layer` every element carries until `#18` gives a Project any Layer (#68 Scope 2).
 *
 * It is a data value of contract v1.0, in the same sense as an enum code — the word a reader
 * filters a spreadsheet on — and it is never empty, because an empty cell would read as "this row
 * has no layer column filled in yet" rather than "this row is unlayered".
 */
export const UNLAYERED_LAYER = 'Unlayered'

/**
 * The eight columns every element table opens with and the one it closes with (#68 Scope 1).
 *
 * A row type is one flat object literal rather than an intersection of two, because `writeCsv`
 * takes a `CsvRow` and TypeScript grants an implicit index signature only to a type spelled as a
 * single literal — the same reason `ItemListRow` is written out in full.
 */
export type ElementColumns = {
  readonly stableId: string
  readonly floorId: string
  readonly floor: string
  readonly designOptionId: string
  readonly designOption: string
  readonly renovationState: RenovationState
  readonly drawingLayerId: string
  readonly drawingLayer: string
  readonly predecessorIds: readonly string[]
}

/** One Rooms row (export contract §7). */
export type RoomsRow = {
  readonly stableId: string
  readonly floorId: string
  readonly floor: string
  readonly designOptionId: string
  readonly designOption: string
  readonly renovationState: RenovationState
  readonly drawingLayerId: string
  readonly drawingLayer: string
  readonly predecessorIds: readonly string[]
  readonly name: string
  readonly areaM2: number
  readonly perimeterMm: number
}

/** One Walls row. `radiusMm` is `null` — an empty cell — for every straight Wall. */
export type WallsRow = {
  readonly stableId: string
  readonly floorId: string
  readonly floor: string
  readonly designOptionId: string
  readonly designOption: string
  readonly renovationState: RenovationState
  readonly drawingLayerId: string
  readonly drawingLayer: string
  readonly predecessorIds: readonly string[]
  readonly classification: WallClassification | ''
  readonly constructionLabel: string
  readonly shape: 'straight' | 'arc'
  readonly lengthMm: number
  readonly radiusMm: number | null
  readonly thicknessMm: number
  readonly justification: 'left' | 'centre' | 'right'
  readonly bottomMm: number
  readonly topMm: number
  readonly heightMm: number
}

/** One Openings row. `hingeSide` is empty for a Window, a removed section and a sliding door. */
export type OpeningsRow = {
  readonly stableId: string
  readonly floorId: string
  readonly floor: string
  readonly designOptionId: string
  readonly designOption: string
  readonly renovationState: RenovationState
  readonly drawingLayerId: string
  readonly drawingLayer: string
  readonly predecessorIds: readonly string[]
  readonly kind: 'door' | 'window' | 'removed_section'
  readonly label: string
  readonly hostWallId: string
  readonly startMm: number
  readonly endMm: number
  readonly widthMm: number
  readonly sillMm: number
  readonly headMm: number
  readonly heightMm: number
  readonly hingeSide: HingeSide | ''
  readonly swing: OpeningSwing | ''
}

/** How a Placed Item sits in the Rooms of its Floor — the membership relation, in contract words. */
export type RoomRelation = RoomMembership['relation']

/** One Placed Items row. `roomId` and `room` are filled only when `roomRelation` is `inside`. */
export type PlacedItemsRow = {
  readonly stableId: string
  readonly floorId: string
  readonly floor: string
  readonly designOptionId: string
  readonly designOption: string
  readonly renovationState: RenovationState
  readonly drawingLayerId: string
  readonly drawingLayer: string
  readonly predecessorIds: readonly string[]
  readonly label: string
  readonly itemDesignId: string
  readonly itemDesign: string
  readonly rotationDeg: number
  readonly bottomMm: number
  readonly topMm: number
  readonly roomId: string
  readonly room: string
  readonly roomRelation: RoomRelation
}

/** The Warnings List's word for a subject: `placed_item`, because a CSV column is snake_case. */
export type WarningSubjectCode = 'wall' | 'opening' | 'room' | 'placed_item'

/** One Warnings List row (export contract §5). */
export type WarningsRow = {
  readonly status: 'unacknowledged' | 'acknowledged'
  readonly floorId: string
  readonly floor: string
  readonly designOptionId: string
  readonly designOption: string
  readonly warningType: string
  readonly subjectType: WarningSubjectCode
  readonly subjectId: string
  /** Empty for a warning with one subject. */
  readonly otherType: WarningSubjectCode | ''
  readonly otherId: string
  /** `null` — an empty cell — when the producer measured an area or a percentage instead. */
  readonly measuredMm: number | null
  readonly message: string
  /** The user's note, on an `acknowledged` row and on a reopened one; empty for an open warning. */
  readonly acknowledgementNote: string
}

/**
 * One Beams row (#77 §5). `depthMm` is the word the interface uses for the stored `height`, and
 * `topMm` is `underside_mm + depth_mm` — both derived, never stored, so a row can never disagree
 * with the faces the Plan View draws.
 */
export type BeamsRow = {
  readonly stableId: string
  readonly floorId: string
  readonly floor: string
  readonly designOptionId: string
  readonly designOption: string
  readonly renovationState: RenovationState
  readonly drawingLayerId: string
  readonly drawingLayer: string
  readonly predecessorIds: readonly string[]
  readonly label: string
  readonly lengthMm: number
  readonly widthMm: number
  readonly depthMm: number
  readonly undersideMm: number
  readonly topMm: number
}

/** A scope's six tables, each in the order its file is written in. */
export interface Tables {
  readonly rooms: readonly RoomsRow[]
  readonly walls: readonly WallsRow[]
  readonly openings: readonly OpeningsRow[]
  readonly beams: readonly BeamsRow[]
  readonly placedItems: readonly PlacedItemsRow[]
  readonly warnings: readonly WarningsRow[]
}

/**
 * The copy this module is not allowed to own.
 *
 * The Warnings List's `message` column is the strip's sentence byte for byte (#68 criterion 5), and
 * the sentence lives in `ui/strings`, three layers away from here. It arrives as a finished map —
 * `warningMessages` builds it from `ui/strings`' `warningSentence` — rather than as the function
 * itself, because the rows are written in a Worker that the copy table cannot be posted to: a
 * record of strings crosses `postMessage`, a closure does not. `null` asks for no sentences at all,
 * which is all a row count needs; a key missing from a map that *was* given is a bug, and says so.
 */
export interface TableDeps {
  readonly warningMessages: Readonly<Record<string, string>> | null
}

/**
 * The two Drawing Layer columns of one entity.
 *
 * Kept apart from {@link ElementColumns} because the scope's filter reads the same pair: the
 * `drawing_layer_id` a row publishes is the one the Layers control tested it against, so a CSV
 * that says `Structure` can never have been written by a scope that left Structure out.
 */
type LayerColumns = Pick<ElementColumns, 'drawingLayerId' | 'drawingLayer'>

/** What an entity on no Drawing Layer writes: the word, never an empty cell (#68 Scope 2). */
const UNLAYERED_COLUMNS: LayerColumns = { drawingLayerId: '', drawingLayer: UNLAYERED_LAYER }

/**
 * The Drawing Layer of every entity one Option's model holds, keyed by id (#73 §4).
 *
 * A stored Layer is named by its Project record. A `drawing_layer_id` that names no Layer — one
 * deleted from under the entity, or read from a file written by a newer editor — is Unlayered, the
 * same reading {@link layerRows} gives it: an entity is never on two Layers at once and never on a
 * Layer that does not exist.
 */
function layerColumnsOf(project: Project, model: EffectiveModel): ReadonlyMap<EntityId, LayerColumns> {
  const layers = new Map<EntityId, LayerColumns>()
  for (const row of [...model.rooms, ...model.walls, ...model.openings, ...model.beams, ...model.placedItems]) {
    const layer = drawingLayerById(project, entityLayerId(row.entity))
    layers.set(row.entity.id, layer === null ? UNLAYERED_COLUMNS : { drawingLayerId: layer.id, drawingLayer: layer.name })
  }
  return layers
}

/**
 * The columns every element table shares: the two Option columns, the Floor, the Renovation State
 * the Option gives the entity, and the Drawing Layer it stands on.
 *
 * `predecessor_ids` is the stated S7 default — the column is published in v1.0 so a later issue can
 * fill it without moving one, which would be a major version.
 */
function elementColumns(
  option: OptionColumns,
  floorId: EntityId,
  floor: string,
  renovationState: RenovationState,
  layer: LayerColumns,
): ElementColumns {
  return {
    ...option,
    stableId: '',
    floorId,
    floor,
    renovationState,
    ...layer,
    predecessorIds: [],
  }
}

/** The Rooms of one Floor: name, analytic area at six decimals, analytic perimeter at three. */
function roomsForFloor(
  option: OptionColumns,
  floorId: EntityId,
  floor: string,
  derived: FloorRooms,
  model: EffectiveModel,
  layers: ReadonlyMap<EntityId, LayerColumns>,
): RoomsRow[] {
  const measured = new Map(derived.rooms.map((room) => [room.id, room]))
  // A Room the Option takes down is not in the derive pass, which measures what stands: its area is
  // its own outline, which is the area it had before it was marked.
  for (const room of derivedRoomsOf(model.rooms.filter((each) => !measured.has(each.entity.id)).map((each) => each.entity))) {
    measured.set(room.id, room)
  }
  return model.rooms.flatMap(({ entity, renovationState }) => {
    const room = measured.get(entity.id)
    if (room === undefined) return []
    return [{
      ...elementColumns(option, floorId, floor, renovationState, layers.get(room.id) ?? UNLAYERED_COLUMNS),
      stableId: room.id,
      name: room.name,
      areaM2: room.areaM2,
      perimeterMm: room.perimeterMm,
    }]
  })
}

/**
 * The Walls of one Floor.
 *
 * `lengthMm` is the derived reference-line length, so an arc's is its arc length; `radiusMm` is
 * the radius that curve was solved from, and `null` for a straight Wall, which has none.
 * `topMm` is `bottomMm + heightMm` written out rather than derived by a spreadsheet, because a
 * reader sorting a split-level Floor by height should not have to know which two columns add up.
 */
function wallsForFloor(
  option: OptionColumns,
  floorId: EntityId,
  floor: string,
  model: EffectiveModel,
  derived: FloorWalls,
  layers: ReadonlyMap<EntityId, LayerColumns>,
): WallsRow[] {
  const rows: WallsRow[] = []
  for (const { entity: source, renovationState } of model.walls) {
    const line = source.line
    // The derive pass measures what stands, so a Wall the Option takes down is not in it: its length
    // is its own reference line, untrimmed, because its neighbours' junctions were tidied without it.
    const lengthMm = derived.byId.get(source.id)?.length ?? refLength(line)
    rows.push({
      ...elementColumns(option, floorId, floor, renovationState, layers.get(source.id) ?? UNLAYERED_COLUMNS),
      stableId: source.id,
      classification: source.classification ?? '',
      constructionLabel: source.constructionLabel ?? '',
      shape: line.kind === 'arc' ? 'arc' : 'straight',
      lengthMm,
      radiusMm: line.kind === 'arc' ? arcFromThrough(line.start, line.through, line.end)?.radius ?? null : null,
      thicknessMm: source.thickness,
      justification: source.justification,
      bottomMm: source.baseElevation,
      topMm: source.baseElevation + source.height,
      heightMm: source.height,
    })
  }
  return rows
}

/**
 * The Openings of one Floor, measured along their host's reference line.
 *
 * `endMm` is the far jamb's distance along that line — arc length on a curved Wall, so a 900 door
 * on a curve ends 907.772 rather than 900 — while `widthMm` stays the chord the joiner cuts. An
 * Opening whose host is no longer in scope is dropped rather than written with an empty host: a
 * row that cannot say which Wall it is in would be read as a data error.
 */
function openingsForFloor(
  option: OptionColumns,
  floorId: EntityId,
  floor: string,
  model: EffectiveModel,
  layers: ReadonlyMap<EntityId, LayerColumns>,
): OpeningsRow[] {
  const stored = new Map<EntityId, Wall>(model.walls.map(({ entity }) => [entity.id, entity]))
  const rows: OpeningsRow[] = []
  for (const { entity: opening, renovationState } of model.openings) {
    // An Opening whose host is not in the model at all is dropped rather than written with an empty
    // host. A host the Option takes down is still its host: the Opening comes down with it.
    const line = stored.get(opening.hostWallId)?.line
    if (line === undefined) continue
    rows.push({
      ...elementColumns(option, floorId, floor, renovationState, layers.get(opening.id) ?? UNLAYERED_COLUMNS),
      stableId: opening.id,
      kind: opening.kind,
      label: opening.label,
      hostWallId: opening.hostWallId,
      startMm: opening.start,
      endMm: openingSpan(line, opening.start, opening.width).end,
      widthMm: opening.width,
      sillMm: opening.sill,
      headMm: opening.head,
      heightMm: openingHeight(opening),
      hingeSide: opening.kind === 'door' && opening.swing !== undefined && opening.swing !== 'sliding' ? opening.hingeSide ?? '' : '',
      swing: opening.kind === 'door' ? opening.swing ?? '' : '',
    })
  }
  return rows
}

/**
 * The Beams of one Floor (#77 §5).
 *
 * `lengthMm` is measured along the reference line by the same `deriveBeams` the Plan View draws
 * with, so the number in the file and the outline on the screen are one answer. `depthMm` and
 * `topMm` are the stored Depth and the derived Top — the interface's words for the two fields a
 * Beam is edited by, which is what makes the file checkable against a drawing.
 */
function beamsForFloor(
  option: OptionColumns,
  floorId: EntityId,
  floor: string,
  model: EffectiveModel,
  derived: FloorBeams,
  layers: ReadonlyMap<EntityId, LayerColumns>,
): BeamsRow[] {
  const rows: BeamsRow[] = []
  for (const { entity: beam, renovationState } of model.beams) {
    const length = derived.byId.get(beam.id)?.length
    if (length === undefined) continue
    rows.push({
      ...elementColumns(option, floorId, floor, renovationState, layers.get(beam.id) ?? UNLAYERED_COLUMNS),
      stableId: beam.id,
      predecessorIds: beam.predecessorIds ?? [],
      label: beamLabel(beam),
      lengthMm: length,
      widthMm: beam.width,
      depthMm: beam.height,
      undersideMm: beam.underside,
      topMm: beamTop(beam),
    })
  }
  return rows
}

/**
 * The Placed Items of one Floor, and how each sits in a Room.
 *
 * `label` is the `Base 600 #2` the strip uses ({@link placementLabels}), so a warning in the
 * Warnings List and a row in this table name the same item with the same words.
 *
 * `roomRelation` is the membership the inspector shows. An item that is inside one Room and
 * crosses another — two Rooms that overlap, which an odd-shaped Floor allows — is `inside` the
 * first of them in Room order, because the row has one Room column and `inside` is the relation a
 * reader can act on; the crossing is in the Warnings List, which is where a warning belongs.
 */
function placedItemsForFloor(
  option: OptionColumns,
  floorId: EntityId,
  floor: string,
  project: Project,
  model: EffectiveModel,
  placements: readonly DerivedPlacement[],
  derived: FloorRooms,
  layers: ReadonlyMap<EntityId, LayerColumns>,
): PlacedItemsRow[] {
  const labels = placementLabels(placements)
  const standing = new Map(placements.map((each) => [each.id, each]))
  const designs = new Map(project.itemDesigns.map((design) => [design.id, design]))
  const { membership } = derived
  const rows: PlacedItemsRow[] = []
  for (const { entity: placed, renovationState } of model.placedItems) {
    const design = designs.get(placed.itemDesignId)
    if (design === undefined) continue
    // A placement the Option takes down is not in the derive pass, which measures what stands; the
    // same transform answers for it, and its Room is the one its footprint stands in now.
    const placement = standing.get(placed.id) ?? derivePlacement(design, placed)
    const memberships = membership.get(placement.id) ?? roomMembershipOf(placement.worldPath, derived.rooms)
    const inside = memberships.find((each) => each.relation === 'inside')
    const relation: RoomRelation =
      inside !== undefined ? 'inside' : memberships.some((each) => each.relation === 'crosses') ? 'crosses' : 'outside'
    rows.push({
      ...elementColumns(option, floorId, floor, renovationState, layers.get(placement.id) ?? UNLAYERED_COLUMNS),
      stableId: placement.id,
      label: labels.get(placement.id) ?? placement.label,
      itemDesignId: placement.designId,
      itemDesign: placement.label,
      rotationDeg: ((placement.rotationDeg % 360) + 360) % 360,
      bottomMm: placed.baseElevation,
      topMm: placed.baseElevation + designHeight(design),
      roomId: inside?.roomId ?? '',
      room: inside?.roomName ?? '',
      roomRelation: relation,
    })
  }
  return rows
}

/** `placedItem` in the engine, `placed_item` in the file: the same code, spelled for a column. */
const subjectCode = (kind: WarningSubjectKind): WarningSubjectCode => (kind === 'placedItem' ? 'placed_item' : kind)

/**
 * The Warnings List of one Floor under one Design Option.
 *
 * `status` collapses the engine's three to the contract's two: a reopened warning is one the
 * reader has to look at again, so it is `unacknowledged`, like an open one. Its note is *not*
 * written — the column is the note of the rows that are settled, and a reopened row's note is
 * still on the strip, attached to a signature that no longer holds.
 */
function warningsForFloor(
  option: OptionColumns,
  optionId: EntityId | null,
  floorId: EntityId,
  floor: string,
  project: Project,
  deps: TableDeps,
): WarningsRow[] {
  return deriveWarnings(project, floorId, optionId).warnings.flatMap((warning) => {
    const subject = warning.subjects[0]
    // A warning always has a primary subject; one without could not name the thing it is about,
    // so it has no row rather than a row whose `subject_id` is empty.
    if (subject === undefined) return []
    const other = warning.subjects[1]
    return [
      {
        ...option,
        status: warning.status === 'acknowledged' ? 'acknowledged' : 'unacknowledged',
        floorId,
        floor,
        warningType: warning.type,
        subjectType: subjectCode(subject.type),
        subjectId: subject.id,
        otherType: other === undefined ? '' : subjectCode(other.type),
        otherId: other?.id ?? '',
        measuredMm: warning.measured.mm ?? null,
        message: sentence(deps.warningMessages, warning.key),
        // #66 §3: a reopened warning keeps its note visible beside `Reopened after change`, so the
        // row carries it too — the note belongs to the decision, not to the status.
        acknowledgementNote: warning.acknowledgement?.note ?? '',
      },
    ]
  })
}

/**
 * The five tables of a whole scope (#68 Scope 7).
 *
 * The rows are a pure function of the Project and the scope, and the sort is applied here rather
 * than in the writer so that the panel's row count and the file's rows are the same rows in the
 * same order:
 *
 *   - element tables: Floor display order, Design Option order, then `stable_id` in code-point
 *     order;
 *   - the Warnings List: `unacknowledged` first, then Floor, Design Option, `subject_id`,
 *     `other_id`, `warning_type`.
 *
 * Both are total orders on rows that come from the same revision, so the file is byte-identical
 * every time it is written (#68 criterion 9) whatever order the entities were drawn in.
 */
export function tables(project: Project, scope: QuantityScope, deps: TableDeps): Tables {
  const optionIds = scopeOptionIds(scope)
  const floorIds = scopeFloorIds(project, scope)
  const floorNames = new Map<EntityId, string>(project.floors.map((floor) => [floor.id, floor.name]))
  const floorOrder = new Map<EntityId, number>(project.floors.map((floor, index) => [floor.id, index]))
  const optionOrder = new Map<string, number>(optionIds.map((id, index) => [id ?? '', index]))
  const states = new Set(scope.renovationStates)

  const rooms: RoomsRow[] = []
  const walls: WallsRow[] = []
  const openings: OpeningsRow[] = []
  const beams: BeamsRow[] = []
  const placedItems: PlacedItemsRow[] = []
  const warnings: WarningsRow[] = []

  for (const optionId of optionIds) {
    // Both columns are empty for the Existing Model alone (export contract §7); an Option names
    // itself, and every row of its arm carries the State its owner gives it (#69 §5).
    const option: OptionColumns = { designOptionId: optionId ?? '', designOption: designOptionName(project, optionId) }
    for (const floorId of floorIds) {
      const floor = floorNames.get(floorId)
      if (floor === undefined) continue
      // The Renovation State and the Drawing Layer are the whole scope of an element table, and
      // they are the same two tests `quantities` applies (#62 §6), which is what keeps two tables
      // of one ZIP agreeing about what is in the scope. Both are per-row: one Option's model holds
      // Existing, Demolition and Proposed content at once (#69 §5), and one Floor's content is
      // spread over the Layers the Layers control offers (#73 criterion 7).
      const model = effectiveModel(project, floorId, optionId)
      const layers = layerColumnsOf(project, model)
      const inScope = <T extends ElementColumns>(rows: readonly T[]): T[] =>
        rows.filter((row) =>
          states.has(row.renovationState) &&
          layerMatches(scope.drawingLayers, row.drawingLayerId === '' ? [] : [row.drawingLayerId]))
      // One pass of each derive stage per Floor under this Option, shared by the tables that read it.
      const derivedRooms = deriveRooms(project, floorId, optionId)
      const derivedWalls = deriveWalls(project, floorId, optionId)
      const placements = effectiveFloor(project, 0, floorId, optionId).placements
      rooms.push(...inScope(roomsForFloor(option, floorId, floor, derivedRooms, model, layers)))
      walls.push(...inScope(wallsForFloor(option, floorId, floor, model, derivedWalls, layers)))
      openings.push(...inScope(openingsForFloor(option, floorId, floor, model, layers)))
      beams.push(...inScope(beamsForFloor(option, floorId, floor, model, deriveBeams(project, floorId, optionId), layers)))
      placedItems.push(...inScope(placedItemsForFloor(option, floorId, floor, project, model, placements, derivedRooms, layers)))
      // The Warnings List is scoped by Floor and Design Option only (export contract §3): no
      // Renovation State and no Layer ever hides a warning.
      warnings.push(...warningsForFloor(option, optionId, floorId, floor, project, deps))
    }
  }

  const byScope = (a: OptionColumns, b: OptionColumns): number =>
    (optionOrder.get(a.designOptionId) ?? 0) - (optionOrder.get(b.designOptionId) ?? 0)
  const byElement = <T extends ElementColumns & OptionColumns>(rows: readonly T[]): readonly T[] =>
    stableSort(rows, (a, b) =>
      (floorOrder.get(a.floorId) ?? 0) - (floorOrder.get(b.floorId) ?? 0) ||
      byScope(a, b) ||
      compareCodePoints(a.stableId, b.stableId))

  const sortedWarnings = stableSort(warnings, (a, b) =>
    (a.status === 'unacknowledged' ? 0 : 1) - (b.status === 'unacknowledged' ? 0 : 1) ||
    (floorOrder.get(a.floorId) ?? 0) - (floorOrder.get(b.floorId) ?? 0) ||
    byScope(a, b) ||
    compareCodePoints(a.subjectId, b.subjectId) ||
    compareCodePoints(a.otherId, b.otherId) ||
    compareCodePoints(a.warningType, b.warningType))

  return {
    rooms: byElement(rooms),
    walls: byElement(walls),
    openings: byElement(openings),
    beams: byElement(beams),
    placedItems: byElement(placedItems),
    warnings: sortedWarnings,
  }
}

/**
 * The sentences {@link tables} writes, keyed the way it reads them.
 *
 * `app` calls this with `ui/strings`' `warningSentence` and puts the result in the export request,
 * so the Worker writes the strip's sentences without importing the copy table (#68 criterion 5).
 * It walks the same warnings `tables` walks — the same Floors, the same Design Options, the same
 * engine — which is what lets a missing key be treated as a bug rather than as an empty cell.
 */
export function warningMessages(
  project: Project,
  scope: QuantityScope,
  build: (messageKey: string, params: WarningParams) => string,
): Record<string, string> {
  const sentences: Record<string, string> = {}
  for (const optionId of scopeOptionIds(scope)) {
    for (const floorId of scopeFloorIds(project, scope)) {
      for (const warning of deriveWarnings(project, floorId, optionId).warnings) {
        sentences[warning.key] = build(warning.messageKey, warning.params)
      }
    }
  }
  return sentences
}

/** The Design Options a scope covers; `existing-only` is the Existing Model alone. */
function scopeOptionIds(scope: QuantityScope): readonly (EntityId | null)[] {
  return scope.designOptionIds === 'existing-only' ? [null] : scope.designOptionIds
}

/** The Floors a scope covers, in the Project's display order; a Floor the Project lacks is not. */
function scopeFloorIds(project: Project, scope: QuantityScope): EntityId[] {
  // A scope that named the same Floor twice would write it twice; a scope is data from a dialog or
  // a recipe file, so it is a set of Floors rather than a list to iterate.
  const wanted = new Set(scope.floorIds)
  return project.floors.filter((floor) => wanted.has(floor.id)).map((floor) => floor.id)
}

/**
 * One warning's sentence.
 *
 * A map that was given and does not hold this warning means the map and the rows did not come from
 * the same Project at the same revision; writing an empty `message` would be a Warnings List that
 * quietly stopped saying what is wrong, so it fails instead.
 */
function sentence(messages: Readonly<Record<string, string>> | null, key: string): string {
  if (messages === null) return ''
  const found = messages[key]
  if (found === undefined) throw new TypeError(`No warning sentence was supplied for "${key}"`)
  return found
}
