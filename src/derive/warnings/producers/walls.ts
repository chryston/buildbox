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
  classifyPoint,
  intersectSegments,
  nearestOnSegment,
  overlap,
  pointOn,
  refLength,
  refSegment,
  segmentStart,
  spanOf,
} from '../../../geometry'
import type { ClosedPath, WallRefLine } from '../../../geometry'
import { compareCodePoints } from '../../../lib'
import type { WarningCandidate, WarningFloor, WarningProducer, WarningWall } from '../types'

/**
 * The overlap area below which two footprints are treated as not overlapping at all (#66 §8).
 *
 * Half a hundredth of a square millimetre: far below anything a user could draw or care about,
 * comfortably above the float noise a pair of Walls that merely touch produces.
 */
const MIN_OVERLAP_AREA_MM2 = 0.01

/** One pair of Walls whose tidied footprints overlap. */
interface WallPair {
  readonly first: WarningWall
  readonly second: WarningWall
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
      if (shared.kind === 'positive' && shared.area > MIN_OVERLAP_AREA_MM2) pairs.push({ first: walls[i], second: walls[j] })
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
 * How much of a reference line lies inside a footprint, in millimetres (#66 §8, §9).
 *
 * The same number answers both producers: for a crossing it is the depth of the intrusion, for
 * a collinear overlap it is the length they run together. The line is cut at every place it
 * meets the footprint's outline and each piece is classified at its midpoint, so an arc is
 * measured along its own length and a line that passes through, out, and back in again is
 * counted for both stretches.
 *
 * A piece lying exactly *on* the outline counts. A Wall whose reference line coincides with the
 * edge of another Wall's band — the same justification, the same thickness — is the case that
 * makes that necessary, and it cannot be a false positive here: the pair only reaches this
 * function once their footprints overlap with positive area.
 */
const refLengthInside = (line: WallRefLine, region: ClosedPath): number => {
  const { segment, from } = refSegment(line)
  const span = spanOf(segment, from)
  // Reference parameters are not lengths: an arc's parameter runs over its sweep in radians, so
  // a piece is measured as its share of the whole reference length.
  const perUnit = span.hi === span.lo ? 0 : refLength(line) / (span.hi - span.lo)
  const marks: number[] = [span.lo, span.hi]
  region.segments.forEach((edge, index) => {
    const meeting = intersectSegments(segment, from, edge, segmentStart(region, index))
    meeting.crossings.forEach((cross) => marks.push(nearestOnSegment(cross.at, segment, from).t))
    // `a` is the stretch in the first segment's own parameter — the reference line's here —
    // so a reference line running along an edge of the footprint is cut at both its ends.
    meeting.overlaps.forEach((stretch) => marks.push(stretch.a[0], stretch.a[1]))
  })
  const cuts = marks.filter((t) => t >= span.lo && t <= span.hi).sort((low, high) => low - high)
  let inside = 0
  for (let i = 1; i < cuts.length; i += 1) {
    const width = cuts[i] - cuts[i - 1]
    if (width <= 1e-9) continue
    const middle = classifyPoint(pointOn(segment, from, (cuts[i] + cuts[i - 1]) / 2), region)
    if (middle !== 'outside') inside += width * perUnit
  }
  return inside
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
  const mm = Math.round(refLengthInside(primary.line, other.outline) * 10) / 10
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
