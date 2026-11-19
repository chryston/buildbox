/**
 * The draft-path state machine (#59 §1, behaviours 9–11).
 *
 * A draft is the sequence of clicks between picking a draw tool and pressing `Close`:
 * a start point, zero or more placed vertices, and a segment in progress that follows the
 * pointer. Everything here is pure — the store holds one `PathDraft` and replaces it with
 * the value these functions return, so undo, Esc and a re-render can never disagree with
 * what was clicked. `ui` may not import `geometry` (#20 §2), so the few pieces of vector
 * arithmetic the rubber band needs are inlined below rather than reached around the façade.
 *
 * Conventions are the ones #54 pinned: millimetres, +X right and +Y down, angles in
 * degrees growing clockwise on screen, arc `sweepDeg` signed with positive clockwise.
 */
import type {
  ArcSegment,
  ClosedPath,
  EllipticalArcSegment,
  LineSegment,
  Pt,
  Segment,
} from '../../../derive'
import { directionDeg, distance, lengthOf, normaliseDeg, pt } from '../../../derive'

const DEG = Math.PI / 180

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y })
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y })
const scale = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k })

/** The direction from `a` to `b` in degrees, clockwise from +X, in (−180, 180]. */
const directionDegOf = (a: Pt, b: Pt): number => Math.atan2(b.y - a.y, b.x - a.x) / DEG

/** The arc subtypes, named by `geometry` and re-exported by `derive` for views (#20 §2). */
type ArcSeg = ArcSegment
type EllipticSeg = EllipticalArcSegment

/** The three tools the draft bar offers (#59 §1). */
export type DrawTool = 'line' | 'arc' | 'ellipticalArc'

/** One placed vertex and the Edge kind that runs to it from the previous vertex. */
export interface DraftVertex {
  readonly to: Pt
  readonly kind: DrawTool
}

export interface PathDraft {
  readonly tool: DrawTool
  readonly start: Pt
  readonly placed: readonly DraftVertex[]
  /** The bulge of the arc/elliptical-arc segment in progress, once its second click landed. */
  readonly bulge: Pt | null
  /** The pointer in local millimetres, or null before it has moved. */
  readonly cursor: Pt | null
  /** A typed length for the segment in progress, exact millimetres, or null. */
  readonly typedLength: number | null
  /** `Close` was pressed with an arc tool: the next click is the closing segment's bulge. */
  readonly pendingClose: boolean
}

/** Open a draft at its start point with nothing placed yet (behaviour 9). */
export const startDraft = (tool: DrawTool, at: Pt): PathDraft => ({
  tool,
  start: at,
  placed: [],
  bulge: null,
  cursor: null,
  typedLength: null,
  pendingClose: false,
})

/**
 * Switch tools mid-draft (behaviour 9): only the tool changes, so the next segment uses
 * it while every already-placed Edge keeps the kind it was drawn with.
 */
export const withTool = (draft: PathDraft, tool: DrawTool): PathDraft => ({ ...draft, tool })

/** Move the pointer; `null` means it left the canvas and the rubber band disappears. */
export const withCursor = (draft: PathDraft, cursor: Pt | null): PathDraft => ({ ...draft, cursor })

/**
 * Type an exact length for the segment in progress (behaviour 9): the direction stays the
 * pointer's, the distance becomes the typed one. It never moves a placed point.
 */
export const withTypedLength = (draft: PathDraft, mm: number | null): PathDraft => ({
  ...draft,
  typedLength: mm,
})

/**
 * Press `Close`. With a line tool the commit is immediate; with an arc tool the draft
 * waits for one more click, which becomes the closing segment's bulge (behaviour 10).
 */
export const beginClose = (draft: PathDraft): PathDraft => ({ ...draft, pendingClose: true })

/** Placed vertices plus the start, which is what the `N points` readout counts. */
export const placedCount = (draft: PathDraft): number => draft.placed.length + 1

/**
 * Backspace: drop the last placed vertex. `null` means nothing is left to take away —
 * only the start remains — and the caller cancels the draft, which is what Esc does.
 * The bulge and any pending close belonged to the vertex that just went away.
 */
export const undoPoint = (draft: PathDraft): PathDraft | null =>
  draft.placed.length === 0
    ? null
    : { ...draft, placed: draft.placed.slice(0, -1), bulge: null, pendingClose: false }

/** The point the segment in progress runs from: the last placed vertex, or the start. */
const lastPoint = (draft: PathDraft): Pt =>
  draft.placed.length === 0 ? draft.start : draft.placed[draft.placed.length - 1].to

/**
 * True while the last placed vertex is an arc or elliptical arc whose second click has
 * not landed: the vertex holds the end point and `bulge` is still null (behaviour 10, D9).
 */
const waitingForBulge = (draft: PathDraft): boolean => {
  if (draft.bulge !== null) return false
  const last = draft.placed[draft.placed.length - 1]
  return last !== undefined && last.kind !== 'line'
}

/**
 * The far end of the segment in progress: the pointer, or — when a length was typed —
 * exactly that many millimetres along the pointer's direction from the last placed point
 * (behaviour 9). Null before the pointer has moved, because there is no direction yet.
 */
export const draftEnd = (draft: PathDraft): Pt | null => {
  if (draft.cursor === null) return null
  if (draft.typedLength === null) return draft.cursor
  const from = lastPoint(draft)
  const span = distance(from, draft.cursor)
  if (span === 0) return draft.cursor
  return add(from, scale(sub(draft.cursor, from), draft.typedLength / span))
}

/**
 * The circle through three points, as the arc that starts at `from`, passes through
 * `bulge` and ends at `to` (behaviour 10, D9). The centre is the perpendicular-bisector
 * solve; `sweepDeg` is the signed clockwise angle from `start − center` to `to − center`
 * taken through `bulge`, so a major arc keeps its > 180° sweep and is never clamped.
 * Collinear or coincident input has no circle, so this returns `null` and the caller
 * keeps its previous value rather than inventing a straight line the user never drew.
 */
const arcThrough = (from: Pt, bulge: Pt, to: Pt): ArcSeg | null => {
  const d = 2 * (from.x * (bulge.y - to.y) + bulge.x * (to.y - from.y) + to.x * (from.y - bulge.y))
  if (Math.abs(d) < 1e-9) return null
  const f = from.x * from.x + from.y * from.y
  const b = bulge.x * bulge.x + bulge.y * bulge.y
  const t = to.x * to.x + to.y * to.y
  const center = pt(
    (f * (bulge.y - to.y) + b * (to.y - from.y) + t * (from.y - bulge.y)) / d,
    (f * (to.x - bulge.x) + b * (from.x - to.x) + t * (bulge.x - from.x)) / d,
  )
  // Clockwise angles from the start ray; in the +Y-down frame `atan2` already grows clockwise.
  const twoPi = 2 * Math.PI
  const clockwiseFrom = (a: number): number => {
    const delta = (a - Math.atan2(from.y - center.y, from.x - center.x)) % twoPi
    return delta < 0 ? delta + twoPi : delta
  }
  const toDelta = clockwiseFrom(Math.atan2(to.y - center.y, to.x - center.x))
  const bulgeDelta = clockwiseFrom(Math.atan2(bulge.y - center.y, bulge.x - center.x))
  if (toDelta === 0) return null
  const sweepRad = bulgeDelta <= toDelta ? toDelta : toDelta - twoPi
  return { kind: 'arc', to, center, sweepDeg: sweepRad / DEG }
}

/**
 * The default elliptical arc (behaviour 11, D9): the chord `from→to` is one full axis and
 * the bulge's perpendicular distance from it is the other semi-axis, so two clicks give a
 * half-ellipse without asking anyone for a rotation. `sweepDeg` is ±180, signed so the arc
 * actually passes through the bulge: in the ellipse's own frame the bulge's local y decides
 * which way round the half turn runs.
 */
const ellipticalThrough = (from: Pt, bulge: Pt, to: Pt): EllipticSeg => {
  const center = pt((from.x + to.x) / 2, (from.y + to.y) / 2)
  const rotationDeg = directionDegOf(from, to)
  const local = rotateDeg(sub(bulge, center), -rotationDeg)
  return {
    kind: 'ellipticalArc',
    to,
    center,
    rx: distance(from, to) / 2,
    ry: Math.abs(local.y),
    rotationDeg,
    sweepDeg: local.y > 0 ? -180 : 180,
  }
}

/** Clockwise rotation by `deg` in the +Y-down frame, matching SVG `rotate()`. */
function rotateDeg(a: Pt, deg: number): Pt {
  if (deg === 0) return { ...a }
  const r = deg * DEG
  const c = Math.cos(r)
  const s = Math.sin(r)
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c }
}

/**
 * A placed arc vertex remembers the bulge click that completed it. `DraftVertex` is the
 * contract's public shape and carries only `to` and `kind`; the extra field is private to
 * this module, so a draft with several arcs can rebuild every one of them after the
 * shared `bulge` slot has moved on to the next segment.
 */
type PlacedVertex = DraftVertex & { readonly bulge?: Pt }

/**
 * The segment a vertex describes once its bulge is known, or `null` while an arc vertex
 * is still waiting for its second click — an incomplete Edge is not a placed Edge.
 */
const segmentFor = (from: Pt, vertex: PlacedVertex, liveBulge: Pt | null): Segment | null => {
  if (vertex.kind === 'line') return { kind: 'line', to: vertex.to }
  const bulge = vertex.bulge ?? liveBulge
  if (bulge === null || bulge === undefined) return null
  if (vertex.kind === 'arc') return arcThrough(from, bulge, vertex.to) ?? { kind: 'line', to: vertex.to }
  return ellipticalThrough(from, bulge, vertex.to)
}

/**
 * The placed Edges each paired with the point it runs from — the pairing every
 * measurement needs, since a `Segment` stores only where it ends.
 */
const placedEdges = (draft: PathDraft): { segment: Segment; from: Pt }[] => {
  const out: { segment: Segment; from: Pt }[] = []
  let from = draft.start
  draft.placed.forEach((vertex, i) => {
    // Only the last vertex can still be waiting for the live bulge, because a click while
    // waiting sets it instead of placing a new vertex; earlier arcs carry their own.
    const liveBulge = i === draft.placed.length - 1 ? draft.bulge : null
    const segment = segmentFor(from, vertex, liveBulge)
    if (segment !== null) out.push({ segment, from })
    from = vertex.to
  })
  return out
}

/**
 * The placed Edges, from `draft.start`, excluding the rubber band. An arc vertex whose
 * bulge has not landed yet is not included: it is still a gesture, not an Edge.
 */
export const draftSegments = (draft: PathDraft): Segment[] => placedEdges(draft).map((edge) => edge.segment)

/** The rubber band: the segment in progress, paired with the point it runs from. */
const rubberBand = (draft: PathDraft): { segment: Segment; from: Pt } | null => {
  if (waitingForBulge(draft)) {
    if (draft.cursor === null) return null
    const vertex = draft.placed[draft.placed.length - 1]
    // The band runs from where the waiting segment starts, not from its end point.
    const from = draft.placed.length >= 2 ? draft.placed[draft.placed.length - 2].to : draft.start
    // Before the bulge lands the preview draws the arc *through the pointer* (behaviour 10).
    const segment =
      vertex.kind === 'arc'
        ? arcThrough(from, draft.cursor, vertex.to) ?? { kind: 'line', to: vertex.to }
        : ellipticalThrough(from, draft.cursor, vertex.to)
    return { segment, from }
  }
  const from = lastPoint(draft)
  if (draft.pendingClose) {
    const bulge = draft.bulge ?? draft.cursor
    const straight: LineSegment = { kind: 'line', to: draft.start }
    const segment =
      draft.tool === 'line' || bulge === null
        ? straight
        : draft.tool === 'arc'
          ? arcThrough(from, bulge, draft.start) ?? straight
          : ellipticalThrough(from, bulge, draft.start)
    return { segment, from }
  }
  const end = draftEnd(draft)
  if (end === null) return null
  // An arc tool's first click only fixes the end point, so until then the band is a line.
  return { segment: { kind: 'line', to: end }, from }
}

/**
 * The placed Edges plus the rubber band to the pointer — or to the closing point while a
 * pending close is picking its bulge — which is everything the canvas draws live.
 */
export const draftPreviewSegments = (draft: PathDraft): Segment[] => {
  const band = rubberBand(draft)
  return band === null ? draftSegments(draft) : [...draftSegments(draft), band.segment]
}

/**
 * The loop the draft would commit if `Close` were pressed now with a line tool: the
 * placed Edges plus a straight closing Edge back to `start`.
 */
export const draftLoop = (draft: PathDraft): ClosedPath => ({
  start: draft.start,
  segments: [...draftSegments(draft), { kind: 'line', to: draft.start }],
})

/**
 * True once the committed loop would have at least three Edges, which is when a draft can
 * be judged at all: a two-Edge loop is not a shape yet, so a fresh draft never reads as
 * invalid while it is being drawn (#54 `too-few-edges`, #59 behaviour 12).
 */
export const draftIsJudgeable = (draft: PathDraft): boolean => draftSegments(draft).length >= 2

/**
 * One click. A line tool places a vertex and clears any typed length, which belonged to
 * the segment that just landed. An arc or elliptical arc takes two clicks: the first is
 * the end point (held as a vertex with no bulge yet), the second is the bulge
 * (behaviours 10 and 11, D9). While a close is pending, the click is the closing
 * segment's bulge.
 */
export const clickDraft = (draft: PathDraft, at: Pt): PathDraft => {
  if (draft.pendingClose) {
    if (draft.tool === 'line') return draft
    return { ...draft, bulge: at }
  }
  if (waitingForBulge(draft)) return { ...draft, bulge: at, typedLength: null }
  // The vertex being left behind, if it is the arc whose bulge just landed, keeps that
  // bulge for itself; the shared slot then belongs to the segment that starts now.
  const placed = [...draft.placed] as PlacedVertex[]
  if (draft.bulge !== null && placed.length > 0)
    placed[placed.length - 1] = { ...placed[placed.length - 1], bulge: draft.bulge }
  return {
    ...draft,
    placed: [...placed, { to: at, kind: draft.tool }],
    bulge: null,
    typedLength: null,
  }
}

/**
 * The closed path a `Close` produces. `kind` is the active tool; the two arc tools need a
 * bulge — the caller passes the one it collected, falling back to the draft's own — and a
 * degenerate (collinear) bulge falls back to a straight closing Edge rather than failing,
 * because the loop still has to close exactly on `start`.
 */
export const closeDraft = (draft: PathDraft, kind: DrawTool, bulge?: Pt | null): ClosedPath => {
  const from = lastPoint(draft)
  const b = bulge ?? draft.bulge ?? draft.cursor
  const closing: Segment =
    kind === 'line' || b === null || b === undefined
      ? { kind: 'line', to: draft.start }
      : kind === 'arc'
        ? arcThrough(from, b, draft.start) ?? { kind: 'line', to: draft.start }
        : ellipticalThrough(from, b, draft.start)
  return { start: draft.start, segments: [...draftSegments(draft), closing] }
}

/**
 * The numbers a chip shows, for the segment in progress — or for the last placed Edge
 * when the pointer has not produced a rubber band. Only the numbers; the UI formats them.
 */
export interface DraftChip {
  readonly kind: DrawTool
  /** Straight length, or the chord for a curve. */
  readonly lengthMm: number
  /** Degrees from +X, clockwise on screen, normalised to [0, 360). */
  readonly directionDeg: number
  /** Circular radius, or null. */
  readonly radiusMm: number | null
  /** Arc length along the curve, or null for a line. */
  readonly arcLengthMm: number | null
  readonly rx: number | null
  readonly ry: number | null
}

/**
 * The chip numbers for one Edge (#59 §1): chord and direction always, radius and arc length
 * for a circular arc, semi-axes and arc length for an elliptical one. Every placed Edge carries
 * a chip while the draft is open, not only the one in progress, so this reads a segment rather
 * than a draft. The arc length comes from `derive`'s `lengthOf`, the same adaptive-Simpson
 * quadrature of the curve's speed that measures every committed Edge — so the chip and the
 * final perimeter cannot disagree.
 */
export const chipForSegment = (segment: Segment, from: Pt): DraftChip => {
  const chord = distance(from, segment.to)
  const base = {
    kind: segment.kind,
    lengthMm: chord,
    directionDeg: normaliseDeg(directionDeg({ kind: 'line', to: segment.to }, from)),
    radiusMm: null as number | null,
    arcLengthMm: null as number | null,
    rx: null as number | null,
    ry: null as number | null,
  }
  if (segment.kind === 'line') return base
  if (segment.kind === 'arc')
    return { ...base, radiusMm: distance(from, segment.center), arcLengthMm: lengthOf(segment, from) }
  return { ...base, arcLengthMm: lengthOf(segment, from), rx: segment.rx, ry: segment.ry }
}

/** The chip for the segment in progress, or the last placed Edge when there is no band. */
export const draftChip = (draft: PathDraft): DraftChip | null => {
  const placed = placedEdges(draft)
  const edge = rubberBand(draft) ?? placed[placed.length - 1]
  return edge === undefined ? null : chipForSegment(edge.segment, edge.from)
}
