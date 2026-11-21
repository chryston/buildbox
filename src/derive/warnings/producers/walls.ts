/**
 * The first producers: Walls that meet without being joined (#22, #66 §8–§10).
 *
 * BuildBox never infers a Junction. Two Walls that cross, or run along each other, and do not
 * share a Junction are a warning about the model — measured, non-blocking, dismissible — and
 * nothing here ever repairs them, because the user may have meant it: a service riser passing
 * behind a partition, a wall drawn twice on purpose.
 *
 * Both producers ask the same two questions of the same set of pairs, and differ only in the
 * second answer:
 *
 *  1. Do the two Walls' **tidied footprints** overlap with positive area? Tidied means cut at
 *     every Junction they take part in — the same outlines `deriveWalls` draws — which is what
 *     makes "regions inside a shared junction's tidied cap never count" true by construction
 *     rather than by subtraction: Walls joined at a Junction have their ends cut *at* it, so
 *     their footprints tile the junction instead of overlapping in it. Walls that share a
 *     Junction at one point and overlap somewhere else still warn, because the overlap that
 *     remains is real.
 *  2. Do the two Walls' **reference lines** meet at a point (`wall_crossing`) or run alongside
 *     each other (`wall_overlap`)?
 *
 * A pair that touches without overlapping — two Walls butted end to end with no Junction — has
 * no positive-area overlap and produces nothing. That is a drawing the user will fix by
 * clicking once, not a warning.
 */
import {
  intersectSegments,
  nearestOnSegment,
  overlap,
  pointOn,
  refLength,
  refSegment,
  segmentStart,
  spanOf,
} from '../../../geometry'
import type { ClosedPath, Pt, WallRefLine } from '../../../geometry'
import { compareCodePoints } from '../../../lib'
import type { WarningCandidate, WarningFloor, WarningProducer, WarningWall } from '../types'

/**
 * The overlap area below which two footprints are treated as not overlapping at all (#66 §8).
 *
 * Half a hundredth of a square millimetre: far below anything a user could draw or care about,
 * comfortably above the float noise a pair of Walls that merely touch produces.
 */
const MIN_OVERLAP_AREA_MM2 = 0.01

/** One pair of Walls whose tidied footprints overlap, and the region they overlap in. */
interface WallPair {
  readonly first: WarningWall
  readonly second: WarningWall
  readonly region: readonly ClosedPath[]
}

/**
 * Every overlapping pair of one Floor, in a canonical order.
 *
 * `floor.walls` arrives sorted by ID, so `i < j` names each unordered pair exactly once and the
 * list does not depend on the order the Walls were inserted (#66 criterion 10).
 */
const overlappingPairs = (floor: WarningFloor): WallPair[] => {
  const pairs: WallPair[] = []
  const walls = floor.walls
  for (let i = 0; i < walls.length; i += 1) {
    for (let j = i + 1; j < walls.length; j += 1) {
      const shared = overlap(walls[i].outline, walls[j].outline)
      if (shared.kind === 'positive' && shared.area > MIN_OVERLAP_AREA_MM2) {
        pairs.push({ first: walls[i], second: walls[j], region: shared.region })
      }
    }
  }
  return pairs
}

/**
 * Whether two reference lines meet at a point, as opposed to running along one another.
 *
 * A crossing or a touch is a meeting of two different directions — an X, a T, an L — which is
 * what the word "crosses" in the copy claims. A collinear stretch is reported as an overlap of
 * the two lines and belongs to `wall_overlap` instead.
 */
const refLinesMeetAtAPoint = (a: WallRefLine, b: WallRefLine): boolean => {
  const first = refSegment(a)
  const second = refSegment(b)
  const meeting = intersectSegments(first.segment, first.from, second.segment, second.from)
  return meeting.crossings.length > 0 || meeting.touches.length > 0
}

/**
 * How far the two footprints run together, measured along the primary's reference line (#66 §8, §9).
 *
 * The overlap region is projected onto the primary's reference line and its extent there is the
 * answer. For a crossing that is the depth of the intrusion — the same number as the length of
 * the primary's reference line inside the other footprint, which is how §8 words it — and for a
 * collinear or parallel run it is the length they share, which is how §9 words it. The two
 * wordings part company only for a parallel pair whose reference lines never enter one another's
 * band, where the §8 reading would print `0 mm`; the projection prints the run, which is the
 * number the sentence is about.
 *
 * The region is sampled at three points an edge rather than taken vertex to vertex, so an arc's
 * bulge is measured along its own curve, and each sample is snapped to the nearest point of the
 * reference line, so an arc primary is measured along its own sweep rather than along its chord.
 */
const overlapExtentAlongRef = (line: WallRefLine, region: readonly ClosedPath[]): number => {
  const { segment, from } = refSegment(line)
  const span = spanOf(segment, from)
  if (span.hi === span.lo) return 0
  // Reference parameters are not lengths: an arc's parameter runs over its sweep in radians.
  const perUnit = refLength(line) / (span.hi - span.lo)
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  const sample = (point: Pt): void => {
    const near = nearestOnSegment(point, segment, from)
    if (near.t < lo) lo = near.t
    if (near.t > hi) hi = near.t
  }
  region.forEach((loop) => {
    loop.segments.forEach((edge, index) => {
      const edgeFrom = segmentStart(loop, index)
      const edgeSpan = spanOf(edge, edgeFrom)
      sample(pointOn(edge, edgeFrom, edgeSpan.lo))
      sample(pointOn(edge, edgeFrom, (edgeSpan.lo + edgeSpan.hi) / 2))
      sample(pointOn(edge, edgeFrom, edgeSpan.hi))
    })
  })
  return hi > lo ? (hi - lo) * perUnit : 0
}

/**
 * Every model field this pair's warning is a function of (#66 §10).
 *
 * Each Wall's reference line, thickness, justification and Floor, plus the Junction memberships
 * of the pair — the four things that decide both whether the footprints overlap and how far the
 * reference line reaches into the other one. Nothing measured, nothing formatted: a Wall moved
 * along its own length changes one coordinate here and reopens the warning even though the
 * sentence is identical (#66 criterion 1), and a change of display unit or Layer changes nothing
 * here and never reopens it.
 *
 * The Walls are listed by ID, not primary-first, so the signature of a pair does not depend on
 * which side the copy happens to name first.
 */
const signatureInputsOf = (pair: WallPair, floor: WarningFloor): unknown => {
  const byId = [pair.first, pair.second].sort((a, b) => compareCodePoints(a.id, b.id))
  const involved = new Set(byId.map((wall) => wall.id))
  return {
    walls: byId.map((wall) => ({
      id: wall.id,
      floorId: wall.floorId,
      line: wall.line,
      thickness: wall.thickness,
      justification: wall.justification,
    })),
    junctions: floor.junctions
      .filter((junction) => junction.wallIds.some((wallId) => involved.has(wallId)))
      .map((junction) => ({ id: junction.id, wallIds: [...junction.wallIds].sort(compareCodePoints) })),
  }
}

/**
 * One candidate for one pair: subjects by `ref`, the primary's intrusion measured, the copy
 * named by key.
 *
 * The primary subject is the Wall with the lower `ref` (#66 §8), which is also the Wall the
 * sentence names first and the one whose reference line is measured — so the number in the copy
 * is the number the strip prints, and locating the warning selects the Wall the user was told
 * about.
 */
const candidateOf = (type: string, pair: WallPair, floor: WarningFloor): WarningCandidate => {
  const [primary, other] =
    compareCodePoints(pair.first.ref, pair.second.ref) <= 0 ? [pair.first, pair.second] : [pair.second, pair.first]
  // A tenth of a millimetre: the resolution a builder reads off a tape. The engine reports a
  // measurement, not a sentence — the strip and the CSV each format it for their own reader.
  const mm = Math.round(overlapExtentAlongRef(primary.line, pair.region) * 10) / 10
  return {
    subjects: [
      { type: 'wall', id: primary.id },
      { type: 'wall', id: other.id },
    ],
    measured: { mm },
    messageKey: type,
    params: { a: primary.ref, b: other.ref, mm },
    signatureInputs: signatureInputsOf(pair, floor),
  }
}

/** `W-2 crosses W-5 without a join: 100 mm overlap.` (#66 §8) */
export const wallCrossing: WarningProducer = {
  type: 'wall_crossing',
  produce: (floor) =>
    overlappingPairs(floor)
      .filter((pair) => refLinesMeetAtAPoint(pair.first.line, pair.second.line))
      .map((pair) => candidateOf('wall_crossing', pair, floor)),
}

/** `W-2 runs along W-5 for 450 mm without a join.` (#66 §9) */
export const wallOverlap: WarningProducer = {
  type: 'wall_overlap',
  produce: (floor) =>
    overlappingPairs(floor)
      .filter((pair) => !refLinesMeetAtAPoint(pair.first.line, pair.second.line))
      .map((pair) => candidateOf('wall_overlap', pair, floor)),
}

/** The Wall producers, in the order the engine runs them. */
export const WALL_PRODUCERS: readonly WarningProducer[] = [wallCrossing, wallOverlap]
