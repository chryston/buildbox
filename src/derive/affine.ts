/**
 * The one 2×3 affine matrix in the codebase (#60 §1).
 *
 * `geometry`'s `Transform` is a *rigid placement* — rotate about a pivot, then translate —
 * which is what a Placed Item is. A matrix is a different question: it is what a renderer
 * applies, and what a Plan Image's calibration is (a pure scale, `1 / pixelsPerMm`). Keeping
 * the two apart is what stops a calibration being mistaken for a placement.
 *
 * The element order is SVG's `matrix(a,b,c,d,e,f)`, so a matrix reaches the screen without
 * being transposed: `x′ = a·x + c·y + e`, `y′ = b·x + d·y + f`.
 *
 * `derive` owns it because `derive` is where a calibration becomes a matrix; `drawing` takes
 * it as an input for `image` and `group` items. Both frames are +X right, +Y down.
 */

/** An SVG-order affine matrix: `matrix(a,b,c,d,e,f)`. */
export interface Affine {
  readonly a: number
  readonly b: number
  readonly c: number
  readonly d: number
  readonly e: number
  readonly f: number
}

/** The matrix that changes nothing. */
export const AFFINE_IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

/** `matrix(sx,0,0,sy,0,0)`; `sy` defaults to `sx`. */
export const affineScale = (sx: number, sy: number = sx): Affine => ({
  a: sx, b: 0, c: 0, d: sy, e: 0, f: 0,
})

/** `matrix(1,0,0,1,tx,ty)`. */
export const affineTranslate = (tx: number, ty: number): Affine => ({
  a: 1, b: 0, c: 0, d: 1, e: tx, f: ty,
})

/** `matrix(cos,sin,−sin,cos,0,0)`: clockwise in the +Y-down frame, degrees in. */
export const affineRotateDeg = (deg: number): Affine => {
  const rad = (deg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 }
}

/** `outer ∘ inner`: apply `inner` first, then `outer` — SVG's own nesting order. */
export const affineMultiply = (outer: Affine, inner: Affine): Affine => ({
  a: outer.a * inner.a + outer.c * inner.b,
  b: outer.b * inner.a + outer.d * inner.b,
  c: outer.a * inner.c + outer.c * inner.d,
  d: outer.b * inner.c + outer.d * inner.d,
  e: outer.a * inner.e + outer.c * inner.f + outer.e,
  f: outer.b * inner.e + outer.d * inner.f + outer.f,
})

/** The matrix `m` maps a point through. */
export const affineApply = (m: Affine, at: { x: number; y: number }): { x: number; y: number } => ({
  x: m.a * at.x + m.c * at.y + m.e,
  y: m.b * at.x + m.d * at.y + m.f,
})

/** `matrix(a,b,c,d,e,f)` as SVG spells it, with no spaces after the commas. */
export const affineToSvg = (m: Affine): string =>
  `matrix(${m.a},${m.b},${m.c},${m.d},${m.e},${m.f})`
