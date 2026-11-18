/**
 * The geometry kernel's vocabulary (#54 §1).
 *
 * Plan coordinates are millimetres with **+X right and +Y down**, the same frame as
 * domain v1, and rotation is **clockwise** in degrees, normalised to [0, 360). A closed
 * path is one simple loop of straight, circular-arc and elliptical-arc segments: the
 * Room Outline of a Room, or the Item Footprint of an Item Design in its local frame.
 *
 * `TOLERANCE_MM` is the module's only epsilon (#54 §3). Everything else is exact float64
 * arithmetic on analytic curves; `flatten` exists for renderers and nothing else.
 */

/** A point in millimetres. */
export interface Pt {
  x: number
  y: number
}

/** The one topology tolerance: 0.01 mm (#54 §1, #20 §2). */
export const TOLERANCE_MM = 0.01

/** A point, spelled shortly. */
export const pt = (x: number, y: number): Pt => ({ x, y })

/** A straight segment ending at `to`. */
export interface LineSegment {
  kind: 'line'
  to: Pt
}

/**
 * A circular arc ending at `to` about `center`. Its radius is derived from
 * `|start − center|` and is never stored; `sweepDeg` is signed, positive being clockwise
 * on screen, with magnitude in (0, 360) exclusive — so major arcs are representable.
 */
export interface ArcSegment {
  kind: 'arc'
  to: Pt
  center: Pt
  sweepDeg: number
}

/**
 * An elliptical arc ending at `to` about `center`. `sweepDeg` is measured in the
 * ellipse's parametric angle, signed the same way as a circular arc's.
 */
export interface EllipticalArcSegment {
  kind: 'ellipticalArc'
  to: Pt
  center: Pt
  rx: number
  ry: number
  rotationDeg: number
  sweepDeg: number
}

export type Segment = LineSegment | ArcSegment | EllipticalArcSegment

/**
 * One closed simple loop. Segment `i` starts where segment `i−1` ends (the first starts
 * at `start`) and the last `to` equals `start`. Edge numbers in messages are 1-based from
 * `start` in segment order; "Edges" is the UI word for segments.
 */
export interface ClosedPath {
  start: Pt
  segments: Segment[]
}

/** A rigid placement: rotation about `pivot`, then translation (#54 §5). */
export interface Transform {
  rotationDeg: number
  translation: Pt
  pivot: Pt
}

/** A rectangular preset's side, named by its position at 0° (#54 behaviour 7). */
export type SideName = 'top' | 'right' | 'bottom' | 'left'

/**
 * The nine loop-level codes of #54 §3, plus the three parameter-level codes of #54 §5
 * that a preset can have before any path exists.
 */
export type GeometryProblemCode =
  | 'edges-cross'
  | 'edges-touch'
  | 'edge-no-length'
  | 'too-few-edges'
  | 'no-area'
  | 'corner-radii-overlap'
  | 'arc-radius-too-small'
  | 'arc-not-closed'
  | 'radius-not-positive'
  | 'size-not-positive'
  | 'capsule-too-short'
  | 'side-count-too-small'

/**
 * A structured geometry problem (#54 §3). `edges` are 1-based segment numbers, `at` is
 * the point a canvas marker should sit on, `values` are the millimetre numbers the
 * message quotes, `side` names a preset's side where there are no edge numbers yet. The
 * message itself is formatted in `domain`, which owns units.
 */
export interface GeometryProblem {
  code: GeometryProblemCode
  edges: number[]
  at?: Pt
  values?: number[]
  side?: SideName
}

/** The extra fields a problem may carry, so every site reads the same shape. */
export interface ProblemDetail {
  at?: Pt
  values?: number[]
  side?: SideName
}

/** One problem, with only the fields it actually carries set. */
export const geometryProblem = (code: GeometryProblemCode, edges: number[], detail: ProblemDetail = {}): GeometryProblem => {
  const out: GeometryProblem = { code, edges }
  if (detail.at !== undefined) out.at = detail.at
  if (detail.values !== undefined) out.values = detail.values
  if (detail.side !== undefined) out.side = detail.side
  return out
}
