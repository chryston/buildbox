/**
 * The vertical producers (#76 §5, behaviour 25): who runs into whom, in height.
 *
 * Five pair families, all asking the same two questions — do the plan regions intersect with
 * positive area, and do the Vertical Extents overlap — and one measured number each. The copy
 * comes from the §3 builder in `../verticalCopy`, so these sentences read the same as the Beam,
 * Skirting and Service sentences #77–#79 will add.
 *
 * What is deliberately *not* here, because §5 forbids it: touching (zero area or zero height
 * overlap, within the 0.01 mm tolerance, is a drawing the user likes); an Opening inside its
 * host; an item inside its own Clearance Envelope — every placement of a Design shares the one
 * envelope, so the Design's own placements never intrude on it; envelope against envelope —
 * two clearances overlapping is two facts, not a collision; and Rooms, which stay with #67.
 *
 * Every signature is model fields only — the placement's Base, translation and rotation, the
 * Design's height and stored envelope, the Wall's line and thickness and heights, the Opening's
 * four numbers, the Floor's limits — never a measured value and never anything a view owns.
 * Moving a Placed Item along a wall keeps its warning's sentence identical and still reopens it
 * (criterion 13); changing a Design height or envelope reopens it through the Design's fields
 * (criterion 14); changing a view cannot reach this file at all.
 */
import {
  arcFromThrough,
  area,
  bounds,
  containment,
  faceOffsets,
  interval,
  overlap,
  overlapLength,
  pointOn,
  pt,
  refPointAt,
  segmentStart,
  spanOf,
  TOLERANCE_MM,
} from '../../../geometry'
import type { ClosedPath, Interval, Pt, WallJustification, WallRefLine } from '../../../geometry'
import { compareCodePoints } from '../../../lib'
import {
  chooseVerticalSubject,
  floorLimitCopy,
  hostRangeCopy,
  verticalRelationCopy,
  type VerticalSubject,
} from '../verticalCopy'
import type {
  WarningCandidate,
  WarningFloor,
  WarningOpening,
  WarningPlacement,
  WarningProducer,
  WarningSubject,
  WarningWall,
} from '../types'

/** Below this overlap area two plan regions are treated as merely touching (#66 §8). */
const MIN_OVERLAP_AREA_MM2 = 0.01

/**
 * The axis-aligned bounding box of a plan region, and the prefilter it powers: a positive-area
 * overlap needs the boxes to overlap too, so pairs whose boxes miss never pay for a clip. The
 * producers only ever act on `positive` results, so the strict comparison loses nothing. The
 * kernel's own `bounds` is arc-aware, so a bulging Footprint never hides an overlap.
 */
interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

const bboxOf = (path: ClosedPath): Box => {
  const b = bounds(path)
  return { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY }
}

const boxesMeet = (a: Box, b: Box): boolean => a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY

/** The Vertical Extent of a placement: its Base and the height its Design gives it. */
const placementInterval = (p: WarningPlacement): Interval => interval(p.baseElevation, p.baseElevation + p.height)

/** The Vertical Extent of a Wall. */
const wallInterval = (w: WarningWall): Interval => interval(w.baseElevation, w.baseElevation + w.height)

/** The vertical span of one placement's Clearance Envelope, riding its Base (#76 §4). */
const envelopeInterval = (p: WarningPlacement): Interval | null =>
  p.clearanceEnvelope === null
    ? null
    : interval(
        p.baseElevation + p.clearanceEnvelope.bottomOffset,
        p.baseElevation + p.clearanceEnvelope.bottomOffset + p.clearanceEnvelope.height,
      )

/** The §3 subject view of a placement. */
const placementSubject = (p: WarningPlacement): VerticalSubject => ({
  id: p.id,
  kind: 'placedItem',
  label: p.label,
  extent: { bottom: p.baseElevation, top: p.baseElevation + p.height },
})

/** A Wall's display name: `Wall W-1` (§3 names entities in full). */
const wallLabel = (w: WarningWall): string => `Wall ${w.ref}`

/** The model fields of one placement, for a signature: stored numbers, never measured ones. */
const placementFields = (p: WarningPlacement): unknown => ({
  id: p.id,
  itemDesignId: p.itemDesignId,
  translation: p.translation,
  rotationDeg: p.rotationDeg,
  baseElevation: p.baseElevation,
  design: { id: p.itemDesignId, height: p.height, clearanceEnvelope: p.clearanceEnvelope },
})

/** The model fields of one Wall, for a signature. */
const wallFields = (w: WarningWall): unknown => ({
  id: w.id,
  line: w.line,
  thickness: w.thickness,
  justification: w.justification,
  baseElevation: w.baseElevation,
  height: w.height,
})

/** The model fields of one Opening, for a signature. */
const openingFields = (o: WarningOpening): unknown => ({
  id: o.id,
  hostWallId: o.hostWallId,
  sill: o.sill,
  head: o.head,
  start: o.start,
  width: o.width,
})

/**
 * Three points an edge of the path, as points on the curve (#66 §8's sampling rule).
 *
 * The penetration measure reads these, so an arc's bulge is measured on its own sweep rather
 * than along its chord.
 */
const boundarySamples = (path: ClosedPath): Pt[] => {
  const samples: Pt[] = []
  path.segments.forEach((edge, index) => {
    const from = segmentStart(path, index)
    const span = spanOf(edge, from)
    samples.push(pointOn(edge, from, span.lo), pointOn(edge, from, (span.lo + span.hi) / 2), pointOn(edge, from, span.hi))
  })
  return samples
}

/**
 * The signed offset of a point from a reference line, positive to the left of its direction.
 *
 * Straight lines get the exact perpendicular; an arc gets the signed distance from its circle,
 * whose sign follows the sweep — the same left/right the Wall's own faces are named by, so the
 * two `faceOffsets` numbers land on the same sides here as they do in `deriveWalls`.
 */
const sideOf = (line: WallRefLine, at: Pt): number => {
  if (line.kind === 'line') {
    const dx = line.end.x - line.start.x
    const dy = line.end.y - line.start.y
    const l = Math.hypot(dx, dy) || 1
    return ((at.y - line.start.y) * dx - (at.x - line.start.x) * dy) / l
  }
  const arc = arcFromThrough(line.start, line.through, line.end)
  if (arc === null) return 0
  const dp = Math.hypot(at.x - arc.center.x, at.y - arc.center.y)
  return arc.t1 > arc.t0 ? arc.radius - dp : dp - arc.radius
}

/**
 * How deep a Placed Item's footprint runs into a Wall, perpendicular to the nearer face (#76 §5).
 *
 * The item's boundary is sampled and each sample read as a signed offset from the reference
 * line; the Wall's body is the band between its two faces. Reaching past one face by `d` is
 * "runs `d` mm into" the Wall; reaching past both is fully through, which the sentence caps at
 * the thickness. An item entirely inside the band — embedded, past neither face — is measured to
 * its deepest point from the nearer face.
 */
const penetration = (line: WallRefLine, thickness: number, justification: WallJustification, footprint: ClosedPath): number => {
  const [f0, f1] = faceOffsets(thickness, justification)
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  for (const sample of boundarySamples(footprint)) {
    const s = sideOf(line, sample)
    if (s < lo) lo = s
    if (s > hi) hi = s
  }
  // Reaching past a face, the penetration is how deep the item goes from that face — its far
  // end's distance from the face, capped at the thickness, since past the far face there is no
  // more Wall to run into.
  const fromF0 = lo < f0 ? Math.min(hi - f0, thickness) : Number.POSITIVE_INFINITY
  const fromF1 = hi > f1 ? Math.min(f1 - lo, thickness) : Number.POSITIVE_INFINITY
  if (fromF0 !== Number.POSITIVE_INFINITY || fromF1 !== Number.POSITIVE_INFINITY) return Math.min(fromF0, fromF1)
  // Embedded: past neither face, the depth is the nearest face's distance from the item.
  return Math.max(0, Math.min(lo - f0, f1 - hi))
}

/**
 * The along-wall rectangle an Opening cuts through the Wall's whole thickness.
 *
 * Built from the reference line itself, so it follows an arc's sweep; the normal at each corner
 * comes from two neighbouring points on the line, which is exact for a straight line and close
 * enough for an arc's band at these widths.
 */
const openingHole = (line: WallRefLine, opening: WarningOpening, thickness: number, justification: WallJustification): ClosedPath => {
  const [f0, f1] = faceOffsets(thickness, justification)
  // A hair bigger than the gap on every side: an item deeper than the Wall overlaps the whole
  // thickness, and a region sharing the gap's own boundary is in the gap, not beside it.
  const corner = (at: number, offset: number): Pt => {
    const here = refPointAt(line, at)
    const before = refPointAt(line, Math.max(0, at - 1))
    const after = refPointAt(line, at + 1)
    const tx = after.x - before.x
    const ty = after.y - before.y
    const l = Math.hypot(tx, ty) || 1
    return pt(here.x - (ty / l) * offset, here.y + (tx / l) * offset)
  }
  const s0 = opening.start - TOLERANCE_MM
  const s1 = opening.start + opening.width + TOLERANCE_MM
  return {
    start: corner(s0, f0 - TOLERANCE_MM),
    segments: [
      { kind: 'line', to: corner(s1, f0 - TOLERANCE_MM) },
      { kind: 'line', to: corner(s1, f1 + TOLERANCE_MM) },
      { kind: 'line', to: corner(s0, f1 + TOLERANCE_MM) },
      { kind: 'line', to: corner(s0, f0 - TOLERANCE_MM) },
    ],
  }
}

/**
 * `Placed Item–Placed Item` (§5): footprints intersect with positive area and the Vertical
 * Extents overlap; the subject is the higher bottom, then the higher top, then the lower ID.
 */
const itemItemOverlap: WarningProducer = {
  type: 'item_item_overlap',
  messageKeys: ['vertical_above', 'vertical_below', 'vertical_overlap_height'],
  produce: (floor) => {
    const candidates: WarningCandidate[] = []
    const placements = floor.placements
    const boxes = new Map(placements.map((placement) => [placement.id, bboxOf(placement.worldPath)]))
    for (let i = 0; i < placements.length; i += 1) {
      for (let j = i + 1; j < placements.length; j += 1) {
        const first = placements[i]!
        const second = placements[j]!
        // The cheap tests first: heights apart or boxes apart, no clip is ever needed.
        const extents = overlapLength(placementInterval(first), placementInterval(second))
        if (extents <= TOLERANCE_MM) continue
        if (!boxesMeet(boxes.get(first.id)!, boxes.get(second.id)!)) continue
        const shared = overlap(first.worldPath, second.worldPath)
        if (shared.kind !== 'positive' || shared.area <= MIN_OVERLAP_AREA_MM2) continue
        const [subject, other] = chooseVerticalSubject(placementSubject(first), placementSubject(second))
        const copy = verticalRelationCopy(subject, other)
        candidates.push({
          subjects: [
            { type: 'placedItem', id: subject.id },
            { type: 'placedItem', id: other.id },
          ],
          measured: copy.measured,
          messageKey: copy.messageKey,
          params: copy.params,
          signatureInputs: {
            placements: [first, second]
              .sort((a, b) => compareCodePoints(a.id, b.id))
              .map((placement) => placementFields(placement)),
          },
        })
      }
    }
    return candidates
  },
}

/**
 * `Placed Item–Wall` (§5): the footprint meets the Wall body with positive area — the body read
 * minus the along-wall hole of every hosted Opening the item's extent fits inside, so an item
 * passing through the opening's gap is not running into the Wall — and the extents overlap.
 * The number is the maximum penetration perpendicular to the nearer face, at most the thickness.
 */
const itemIntoWall: WarningProducer = {
  type: 'item_into_wall',
  produce: (floor) => {
    const candidates: WarningCandidate[] = []
    const wallBoxes = new Map(floor.walls.map((wall) => [wall.id, bboxOf(wall.outline)]))
    for (const placement of floor.placements) {
      const extent = placementInterval(placement)
      const placementBox = bboxOf(placement.worldPath)
      for (const wall of floor.walls) {
        if (wallInterval(wall).hi <= extent.lo || wallInterval(wall).lo >= extent.hi) continue
        if (!boxesMeet(placementBox, wallBoxes.get(wall.id)!)) continue
        const shared = overlap(placement.worldPath, wall.outline)
        if (shared.kind !== 'positive' || shared.area <= MIN_OVERLAP_AREA_MM2) continue
        // The item's extent inside a hosted Opening's height range means the gap is open at the
        // heights the item occupies; if every piece of the overlap region sits inside such a
        // gap, nothing is running into any material.
        const gaps = floor.openings.filter(
          (opening) =>
            opening.hostWallId === wall.id && opening.sill - TOLERANCE_MM <= extent.lo && extent.hi <= opening.head + TOLERANCE_MM,
        )
        const clearThroughGap =
          gaps.length > 0 &&
          shared.region.length > 0 &&
          shared.region.every(
            (loop) =>
              gaps.some(
                (opening) =>
                  containment(loop, openingHole(wall.line, opening, wall.thickness, wall.justification)) === 'inside',
              ),
          )
        if (clearThroughGap) continue
        const mm = penetration(wall.line, wall.thickness, wall.justification, placement.worldPath)
        if (mm <= TOLERANCE_MM) continue
        candidates.push({
          subjects: [
            { type: 'placedItem', id: placement.id },
            { type: 'wall', id: wall.id },
          ],
          measured: { mm },
          messageKey: 'item_into_wall',
          params: { a: placement.label, b: wallLabel(wall), mm },
          signatureInputs: {
            placement: placementFields(placement),
            wall: wallFields(wall),
            openings: floor.openings
              .filter((opening) => opening.hostWallId === wall.id)
              .map((opening) => openingFields(opening)),
          },
        })
      }
    }
    return candidates
  },
}

/** One host-range producer: the Opening reaches past the host's top (`above`) or base (`below`). */
const openingHostProducer = (side: 'above' | 'below'): WarningProducer => ({
  type: `opening_host_${side}`,
  messageKeys: [`host_range_${side}`],
  produce: (floor) => {
    const candidates: WarningCandidate[] = []
    for (const opening of floor.openings) {
      const wall = floor.walls.find((candidate) => candidate.id === opening.hostWallId)
      if (wall === undefined) continue
      const host = { bottom: wall.baseElevation, top: wall.baseElevation + wall.height }
      const d = side === 'above' ? opening.head - host.top : host.bottom - opening.sill
      if (d <= TOLERANCE_MM) continue
      const subject: VerticalSubject = {
        id: opening.id,
        kind: 'opening',
        label: opening.label,
        extent: { bottom: opening.sill, top: opening.head },
      }
      const copy = hostRangeCopy(subject, wallLabel(wall), side, d)
      candidates.push({
        subjects: [
          { type: 'opening', id: opening.id },
          { type: 'wall', id: wall.id },
        ],
        measured: copy.measured,
        messageKey: copy.messageKey,
        params: copy.params,
        signatureInputs: { opening: openingFields(opening), wall: { id: wall.id, baseElevation: wall.baseElevation, height: wall.height } },
      })
    }
    return candidates
  },
})

/** Everything on the Floor that has a Vertical Extent, as a §3 subject plus its model fields. */
const limitedSubjects = (floor: WarningFloor): { subject: VerticalSubject; kind: WarningSubject['type']; fields: unknown }[] => [
  ...floor.walls.map((wall) => ({
    subject: {
      id: wall.id,
      kind: 'wall' as const,
      label: wallLabel(wall),
      extent: { bottom: wall.baseElevation, top: wall.baseElevation + wall.height },
    },
    kind: 'wall' as const,
    fields: wallFields(wall),
  })),
  ...floor.openings.map((opening) => ({
    subject: {
      id: opening.id,
      kind: 'opening' as const,
      label: opening.label,
      extent: { bottom: opening.sill, top: opening.head },
    },
    kind: 'opening' as const,
    fields: openingFields(opening),
  })),
  ...floor.placements.map((placement) => ({ subject: placementSubject(placement), kind: 'placedItem' as const, fields: placementFields(placement) })),
]

/** One Floor-limit producer: a thing reaching above the upper limit or under the lower one. */
const floorLimitProducer = (side: 'above' | 'below'): WarningProducer => ({
  type: `floor_limit_${side}`,
  messageKeys: [`floor_limit_${side}`],
  produce: (floor) => {
    const limit = side === 'above' ? floor.limits.upperMm : floor.limits.lowerMm
    if (limit === null) return []
    const candidates: WarningCandidate[] = []
    for (const { subject, kind, fields } of limitedSubjects(floor)) {
      const edge = side === 'above' ? subject.extent.top : subject.extent.bottom
      const d = side === 'above' ? edge - limit : limit - edge
      if (d <= TOLERANCE_MM) continue
      const copy = floorLimitCopy(subject, side, d)
      candidates.push({
        subjects: [{ type: kind, id: subject.id }],
        measured: copy.measured,
        messageKey: copy.messageKey,
        params: copy.params,
        signatureInputs: { entity: fields, floorLimits: floor.limits },
      })
    }
    return candidates
  },
})

/**
 * `Clearance Envelope intrusion` (§5): another Placed Item's footprint, or a Wall body, takes up
 * part of the envelope's plan region at heights the envelope covers.
 *
 * The subject list is the intruder first — the sentence names it first — and the measurement is
 * an area and a share of the envelope, never a length, so `measured_mm` stays empty the way the
 * Room crossing warning leaves it. The envelope's own Design never intrudes on its own envelope:
 * every placement shares the one record, and a Fridge standing in its own door-swing zone is
 * exactly what the zone is for.
 */
const envelopeIntrusion: WarningProducer = {
  type: 'clearance_envelope_intrusion',
  produce: (floor) => {
    const candidates: WarningCandidate[] = []
    const boxes = new Map(floor.placements.map((placement) => [placement.id, bboxOf(placement.worldPath)]))
    const wallBoxes = new Map(floor.walls.map((wall) => [wall.id, bboxOf(wall.outline)]))
    for (const owner of floor.placements) {
      const region = owner.envelopeWorldPath
      const span = envelopeInterval(owner)
      if (region === null || span === null) continue
      const regionBox = bboxOf(region)
      const envelopeArea = Math.abs(area(region))
      if (envelopeArea <= MIN_OVERLAP_AREA_MM2) continue
      for (const intruder of floor.placements) {
        if (intruder.itemDesignId === owner.itemDesignId) continue
        if (!boxesMeet(boxes.get(intruder.id)!, regionBox)) continue
        if (overlapLength(placementInterval(intruder), span) <= TOLERANCE_MM) continue
        const shared = overlap(intruder.worldPath, region)
        if (shared.kind !== 'positive' || shared.area <= MIN_OVERLAP_AREA_MM2) continue
        candidates.push(
          intrusionCandidate(shared.area, envelopeArea, { type: 'placedItem', id: intruder.id }, intruder.label, owner, placementFields(intruder)),
        )
      }
      for (const wall of floor.walls) {
        if (!boxesMeet(wallBoxes.get(wall.id)!, regionBox)) continue
        if (overlapLength(wallInterval(wall), span) <= TOLERANCE_MM) continue
        const shared = overlap(wall.outline, region)
        if (shared.kind !== 'positive' || shared.area <= MIN_OVERLAP_AREA_MM2) continue
        candidates.push(
          intrusionCandidate(shared.area, envelopeArea, { type: 'wall', id: wall.id }, wallLabel(wall), owner, wallFields(wall)),
        )
      }
    }
    return candidates
  },
}

/** One intrusion candidate, its area turned into the m² and whole-percent the sentence wants. */
const intrusionCandidate = (
  sharedArea: number,
  envelopeArea: number,
  intruder: WarningSubject,
  intruderLabel: string,
  owner: WarningPlacement,
  intruderFields: unknown,
): WarningCandidate => {
  const m2 = sharedArea / 1_000_000
  const pct = (sharedArea / envelopeArea) * 100
  return {
    subjects: [intruder, { type: 'placedItem', id: owner.id }],
    measured: { m2, pct },
    messageKey: 'clearance_envelope_intrusion',
    params: { a: intruderLabel, b: owner.label, m2, pct },
    signatureInputs: { owner: placementFields(owner), intruder: intruderFields },
  }
}

/** Every vertical producer, in registration order (#76 §5). */
export const VERTICAL_PRODUCERS: readonly WarningProducer[] = [
  itemItemOverlap,
  itemIntoWall,
  openingHostProducer('above'),
  openingHostProducer('below'),
  floorLimitProducer('above'),
  floorLimitProducer('below'),
  envelopeIntrusion,
]
