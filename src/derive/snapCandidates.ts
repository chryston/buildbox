/**
 * Where the snap candidates come from (#59 §5).
 *
 * `geometry`'s `resolveSnap` decides *which* point wins; this file decides *what is on
 * offer*: the vertices, true curve midpoints, arc centres, intersections, tangent points,
 * perpendicular feet, axis alignments, angle rays, grid points and Wall faces the tools
 * would show while a command is in flight. Every source is built from the #54 primitives
 * on the exact curve, and each kind is emitted only when its `Snaps ▾` row is enabled.
 *
 * Wall centrelines and centreline endpoints are never candidates (#59 behaviour 24, the
 * `A-snap` defect): `WallFaceSource` deliberately has no centreline field, so a caller
 * cannot offer one by accident. #64 generates the faces; #59 defines the shape.
 *
 * Like every snap function this is pure and stores nothing: a snap writes coordinates and
 * leaves no relationship behind (#59 behaviour 25).
 */
import {
  DEG,
  TOLERANCE_MM,
  centres,
  distance,
  endpoints,
  equalPts,
  intersectSegments,
  intersections,
  midpoints,
  normaliseDeg,
  perpendicularFoot,
  pt,
  segmentStart,
  tangentPoints,
} from '../geometry'
import type { ClosedPath, Pt, Segment, SnapCandidate, SnapKind } from '../geometry'

/** One named piece of geometry the tools may snap to (a Room Outline, an Item Footprint placed on the Floor). */
export interface SnapGeometry {
  readonly path: ClosedPath
  /** Plain words for the indicator: `Kitchen`, `Base 600`. */
  readonly name: string
  /**
   * The entity this geometry belongs to — the Room whose Outline it is, the Placed Item whose
   * Footprint it repeats (#71 criterion 12). Absent means nobody's: a draft edge or the Floor itself
   * is on no layer, so no layer setting can take it away.
   */
  readonly ownerId?: string
}

/**
 * One Wall's snap-able faces (#64 generates these; #59 defines the shape).
 * The Wall's centreline is deliberately NOT part of this interface: a centreline or a
 * centreline endpoint is never a snap target (#59 behaviour 24, the `A-snap` defect).
 */
export interface WallFaceSource {
  /** `W-5` */
  readonly id: string
  /** `W-5 · face` — the wording for a point on a face (#64 §7; #67 upgrades it to Room sides). */
  readonly label: string
  /** Face corners: where two faces meet, or a face ends (D6: these ARE targets). */
  readonly corners: readonly { point: Pt; label: string }[]
  /** The faces themselves, on their real curves: an arc face snaps to the arc, not its chord.
      A face that borders a Room carries its own wording, `W-5 · Kitchen side face` (#67 §9). */
  readonly faces: readonly { from: Pt; to: Pt; segment: Segment; label?: string }[]
}

export interface SnapSourceInput {
  /** Current-Floor or current-design geometry, already in the frame the cursor is in. */
  readonly geometry: readonly SnapGeometry[]
  /** Walls' faces, or nothing until #64 supplies them. */
  readonly walls?: readonly WallFaceSource[]
  readonly cursor: Pt
  /** The last placed draft point; enables axis/angle/tangent/perpendicular. */
  readonly from?: Pt | null
  /**
   * The draft's placed segments so far, newest first and chained backwards from `from`:
   * the first entry starts at `from`, and each later entry starts where the one before
   * ends. So a snap can find where the draft crosses existing geometry.
   */
  readonly draft?: readonly Segment[]
  readonly gridSpacingMm: number
  readonly angleIncrementDeg: number
  readonly enabled: ReadonlySet<SnapKind>
  /**
   * Whether one entity's geometry may be snapped to, answered by the owning entity's id
   * (#71 criterion 12). Absent means everything may — the flag-off answer, and the answer of a
   * Project with no Drawing Layers.
   */
  readonly allowed?: (ownerId: string) => boolean
}

/** True when `at` is not already in `seen` within the topology tolerance; `seen` grows. */
const fresh = (seen: Pt[], at: Pt): boolean => {
  if (seen.some((other) => distance(other, at) <= TOLERANCE_MM)) return false
  seen.push(at)
  return true
}

/** The unit direction of the ray `from → cursor`, or `null` when the cursor sits on `from`. */
const rayDirection = (from: Pt, cursor: Pt): Pt | null => {
  const dx = cursor.x - from.x
  const dy = cursor.y - from.y
  const d = Math.hypot(dx, dy)
  return d === 0 ? null : { x: dx / d, y: dy / d }
}

/**
 * The nine `Snaps ▾` rows' kinds, so the UI stays declarative (#59 §5). Row 2 is one
 * checkbox for two kinds, which is why `endpoints` carries both `endpoint` and `midpoint`.
 */
export interface SnapSettingKinds {
  readonly grid: readonly SnapKind[]
  readonly endpoints: readonly SnapKind[]
  readonly centres: readonly SnapKind[]
  readonly intersections: readonly SnapKind[]
  readonly wallFaces: readonly SnapKind[]
  readonly axis: readonly SnapKind[]
  readonly angle: readonly SnapKind[]
  readonly perpendicular: readonly SnapKind[]
  readonly tangent: readonly SnapKind[]
}

export const SNAP_ROW_KINDS: SnapSettingKinds = {
  grid: ['grid'],
  endpoints: ['endpoint', 'midpoint'],
  centres: ['centre'],
  intersections: ['intersection'],
  wallFaces: ['wallFace'],
  axis: ['axis'],
  angle: ['angle'],
  perpendicular: ['perpendicular'],
  tangent: ['tangent'],
}

/** The enabled kinds for the nine booleans + grid spacing/angle increment state. */
export const enabledSnapKinds = (settings: {
  grid: boolean
  endpoints: boolean
  centres: boolean
  intersections: boolean
  wallFaces: boolean
  axis: boolean
  angle: boolean
  perpendicular: boolean
  tangent: boolean
}): Set<SnapKind> => {
  const kinds = new Set<SnapKind>()
  for (const row of Object.keys(SNAP_ROW_KINDS) as (keyof SnapSettingKinds)[]) {
    if (settings[row]) for (const kind of SNAP_ROW_KINDS[row]) kinds.add(kind)
  }
  return kinds
}

/**
 * The nearest point of one tidied face to the cursor (#64 §7). A straight face is the
 * projection onto its span, clamped to its ends. An arc face is the point of its circle on the
 * ray from the centre through the cursor, clamped to the arc: the chord would offer a point
 * that is not on any wall.
 */
const nearestOnFace = (face: { from: Pt; to: Pt; segment: Segment }, cursor: Pt): Pt | null => {
  const { segment } = face
  if (segment.kind !== 'arc') {
    const d = { x: face.to.x - face.from.x, y: face.to.y - face.from.y }
    const dd = d.x * d.x + d.y * d.y
    if (dd === 0) return null
    const t = Math.min(1, Math.max(0, ((cursor.x - face.from.x) * d.x + (cursor.y - face.from.y) * d.y) / dd))
    return pt(face.from.x + d.x * t, face.from.y + d.y * t)
  }
  const centre = segment.center
  const radius = distance(centre, face.from)
  if (radius === 0) return null
  const degrees = (at: Pt): number => (Math.atan2(at.y - centre.y, at.x - centre.x) * 180) / Math.PI
  const start = degrees(face.from)
  const sweep = segment.sweepDeg
  // The cursor’s bearing from the arc’s start, wound into the direction the arc turns and then
  // clamped to the arc’s own length.
  const bearing = degrees(cursor)
  const around = (at: number): number => ((at % 360) + 360) % 360
  const offset = sweep >= 0 ? around(bearing - start) : -around(start - bearing)
  const along = sweep >= 0 ? Math.min(sweep, offset) : Math.max(sweep, offset)
  const angle = (start + along) * DEG
  return pt(centre.x + radius * Math.cos(angle), centre.y + radius * Math.sin(angle))
}

/**
 * Every candidate the tools would offer for one cursor position (#59 §5). Each source
 * fires only when its kind is enabled; duplicates within one source are dropped, but
 * coincident candidates from *different* sources are kept, because the D6 tie-break in
 * `resolveSnap` is what decides between them.
 */
export const snapCandidates = (input: SnapSourceInput): SnapCandidate[] => {
  const { cursor, from, draft, gridSpacingMm, angleIncrementDeg, enabled, allowed } = input
  // #71 criterion 12: content this view has hidden or made non-selectable is not a snap target, and
  // `Snap to hidden content` is the one switch that puts it back. Picking it is still impossible —
  // that answer comes from `layerAccessOf`, not from here — so a tool can aim at a Wall it cannot
  // then click. Geometry with no owner is nobody's layer and stays a target.
  const geometry = input.geometry.filter((one) => one.ownerId === undefined || allowed?.(one.ownerId) !== false)
  const walls = input.walls?.filter((one) => allowed?.(one.id) !== false)
  const out: SnapCandidate[] = []

  if (enabled.has('endpoint')) {
    for (const { path, name } of geometry) {
      for (const at of endpoints(path)) out.push({ point: at, kind: 'endpoint', label: `Corner of ${name}` })
    }
  }

  if (enabled.has('midpoint')) {
    for (const { path } of geometry) {
      midpoints(path).forEach((at, i) => out.push({ point: at, kind: 'midpoint', label: `Midpoint of edge ${i + 1}` }))
    }
  }

  if (enabled.has('centre')) {
    for (const { path } of geometry) {
      for (const at of centres(path)) out.push({ point: at, kind: 'centre', label: 'Centre of arc' })
    }
  }

  if (enabled.has('intersection')) {
    const seen: Pt[] = []
    for (let i = 0; i < geometry.length; i += 1) {
      for (let j = i + 1; j < geometry.length; j += 1) {
        for (const at of intersections(geometry[i].path, geometry[j].path)) {
          if (fresh(seen, at)) out.push({ point: at, kind: 'intersection', label: 'Intersection' })
        }
      }
    }
    // A draft segment is not a closed path, so it meets geometry through `intersectSegments`
    // rather than `intersect`; the chain runs backwards from `from`, newest segment first.
    if (from !== null && from !== undefined && draft !== undefined) {
      let start = from
      for (const segment of draft) {
        for (const { path } of geometry) {
          path.segments.forEach((other, i) => {
            const both = intersectSegments(segment, start, other, segmentStart(path, i))
            for (const meeting of [...both.crossings, ...both.touches]) {
              if (fresh(seen, meeting.at)) out.push({ point: meeting.at, kind: 'intersection', label: 'Intersection' })
            }
          })
        }
        start = segment.to
      }
    }
  }

  if (from !== null && from !== undefined) {
    if (enabled.has('tangent')) {
      for (const { path } of geometry) {
        path.segments.forEach((segment, i) => {
          if (segment.kind === 'line') return
          for (const at of tangentPoints(cursor, segment, segmentStart(path, i))) {
            out.push({ point: at, kind: 'tangent', label: 'Tangent' })
          }
        })
      }
    }

    if (enabled.has('perpendicular')) {
      for (const { path } of geometry) {
        path.segments.forEach((segment, i) => {
          const at = perpendicularFoot(cursor, segment, segmentStart(path, i))
          if (at !== null) out.push({ point: at, kind: 'perpendicular', label: 'Perpendicular' })
        })
      }
    }
  }

  if (enabled.has('axis')) {
    const anchors = from !== null && from !== undefined
      ? geometry.flatMap((g) => endpoints(g.path)).concat(from)
      : geometry.flatMap((g) => endpoints(g.path))
    for (const anchor of anchors) {
      const horizontal = pt(cursor.x, anchor.y)
      if (!equalPts(horizontal, anchor)) out.push({ point: horizontal, kind: 'axis', label: 'Horizontal from corner' })
      const vertical = pt(anchor.x, cursor.y)
      if (!equalPts(vertical, anchor)) out.push({ point: vertical, kind: 'axis', label: 'Vertical from corner' })
    }
  }

  if (from !== null && from !== undefined && enabled.has('angle') && angleIncrementDeg > 0) {
    const dir = rayDirection(from, cursor)
    if (dir !== null) {
      const bearing = normaliseDeg(Math.atan2(cursor.y - from.y, cursor.x - from.x) / DEG)
      let bestDeg = 0
      let bestGap = Infinity
      for (let deg = 0; deg < 360; deg += angleIncrementDeg) {
        const gap = Math.abs(((bearing - deg + 540) % 360) - 180)
        if (gap < bestGap) {
          bestGap = gap
          bestDeg = deg
        }
      }
      const rad = bestDeg * DEG
      const ray = { x: Math.cos(rad), y: Math.sin(rad) }
      const label = `Angle ${normaliseDeg(bestDeg)}°`
      const along = distance(cursor, from)
      out.push({ point: pt(from.x + ray.x * along, from.y + ray.y * along), kind: 'angle', label })
      const t = (cursor.x - from.x) * ray.x + (cursor.y - from.y) * ray.y
      if (t >= 0) out.push({ point: pt(from.x + ray.x * t, from.y + ray.y * t), kind: 'angle', label })
    }
  }

  if (enabled.has('grid') && gridSpacingMm > 0) {
    const s = gridSpacingMm
    out.push({
      point: pt(Math.round(cursor.x / s) * s, Math.round(cursor.y / s) * s),
      kind: 'grid',
      // No spacing number: a named deviation from the prototype's label (#59 criterion 25).
      label: 'Grid',
    })
  }

  if (enabled.has('wallFace')) {
    for (const wall of walls ?? []) {
      const seen: Pt[] = []
      for (const corner of wall.corners) {
        if (fresh(seen, corner.point)) out.push({ point: corner.point, kind: 'wallFace', label: corner.label })
      }
      for (const face of wall.faces) {
        const at = nearestOnFace(face, cursor)
        if (at !== null && fresh(seen, at)) out.push({ point: at, kind: 'wallFace', label: face.label ?? wall.label })
      }
    }
  }

  return out
}
