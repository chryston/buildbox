/**
 * The invalid-proposal controller (#58 §6, behaviour 17).
 *
 * One state machine for every shape gesture: a preset being dragged out, a parameter field
 * being typed into, a conversion, and — later — the drafts, handle drags, edge fields and
 * fillets of #59 and the wall-face work of #67. They share it rather than each inventing
 * their own, because the prototype showed what happens otherwise: the same failure reported
 * twice in two different voices, one of them with a coordinate pair in it, next to a shape
 * that had already been written to the model.
 *
 * So the rules live here and nowhere else:
 *
 *  - **Nothing is written.** A proposal is a value. The model is only touched by `commit`,
 *    which the caller reaches for when `canCommit` says so — which it never does while a
 *    proposal is invalid. Revision, history length and IndexedDB cannot move from this file.
 *  - **One message.** The first problem the kernel reports, in `formatGeometryProblem`'s
 *    words — the same sentence the Edit Intent will reject with, because it is the same
 *    function over the same footprint. Never two, never a coordinate pair.
 *  - **The last valid shape is kept.** A proposal that fails does not overwrite the ghost;
 *    the shape that was there before stays on screen, dashed, until the person corrects it
 *    or gets rid of the proposal.
 *  - **Esc, correcting, or selecting away all discard.** They are the same transition.
 *
 * It is deliberately not React and knows nothing about the DOM: the state machine is the
 * part with criteria against it, so it is the part that must be testable without a browser.
 */
import { formatGeometryProblem, footprintProblems } from '../../../domain'
import type { DisplayFormat, ItemFootprint, Point2 } from '../../../domain'
import type { GeometryProblem } from '../../../derive'

/**
 * What a shape edit is aimed at: enough of the target to propose against it, and nothing
 * else. #59 and #67 build one of these for their own subject — a draft, a Room — and reuse
 * every transition below unchanged, which is the whole point of naming it here.
 */
export interface ShapeTarget {
  /** The Item Design the proposal would replace the footprint of. */
  readonly itemDesignId: string
  /** The footprint the model holds. The ghost of it is what an invalid proposal draws. */
  readonly current: ItemFootprint
  /** How many Placed Items share this design: one commits, more preview first (#57 D3). */
  readonly placementCount: number
  /** The Project's display unit and precision, for the one sentence that gets shown. */
  readonly format: DisplayFormat
  /**
   * Anything this kind of target refuses that the geometry kernel cannot see, in one plain
   * sentence — a cabinet's footprint comes from its construction, a Room has to reach a
   * wall. Absent for a plain Item Design, where the kernel's answer is the whole answer.
   */
  refuse?: (footprint: ItemFootprint) => string | null
}

/** Where the proposal came from, which decides where its one message is shown. */
export type ShapeGesture =
  /** A field edit: the message belongs under the field, and the field is marked. */
  | { readonly via: 'field'; readonly field: string }
  /** A canvas gesture — a drag, a handle, a placement: the message belongs in the draft bar. */
  | { readonly via: 'canvas' }

/** The one thing on screen about a proposal that will not commit. */
export interface ShapeProblem {
  /** The sentence. Never a second one, never a coordinate pair (#58 behaviour 18). */
  readonly message: string
  /** The kernel's code, so a caller can name the failure without parsing the sentence. */
  readonly code: string
  /** Where the canvas marks it, when the kernel knows a place. */
  readonly at: Point2 | null
  /** The field to mark, or `null` for a canvas gesture, which has no field to mark. */
  readonly field: string | null
}

/** A footprint on its way to becoming an Item Footprint, and what the model thinks of it. */
export type ShapeProposal =
  | { readonly state: 'idle' }
  | { readonly state: 'valid'; readonly footprint: ItemFootprint }
  | {
      readonly state: 'invalid'
      readonly footprint: ItemFootprint
      readonly problem: ShapeProblem
    }

/**
 * The transient state of one shape editor: the proposal, and the last shape that was
 * acceptable. Held in the UI-session store, never in the Project snapshot (#58 §Notes).
 */
export interface ShapeDraft {
  readonly proposal: ShapeProposal
  /**
   * The geometry to draw as the dashed ghost. Seeded from the model when the editor opens
   * and moved forward only by a proposal that passed, so typing 1,001 then 1,002 keeps
   * showing the 1,000 that is still committed rather than the first thing that failed.
   */
  readonly lastValid: ItemFootprint
}

/** The kernel's first complaint about a footprint, in the Project's own words. */
const firstProblem = (
  target: ShapeTarget,
  footprint: ItemFootprint,
  gesture: ShapeGesture,
): ShapeProblem | null => {
  const refused = target.refuse?.(footprint) ?? null
  if (refused !== null) {
    // An adapter problem: this target's own rule, with no geometry behind it and so no
    // place to mark. It is still the only message on screen.
    return { message: refused, code: 'target-refused', at: null, field: gesture.via === 'field' ? gesture.field : null }
  }
  const [problem] = footprintProblems(footprint)
  if (problem === undefined) return null
  return describe(target.format, problem, gesture)
}

/** One problem, in the one shape the editor shows it in. */
const describe = (format: DisplayFormat, problem: GeometryProblem, gesture: ShapeGesture): ShapeProblem => ({
  message: formatGeometryProblem(problem, format),
  code: problem.code,
  at: problem.at === undefined ? null : { x: problem.at.x, y: problem.at.y },
  field: gesture.via === 'field' ? gesture.field : null,
})

/** The draft an editor opens with: nothing proposed, the committed shape kept for the ghost. */
export const openShape = (target: ShapeTarget): ShapeDraft => ({
  proposal: { state: 'idle' },
  lastValid: target.current,
})

/**
 * Put a footprint on screen as a proposal.
 *
 * This is the only way in, and it never writes: the caller has to take `canCommit`'s answer
 * to `commit` itself, so an invalid proposal cannot reach the model even by accident.
 */
export function propose(target: ShapeTarget, draft: ShapeDraft, gesture: ShapeGesture, footprint: ItemFootprint): ShapeDraft {
  const problem = firstProblem(target, footprint, gesture)
  if (problem === null) {
    return { proposal: { state: 'valid', footprint }, lastValid: footprint }
  }
  return { proposal: { state: 'invalid', footprint, problem }, lastValid: draft.lastValid }
}

/**
 * Get rid of the proposal: Esc, or selecting something else, which the issue makes the same
 * thing. The ghost stays where it was, which is what restores the field the person typed
 * into — the Shape tab reads its values from the draft, so discarding puts 1,000 back.
 */
export const discard = (draft: ShapeDraft): ShapeDraft => ({
  proposal: { state: 'idle' },
  lastValid: draft.lastValid,
})

/** Whether `commit`, Enter and `Apply` may be offered at all. */
export const canCommit = (draft: ShapeDraft): boolean => draft.proposal.state === 'valid'

/** The footprint to draw solid and red, or `null` when there is no proposal up. */
export const proposalFootprint = (draft: ShapeDraft): ItemFootprint | null =>
  draft.proposal.state === 'idle' ? null : draft.proposal.footprint

/** The footprint to draw dashed: only while a proposal has failed. */
export const ghostFootprint = (draft: ShapeDraft): ItemFootprint | null =>
  draft.proposal.state === 'invalid' ? draft.lastValid : null

/** The one message, or `null`. There is no second one anywhere (#58 criterion 11). */
export const proposalMessage = (draft: ShapeDraft): string | null =>
  draft.proposal.state === 'invalid' ? draft.proposal.problem.message : null

/** The field to mark `aria-invalid`, or `null` when the proposal came from the canvas. */
export const markedField = (draft: ShapeDraft): string | null =>
  draft.proposal.state === 'invalid' ? draft.proposal.problem.field : null

/** Where the canvas puts its marker, or `null` when nothing knows a place. */
export const markerPoint = (draft: ShapeDraft): Point2 | null =>
  draft.proposal.state === 'invalid' ? draft.proposal.problem.at : null

/**
 * Whether this change has to be previewed before it commits. One placement has nobody else
 * to warn, so it commits straight away; more than one goes through `Affects N placements`.
 */
export const needsPreview = (target: ShapeTarget): boolean => target.placementCount > 1

/**
 * The footprint a field should show: the proposal while one is up, the committed shape
 * otherwise. Reading fields through this is what makes Esc restore the old value without the
 * field having to know that anything was ever proposed.
 */
export const shownFootprint = (draft: ShapeDraft, current: ItemFootprint): ItemFootprint =>
  proposalFootprint(draft) ?? current
