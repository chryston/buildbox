/**
 * The renovation overlay rules (#70 §"The four Renovation Displays").
 *
 * A Renovation Display does not repaint an entity. The Wall a Design Option demolishes is still the
 * Wall the `walls` layer draws, in the layer's own colour; what the Display adds is a *bounded
 * overlay on top of it* — a dashed outline in the demolition colour with 45° hatching inside, or a
 * dashed halo 3 px outside the outline in the proposed colour. The layer style is never rewritten,
 * which is what lets the same drawing be read as a plan and as a renovation at once.
 *
 * So this file emits **separate display-list items**, in the layer of the entity they belong to, and
 * touches nothing about the entity's own item. That is also why the rules live here rather than in
 * `ui`: the on-screen canvas and the export are built from one display list, and an overlay one of
 * them knew about would be a drawing that lies.
 *
 * Within one layer the overlays come out Existing, then Demolition, then Proposed — the order the
 * issue gives, and the reason the Proposed successor is the top candidate under the pointer when a
 * replaced Wall is standing where it was.
 */
import type { RenovationState } from '../derive'
import type { Pt } from '../geometry'
import { resolveSize } from './styles'
import type { DisplayItem, DisplayLayer, LayerKey, PathCommand, Rect, Ref, Sizing } from './types'
import { LAYER_ORDER } from './types'

/** The order the issue gives a layer's contents: Existing, then Demolition, then Proposed. */
const STATE_ORDER: Record<RenovationState, number> = { existing: 0, demolition: 1, proposed: 2 }

/** One drawn entity, as the overlay needs it: what to point at, which band it stands in, its outline. */
export type RenovationOutline = {
  readonly ref: Ref
  readonly layer: LayerKey
  readonly outline: readonly PathCommand[]
}

/** The corners an outline travels through, arcs approximated by their endpoints. */
function outlinePoints(outline: readonly PathCommand[]): Pt[] {
  return outline.map((command) => command.to)
}

function pointsBounds(points: readonly Pt[]): Rect {
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

/**
 * The outline pushed `gap` millimetres away from its own centre, edge by edge, with mitred corners.
 *
 * Offsetting each edge and intersecting neighbours is exact for the rectangles and rotated
 * rectangles a Plan View holds — Walls, Openings, Placed Items — and the centroid test on each edge
 * is what decides which way is out, so a path wound either way gets a halo on the outside.
 */
export function offsetOutward(points: readonly Pt[], gap: number): Pt[] {
  const n = points.length
  if (n < 3 || gap === 0) return [...points]
  const centroid = points.reduce((sum, point) => ({ x: sum.x + point.x / n, y: sum.y + point.y / n }), { x: 0, y: 0 })
  const edges = points.map((from, index) => {
    const to = points[(index + 1) % n]!
    const dx = to.x - from.x
    const dy = to.y - from.y
    const length = Math.hypot(dx, dy) || 1
    // The two normals of a direction; the one pointing away from the centroid is the outside.
    let nx = dy / length
    let ny = -dx / length
    const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
    if ((middle.x - centroid.x) * nx + (middle.y - centroid.y) * ny < 0) {
      nx = -nx
      ny = -ny
    }
    return { a: { x: from.x + nx * gap, y: from.y + ny * gap }, b: { x: to.x + nx * gap, y: to.y + ny * gap } }
  })
  return edges.map((edge, index) => {
    const previous = edges[(index + n - 1) % n]!
    const t = intersect(previous, edge)
    return t === null ? edge.a : t
  })
}

/** Where two offset edges meet, or `null` when they are parallel and the corner is left square. */
function intersect(one: { a: Pt; b: Pt }, two: { a: Pt; b: Pt }): Pt | null {
  const d1 = { x: one.b.x - one.a.x, y: one.b.y - one.a.y }
  const d2 = { x: two.b.x - two.a.x, y: two.b.y - two.a.y }
  const cross = d1.x * d2.y - d1.y * d2.x
  if (Math.abs(cross) < 1e-9) return null
  const dx = two.a.x - one.a.x
  const dy = two.a.y - one.a.y
  const t = (dx * d2.y - dy * d2.x) / cross
  return { x: one.a.x + d1.x * t, y: one.a.y + d1.y * t }
}

/**
 * 45° hatching across the inside of an outline, as line segments.
 *
 * The renderer draws paths and text, not `<pattern>` fills, so the hatching is the lines
 * themselves: every diagonal `x + y = c` that crosses the outline's box, clipped to the outline by
 * the even-odd rule — the crossings a closed path makes with the line, sorted and paired. It is
 * correct for a concave outline as well as a rectangular one, which is what a Wall with a gap in it
 * is.
 */
export function hatchLines(points: readonly Pt[], pitch: number): PathCommand[] {
  const n = points.length
  if (n < 3 || pitch <= 0) return []
  const box = pointsBounds(points)
  const from = box.x + box.y
  const to = box.x + box.w + box.y + box.h
  const commands: PathCommand[] = []
  for (let c = from - pitch; c <= to + pitch; c += pitch) {
    const crossings: number[] = []
    for (let index = 0; index < n; index += 1) {
      const a = points[index]!
      const b = points[(index + 1) % n]!
      const sa = a.x + a.y - c
      const sb = b.x + b.y - c
      if (sa === 0) crossings.push(a.x)
      else if (sa * sb < 0) crossings.push(a.x + ((b.x - a.x) * sa) / (sa - sb))
    }
    crossings.sort((one, two) => one - two)
    for (let pair = 0; pair + 1 < crossings.length; pair += 2) {
      const x1 = crossings[pair]!
      const x2 = crossings[pair + 1]!
      commands.push({ k: 'M', to: { x: x1, y: c - x1 } }, { k: 'L', to: { x: x2, y: c - x2 } })
    }
  }
  return commands
}

/**
 * The overlays of the entities `states` says are drawn, grouped into the layers they belong to.
 *
 * `states` is the Display's own answer — `displayModel`'s rows, keyed by entity id — so an entity
 * the Display does not draw is absent from it and gets no overlay, and an Existing entity gets none
 * either: the Existing Model is the drawing, not an annotation on it.
 */
export function renovationOverlays(
  outlines: readonly RenovationOutline[],
  states: ReadonlyMap<string, RenovationState>,
  sizing: Sizing,
): DisplayLayer[] {
  const gap = resolveSize('renovation-halo-gap', sizing).mm
  const pitch = resolveSize('renovation-hatch-pitch', sizing).mm
  const byLayer = new Map<LayerKey, { rank: number; items: DisplayItem[] }[]>()

  for (const entity of outlines) {
    const state = states.get(entity.ref.id)
    if (state === undefined || state === 'existing') continue
    const points = outlinePoints(entity.outline)
    const items: DisplayItem[] =
      state === 'demolition'
        ? [
            {
              kind: 'path',
              ref: entity.ref,
              segments: [...entity.outline],
              closed: true,
              style: 'renovation-demolition',
            },
            {
              kind: 'path',
              ref: { id: entity.ref.id, role: `${entity.ref.role}-hatch` },
              segments: hatchLines(points, pitch),
              closed: false,
              style: 'renovation-hatch',
            },
          ]
        : [
            {
              kind: 'path',
              ref: { id: entity.ref.id, role: `${entity.ref.role}-halo` },
              segments: outlineCommands(offsetOutward(points, gap)),
              closed: true,
              style: 'renovation-halo',
            },
          ]
    const rows = byLayer.get(entity.layer) ?? []
    rows.push({ rank: STATE_ORDER[state], items })
    byLayer.set(entity.layer, rows)
  }

  return LAYER_ORDER.flatMap((key) => {
    const rows = byLayer.get(key)
    if (rows === undefined || rows.length === 0) return []
    const items = rows.sort((one, two) => one.rank - two.rank).flatMap((row) => row.items)
    return [{ key, items }]
  })
}

/** The commands a ring of points travels as — a straight-lined closed path. */
function outlineCommands(points: readonly Pt[]): PathCommand[] {
  const [first, ...rest] = points
  if (first === undefined) return []
  return [{ k: 'M', to: first }, ...rest.map((to): PathCommand => ({ k: 'L', to }))]
}
