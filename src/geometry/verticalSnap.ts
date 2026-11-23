/**
 * Vertical snapping: the 12 CSS px that decide where an Elevation View's content stops (#75 §5).
 *
 * The plan has `snap.ts`, which resolves a cursor against candidate *places*. An Elevation View drags
 * in one axis only — height above the Floor Datum — and the candidates it can snap to are a different
 * set with a different precedence, so it gets its own resolver here. What the two files share is the
 * shape of the answer: a candidate is data with an id, a kind and a label, the caller supplies the
 * tolerance in millimetres, and the resolver is pure, deterministic and never stores anything.
 *
 * **The tolerance is a screen distance, not a millimetre one.** 12 CSS px at whatever zoom the view is
 * drawn at, so `verticalTolerance` divides the constant by the zoom — the same conversion the plan
 * canvas makes (`SNAP_PX / zoom` in `ui/canvas/pointer.ts`), because `zoom` is CSS px per millimetre.
 *
 * **The precedence is the issue's, and it is not nearness.** A Floor Datum or a Floor's Vertical Limits
 * beats an entity's top or bottom edge, which beats a preset pack's typical mounting height; within one
 * class the nearer candidate wins, and an exact tie goes to the lower id (#75 §5). Precedence is
 * applied before distance, so a Datum 9 mm from the cursor beats a Wall top 2 mm away — which is what
 * makes a cabinet land on the Datum rather than on the wall behind it.
 *
 * **A body drags both of its edges.** Moving a cabinet by its body tests its bottom and its top against
 * the candidates and moves the whole body by the one delta the winning edge asked for, so the cabinet
 * keeps its height (#75 §5). Which edge won is part of the answer because it is what the guide line
 * names.
 */

/** What kind of thing a vertical candidate is, in the order the issue ranks them (#75 §5). */
export type VerticalSnapKind = 'datum' | 'limit' | 'entity' | 'mounting'

/** The rank of each kind: lower is stronger, and it is compared before distance. */
const VERTICAL_SNAP_RANK: Record<VerticalSnapKind, number> = { datum: 0, limit: 0, entity: 1, mounting: 2 }

/** One height a drag could stop at, in millimetres above the Floor Datum. */
export interface VerticalSnapCandidate {
  /** Stable identity, used only to break an exact tie; also what `excludeId` answers. */
  readonly id: string
  /** Millimetres above the Floor Datum, which is Z = 0 by definition. */
  readonly mm: number
  readonly kind: VerticalSnapKind
  /** The words the guide line shows, supplied by the caller — this module owns no copy. */
  readonly label: string
}

/** A resolved snap: the candidate, the height it asks for and how far the dragged edge travelled. */
export interface VerticalSnap {
  readonly candidate: VerticalSnapCandidate
  readonly mm: number
  readonly delta: number
}

/** The acquisition radius of a vertical snap, in CSS pixels (#75 §5). */
export const VERTICAL_SNAP_PX = 12

/**
 * The tolerance in millimetres for a view drawn at `zoom` CSS px per millimetre.
 *
 * A zoom of 0 or less has no screen to be drawn on and answers 0, which acquires nothing.
 */
export function verticalTolerance(zoom: number): number {
  return zoom > 0 ? VERTICAL_SNAP_PX / zoom : 0
}

/** Whether one candidate may be taken at all: inside the tolerance, and not the thing being dragged. */
const eligible = (candidate: VerticalSnapCandidate, at: number, toleranceMm: number, excludeId: string | null): boolean =>
  candidate.id !== excludeId && Math.abs(candidate.mm - at) <= toleranceMm

/** The stronger of two snaps: precedence first, then nearness, then the lower id. */
function better(a: VerticalSnap, b: VerticalSnap): VerticalSnap {
  const rankA = VERTICAL_SNAP_RANK[a.candidate.kind]
  const rankB = VERTICAL_SNAP_RANK[b.candidate.kind]
  if (rankA !== rankB) return rankA < rankB ? a : b
  const gapA = Math.abs(a.delta)
  const gapB = Math.abs(b.delta)
  if (gapA !== gapB) return gapA < gapB ? a : b
  return a.candidate.id <= b.candidate.id ? a : b
}

/**
 * The candidate one height snaps to, or nothing.
 *
 * `at` is where the dragged edge stands before snapping. The candidate's own height is what the drag
 * ends at — never the cursor, which is the same rule the plan's snaps follow.
 */
export function verticalSnap(
  candidates: readonly VerticalSnapCandidate[],
  at: number,
  toleranceMm: number,
  excludeId: string | null = null,
): VerticalSnap | null {
  let found: VerticalSnap | null = null
  for (const candidate of candidates) {
    if (!eligible(candidate, at, toleranceMm, excludeId)) continue
    const snap: VerticalSnap = { candidate, mm: candidate.mm, delta: candidate.mm - at }
    found = found === null ? snap : better(found, snap)
  }
  return found
}

/** The two horizontal edges of a body being dragged: its bottom and its top, in millimetres. */
export interface VerticalEdges {
  readonly bottom: number
  readonly top: number
}

/** A body snap: which edge won, what it snapped to, and the one delta the whole body takes. */
export interface VerticalBodySnap extends VerticalSnap {
  readonly edge: keyof VerticalEdges
}

/**
 * A body drag: both edges tested, one delta applied.
 *
 * The bottom edge is tested first and the top second; when both snap, the nearer wins, and an exact tie
 * between the two edges goes to the bottom, which is the deterministic answer the tests pin. The body
 * keeps its height either way — `delta` moves bottom and top together (#75 §5).
 */
export function verticalBodySnap(
  candidates: readonly VerticalSnapCandidate[],
  edges: VerticalEdges,
  toleranceMm: number,
  excludeId: string | null = null,
): VerticalBodySnap | null {
  const bottom = verticalSnap(candidates, edges.bottom, toleranceMm, excludeId)
  const top = verticalSnap(candidates, edges.top, toleranceMm, excludeId)
  if (bottom === null) return top === null ? null : { ...top, edge: 'top' }
  if (top === null) return { ...bottom, edge: 'bottom' }
  const gap = (snap: VerticalSnap): number => Math.abs(snap.delta)
  const rank = (snap: VerticalSnap): number => VERTICAL_SNAP_RANK[snap.candidate.kind]
  const won = rank(bottom) !== rank(top) ? rank(bottom) < rank(top) : gap(bottom) !== gap(top) ? gap(bottom) < gap(top) : true
  return won ? { ...bottom, edge: 'bottom' } : { ...top, edge: 'top' }
}

/**
 * Where a body ends up after a snap: the same delta on both edges, or the untouched edges.
 *
 * A single-edge drag — a cabinet's top edge, or a Wall's top — takes the snap directly and leaves the
 * other edge where it was, which is the other half of criterion 15.
 */
export function movedEdges(edges: VerticalEdges, snap: VerticalSnap | null): VerticalEdges {
  return snap === null ? edges : { bottom: edges.bottom + snap.delta, top: edges.top + snap.delta }
}
