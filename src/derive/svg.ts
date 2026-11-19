/**
 * A closed path as SVG path data (#58 §8).
 *
 * Arcs are written as SVG `A` commands with `large-arc` and `sweep` derived from the
 * segment's own sweep, and an elliptical arc carries its `rx`, `ry` and `rotationDeg`
 * through. Nothing is flattened for display: the browser draws the same analytic curve the
 * kernel measured, so the outline on screen, the exported SVG and the reported perimeter
 * cannot drift apart as the zoom changes.
 *
 * The two flags come straight out of the shared conventions. Both frames are +Y-down and
 * both measure a positive sweep clockwise, so `sweepDeg > 0` is SVG's `sweep-flag: 1` and a
 * sweep past a half turn is the large arc — no sign flip and no complement, which is the
 * whole reason this lives beside the kernel rather than inside a component.
 */
import type { ClosedPath, Pt, Segment } from '../geometry'

/** Millimetre coordinates to three decimals: a micrometre, and never `-0`. */
const n = (value: number): string => {
  const rounded = Math.round(value * 1000) / 1000
  const text = Object.is(rounded, -0) ? '0' : String(rounded)
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text
}

const point = (p: Pt): string => `${n(p.x)} ${n(p.y)}`

/** `large-arc-flag` and `sweep-flag` for one arc's signed sweep in degrees. */
const flags = (sweepDeg: number): string => `${Math.abs(sweepDeg) > 180 ? 1 : 0} ${sweepDeg >= 0 ? 1 : 0}`

function segmentData(segment: Segment, from: Pt): string {
  switch (segment.kind) {
    case 'line':
      return `L ${point(segment.to)}`
    case 'arc': {
      const radius = Math.hypot(segment.center.x - from.x, segment.center.y - from.y)
      return `A ${n(radius)} ${n(radius)} 0 ${flags(segment.sweepDeg)} ${point(segment.to)}`
    }
    case 'ellipticalArc':
      return (
        `A ${n(segment.rx)} ${n(segment.ry)} ${n(segment.rotationDeg)} ` +
        `${flags(segment.sweepDeg)} ${point(segment.to)}`
      )
  }
}

/**
 * The path data for one closed path, starting at its `start` point.
 *
 * A path whose last Edge does not return to `start` is drawn as stored rather than silently
 * closed: an invalid proposal has to look invalid on the canvas, and `Z` would hide the gap.
 */
export function pathToSvg(path: ClosedPath): string {
  let cursor = path.start
  const parts = [`M ${point(path.start)}`]
  for (const segment of path.segments) {
    parts.push(segmentData(segment, cursor))
    cursor = segment.to
  }
  return parts.join(' ')
}
