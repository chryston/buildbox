/**
 * Where a drawing puts its labels (#57 criterion 12, moved here by #60 §7).
 *
 * A Floor can be rotated to any angle, so the text that names its bounds has to find a clear
 * box beside the Floor rather than on it — at 37° as well as at 0°. That is a placement
 * question, not a rendering one: the candidates are rings of boxes around the footprint,
 * tried nearest the label's own anchor first, and the answer is the first that touches
 * nothing already claimed.
 *
 * It lived beside the Plan View only because nothing else could use it from there. The Item
 * Detail has the same problem in miniature — a dimension text and a space label that both
 * want the middle of a gap — and #60's display list is built once for both surfaces, so the
 * placer moves with it. The arithmetic is unchanged in every particular, including the
 * tie-breaks: the same frame still places the same chip in the same pixel.
 *
 * The footprint arrives as an axis-aligned box because the caller has already rotated and
 * projected it: screen space here *is* world millimetres, +X right and +Y down.
 */
import type { Pt } from '../geometry'
import type { Rect } from './types'

/** One label that wants to be drawn, and where it would like to sit. */
export interface LabelRequest {
  readonly id: string
  /** Where the label would like to sit: its centre. */
  readonly anchor: Pt
  readonly w: number
  readonly h: number
}

/** Everything the placer has to respect for one frame of the Plan View. */
export interface LabelPlacement {
  /** The selected placement's world-space bounding box: a label may never cover it. */
  readonly footprint: Rect
  /** Boxes a label must not enter: the dimension texts, and #66's warning badge. */
  readonly obstacles: readonly Rect[]
  /** The labels to place, in the order they are drawn. */
  readonly labels: readonly LabelRequest[]
}

/** Clear millimetres a label keeps between itself and the footprint it labels. */
const MARGIN = 12
/** Slots per ring: fine enough that some angle is free however the Floor is turned. */
const ANGLES = 16
/** Rings tried outward once the innermost one is fully claimed. */
const RADII = 4

/** Half the diagonal of a box: the radius of the smallest circle that covers it. */
const halfDiagonal = (w: number, h: number): number => Math.hypot(w, h) / 2

/**
 * The area two boxes share, which is zero when they only touch. Touching is allowed: two
 * chips that meet edge to edge are as legible as two chips a millimetre apart.
 */
const overlapArea = (a: Rect, b: Rect): number =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))

/** One possible home for one label, with what ordering it was generated in. */
interface Candidate {
  readonly box: Rect
  readonly distance: number
  readonly angle: number
  readonly radius: number
}

/**
 * The candidate boxes for one label, nearest its anchor first.
 *
 * The innermost ring sits at the footprint's half-diagonal plus the margin plus the label's
 * own half-diagonal, and a box that far from the footprint's centre cannot overlap it at any
 * angle — so every candidate here clears the footprint by construction, and only the
 * obstacles and earlier labels have to be tested.
 */
function candidates(footprint: Rect, label: LabelRequest): Candidate[] {
  const cx = footprint.x + footprint.w / 2
  const cy = footprint.y + footprint.h / 2
  const inner = halfDiagonal(footprint.w, footprint.h) + MARGIN + halfDiagonal(label.w, label.h)
  const step = inner / 2 + MARGIN
  const out: Candidate[] = []
  for (let ring = 0; ring < RADII; ring++) {
    const radius = inner + ring * step
    for (let slot = 0; slot < ANGLES; slot++) {
      const angle = (slot * 2 * Math.PI) / ANGLES
      const x = cx + radius * Math.cos(angle)
      const y = cy + radius * Math.sin(angle)
      out.push({
        box: { x: x - label.w / 2, y: y - label.h / 2, w: label.w, h: label.h },
        distance: Math.hypot(x - label.anchor.x, y - label.anchor.y),
        angle,
        radius,
      })
    }
  }
  // Equal distance is common — an anchor at the footprint's centre is equidistant from a
  // whole ring — so angle and then radius break the tie, and the same frame always places
  // the same chip in the same pixel.
  return out.sort(
    (a, b) => a.distance - b.distance || a.angle - b.angle || a.radius - b.radius,
  )
}

/** How much `box` intrudes on everything already claimed. */
function intrusion(box: Rect, obstacles: readonly Rect[], placed: readonly Rect[]): number {
  let area = 0
  for (const obstacle of obstacles) area += overlapArea(box, obstacle)
  for (const earlier of placed) area += overlapArea(box, earlier)
  return area
}

/**
 * One box per label, in request order.
 *
 * Labels are placed in the order they are drawn, so each later one treats the earlier ones
 * as obstacles: the chip drawn last is the one that moves when two want the same corner.
 * A pathological pile-up where no candidate is free still answers — the candidate that
 * intrudes least is returned rather than nothing — and it can never land on the footprint,
 * because none of the candidates can.
 */
export function placeLabels(input: LabelPlacement): Rect[] {
  const { footprint, obstacles, labels } = input
  const placed: Rect[] = []
  for (const label of labels) {
    const ring = candidates(footprint, label)
    let best = ring[0]
    let least = Infinity
    for (const candidate of ring) {
      const area = intrusion(candidate.box, obstacles, placed)
      if (area === 0) {
        best = candidate
        break
      }
      if (area < least) {
        least = area
        best = candidate
      }
    }
    placed.push(best.box)
  }
  return placed
}
