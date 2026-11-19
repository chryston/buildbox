/**
 * The preset catalog (#54 §5, behaviours 7 and 8, decisions D1 and D5).
 *
 * Exactly eight kinds exist and no `L` or `U` shape does (D5). Every preset evaluates
 * **clockwise on screen**, in a local frame whose bounds are centred on the origin, and is
 * then rotated about that centre and translated to `placement.centre` — the centre of the
 * local bounds is both the position and the orientation pivot.
 *
 * A Circle and an Ellipse are four quarter arcs split at the axis extremes, never two half
 * arcs (D1): two half arcs would each have `start` equal to `to`, which reads as a
 * degenerate loop. The Capsule's end radius is `width ÷ 2`, derived and never stored (D5).
 */
import { applyTransform, transformSegment } from './measure'
import { distance, normaliseDeg } from './segment'
import type { ClosedPath, GeometryProblem, Pt, Segment, SideName } from './types'
import { geometryProblem, pt } from './types'

/** Where a preset sits: the centre of its local bounds, rotated clockwise about it. */
export interface Placement {
  centre: Pt
  orientationDeg: number
}

/** The four corners of a Rounded Rectangle, named by their position at 0°. */
export interface CornerRadii {
  topLeft: number
  topRight: number
  bottomRight: number
  bottomLeft: number
}

export interface SquarePreset {
  kind: 'square'
  side: number
}
export interface RectanglePreset {
  kind: 'rectangle'
  width: number
  depth: number
}
export interface RoundedRectanglePreset {
  kind: 'roundedRectangle'
  width: number
  depth: number
  /** Either one radius for all four corners, or the four corners named at 0°. */
  radius?: number
  radii?: CornerRadii
}
export interface CirclePreset {
  kind: 'circle'
  diameter: number
}
export interface EllipsePreset {
  kind: 'ellipse'
  width: number
  depth: number
}
export interface CapsulePreset {
  kind: 'capsule'
  length: number
  width: number
}
export interface TrianglePreset {
  kind: 'triangle'
  baseWidth: number
  depth: number
  /** From the base's left end; the default is `baseWidth ÷ 2`, and 0 is a right triangle. */
  apexOffset?: number
}
export interface RegularPolygonPreset {
  kind: 'regularPolygon'
  sideCount: number
  sideLength: number
}

/** The catalog, exactly (#54 criterion 3, D5). */
export type Preset =
  | SquarePreset
  | RectanglePreset
  | RoundedRectanglePreset
  | CirclePreset
  | EllipsePreset
  | CapsulePreset
  | TrianglePreset
  | RegularPolygonPreset

export type PresetKind = Preset['kind']

/** The one list the catalog is checked against; no `L` or `U` kind exists. */
export const PRESET_KINDS: readonly PresetKind[] = [
  'square',
  'rectangle',
  'roundedRectangle',
  'circle',
  'ellipse',
  'capsule',
  'triangle',
  'regularPolygon',
]

/** The corner order around the loop, clockwise from the top-left. */
export const CORNER_ORDER: readonly (keyof CornerRadii)[] = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft']

/** One side of a rectangular preset: the corner it runs from, the one it runs to, its length. */
interface Side {
  side: SideName
  from: keyof CornerRadii
  to: keyof CornerRadii
  length: (preset: RoundedRectanglePreset) => number
}

const SIDES: readonly Side[] = [
  { side: 'top', from: 'topLeft', to: 'topRight', length: (p) => p.width },
  { side: 'right', from: 'topRight', to: 'bottomRight', length: (p) => p.depth },
  { side: 'bottom', from: 'bottomRight', to: 'bottomLeft', length: (p) => p.width },
  { side: 'left', from: 'bottomLeft', to: 'topLeft', length: (p) => p.depth },
]

/** The four corner radii of a Rounded Rectangle, `radius` expanded to all four. */
export const cornerRadiiOf = (preset: RoundedRectanglePreset): CornerRadii =>
  preset.radii ?? {
    topLeft: preset.radius ?? 0,
    topRight: preset.radius ?? 0,
    bottomRight: preset.radius ?? 0,
    bottomLeft: preset.radius ?? 0,
  }

/** The closed form a preset's area is checked against (#54 §9). */
export const presetArea = (preset: Preset): number => {
  switch (preset.kind) {
    case 'square':
      return preset.side * preset.side
    case 'rectangle':
      return preset.width * preset.depth
    case 'roundedRectangle': {
      // Each corner removes r² − πr²/4 from the rectangle.
      const r = cornerRadiiOf(preset)
      const loss = CORNER_ORDER.reduce((sum, k) => sum + r[k] * r[k] * (1 - Math.PI / 4), 0)
      return preset.width * preset.depth - loss
    }
    case 'circle':
      return Math.PI * (preset.diameter / 2) ** 2
    case 'ellipse':
      return Math.PI * (preset.width / 2) * (preset.depth / 2)
    case 'capsule':
      return preset.width * (preset.length - preset.width) + Math.PI * (preset.width / 2) ** 2
    case 'triangle':
      return (preset.baseWidth * preset.depth) / 2
    case 'regularPolygon':
      return (preset.sideCount * preset.sideLength ** 2) / (4 * Math.tan(Math.PI / preset.sideCount))
  }
}

/** The closed form a preset's perimeter is checked against (#54 §9). */
export const presetPerimeter = (preset: Preset): number => {
  switch (preset.kind) {
    case 'square':
      return 4 * preset.side
    case 'rectangle':
      return 2 * (preset.width + preset.depth)
    case 'roundedRectangle': {
      // Each side keeps its length minus the two radii; the quarter arcs together make one
      // full circle's worth of arc per unit of summed radius.
      const r = cornerRadiiOf(preset)
      const summed = CORNER_ORDER.reduce((sum, k) => sum + r[k], 0)
      return 2 * (preset.width + preset.depth) - 2 * summed + (Math.PI / 2) * summed
    }
    case 'circle':
      return Math.PI * preset.diameter
    case 'ellipse':
      return ramanujanPerimeter(preset.width / 2, preset.depth / 2)
    case 'capsule':
      return 2 * (preset.length - preset.width) + Math.PI * preset.width
    case 'triangle': {
      const offset = preset.apexOffset ?? preset.baseWidth / 2
      return (
        preset.baseWidth +
        Math.hypot(offset, preset.depth) +
        Math.hypot(preset.baseWidth - offset, preset.depth)
      )
    }
    case 'regularPolygon':
      return preset.sideCount * preset.sideLength
  }
}

/** Ramanujan's second approximation for an ellipse's perimeter, the quadrature's oracle. */
export const ramanujanPerimeter = (rx: number, ry: number): number => {
  const h = ((rx - ry) / (rx + ry)) ** 2
  return Math.PI * (rx + ry) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)))
}

/** The across-corners and across-flats distances of a regular polygon, for read-only display. */
export const regularPolygonMetrics = (sideCount: number, sideLength: number): { acrossCorners: number; acrossFlats: number } => ({
  acrossCorners: sideLength / Math.sin(Math.PI / sideCount),
  acrossFlats: sideLength / Math.tan(Math.PI / sideCount),
})

/** A size in local millimetres — the only thing two different preset kinds can agree on. */
export interface SizeBox {
  readonly width: number
  readonly depth: number
}

/**
 * The preset of `kind` that fits a box (#58 §4, §5).
 *
 * A box is what both gestures produce: a dragged rectangle on the canvas, and the local bounds
 * of the shape a kind switch is replacing. A preset's own parameters mean nothing to another
 * kind — a Circle has no depth to inherit — so the box is the only size either one can offer.
 *
 * Where the new kind takes two numbers they are the box's own, in the order they were drawn.
 * Where it takes one it takes the smaller axis, so a Circle in a 1,200 × 400 box is Ø400 and
 * still fits where it was rather than Ø1,200 with most of it off the paper. A Regular Polygon
 * is sized so its across-corners span the smaller axis, for the same reason: corners are what
 * would poke out.
 */
export const presetInBox = (kind: PresetKind, box: SizeBox): Preset => {
  const small = Math.min(box.width, box.depth)
  const large = Math.max(box.width, box.depth)
  switch (kind) {
    case 'square':
      return { kind: 'square', side: small }
    case 'rectangle':
      return { kind: 'rectangle', width: box.width, depth: box.depth }
    case 'roundedRectangle':
      return { kind: 'roundedRectangle', width: box.width, depth: box.depth, radius: 0 }
    case 'circle':
      return { kind: 'circle', diameter: small }
    case 'ellipse':
      return { kind: 'ellipse', width: box.width, depth: box.depth }
    case 'capsule':
      return { kind: 'capsule', length: large, width: small }
    case 'triangle':
      return { kind: 'triangle', baseWidth: box.width, depth: box.depth }
    case 'regularPolygon':
      return { kind: 'regularPolygon', sideCount: 6, sideLength: small * Math.sin(Math.PI / 6) }
  }
}

/** Square and Rectangle: four lines, start top-left, edges top, right, bottom, left. */
const rectangle = (width: number, depth: number): ClosedPath => {
  const start = pt(-width / 2, -depth / 2)
  return {
    start,
    segments: [
      { kind: 'line', to: pt(width / 2, -depth / 2) },
      { kind: 'line', to: pt(width / 2, depth / 2) },
      { kind: 'line', to: pt(-width / 2, depth / 2) },
      { kind: 'line', to: start },
    ],
  }
}

/**
 * Rounded Rectangle: top line, top-right arc, right line, bottom-right arc, bottom line,
 * bottom-left arc, left line, top-left arc. A zero radius omits its arc; a side whose two
 * radii sum exactly to its length omits its zero-length straight (behaviour 7's equality
 * case), so the path never carries a zero-length edge.
 */
const roundedRectangle = (preset: RoundedRectanglePreset): ClosedPath => {
  const r = cornerRadiiOf(preset)
  // The four corners at 0°, clockwise from top-left, and the unit direction of each side.
  const corners = [
    pt(-preset.width / 2, -preset.depth / 2),
    pt(preset.width / 2, -preset.depth / 2),
    pt(preset.width / 2, preset.depth / 2),
    pt(-preset.width / 2, preset.depth / 2),
  ]
  const dirs = [pt(1, 0), pt(0, 1), pt(-1, 0), pt(0, -1)]
  const radiusAt = CORNER_ORDER.map((k) => r[k])
  // Corner i is joined by the side running in dirs[i − 1] and the side running in dirs[i].
  const corner = (i: number): Pt => corners[((i % 4) + 4) % 4]
  const dir = (i: number): Pt => dirs[((i % 4) + 4) % 4]
  const radius = (i: number): number => radiusAt[((i % 4) + 4) % 4]
  const along = (i: number, at: Pt, signed: number): Pt =>
    pt(corner(i).x + at.x * signed, corner(i).y + at.y * signed)
  const arcStart = (i: number): Pt => (radius(i) === 0 ? corner(i) : along(i, dir(i - 1), -radius(i)))
  const arcEnd = (i: number): Pt => (radius(i) === 0 ? corner(i) : along(i, dir(i), radius(i)))
  const arcCentre = (i: number): Pt => {
    const dIn = dir(i - 1)
    const dOut = dir(i)
    const ri = radius(i)
    return pt(corner(i).x - dIn.x * ri + dOut.x * ri, corner(i).y - dIn.y * ri + dOut.y * ri)
  }
  const start = arcStart(0)
  const pieces: Segment[] = []
  for (let i = 0; i < 4; i++) {
    if (radius(i) > 0) pieces.push({ kind: 'arc', to: arcEnd(i), center: arcCentre(i), sweepDeg: 90 })
    const target = i === 3 ? start : arcStart(i + 1)
    if (distance(arcEnd(i), target) > 0) pieces.push({ kind: 'line', to: target })
  }
  return { start, segments: pieces }
}

/** Circle and Ellipse: four quarter arcs split at the axis extremes, from the top (D1). */
const quarterArcs = (rx: number, ry: number, circular: boolean): ClosedPath => {
  const start = pt(0, -ry)
  const points = [pt(rx, 0), pt(0, ry), pt(-rx, 0), start]
  const segments: Segment[] = points.map((to) =>
    circular
      ? { kind: 'arc' as const, to, center: pt(0, 0), sweepDeg: 90 }
      : { kind: 'ellipticalArc' as const, to, center: pt(0, 0), rx, ry, rotationDeg: 0, sweepDeg: 90 },
  )
  return { start, segments }
}

/**
 * Regular Polygon: a flat side at the bottom sized by side length, edges starting at the
 * bottom side's left vertex and running clockwise, so the bottom side is the last edge.
 */
const regularPolygon = (sideCount: number, sideLength: number): ClosedPath => {
  const circumradius = sideLength / (2 * Math.sin(Math.PI / sideCount))
  const first = Math.PI / 2 + Math.PI / sideCount
  const vertex = (k: number): Pt => pt(
    circumradius * Math.cos(first + (k * 2 * Math.PI) / sideCount),
    circumradius * Math.sin(first + (k * 2 * Math.PI) / sideCount),
  )
  const start = vertex(0)
  const segments: Segment[] = []
  for (let k = 1; k < sideCount; k++) segments.push({ kind: 'line', to: vertex(k) })
  segments.push({ kind: 'line', to: start })
  return { start, segments }
}

/** The path in its local frame, bounds centred on the origin, clockwise. */
const canonicalPath = (preset: Preset): ClosedPath => {
  switch (preset.kind) {
    case 'square':
      return rectangle(preset.side, preset.side)
    case 'rectangle':
      return rectangle(preset.width, preset.depth)
    case 'roundedRectangle':
      return roundedRectangle(preset)
    case 'circle':
      return quarterArcs(preset.diameter / 2, preset.diameter / 2, true)
    case 'ellipse':
      return quarterArcs(preset.width / 2, preset.depth / 2, false)
    case 'capsule': {
      const radius = preset.width / 2
      const half = (preset.length - preset.width) / 2
      const start = pt(-half, -radius)
      return {
        start,
        segments: [
          { kind: 'line', to: pt(half, -radius) },
          { kind: 'arc', to: pt(half, radius), center: pt(half, 0), sweepDeg: 180 },
          { kind: 'line', to: pt(-half, radius) },
          { kind: 'arc', to: start, center: pt(-half, 0), sweepDeg: 180 },
        ],
      }
    }
    case 'triangle': {
      const offset = preset.apexOffset ?? preset.baseWidth / 2
      const baseLeft = pt(-preset.baseWidth / 2, preset.depth / 2)
      const apex = pt(-preset.baseWidth / 2 + offset, -preset.depth / 2)
      const baseRight = pt(preset.baseWidth / 2, preset.depth / 2)
      return {
        start: baseLeft,
        segments: [
          { kind: 'line', to: apex },
          { kind: 'line', to: baseRight },
          { kind: 'line', to: baseLeft },
        ],
      }
    }
    case 'regularPolygon':
      return regularPolygon(preset.sideCount, preset.sideLength)
  }
}

/**
 * The closed path a preset evaluates to, placed on the Floor (#54 §5). Position is the
 * centre of the shape's local bounds, which is also the orientation pivot.
 */
export const evaluatePreset = (preset: Preset, placement: Placement): ClosedPath => {
  const local = canonicalPath(preset)
  const transform = { rotationDeg: normaliseDeg(placement.orientationDeg), translation: placement.centre, pivot: pt(0, 0) }
  return {
    start: applyTransform(local.start, transform),
    segments: local.segments.map((segment) => transformSegment(segment, transform)),
  }
}

/**
 * Behaviour 7 for a Rounded Rectangle: on every side the two adjacent radii sum to no more
 * than that side's length. Equality is valid; a larger sum is `corner-radii-overlap`, with
 * the side named by its position at 0°. The radii are never clamped.
 */
export const roundedRectangleOverlap = (preset: RoundedRectanglePreset): GeometryProblem[] => {
  const r = cornerRadiiOf(preset)
  const out: GeometryProblem[] = []
  for (const { side, from, to, length } of SIDES) {
    const a = r[from]
    const b = r[to]
    const sideLength = length(preset)
    if (a + b > sideLength) out.push(geometryProblem('corner-radii-overlap', [], { values: [a, b, sideLength], side }))
  }
  return out
}

/**
 * The parameter-level problems of a preset (#54 §5): non-positive sizes, a side count below
 * 3 or not an integer, the capsule rule and the corner-radius rule.
 */
export const presetParametersValid = (preset: Preset): GeometryProblem[] => {
  const problems: GeometryProblem[] = []
  const notPositive = (value: number): void => {
    if (!(value > 0)) problems.push(geometryProblem('size-not-positive', []))
  }
  switch (preset.kind) {
    case 'square':
      notPositive(preset.side)
      break
    case 'rectangle':
      notPositive(preset.width)
      notPositive(preset.depth)
      break
    case 'roundedRectangle': {
      notPositive(preset.width)
      notPositive(preset.depth)
      const r = cornerRadiiOf(preset)
      for (const k of CORNER_ORDER) if (r[k] < 0) problems.push(geometryProblem('size-not-positive', [], { values: [r[k]] }))
      problems.push(...roundedRectangleOverlap(preset))
      break
    }
    case 'circle':
      notPositive(preset.diameter)
      break
    case 'ellipse':
      notPositive(preset.width)
      notPositive(preset.depth)
      break
    case 'capsule':
      notPositive(preset.length)
      notPositive(preset.width)
      if (preset.length > 0 && preset.width > 0 && preset.length <= preset.width) {
        problems.push(geometryProblem('capsule-too-short', [], { values: [preset.length, preset.width] }))
      }
      break
    case 'triangle':
      notPositive(preset.baseWidth)
      notPositive(preset.depth)
      break
    case 'regularPolygon':
      if (!Number.isInteger(preset.sideCount) || preset.sideCount < 3) {
        problems.push(geometryProblem('side-count-too-small', [], { values: [preset.sideCount] }))
      }
      notPositive(preset.sideLength)
      break
  }
  return problems
}
