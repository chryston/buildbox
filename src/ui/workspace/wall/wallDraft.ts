/**
 * The Wall tool's draft (#64 §12): the clicks between picking `Wall` and pressing `Finish`.
 *
 * Everything here is pure, in the same shape as `shape/draftPath`: the store holds one draft and
 * replaces it with what these functions return, so `Undo point`, Esc and a re-render can never
 * disagree with what was clicked. A draft is a chain of reference-line segments — the tidied band
 * is derived on read, so nothing here builds an outline, and nothing here allocates a Wall id:
 * the Intent's ids come from the session's source (#22).
 *
 * The words are the acceptance text: `Join to end of W-3`, `Attach to W-3`, `2,000 mm · 90°`,
 * `R 1,500 · 2,356 mm`. Never a side, never a centreline (#64 §7, D6).
 */
import type { Pt } from '../../../derive'
import { distance, normaliseDeg, pt } from '../../../derive'
import type { WallEndTarget } from '../../../edit'

/** The direction from `a` to `b` in degrees, clockwise from +X, in the +Y-down frame. */
const directionBetween = (a: Pt, b: Pt): number => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI

/** The three segment modes of the Wall tool (#64 §12). */
export type WallSegmentTool = 'line' | 'arc' | 'arcFromLast'

/**
 * What the pointer is over while drawing. `end` and `face` are the only two things that make a
 * Junction; `free` makes none, however close the pointer is to another Wall (#64 criterion 4).
 */
export type WallSnapTarget =
  | { readonly kind: 'free' }
  | { readonly kind: 'end'; readonly wallId: string; readonly ref: string; readonly end: 'start' | 'end' }
  | { readonly kind: 'face'; readonly wallId: string; readonly ref: string }

export const FREE_TARGET: WallSnapTarget = { kind: 'free' }

/** The indicator over the pointer, or `null` when nothing would be joined. */
export const joinLabel = (target: WallSnapTarget): string | null => {
  if (target.kind === 'end') return `Join to end of ${target.ref}`
  if (target.kind === 'face') return `Attach to ${target.ref}`
  return null
}

/** The same target as the Intent's payload. */
export const toEndTarget = (target: WallSnapTarget): WallEndTarget => {
  if (target.kind === 'end') return { kind: 'wall', wallId: target.wallId, end: target.end }
  if (target.kind === 'face') return { kind: 'host', wallId: target.wallId }
  return { kind: 'free' }
}

/**
 * One node of the draft: an `end` is a point the reference line runs through, a `bulge` is the
 * click that gives the segment leaving it its curve. Only `end` nodes carry a join target.
 */
export interface WallDraftNode {
  readonly at: Pt
  readonly role: 'end' | 'bulge'
  readonly target: WallSnapTarget
}

export interface WallDraft {
  readonly tool: WallSegmentTool
  /** At least one node: the start point. */
  readonly nodes: readonly WallDraftNode[]
  /** The rubber band, or `null` before the pointer has moved onto the canvas. */
  readonly cursor: WallDraftNode | null
  /** A typed length for the segment in progress, exact millimetres, or `null`. */
  readonly typedLength: number | null
}

/** Open a draft at its first point. */
export const startWallDraft = (at: Pt, tool: WallSegmentTool = 'line'): WallDraft => ({
  tool,
  nodes: [{ at, role: 'end', target: FREE_TARGET }],
  cursor: null,
  typedLength: null,
})

export const withWallTool = (draft: WallDraft, tool: WallSegmentTool): WallDraft => ({ ...draft, tool })

/**
 * Whether the next click with the `Arc` tool gives the segment in progress its curve: the end
 * is clicked first, the bulge second, so an odd number of clicks after the start means the
 * curve is still missing.
 */
export const pendingBulge = (draft: WallDraft): boolean =>
  draft.tool === 'arc' && draft.nodes.length % 2 === 0

export const withWallCursor = (draft: WallDraft, at: Pt | null, target: WallSnapTarget = FREE_TARGET): WallDraft => ({
  ...draft,
  cursor: at === null ? null : { at, role: pendingBulge(draft) ? 'bulge' : 'end', target },
})

export const withTypedLength = (draft: WallDraft, typedLength: number | null): WallDraft => ({
  ...draft,
  typedLength,
})

/** The last placed node, which is where the segment in progress starts. */
export const lastNode = (draft: WallDraft): WallDraftNode => draft.nodes[draft.nodes.length - 1]!

/** The last placed `end`, which is the start of the segment the next click will finish. */
const lastEnd = (draft: WallDraft): WallDraftNode | null => {
  for (let index = draft.nodes.length - 1; index >= 0; index -= 1) {
    if (draft.nodes[index]!.role === 'end') return draft.nodes[index]!
  }
  return null
}

/** One drawn segment of the chain, in reference-line terms. */
export interface WallDraftSegment {
  readonly start: Pt
  readonly end: Pt
  readonly through: Pt | null
  readonly startTarget: WallSnapTarget
  readonly endTarget: WallSnapTarget
}

/**
 * The segments drawn so far. A `bulge` node curves the segment that ran to the end before it —
 * the end is clicked, then the curve — so a segment still without one is a line, which is what
 * the rubber band shows while that second click is on its way.
 */
export const draftSegments = (draft: WallDraft): readonly WallDraftSegment[] => {
  const out: WallDraftSegment[] = []
  let start: WallDraftNode | null = null
  for (const node of draft.nodes) {
    if (node.role === 'bulge') {
      const last = out[out.length - 1]
      if (last !== undefined) out[out.length - 1] = { ...last, through: node.at }
      continue
    }
    if (start !== null) {
      out.push({ start: start.at, end: node.at, through: null, startTarget: start.target, endTarget: node.target })
    }
    start = node
  }
  if (start !== null && draft.cursor !== null && draft.cursor.role === 'end') {
    out.push({
      start: start.at,
      end: draft.cursor.at,
      through: null,
      startTarget: start.target,
      endTarget: draft.cursor.target,
    })
  }
  return out
}

/** The direction the drawing is heading, which is what `Arc from last` continues. */
export const draftHeadingDeg = (draft: WallDraft): number => {
  const segments = draftSegments({ ...draft, cursor: null })
  const last = segments[segments.length - 1]
  if (last === undefined) return 0
  if (last.through === null) return directionBetween(last.start, last.end)
  const curve = circleThrough(last.start, last.through, last.end)
  if (curve === null) return directionBetween(last.start, last.end)
  const radial = Math.atan2(last.end.y - curve.center.y, last.end.x - curve.center.x)
  const turned = radial + (curve.sweep >= 0 ? Math.PI / 2 : -Math.PI / 2)
  return (turned * 180) / Math.PI
}

/**
 * The point that curves an arc leaving `start` along `tangentDeg` and arriving at `end`: the
 * centre is where the perpendicular to that tangent meets the perpendicular bisector of the two
 * points, so one click is enough and the curve is the one that carries on (#64 §12).
 */
export const tangentArcThrough = (start: Pt, tangentDeg: number, end: Pt): Pt | null => {
  const radians = (tangentDeg * Math.PI) / 180
  const nx = -Math.sin(radians)
  const ny = Math.cos(radians)
  const dx = end.x - start.x
  const dy = end.y - start.y
  const denominator = nx * dx + ny * dy
  if (Math.abs(denominator) < 1e-9) return null
  const s = ((end.x * end.x - start.x * start.x + end.y * end.y - start.y * start.y) / 2
    - (start.x * dx + start.y * dy)) / denominator
  const cx = start.x + nx * s
  const cy = start.y + ny * s
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null
  return throughOn(cx, cy, start, end)
}

/** The point of the circle halfway between the two ends along the shorter way round. */
const throughOn = (cx: number, cy: number, start: Pt, end: Pt): Pt => {
  const a0 = Math.atan2(start.y - cy, start.x - cx)
  const a1 = Math.atan2(end.y - cy, end.x - cx)
  let delta = a1 - a0
  while (delta > Math.PI) delta -= 2 * Math.PI
  while (delta < -Math.PI) delta += 2 * Math.PI
  const radius = Math.hypot(start.x - cx, start.y - cy)
  const mid = a0 + delta / 2
  return pt(cx + radius * Math.cos(mid), cy + radius * Math.sin(mid))
}

/**
 * Place the cursor: the click lands where the rubber band is, or — with a typed length — at
 * exactly that distance along the direction being drawn (#64 §12). `Arc from last` inserts its
 * bulge itself, because that arc is fully determined by the previous tangent and the new end.
 */
export const placePoint = (draft: WallDraft): WallDraft | null => {
  if (draft.cursor === null) return null
  const from = lastNode(draft).at
  const at = draft.typedLength === null ? draft.cursor.at : along(from, draft.cursor.at, draft.typedLength)
  const node: WallDraftNode = { at, role: draft.cursor.role, target: draft.cursor.target }
  if (draft.tool === 'arcFromLast' && node.role === 'end' && lastEnd(draft) !== null && draft.nodes.length >= 2) {
    const through = tangentArcThrough(from, draftHeadingDeg(draft), at)
    if (through !== null) {
      return {
        ...draft,
        nodes: [...draft.nodes, node, { at: through, role: 'bulge', target: FREE_TARGET }],
        typedLength: null,
        cursor: null,
      }
    }
  }
  return { ...draft, nodes: [...draft.nodes, node], typedLength: null, cursor: null }
}

/** `Undo point`: the last click goes; the start point stays until the draft is cancelled. */
export const undoPoint = (draft: WallDraft): WallDraft =>
  draft.nodes.length <= 1 ? draft : { ...draft, nodes: draft.nodes.slice(0, -1) }

/** `Finish` needs at least one whole segment: a start and one placed end. */
export const canFinish = (draft: WallDraft): boolean =>
  draft.nodes.filter((node) => node.role === 'end').length >= 2

/** The direction from `from` toward `toward`, run out to `length` millimetres. */
const along = (from: Pt, toward: Pt, length: number): Pt => {
  const dx = toward.x - from.x
  const dy = toward.y - from.y
  const l = Math.hypot(dx, dy)
  if (l === 0) return pt(from.x + length, from.y)
  return pt(from.x + (dx / l) * length, from.y + (dy / l) * length)
}

/** The circle through three points, with the signed sweep from `start` to `end`. */
export const circleThrough = (
  start: Pt,
  through: Pt,
  end: Pt,
): { center: Pt; radius: number; sweep: number } | null => {
  const d = 2 * (start.x * (through.y - end.y) + through.x * (end.y - start.y) + end.x * (start.y - through.y))
  if (Math.abs(d) < 1e-9) return null
  const sa = start.x * start.x + start.y * start.y
  const sb = through.x * through.x + through.y * through.y
  const sc = end.x * end.x + end.y * end.y
  const ux = (sa * (through.y - end.y) + sb * (end.y - start.y) + sc * (start.y - through.y)) / d
  const uy = (sa * (end.x - through.x) + sb * (start.x - end.x) + sc * (through.x - start.x)) / d
  const angle = (x: number, y: number): number => Math.atan2(y - uy, x - ux)
  const a0 = angle(start.x, start.y)
  const wrap = (t: number): number => {
    let value = t
    while (value > Math.PI) value -= 2 * Math.PI
    while (value < -Math.PI) value += 2 * Math.PI
    return value
  }
  const sweep = wrap(angle(through.x, through.y) - a0) + wrap(angle(end.x, end.y) - angle(through.x, through.y))
  return { center: pt(ux, uy), radius: Math.hypot(start.x - ux, start.y - uy), sweep }
}

/** The live chip of a segment: `2,000 mm · 90°`, or `R 1,500 · 2,356 mm` (#64 §12). */
export const draftChip = (segment: WallDraftSegment, num: (mm: number) => string, unit: string): string => {
  if (segment.through === null) {
    const direction = Math.round(normaliseDeg(directionBetween(segment.start, segment.end)))
    return `${num(distance(segment.start, segment.end))} ${unit} · ${direction}°`
  }
  const curve = circleThrough(segment.start, segment.through, segment.end)
  const radius = curve?.radius ?? distance(segment.start, segment.through)
  const arcLength = curve === null ? distance(segment.start, segment.end) : radius * Math.abs(curve.sweep)
  return `R ${num(radius)} ${unit} · ${num(arcLength)} ${unit}`
}

/** What a finished chain sends: one Wall per segment, plus the Junctions the clicks named. */
export interface WallChainDraft {
  readonly floorId: string
  readonly walls: readonly {
    line: { kind: 'line'; start: Pt; end: Pt } | { kind: 'arc'; start: Pt; end: Pt; through: Pt }
    thickness: number
    justification: 'left' | 'centre' | 'right'
    baseElevation: number
    height: number
  }[]
  readonly starts: readonly WallEndTarget[]
  readonly ends: readonly WallEndTarget[]
}

/**
 * The committed chain. An interior point with nothing under it joins the two segments of the
 * chain to each other (#64 §8); a point that was snapped to another Wall gives both of its ends
 * that same target, so the new pair and the existing end land in one Junction.
 */
export const toChainPayload = (
  draft: WallDraft,
  floorId: string,
  defaults: {
    thickness: number
    justification: 'left' | 'centre' | 'right'
    baseElevation: number
    height: number
  },
): WallChainDraft | null => {
  const segments = draftSegments(draft)
  if (segments.length === 0) return null
  const walls = segments.map((segment) => ({
    line: segment.through === null
      ? { kind: 'line' as const, start: segment.start, end: segment.end }
      : { kind: 'arc' as const, start: segment.start, end: segment.end, through: segment.through },
    thickness: defaults.thickness,
    justification: defaults.justification,
    baseElevation: defaults.baseElevation,
    height: defaults.height,
  }))
  const starts = segments.map((segment) => toEndTarget(segment.startTarget))
  const ends = segments.map((segment) => toEndTarget(segment.endTarget))
  for (let index = 1; index < segments.length; index += 1) {
    if (starts[index]!.kind === 'free' && ends[index - 1]!.kind === 'free') {
      starts[index] = { kind: 'segment', index: index - 1, end: 'end' }
      ends[index - 1] = { kind: 'segment', index, end: 'start' }
    }
  }
  return { floorId, walls, starts, ends }
}
