/**
 * Where a drawing puts its labels (#57 criterion 12, moved here by #60 §7; #74 §3).
 *
 * A Floor can be rotated to any angle, so the text that names a thing has to find a clear box
 * beside it rather than on it — at 37° as well as at 0°. That is a placement question, not a
 * rendering one: the candidates are rings of boxes around the thing being named, tried nearest the
 * label's own anchor first, and the answer is the first that touches nothing already claimed.
 *
 * It lived beside the Plan View only because nothing else could use it from there. The Item
 * Detail has the same problem in miniature — a dimension text and a space label that both want the
 * middle of a gap — and #60's display list is built once for both surfaces, so the placer moves
 * with it. The arithmetic is unchanged in every particular, including the tie-breaks: the same
 * frame still places the same chip in the same pixel.
 *
 * #74 §3 changed the two things a single shared footprint could not express. Every label now
 * carries *its own* entity, because a name moves along its Wall or its cabinet and not along
 * whatever else happens to be selected; and a label with no clean candidate is answered `null`
 * instead of with the least-intruding box, because a name written on top of another name reads as
 * neither, and the caller can show it on hover. `atHome` is the other half of the same rule: an
 * Item's name belongs on the Item and moves only when an earlier name has taken that box, where a
 * Wall's reference has never sat inside the band it labels.
 *
 * The entity arrives as an axis-aligned box because the caller has already rotated and projected
 * it: screen space here *is* world millimetres, +X right and +Y down.
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
  /** The entity this label names: the box it moves along, and never sits on unless `atHome`. */
  readonly entity: Rect
  /**
   * Whether the anchor box itself is the first candidate (#74 §3): the label's default position,
   * which is only ever given up when something has already claimed it.
   */
  readonly atHome?: boolean
}

/** Everything the placer has to respect for one frame of the Plan View. */
export interface LabelPlacement {
  /** Boxes a label must not enter: the dimension texts, and #66's warning badge. */
  readonly obstacles: readonly Rect[]
  /** The labels to place, in the order they are drawn. */
  readonly labels: readonly LabelRequest[]
}

/** Clear millimetres a label keeps between itself and the entity it labels. */
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
 * The innermost ring sits at the entity's half-diagonal plus the margin plus the label's own
 * half-diagonal, and a box that far from the entity's centre cannot overlap it at any angle — so
 * every ring candidate clears the entity by construction, and only the obstacles and earlier
 * labels have to be tested.
 *
 * `atHome` puts two things in front of the whole set. The first is the anchor box itself, the
 * label's default position, which is the one candidate allowed to sit on the entity because it is
 * the thing being named. The second is the entity's four faces: the first place a name that has
 * lost its box should look is the edge of the thing it names, and the ring is a circle that clears
 * the entity at *any* rotation — a whole diagonal out, which on a bed is two metres of blank floor
 * between a word and what it means.
 */
function candidates(label: LabelRequest): Candidate[] {
  const { entity } = label
  const cx = entity.x + entity.w / 2
  const cy = entity.y + entity.h / 2
  const inner = halfDiagonal(entity.w, entity.h) + MARGIN + halfDiagonal(label.w, label.h)
  const step = inner / 2 + MARGIN
  const out: Candidate[] = label.atHome === true
    ? [{
        box: { x: label.anchor.x - label.w / 2, y: label.anchor.y - label.h / 2, w: label.w, h: label.h },
        distance: 0,
        angle: -1,
        radius: -1,
      },
      // A label that has lost its box on the entity first tries the entity's four faces, at the
      // same margin the rings keep. A name belongs beside the thing it names, and the ring — the
      // circle that clears the entity at *any* rotation — sits a whole diagonal away, which on a
      // 2 m bed is two metres of blank floor between a word and what it means. A face box whose own
      // corners would still touch the entity, because the word is longer than the face is wide, is
      // simply not a candidate.
      ...([
        { x: entity.x + entity.w + MARGIN + label.w / 2, y: cy, angle: 0 },
        { x: cx, y: entity.y + entity.h + MARGIN + label.h / 2, angle: Math.PI / 2 },
        { x: entity.x - MARGIN - label.w / 2, y: cy, angle: Math.PI },
        { x: cx, y: entity.y - MARGIN - label.h / 2, angle: (3 * Math.PI) / 2 },
      ] as const)
        .map((at): Candidate => ({
          box: { x: at.x - label.w / 2, y: at.y - label.h / 2, w: label.w, h: label.h },
          distance: Math.hypot(at.x - label.anchor.x, at.y - label.anchor.y),
          angle: at.angle,
          radius: Math.hypot(at.x - cx, at.y - cy),
        }))
        .filter((face) => overlapArea(face.box, entity) === 0)]
    : []
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
  // Equal distance is common — an anchor at the entity's centre is equidistant from a whole ring —
  // so angle and then radius break the tie, and the same frame always places the same chip in the
  // same pixel.
  return out.sort(
    (a, b) => a.distance - b.distance || a.angle - b.angle || a.radius - b.radius,
  )
}

/** Whether `box` shares any area with anything already claimed. */
function intrudes(box: Rect, obstacles: readonly Rect[], placed: readonly Rect[]): boolean {
  for (const obstacle of obstacles) if (overlapArea(box, obstacle) > 0) return true
  for (const earlier of placed) if (overlapArea(box, earlier) > 0) return true
  return false
}

/**
 * One box per label, in request order — or `null` for a label with nowhere left to sit.
 *
 * Labels are placed in the order they are drawn, so each later one treats the earlier ones as
 * obstacles: the name drawn last is the one that moves when two want the same box (#74 §3). A
 * label whose every candidate intrudes is left out of the picture rather than written over what is
 * already there, and the caller carries it to a hover instead. It is never placed on its entity,
 * because no candidate but an `atHome` one can be.
 */
export function placeLabels(input: LabelPlacement): (Rect | null)[] {
  const { obstacles, labels } = input
  const placed: Rect[] = []
  return labels.map((label) => {
    for (const candidate of candidates(label)) {
      if (intrudes(candidate.box, obstacles, placed)) continue
      placed.push(candidate.box)
      return candidate.box
    }
    return null
  })
}
