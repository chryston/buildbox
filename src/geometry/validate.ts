/**
 * Loop validation (#54 §3, §5).
 *
 * One pass over a closed path reports every problem it has, in a deterministic order that
 * depends on neither the start vertex nor the orientation. Every test is against the one
 * `TOLERANCE_MM` and runs on the exact curves — `flatten` is never consulted, which is
 * what makes a 0.0099 mm gap between two arcs indistinguishable from a 0.011 mm one.
 */
import { distanceBetweenSegments, intersectSegments } from './curve'
import { perimeter, segmentBounds, signedArea } from './measure'
import { presetParametersValid, evaluatePreset } from './presets'
import type { Placement, Preset } from './presets'
import { distance, lengthOf, segmentStart } from './segment'
import type { ClosedPath, GeometryProblem, Pt, Segment } from './types'
import { TOLERANCE_MM, geometryProblem } from './types'
import { childPath } from '../lib'
import type { ValidationProblem } from '../lib'

/** What `validateLoop` accepts: a stored path, or a preset before it becomes one. */
export type LoopInput = ClosedPath | { preset: Preset; placement: Placement }

const isPresetInput = (input: LoopInput): input is { preset: Preset; placement: Placement } =>
  'preset' in input

/**
 * Every problem with one Room Outline, Item Footprint or preset.
 *
 * A preset is checked at parameter level first, because an over-constrained Rounded
 * Rectangle has no path to check: radii of 1,000 and 1,001 on a 2,000 side describe a
 * shape that cannot be drawn, and the answer is one `corner-radii-overlap`.
 */
export const validateLoop = (input: LoopInput): GeometryProblem[] => {
  if (isPresetInput(input)) {
    const parameters = presetParametersValid(input.preset)
    return parameters.length > 0 ? parameters : validateLoop(evaluatePreset(input.preset, input.placement))
  }
  const path = input
  const n = path.segments.length
  if (n < 3) return [geometryProblem('too-few-edges', edgesOf(n))]
  const problems = [
    ...path.segments.flatMap((segment, i) => segmentProblems(segment, segmentStart(path, i), i)),
    // The last `to` is the only endpoint the path type cannot guarantee: it has to be back
    // at `start`, and a gap there is the same "doesn't meet its neighbour" problem.
    ...(distance(path.start, path.segments[n - 1].to) > TOLERANCE_MM
      ? [geometryProblem('arc-not-closed', [n], { values: [distance(path.start, path.segments[n - 1].to)] })]
      : []),
    ...pairProblems(path),
  ]
  const area = Math.abs(signedArea(path))
  if (area <= TOLERANCE_MM * perimeter(path)) problems.push(geometryProblem('no-area', edgesOf(n)))
  return problems
}

const edgesOf = (count: number): number[] => Array.from({ length: count }, (_unused, i) => i + 1)

/** The problems one segment has on its own: no length, a bad radius, an arc that is not a arc. */
const segmentProblems = (segment: Segment, from: Pt, index: number): GeometryProblem[] => {
  const edge = [index + 1]
  const out: GeometryProblem[] = []
  if (lengthOf(segment, from) <= TOLERANCE_MM) out.push(geometryProblem('edge-no-length', edge))
  if (segment.kind === 'arc') {
    const startRadius = distance(from, segment.center)
    const endRadius = distance(segment.to, segment.center)
    const chord = distance(from, segment.to)
    if (startRadius <= TOLERANCE_MM) out.push(geometryProblem('radius-not-positive', edge, { values: [startRadius] }))
    else if (Math.abs(startRadius - endRadius) > TOLERANCE_MM) {
      out.push(geometryProblem('arc-not-closed', edge, { values: [startRadius, endRadius] }))
    } else if (startRadius < chord / 2 - TOLERANCE_MM) {
      out.push(geometryProblem('arc-radius-too-small', edge, { values: [startRadius, chord / 2] }))
    }
  }
  if (segment.kind === 'ellipticalArc' && (segment.rx <= TOLERANCE_MM || segment.ry <= TOLERANCE_MM)) {
    out.push(geometryProblem('radius-not-positive', edge, { values: [segment.rx, segment.ry] }))
  }
  return out
}

/**
 * Meetings between distinct edges. Neighbouring edges are allowed to share exactly their
 * common endpoint; anything else they share, and any meeting between non-neighbours, is a
 * problem. A crossing is reported per meeting point, so a self-crossing loop says so once.
 */
const pairProblems = (path: ClosedPath): GeometryProblem[] => {
  const n = path.segments.length
  const out: GeometryProblem[] = []
  const starts: Pt[] = []
  let walk = path.start
  for (const segment of path.segments) {
    starts.push(walk)
    walk = segment.to
  }
  // Exact bounds per edge, so a pair that cannot come within tolerance of each other is
  // rejected before the analytic curve intersection runs. On a convex preset that is
  // almost every pair, and the arc solver is the most expensive thing in the module.
  const boxes = path.segments.map((segment, i) => segmentBounds(segment, starts[i]))
  for (let i = 0; i < n; i++) {
    const fromA = starts[i]
    const boxA = boxes[i]
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === n - 1)
      const boxB = boxes[j]
      if (
        !adjacent &&
        (boxA.minX - TOLERANCE_MM > boxB.maxX ||
          boxB.minX - TOLERANCE_MM > boxA.maxX ||
          boxA.minY - TOLERANCE_MM > boxB.maxY ||
          boxB.minY - TOLERANCE_MM > boxA.maxY)
      ) {
        continue
      }
      const fromB = starts[j]
      const edges = [i + 1, j + 1]
      const meetings = intersectSegments(path.segments[i], fromA, path.segments[j], fromB)
      const shared = adjacent ? sharedVertex(path, i, j) : null
      const crossings = meetings.crossings.filter((m) => !atVertex(m.at, shared))
      const touches = meetings.touches.filter((m) => !atVertex(m.at, shared))
      for (const crossing of crossings) out.push(geometryProblem('edges-cross', edges, { at: crossing.at }))
      if (crossings.length > 0) continue
      if (meetings.overlaps.length > 0) {
        out.push(geometryProblem('edges-touch', edges, { at: meetings.overlaps[0].from }))
        continue
      }
      if (touches.length > 0) {
        out.push(geometryProblem('edges-touch', edges, { at: touches[0].at }))
        continue
      }
      if (adjacent) continue
      const near = distanceBetweenSegments(path.segments[i], fromA, path.segments[j], fromB)
      if (near.distance <= TOLERANCE_MM) out.push(geometryProblem('edges-touch', edges, { at: near.at }))
    }
  }
  return out
}

/** The endpoint two neighbouring edges share, which is the one meeting that is legal. */
const sharedVertex = (path: ClosedPath, i: number, j: number): Pt => (j === i + 1 ? path.segments[i].to : path.start)

const atVertex = (at: Pt, shared: Pt | null): boolean => shared !== null && distance(at, shared) <= TOLERANCE_MM

/**
 * The lib shape the UI and the persistence layer consume. `basePath` locates the footprint
 * (`itemDesigns[2].footprint`) and the first named edge becomes the array index, so a
 * problem with edge 4 of that footprint reads `itemDesigns[2].footprint.segments[3]`.
 */
export const toValidationProblems = (
  problems: GeometryProblem[],
  basePath: string,
  format: (problem: GeometryProblem) => string,
): ValidationProblem[] =>
  problems.map((one) => ({
    path: one.edges.length > 0
      ? childPath(childPath(basePath, 'segments'), one.edges[0] - 1)
      : basePath,
    code: one.code,
    message: format(one),
  }))
