/**
 * The Clearance Envelope a `Zone off one edge` commit creates (#76 §4).
 *
 * The person picks a straight Item Footprint edge and a `Depth`; the envelope is the rectangle
 * edge-length × Depth standing outward from that edge, in footprint-local millimetres — the
 * same outward the offset module means, so the zone grows away from the shape and never across
 * it. Nothing here knows a number the person did not enter: no default depth, no rule.
 */
import type { ClosedPath } from '../geometry'
import { pt, signedArea } from '../geometry'

/**
 * The rectangle outward from `edgeIndex`, or `null` when there is no such rectangle: a missing
 * edge, an arc edge (the picker offers straight edges only), or a `depth` that is not a
 * positive finite number — an empty field commits nothing.
 */
export function zoneOffEdgeEnvelope(footprint: ClosedPath, edgeIndex: number, depth: number): ClosedPath | null {
  const segment = footprint.segments[edgeIndex]
  if (segment === undefined || segment.kind !== 'line') return null
  if (!Number.isFinite(depth) || depth <= 0) return null
  const from = edgeStart(footprint, edgeIndex)
  const to = segment.to
  const dx = to.x - from.x
  const dy = to.y - from.y
  const l = Math.hypot(dx, dy)
  if (l <= 0) return null
  // The outward normal, in the offset module's convention: positive `delta` leaves the shape.
  const outward = Math.sign(signedArea(footprint)) || 1
  const nx = (outward * dy) / l
  const ny = (-outward * dx) / l
  return {
    start: pt(from.x, from.y),
    segments: [
      { kind: 'line', to: pt(to.x, to.y) },
      { kind: 'line', to: pt(to.x + nx * depth, to.y + ny * depth) },
      { kind: 'line', to: pt(from.x + nx * depth, from.y + ny * depth) },
      { kind: 'line', to: pt(from.x, from.y) },
    ],
  }
}

/** The point the `edgeIndex`-th segment starts at: the previous segment's end, or the path's start. */
function edgeStart(path: ClosedPath, edgeIndex: number): { x: number; y: number } {
  const before = path.segments[edgeIndex - 1]
  return before === undefined ? path.start : before.to
}
