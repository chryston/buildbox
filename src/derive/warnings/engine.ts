/**
 * The warnings engine (#66 §1–§4).
 *
 * One pass per Floor: read the model the producers are allowed to see, run every registered
 * producer in registration order, give each candidate a key, a signature and a status, sort.
 * Nothing else. Producers decide what is worth telling the user; this file decides what it
 * *means* to have seen it, and it means the same thing for a Wall warning today and a Room
 * warning in #67, which is the only reason a later producer can arrive as
 * `{type, produce, messageKey}` and nothing more.
 *
 * Two properties are load-bearing:
 *
 *  - **The output is a pure function of the model.** Not of a view, a Layer, a viewport, a
 *    Range, a revision counter or the order entities were inserted. Producers get
 *    {@link WarningFloor}, which has no such field to read; the entity order is normalised
 *    before they run; and the result is sorted by a comparator that never falls back to
 *    insertion order.
 *  - **The signature is of model fields only.** A warning reopens when the thing it measured
 *    changed — not when the sentence about it changed. That is the whole of the fix for the
 *    prototype defect where a warning reopened only if its text happened to change (#29 D10),
 *    and it is why `signatureInputs` is hashed rather than compared with the last message.
 *
 * It is synchronous and pure, like every other stage of `derive`: no clock, no entropy, no
 * WebCrypto, no DOM.
 */
import { warningKey, beamLabel, beamTop, type Acknowledgement, type EntityId, type Project } from '../../domain'
import { canonicalJson, compareCodePoints, stableHash, stableSort } from '../../lib'
import { effectiveFloor, placementLabels } from '../effective'
import { effectiveModel } from '../effectiveModel'
import { roomOutlinePath } from '../../domain'
import { designHeight } from '../../domain'
import { placementTransform } from '../placement'
import { applyTransform, transformSegment } from '../../geometry'
import { deriveWalls } from '../walls'
import { ROOM_PRODUCERS } from './producers/rooms'
import { VERTICAL_PRODUCERS } from './producers/vertical'
import { WALL_PRODUCERS } from './producers/walls'
import type {
  FloorWarnings,
  Warning,
  WarningFloor,
  WarningOpening,
  WarningPlacement,
  WarningProducer,
  WarningRoom,
  WarningStatus,
  WarningSubject,
  WarningWall,
  WarningBeam,
} from './types'

/**
 * Every producer, in the order the engine runs them (#66 §2).
 *
 * Registration order is the run order and it is fixed: two producers that both fire on one
 * pair of Walls must come out in the same order in every build, or the Warnings List CSV
 * (#68) would sort differently from the strip that fed it. A new producer is one entry here
 * and one file beside it.
 */
export const WARNING_PRODUCERS: readonly WarningProducer[] = [...WALL_PRODUCERS, ...ROOM_PRODUCERS, ...VERTICAL_PRODUCERS]

/**
 * The measurement signature of one candidate: `stableHash` of the canonical JSON of its
 * signature inputs (#66 §2).
 *
 * Canonical JSON first, so a producer's key-insertion order can never change the answer: two
 * producers that write the same fields in a different order describe the same model state and
 * must not reopen each other's warnings.
 */
export const warningSignature = (signatureInputs: unknown): string => stableHash(canonicalJson(signatureInputs))

/** The status of a warning given the acknowledgement stored under its key (#66 §3). */
const statusOf = (acknowledgement: Acknowledgement | null, signature: string): WarningStatus => {
  if (acknowledgement === null) return 'open'
  return acknowledgement.signature === signature ? 'acknowledged' : 'reopened'
}

/**
 * The option half of a key, and the option half of the sort.
 *
 * `null` is the Existing Model and sorts as `'existing'`, the same word the key uses, so the
 * Existing Model's warnings come first and the CSV's order and the strip's order agree.
 */
const optionToken = (optionId: EntityId | null): string => optionId ?? 'existing'

/** Subject IDs in the order the key sorts them. */
const subjectIdsOf = (subjects: readonly WarningSubject[]): EntityId[] => subjects.map((subject) => subject.id)

/**
 * Engine order: Floor, option, subject ID, other ID, then type (#66 §2).
 *
 * The subject list is compared element by element, so a two-subject warning sorts before a
 * three-subject warning with the same first two — and the type breaks a tie between two
 * different warnings about the same entities. Nothing here can fall back to producer order:
 * the comparator is total on everything the engine itself builds, and `stableSort` makes the
 * one remaining case (two identical warnings from one producer, which no producer may emit)
 * deterministic rather than arbitrary.
 */
export const compareWarnings = (a: Warning, b: Warning): number =>
  compareCodePoints(a.floorId, b.floorId) ||
  compareCodePoints(optionToken(a.optionId), optionToken(b.optionId)) ||
  compareSubjectLists(a.subjects, b.subjects) ||
  compareCodePoints(a.type, b.type)

const compareSubjectLists = (a: readonly WarningSubject[], b: readonly WarningSubject[]): number => {
  const shared = Math.min(a.length, b.length)
  for (let index = 0; index < shared; index += 1) {
    const byId = compareCodePoints(a[index].id, b[index].id)
    if (byId !== 0) return byId
  }
  return a.length - b.length
}

/**
 * The one thing a producer may read: one Floor's Walls and Junctions, in a canonical order.
 *
 * Walls are sorted by ID so that a Project whose entities were inserted in another order — a
 * Backup restored, a copy made by `remapIds`, a test that shuffled the arrays — produces the
 * identical warnings with the identical keys (#66 criterion 10). The tidied outline comes from
 * `deriveWalls`, the same clean-up the Plan View draws, so a producer measures what the user
 * sees rather than the un-trimmed rectangle. What the Option under review demolishes is not in
 * front of a producer at all (#69 §5): a Wall knocked out in Option A cannot warn about crossing
 * a Wall in Option A, and still can in Option B.
 */
export const warningFloorOf = (project: Project, floorId: EntityId, optionId: EntityId | null = null): WarningFloor => {
  const model = effectiveModel(project, floorId, optionId)
  const derived = deriveWalls(project, floorId, optionId)
  const outlineOf = new Map(derived.walls.map((wall) => [wall.id, wall.outline]))
  const walls: WarningWall[] = model.standingWalls
    .flatMap((wall) => {
      const outline = outlineOf.get(wall.id)
      // A Wall `deriveWalls` did not outline is a Wall the drawing does not draw either; it
      // cannot take part in an overlap, so it takes part in no warning.
      if (outline === undefined) return []
      return [
        {
          id: wall.id,
          ref: wall.ref,
          floorId: wall.floorId,
          line: wall.line,
          thickness: wall.thickness,
          justification: wall.justification,
          outline,
          baseElevation: wall.baseElevation,
          height: wall.height,
        },
      ]
    })
  const openings: WarningOpening[] = model.standingOpenings.map((opening) => ({
    id: opening.id,
    hostWallId: opening.hostWallId,
    label: opening.label,
    sill: opening.sill,
    head: opening.head,
    start: opening.start,
    width: opening.width,
  }))
  // A Beam is documentation, so a Beam this Option drew is in front of a producer exactly as a
  // proposed Wall is; one it demolishes is not, which is the standing set rather than the record.
  const beams: WarningBeam[] = model.beams.map(({ entity }) => ({
    id: entity.id,
    floorId: entity.floorId,
    label: beamLabel(entity),
    line: { start: entity.line.start, end: entity.line.end },
    width: entity.width,
    justification: entity.justification,
    underside: entity.underside,
    top: beamTop(entity),
  }))
  const junctions = model.standingWallJunctions
    .map((junction) => ({
      id: junction.id,
      wallIds: [...junction.ends.map((end) => end.wallId), ...(junction.host === undefined ? [] : [junction.host.wallId])],
    }))
  const rooms: WarningRoom[] = model.standingRooms
    .map((room) => ({
      id: room.id,
      floorId: room.floorId,
      name: room.name,
      source: room.outline,
      outline: roomOutlinePath(room.outline),
    }))
  const placements = effectiveFloor(project, 0, floorId, optionId).placements
  const designs = new Map(project.itemDesigns.map((design) => [design.id, design]))
  // The stored Placed Items behind the derived placements: the Base elevation is the placement's
  // own field, and the Vertical Extent is read from it through the Design (#74 §1).
  const stored = new Map(model.standingPlacedItems.map((placed) => [placed.id, placed]))
  // `Base 600 #2` — the one label rule the Placed Items table shares with this strip (#67 §16).
  const labels = placementLabels(placements)
  const warningPlacements: WarningPlacement[] = placements.map((placement) => {
    const design = designs.get(placement.designId)
    const placed = stored.get(placement.id)
    const envelope = design?.clearanceEnvelope ?? null
    // The envelope through the very transform the footprint arrived by, so the region the
    // intrusion producer measures is the outline the Plan View draws (#76 §4).
    const envelopeWorldPath =
      envelope !== null && placed !== undefined && design !== undefined
        ? (() => {
            const transform = placementTransform(design, placed)
            return {
              start: applyTransform(envelope.path.start, transform),
              segments: envelope.path.segments.map((segment) => transformSegment(segment, transform)),
            }
          })()
        : null
    return {
      id: placement.id,
      itemDesignId: placement.designId,
      label: labels.get(placement.id) ?? placement.label,
      worldPath: placement.worldPath,
      translation: placement.translation,
      rotationDeg: placement.rotationDeg,
      footprint: design === undefined || design.kind !== 'generic' ? null : design.footprint,
      origin: placement.origin,
      baseElevation: placed?.baseElevation ?? 0,
      height: design === undefined ? 0 : designHeight(design),
      clearanceEnvelope: envelope,
      envelopeWorldPath,
    }
  })
  const floorLimits = project.floors.find((floor) => floor.id === floorId)?.limits
  return {
    floorId,
    walls: stableSort(walls, (a, b) => compareCodePoints(a.id, b.id)),
    openings: stableSort(openings, (a, b) => compareCodePoints(a.id, b.id)),
    beams: stableSort(beams, (a, b) => compareCodePoints(a.id, b.id)),
    junctions: stableSort(junctions, (a, b) => compareCodePoints(a.id, b.id)),
    rooms: stableSort(rooms, (a, b) => compareCodePoints(a.id, b.id)),
    placements: stableSort(warningPlacements, (a, b) => compareCodePoints(a.id, b.id)),
    limits: { lowerMm: floorLimits?.lowerMm ?? null, upperMm: floorLimits?.upperMm ?? null },
  }
}

/**
 * Every warning of one Floor under one Design Option (#66 §2, #69 §6).
 *
 * `optionId` is both halves of the answer at once: it decides which model the producers run over
 * — the Option's standing set, so proposed Walls warn too and demolished ones no longer do — and
 * it is half of every key, so acknowledging a warning in Option A never covers the same warning in
 * Option B. Hidden and non-selectable content is warned about like anything else (#66 §4):
 * visibility is a view setting, and a warning that vanished when a Layer was hidden would be a
 * warning the user never agreed to dismiss (#32).
 */
export const deriveWarnings = (project: Project, floorId: EntityId, optionId: EntityId | null): FloorWarnings => {
  const floor = warningFloorOf(project, floorId, optionId)
  const stored = project.warningAcknowledgements
  const warnings: Warning[] = []
  for (const producer of WARNING_PRODUCERS) {
    for (const candidate of producer.produce(floor, optionId)) {
      const key = warningKey(producer.type, subjectIdsOf(candidate.subjects), optionId)
      const signature = warningSignature(candidate.signatureInputs)
      const acknowledgement =
        stored.find((item) => warningKey(item.warningType, item.subjectIds, item.designOptionId) === key) ?? null
      warnings.push({
        key,
        type: producer.type,
        floorId,
        optionId,
        subjects: candidate.subjects,
        measured: candidate.measured,
        messageKey: candidate.messageKey,
        params: candidate.params,
        signature,
        status: statusOf(acknowledgement, signature),
        acknowledgement,
      })
    }
  }
  return { floorId, optionId, warnings: stableSort(warnings, compareWarnings) }
}

/**
 * How many warnings a scope has that the user has not dismissed (#66 §15).
 *
 * The union of the scope's Floors under the given Options: `status !== 'acknowledged'`, so a
 * reopened warning counts again — the model moved after the user looked at it, which is exactly
 * what the `Export…` dialog's notice is for.
 */
export const countUnacknowledged = (
  project: Project,
  floorIds: readonly EntityId[],
  optionIds: readonly (EntityId | null)[],
): number => {
  let count = 0
  for (const floorId of floorIds) {
    for (const optionId of optionIds) {
      for (const warning of deriveWarnings(project, floorId, optionId).warnings) {
        if (warning.status !== 'acknowledged') count += 1
      }
    }
  }
  return count
}
