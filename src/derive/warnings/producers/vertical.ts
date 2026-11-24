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
  linearElement,
  overlap,
  overlapLength,
  pointOn,
  pt,
  refPointAt,
  segmentStart,
  spanOf,
  vertices,
  TOLERANCE_MM,
} from '../../../geometry'
import type { ClosedPath, Interval, Pt, WallJustification, WallRefLine } from '../../../geometry'
import { compareCodePoints } from '../../../lib'
import { perpendicularOffsetOf } from '../../skirting'
import {
  chooseVerticalSubject,
  floorLimitCopy,
  hostRangeCopy,
  verticalRelationCopy,
  type VerticalSubject,
} from '../verticalCopy'
import type {
  WarningCandidate,
  WarningBeam,
  WarningFloor,
  WarningOpening,
  WarningPlacement,
  WarningProducer,
  WarningSubject,
  WarningSubjectKind,
  WarningWall,
  WarningSkirting,
  WarningService,
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
  ...floor.beams.map((beam) => ({ subject: beamSubject(beam), kind: 'beam' as const, fields: beamFields(beam) })),
  ...floor.skirtings.map((skirting) => ({
    subject: skirtingSubject(skirting),
    kind: 'skirting' as const,
    fields: skirtingFields(skirting),
  })),
  // A Service crossing the Floor's upper or lower limit is measured, not blocked (#79 §6 criterion 26):
  // a pipe under the Datum and a duct above the ceiling are both things a person documents.
  ...floor.services.map((service) => ({ subject: serviceSubject(service), kind: 'service' as const, fields: serviceFields(service) })),
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

/** The §3 subject view of a Beam: its Underside and its derived Top (#77 §2 criterion 5). */
const beamSubject = (b: WarningBeam): VerticalSubject => ({
  id: b.id,
  kind: 'beam',
  label: b.label,
  extent: { bottom: b.underside, top: b.top },
})

/** The model fields of one Beam, for a signature. */
const beamFields = (b: WarningBeam): unknown => ({
  id: b.id,
  line: b.line,
  width: b.width,
  justification: b.justification,
  underside: b.underside,
  height: b.top - b.underside,
})

/** The Beam's body, from the same primitive the Plan View draws with. */
const beamOutline = (b: WarningBeam): ClosedPath =>
  linearElement({ kind: 'line', to: b.line.end }, b.line.start, b.width, b.justification).outline

/** One Beam-pair candidate, worded by the shared builder with the Beam as the object. */
const relationCandidate = (
  other: VerticalSubject,
  beam: VerticalSubject,
  otherKind: WarningSubjectKind,
  otherFields: unknown,
  beamEntity: WarningBeam,
): WarningCandidate => {
  const copy = verticalRelationCopy(other, beam)
  return {
    subjects: [{ type: otherKind, id: other.id }, { type: 'beam', id: beam.id }],
    measured: copy.measured,
    messageKey: copy.messageKey,
    params: copy.params,
    signatureInputs: { entity: otherFields, beam: beamFields(beamEntity) },
  }
}

/**
 * A Beam that runs through something at height (#77 §2 criterion 5).
 *
 * The pair is asymmetric and the issue names its subject: the thing the Beam meets reads first —
 * `Wall cabinet #1 top is 40 mm above Beam B-1 underside` — so the Beam is always the object and
 * `verticalRelationCopy` words the pair from the other element's side. The plan test is a real
 * overlap of the two bodies, not a bounding box: a Beam that passes beside a cabinet at the same
 * height says nothing, and one that merely touches its face is touching, not overlapping.
 *
 * A Beam against a Wall, and a Beam against another Beam, are deliberately absent. A Beam is
 * documentation of what is already there: it is drawn under a Wall that stands on it and across
 * another Beam that crosses it, and a warning on every one of those would be noise that says
 * nothing is wrong with the drawing (#77 §2 criterion 5).
 */
const beamPairProducer = (kind: 'placedItem' | 'opening'): WarningProducer => ({
  type: kind === 'placedItem' ? 'beam_placed_item' : 'beam_opening',
  messageKeys: ['vertical_above', 'vertical_below', 'vertical_overlap_height'],
  produce: (floor) => {
    const candidates: WarningCandidate[] = []
    const bodies = new Map(floor.beams.map((beam) => [beam.id, beamOutline(beam)]))
    const boxes = new Map(floor.beams.map((beam) => [beam.id, bboxOf(bodies.get(beam.id)!)]))
    const walls = new Map(floor.walls.map((wall) => [wall.id, wall]))
    for (const beam of floor.beams) {
      const body = bodies.get(beam.id)!
      const box = boxes.get(beam.id)!
      const span = interval(beam.underside, beam.top)
      if (kind === 'placedItem') {
        for (const placement of floor.placements) {
          if (!boxesMeet(bboxOf(placement.worldPath), box)) continue
          if (overlapLength(placementInterval(placement), span) <= TOLERANCE_MM) continue
          const shared = overlap(placement.worldPath, body)
          if (shared.kind !== 'positive') continue
          candidates.push(
            relationCandidate(placementSubject(placement), beamSubject(beam), 'placedItem', placementFields(placement), beam),
          )
        }
        continue
      }
      for (const opening of floor.openings) {
        // An Opening is a hole in a Wall; the region it occupies in plan is that hole, which is
        // what a Beam running through the same part of the Wall actually meets.
        const host = walls.get(opening.hostWallId)
        if (host === undefined) continue
        const hole = openingHole(host.line, opening, host.thickness, host.justification)
        if (!boxesMeet(bboxOf(hole), box)) continue
        if (overlapLength(interval(opening.sill, opening.head), span) <= TOLERANCE_MM) continue
        const shared = overlap(hole, body)
        if (shared.kind !== 'positive') continue
        candidates.push(
          relationCandidate(
            { id: opening.id, kind: 'opening', label: opening.label, extent: { bottom: opening.sill, top: opening.head } },
            beamSubject(beam),
            'opening',
            openingFields(opening),
            beam,
          ),
        )
      }
    }
    return candidates
  },
})

/**
 * A Beam taking up part of a Clearance Envelope (#77 §2 criterion 5).
 *
 * The same sentence and the same area measurement as any other intruder, with the Beam named
 * first: `Beam B-1 takes up 0.40 m² (12%) of Wall cabinet #1's Clearance Envelope.`
 */
const beamEnvelopeIntrusion: WarningProducer = {
  type: 'beam_clearance_envelope_intrusion',
  // The same copy row as every other intruder — the Beam is named in the parameters, not by a
  // new sentence.
  messageKeys: ['clearance_envelope_intrusion'],
  produce: (floor) => {
    const candidates: WarningCandidate[] = []
    for (const owner of floor.placements) {
      const region = owner.envelopeWorldPath
      const span = envelopeInterval(owner)
      if (region === null || span === null) continue
      const regionBox = bboxOf(region)
      const envelopeArea = Math.abs(area(region))
      if (envelopeArea <= MIN_OVERLAP_AREA_MM2) continue
      for (const beam of floor.beams) {
        if (!boxesMeet(bboxOf(beamOutline(beam)), regionBox)) continue
        if (overlapLength(interval(beam.underside, beam.top), span) <= TOLERANCE_MM) continue
        const shared = overlap(beamOutline(beam), region)
        if (shared.kind !== 'positive' || shared.area <= MIN_OVERLAP_AREA_MM2) continue
        candidates.push(
          intrusionCandidate(shared.area, envelopeArea, { type: 'beam', id: beam.id }, beam.label, owner, beamFields(beam)),
        )
      }
    }
    return candidates
  },
}

/**
 * The Skirting producers (#78 §6): a body standing in a footprint, and a Vertical Extent reaching
 * past the host Wall it hangs on.
 *
 * `skirtingSubject` and `skirtingFields` are the §3 and signature views of the same record.
 */

/** The §3 subject view of a Skirting: its Vertical Extent is `bottom..top`. */
const skirtingSubject = (s: WarningSkirting): VerticalSubject => ({
  id: s.id,
  kind: 'skirting',
  label: s.label,
  extent: { bottom: s.bottom, top: s.top },
})

/** The model fields of one Skirting, for a signature: the stored numbers, never a derived body. */
const skirtingFields = (s: WarningSkirting): unknown => ({
  id: s.id,
  hostWallId: s.hostWallId,
  side: s.side,
  bottom: s.bottom,
  height: s.top - s.bottom,
  thickness: s.thickness,
})

/**
 * How deep the body reaches into the footprint, perpendicular to the host face: the perpendicular
 * extent of the region the two share.
 *
 * A cabinet whose back edge is flush with the host face has the whole 15 mm of the body inside it and
 * has to move 15 mm; one whose back edge is 1 mm off the exposed face shares a 1 mm sliver and has to
 * move 1 mm. Never more than the thickness, and never a distance between centroids, which would say
 * something about where the two things sit rather than what has to move (#78 §6).
 */
const depthIntoFootprint = (s: WarningSkirting, region: readonly ClosedPath[]): number => {
  let shallowest = Number.POSITIVE_INFINITY
  let deepest = Number.NEGATIVE_INFINITY
  for (const loop of region) {
    for (const at of vertices(loop)) {
      const offset = perpendicularOffsetOf(s.hostLine, at)
      shallowest = Math.min(shallowest, offset)
      deepest = Math.max(deepest, offset)
    }
  }
  return Math.min(s.thickness, Math.max(0, deepest - shallowest))
}

/**
 * A Skirting standing in a Placed Item's footprint (#78 §6).
 *
 * The pair is asymmetric and the issue names the Skirting as the subject: the sentence says what the
 * Skirting does to the cabinet, not what the cabinet does to the Skirting. Two tests, both strict —
 * the body must cover positive area of the footprint, so a cabinet pushed up against the exposed
 * face touches and says nothing, and the height ranges must overlap, so a wall cabinet above the
 * Skirting says nothing either. The measurement is a depth perpendicular to the host face, which is
 * the one number that says how far the item has to move.
 *
 * A Skirting against a Wall, an Opening, another Skirting or a Beam is deliberately absent: the host
 * relationship is the point of a Skirting, a gap is derived rather than warned about, and two of
 * them meeting at an inside corner is an ordinary drawing (#78 §6).
 */
const skirtingPlacedItem: WarningProducer = {
  type: 'skirting_placed_item',
  produce: (floor) => {
    const candidates: WarningCandidate[] = []
    for (const skirting of floor.skirtings) {
      const span = interval(skirting.bottom, skirting.top)
      for (const placement of floor.placements) {
        if (overlapLength(placementInterval(placement), span) <= TOLERANCE_MM) continue
        let depth = 0
        let met = false
        for (const body of skirting.bodies) {
          if (!boxesMeet(bboxOf(placement.worldPath), bboxOf(body))) continue
          const shared = overlap(placement.worldPath, body)
          if (shared.kind !== 'positive') continue
          met = true
          depth = Math.max(depth, depthIntoFootprint(skirting, shared.region))
        }
        if (!met) continue
        candidates.push({
          subjects: [{ type: 'skirting', id: skirting.id }, { type: 'placedItem', id: placement.id }],
          measured: { mm: depth },
          messageKey: 'skirting_placed_item',
          params: { a: skirting.label, b: placement.label, mm: depth },
          signatureInputs: { skirting: skirtingFields(skirting), placement: placementFields(placement) },
        })
      }
    }
    return candidates
  },
}

/** One Skirting host-range producer: the Skirting reaches past the host's top (`above`) or base (`below`). */
const skirtingHostProducer = (side: 'above' | 'below'): WarningProducer => ({
  type: `skirting_host_${side}`,
  messageKeys: [`host_range_${side}`],
  produce: (floor) => {
    const candidates: WarningCandidate[] = []
    for (const skirting of floor.skirtings) {
      const wall = floor.walls.find((candidate) => candidate.id === skirting.hostWallId)
      if (wall === undefined) continue
      const host = { bottom: wall.baseElevation, top: wall.baseElevation + wall.height }
      const d = side === 'above' ? skirting.top - host.top : host.bottom - skirting.bottom
      if (d <= TOLERANCE_MM) continue
      const copy = hostRangeCopy(skirtingSubject(skirting), wallLabel(wall), side, d)
      candidates.push({
        subjects: [{ type: 'skirting', id: skirting.id }, { type: 'wall', id: wall.id }],
        measured: copy.measured,
        messageKey: copy.messageKey,
        params: copy.params,
        signatureInputs: {
          skirting: skirtingFields(skirting),
          wall: { id: wall.id, baseElevation: wall.baseElevation, height: wall.height },
        },
      })
    }
    return candidates
  },
})

/** The §3 subject view of a Service: its Vertical Extent is `bottom..top`. */
const serviceSubject = (s: WarningService): VerticalSubject => ({
  id: s.id,
  kind: 'service',
  label: s.label,
  extent: { bottom: s.bottom, top: s.top },
})

/** The model fields of one Service, for a signature: the stored numbers, never a derived body. */
const serviceFields = (s: WarningService): unknown => ({
  id: s.id,
  kind: s.kind,
  shape: s.shape,
  section: s.section,
  outsideDiameter: s.outsideDiameter,
  width: s.width,
  depth: s.depth,
  bottom: s.bottom,
  centrelineElevation: s.centrelineElevation,
  height: s.top - s.bottom,
  label: s.name,
})

/**
 * A Service that runs through something (#79 §6 criterion 26).
 *
 * The Service is the subject and reads first — `Service W Ø50 overlaps Wall cabinet #1 over 40 mm of
 * height` — because the Service is the record being coordinated and the thing it meets is the reason
 * it was drawn. The plan test is a real overlap of the two bodies, not a bounding box, and it is
 * strict: a pipe that merely touches a cabinet face is touching, not clashing.
 *
 * A Service against a Wall, another Service or a Skirting is deliberately absent. #79 §5 lists no
 * dependency between a Service and a Wall, so deleting a Wall leaves every Service standing and says
 * nothing about it; two Services crossing is the normal condition of a services drawing; and a
 * Skirting runs at the floor while a Service runs above the ceiling, so a pair that met would be a
 * coincidence worth drawing but not a fault. A warning on any of those would be noise.
 */
const servicePairProducer = (kind: 'placedItem' | 'opening' | 'beam'): WarningProducer => ({
  type: kind === 'placedItem' ? 'service_placed_item' : kind === 'opening' ? 'service_opening' : 'service_beam',
  messageKeys: ['vertical_above', 'vertical_below', 'vertical_overlap_height'],
  produce: (floor) => {
    const candidates: WarningCandidate[] = []
    const boxes = new Map(floor.services.map((service) => [service.id, bboxOf(service.body)]))
    const walls = new Map(floor.walls.map((wall) => [wall.id, wall]))
    const beams = new Map(floor.beams.map((beam) => [beam.id, beam]))
    for (const service of floor.services) {
      const body = service.body
      const box = boxes.get(service.id)!
      const span = interval(service.bottom, service.top)
      if (kind === 'placedItem') {
        for (const placement of floor.placements) {
          if (!boxesMeet(bboxOf(placement.worldPath), box)) continue
          if (overlapLength(placementInterval(placement), span) <= TOLERANCE_MM) continue
          if (overlap(placement.worldPath, body).kind !== 'positive') continue
          candidates.push(serviceRelation(placementSubject(placement), 'placedItem', placementFields(placement), service))
        }
        continue
      }
      if (kind === 'opening') {
        for (const opening of floor.openings) {
          const host = walls.get(opening.hostWallId)
          if (host === undefined) continue
          const hole = openingHole(host.line, opening, host.thickness, host.justification)
          if (!boxesMeet(bboxOf(hole), box)) continue
          if (overlapLength(interval(opening.sill, opening.head), span) <= TOLERANCE_MM) continue
          if (overlap(hole, body).kind !== 'positive') continue
          candidates.push(
            serviceRelation(
              { id: opening.id, kind: 'opening', label: opening.label, extent: { bottom: opening.sill, top: opening.head } },
              'opening',
              openingFields(opening),
              service,
            ),
          )
        }
        continue
      }
      for (const beam of floor.beams) {
        const other = beamOutline(beams.get(beam.id)!)
        if (!boxesMeet(bboxOf(other), box)) continue
        if (overlapLength(interval(beam.underside, beam.top), span) <= TOLERANCE_MM) continue
        if (overlap(other, body).kind !== 'positive') continue
        candidates.push(serviceRelation(beamSubject(beam), 'beam', beamFields(beam), service))
      }
    }
    return candidates
  },
})

/** One Service-pair candidate, worded by the shared builder with the Service as the subject. */
const serviceRelation = (other: VerticalSubject, otherKind: WarningSubjectKind, otherFields: unknown, service: WarningService): WarningCandidate => {
  const copy = verticalRelationCopy(serviceSubject(service), other)
  return {
    subjects: [{ type: 'service', id: service.id }, { type: otherKind, id: other.id }],
    measured: copy.measured,
    messageKey: copy.messageKey,
    params: copy.params,
    signatureInputs: { service: serviceFields(service), entity: otherFields },
  }
}

/**
 * A Service standing inside another Item's Clearance Envelope (#79 §6 criterion 26).
 *
 * The envelope is a documented keep-out volume, so anything that occupies part of it at the heights
 * the envelope covers is a coordination fact worth a row. The Service reads first, as it does in
 * every other Service sentence, and the measurement is the height overlap — the same number the
 * Beam-in-envelope warning reports, never an area, because what a person moves is the pipe.
 */
const serviceEnvelopeIntrusion: WarningProducer = {
  type: 'service_clearance_envelope',
  messageKeys: ['vertical_above', 'vertical_below', 'vertical_overlap_height'],
  produce: (floor) => {
    const candidates: WarningCandidate[] = []
    for (const service of floor.services) {
      const box = bboxOf(service.body)
      const span = interval(service.bottom, service.top)
      for (const owner of floor.placements) {
        const region = owner.envelopeWorldPath
        const envelopeSpan = envelopeInterval(owner)
        if (region === null || envelopeSpan === null) continue
        if (!boxesMeet(bboxOf(region), box)) continue
        if (overlapLength(envelopeSpan, span) <= TOLERANCE_MM) continue
        if (overlap(region, service.body).kind !== 'positive') continue
        candidates.push(serviceRelation(placementSubject(owner), 'placedItem', placementFields(owner), service))
      }
    }
    return candidates
  },
}

/** Every vertical producer, in registration order (#76 §5, #77 §2, #78 §6, #79 §6). */
export const VERTICAL_PRODUCERS: readonly WarningProducer[] = [
  itemItemOverlap,
  itemIntoWall,
  openingHostProducer('above'),
  openingHostProducer('below'),
  floorLimitProducer('above'),
  floorLimitProducer('below'),
  envelopeIntrusion,
  beamPairProducer('placedItem'),
  beamPairProducer('opening'),
  beamEnvelopeIntrusion,
  skirtingPlacedItem,
  skirtingHostProducer('above'),
  skirtingHostProducer('below'),
  servicePairProducer('placedItem'),
  servicePairProducer('opening'),
  servicePairProducer('beam'),
  serviceEnvelopeIntrusion,
]
