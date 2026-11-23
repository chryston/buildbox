/**
 * The `New Elevation View` draft (#75 §3, behaviour 12, D5).
 *
 * Three steps, one after the other: the view line's start, its end, then the side and the depth.
 * The whole machine is a value — a draft is a `ElevationDraft` and nothing else — so the overlay
 * that draws it holds no logic of its own, Esc is `null`, and a test can drive the tool without a
 * canvas.
 *
 * The depth is not typed first and clicked second or the other way round: both are the same
 * `side` + `depth` pair, so the pointer's perpendicular distance and a number in the box arrive at
 * the same field. That is what lets step three say "click, or type it" without two code paths.
 */
import type { ElevationViewSide } from '../../../domain'
import type { Pt } from '../../../derive'

/** The view line and the prism it stands on, as the draft holds them. */
export interface ElevationDraft {
  start: Pt | null
  end: Pt | null
  /** Which side of the line the view stands on, read from the pointer. */
  side: ElevationViewSide
  /** How far in front of the line the view reaches, in millimetres. */
  depth: number
}

/** A draft with nothing in it but the defaults the pointer has not yet contradicted. */
export const emptyElevationDraft = (): ElevationDraft => ({ start: null, end: null, side: 'left', depth: 0 })

/** Which of the three clicks the person is on. */
export type ElevationDraftStep = 'start' | 'end' | 'depth'

export function elevationDraftStep(draft: ElevationDraft | null): ElevationDraftStep {
  if (draft === null || draft.start === null) return 'start'
  return draft.end === null ? 'end' : 'depth'
}

/** The unit normal to the left of `start → end`, or `null` for a zero-length line. */
export function leftNormal(start: Pt, end: Pt): Pt | null {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  if (length === 0) return null
  return { x: -dy / length, y: dx / length }
}

/** The direction the viewer stands toward: into the band, perpendicular to the view line. */
export function viewNormal(start: Pt, end: Pt, side: ElevationViewSide): Pt | null {
  const n = leftNormal(start, end)
  if (n === null) return null
  return side === 'left' ? n : { x: -n.x, y: -n.y }
}

/**
 * Which side of the line a place stands on (#75 §3 step 3).
 *
 * The test is the dot product with the left normal rather than the sign of a cross product: the
 * two agree, and this one says in words what it asks — is the point in front of the left face.
 */
export function sideOf(start: Pt, end: Pt, at: Pt): ElevationViewSide {
  const n = leftNormal(start, end)
  if (n === null) return 'left'
  return (at.x - start.x) * n.x + (at.y - start.y) * n.y >= 0 ? 'left' : 'right'
}

/** How far a place stands from the line, ignoring which side — the depth the pointer is offering. */
export function distanceFromLine(start: Pt, end: Pt, at: Pt): number {
  const n = leftNormal(start, end)
  if (n === null) return 0
  return Math.abs((at.x - start.x) * n.x + (at.y - start.y) * n.y)
}

/**
 * The pointer moving to `at` at the step the draft is on.
 *
 * A point on the line's own perpendicular is not special: the depth is the distance, so a pointer
 * dragged along the line keeps the depth it had and a pointer pulled away grows the prism.
 */
export function elevationAim(draft: ElevationDraft, at: Pt): ElevationDraft {
  const step = elevationDraftStep(draft)
  if (step === 'start') return { ...draft, start: at }
  if (step === 'end') return { ...draft, end: at }
  return { ...draft, side: sideOf(draft.start!, draft.end!, at), depth: distanceFromLine(draft.start!, draft.end!, at) }
}

/** The four corners of the prism the draft covers, in order: the line, then the far edge. */
export function elevationPrismPoints(start: Pt, end: Pt, side: ElevationViewSide, depth: number): Pt[] {
  const n = viewNormal(start, end, side)
  if (n === null) return []
  const far = { x: n.x * depth, y: n.y * depth }
  return [
    start,
    end,
    { x: end.x + far.x, y: end.y + far.y },
    { x: start.x + far.x, y: start.y + far.y },
  ]
}

/**
 * The marker's arrow: a shaft at the line's midpoint pointing into the band, `lengthMm` long or as
 * far as the band goes, whichever is shorter, with two barbs at the tip.
 *
 * It is drawn in millimetres of the Floor and scaled by the canvas, so it keeps its shape at any
 * zoom; the caller passes a length that has already been divided by the zoom when it wants the
 * glyph to stay a fixed size on screen.
 */
export function elevationArrowPath(start: Pt, end: Pt, side: ElevationViewSide, depth: number, lengthMm: number): string {
  const n = viewNormal(start, end, side)
  if (n === null) return ''
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
  const reach = Math.min(lengthMm, depth)
  const tip = { x: mid.x + n.x * reach, y: mid.y + n.y * reach }
  // The barbs come off the tip back along the shaft, at ±30°: a wide head reads as an arrow at the
  // small sizes a plan marker is drawn at, and a narrow one disappears.
  const ux = n.x
  const uy = n.y
  const barb = lengthMm * 0.32
  const cos = Math.cos(Math.PI / 6)
  const sin = Math.sin(Math.PI / 6)
  const left = { x: tip.x - barb * (ux * cos - uy * sin), y: tip.y - barb * (ux * sin + uy * cos) }
  const right = { x: tip.x - barb * (ux * cos + uy * sin), y: tip.y - barb * (ux * sin - uy * cos) }
  return `M ${mid.x} ${mid.y} L ${tip.x} ${tip.y} M ${tip.x} ${tip.y} L ${left.x} ${left.y} M ${tip.x} ${tip.y} L ${right.x} ${right.y}`
}

/** Where the marker's name sits: outside the band, past the line's midpoint, so it never covers it. */
export function elevationLabelAt(start: Pt, end: Pt, side: ElevationViewSide, depth: number): Pt {
  const n = viewNormal(start, end, side)
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
  if (n === null) return mid
  return { x: mid.x - n.x * depth * 0.08, y: mid.y - n.y * depth * 0.08 }
}

/**
 * The far-edge handle of a live view: the midpoint of the prism's far edge, which is the one place
 * a drag changes the depth and nothing else.
 */
export function farEdgeHandle(start: Pt, end: Pt, side: ElevationViewSide, depth: number): Pt | null {
  const n = viewNormal(start, end, side)
  if (n === null) return null
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
  return { x: mid.x + n.x * depth, y: mid.y + n.y * depth }
}

/**
 * A far-edge drag: the new depth is the pointer's distance from the line, and the side never moves
 * — pulling the far edge through the line makes the view look the other way, which is what the
 * `Direction ⇄` button is for, not what a depth drag is for.
 */
export function depthDrag(draft: { start: Pt; end: Pt; side: ElevationViewSide }, at: Pt): number {
  return distanceFromLine(draft.start, draft.end, at)
}
