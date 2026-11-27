/**
 * The Notes a sheet carries (#83 §2, §3).
 *
 * The same two modules the Plan View canvas paints — `drawMarks` for the Annotations of the exported
 * view, `drawNotes` for the pins and the `✎n` badges — handed the same inputs the canvas hands them,
 * with two differences that exist because this is paper: every mark is scaled into paper millimetres
 * the way the Floor's own geometry is, and a pin wears its label because a sheet has no tooltip.
 *
 * What decides whether a mark is on the sheet is the recipe and the composition, never the screen:
 * the Notes overlay's on-screen switch is Display state and is not read here (#83 Notes), and the
 * layer answer comes from the dialog's chips rather than from the saved view, so the sheet shows what
 * the person chose and nothing else.
 */
import type { MarkSubject } from '../drawing'
import { drawMarks, drawNotes } from '../drawing'
import type { DisplayList, Rect } from '../drawing'
import {
  ANNOTATION_SCOPE_ALL,
  UNLAYERED_LAYER_KEY,
  annotationPositionIsRect,
  commentAnchorFloorId,
  commentIsOpen,
  compareAnnotationReferences,
  compareCommentReferences,
  endpointIsAnchored,
  savedViewById,
} from '../domain'
import type { Comment, EntityId, Point2, Project, SavedViewSettings } from '../domain'
import {
  commentAnchorPoint,
  commentIsInContext,
  effectiveAnnotationStyle,
  effectiveModel,
} from '../derive'
import type { FloorWalls } from '../derive'
import { SHEET_SIZING } from './sheet'
import { PIN_STATUS_WORDS } from './strings'
import type { NotesSwitches } from './types'

/** One placement of an Item Design, in the shape the `✎n` badge needs. */
export interface ExportNotePlacement {
  readonly id: EntityId
  readonly designId: EntityId
  readonly worldBounds: Rect
}

export interface ExportNotesInput {
  readonly project: Project
  /** The Plan View this sheet was drawn from, which is what an Annotation belongs to. */
  readonly view: SavedViewSettings & { id: EntityId; floorId: EntityId }
  /** The Design Option the sheet was drawn from, or `null` for the Existing Model alone. */
  readonly optionId: EntityId | null
  /** The composition's layer answer, chips included (#83 §2.1). */
  readonly drawnLayer: (key: EntityId) => boolean
  /** The Floor's Walls, unscaled: an Anchor resolves in model millimetres and is scaled after. */
  readonly walls: FloorWalls
  /** The placements drawn on this Floor, unscaled, for the `✎n` badge. */
  readonly placements: readonly ExportNotePlacement[]
  readonly notes: NotesSwitches
  /** `1 / denominator`, the same shrink the Floor's geometry went through. */
  readonly shrink: number
}

/** The status word a pin's label ends with. */
const statusWord = (comment: Comment): string => PIN_STATUS_WORDS[comment.status]

/**
 * The words beside a pin: `C-004 Shift 50 mm for dishwasher · Open` (#83 §3).
 *
 * The prototype cut the title at sixteen characters to keep its demo pill narrow. A sheet has room
 * for the whole title and a person reading a printed drawing has no way to ask for the rest, so the
 * title goes out whole — the one place this export departs from the prototype on purpose.
 */
const pinLabel = (comment: Comment): string =>
  `${comment.reference} ${comment.title} · ${statusWord(comment)}`.replace(/\s+/g, ' ').trim()

/** The Annotations of the exported view, in reference order, with their endpoints resolved. */
function annotationSubjects(input: ExportNotesInput): MarkSubject[] {
  const { project, view, optionId, drawnLayer, walls, shrink } = input
  const out: MarkSubject[] = []
  const annotations = (project.annotations ?? [])
    .filter((annotation) => annotation.viewId === view.id)
    // The two Project-shaped rules of #81 §5.3, with the dialog's layer answer in place of the
    // saved view's: an Annotation on a Layer the chips turned off does not reach the paper.
    .filter((annotation) => annotation.scope === ANNOTATION_SCOPE_ALL || annotation.scope === optionId)
    .filter((annotation) => drawnLayer(annotation.layerId ?? UNLAYERED_LAYER_KEY))
    .sort((left, right) => compareAnnotationReferences(left.reference, right.reference))
  for (const annotation of annotations) {
    const position = annotation.position
    const scaled = (point: Point2): Point2 => ({ x: point.x * shrink, y: point.y * shrink })
    let endpointAt: Point2 | null = null
    if (annotation.endpoint !== undefined) {
      const resolved = endpointIsAnchored(annotation.endpoint)
        ? commentAnchorPoint(project, walls, annotation.endpoint.anchor)
        : annotation.endpoint.free
      // A Leader whose subject has gone is not drawn at a guessed place, on paper or on screen.
      if (resolved === null) continue
      endpointAt = scaled(resolved)
    }
    out.push({
      id: annotation.id,
      type: annotation.type,
      at: annotationPositionIsRect(position)
        ? { x: Math.min(position.a.x, position.b.x) * shrink, y: Math.min(position.a.y, position.b.y) * shrink }
        : scaled(position),
      text: annotation.text,
      endpointAt,
      rect: annotationPositionIsRect(position)
        ? {
            x: Math.min(position.a.x, position.b.x) * shrink,
            y: Math.min(position.a.y, position.b.y) * shrink,
            w: Math.abs(position.b.x - position.a.x) * shrink,
            h: Math.abs(position.b.y - position.a.y) * shrink,
          }
        : null,
      targetLabel: annotation.targetViewId === undefined ? null : savedViewById(project, annotation.targetViewId)?.name ?? null,
      style: effectiveAnnotationStyle(project, view, annotation),
    })
  }
  return out
}

/**
 * The Comments this sheet carries a pin for.
 *
 * A pin stands in one Floor's coordinates, so an Anchor without a place — the Project, a Floor, a
 * Design Option, an Item Design — gets no pin here; it is the `✎n` badge or the Register that says
 * something about it. The context rule is the screen's own, asked of the Option the sheet was drawn
 * from rather than the one the view has on screen.
 */
function pinnedComments(input: ExportNotesInput): Comment[] {
  const { project, view, optionId, notes } = input
  const model = effectiveModel(project, view.floorId, optionId)
  return (project.comments ?? [])
    .filter((comment) => commentIsInContext(project, view, comment, model))
    .filter((comment) => commentAnchorFloorId(comment.anchor) === null || commentAnchorFloorId(comment.anchor) === view.floorId)
    .filter((comment) => commentIsOpen(comment) || notes.includeResolvedPins)
    .sort((left, right) => compareCommentReferences(left.reference, right.reference))
}

export function exportNotes(input: ExportNotesInput): DisplayList | null {
  const { project, notes, walls, shrink } = input
  const marks = notes.viewAnnotations ? annotationSubjects(input) : []
  const listed = notes.commentPins ? pinnedComments(input) : []
  const pins = listed
    .map((comment) => {
      const at = commentAnchorPoint(project, walls, comment.anchor)
      return at === null ? null : {
        id: comment.id,
        at: { x: at.x * shrink, y: at.y * shrink },
        tone: (commentIsOpen(comment) ? comment.priority : 'resolved') as 'high' | 'normal' | 'low' | 'resolved',
        reference: comment.reference,
        label: pinLabel(comment),
      }
    })
    .filter((pin): pin is NonNullable<typeof pin> => pin !== null)

  // One `✎n` per placement of a Design that has Comments — never one pin per copy (#80 §12). The
  // count is the same set the pins come from, so `include Resolved pins` moves both together.
  const counts = new Map<EntityId, number>()
  for (const comment of listed) {
    const anchor = comment.anchor
    const designId =
      anchor.kind === 'item_design' ? anchor.itemDesignId
        : anchor.kind === 'feature' && project.itemDesigns.some((row) => row.id === anchor.ownerId) ? anchor.ownerId
          : null
    if (designId === null) continue
    counts.set(designId, (counts.get(designId) ?? 0) + 1)
  }
  const badges = [...counts.keys()].length === 0
    ? []
    : input.placements
        .filter((placement) => counts.has(placement.designId))
        .map((placement) => ({
          id: placement.id,
          bounds: {
            x: placement.worldBounds.x * shrink,
            y: placement.worldBounds.y * shrink,
            w: placement.worldBounds.w * shrink,
            h: placement.worldBounds.h * shrink,
          },
          count: counts.get(placement.designId)!,
        }))

  const painted = [drawMarks(marks, { sizing: SHEET_SIZING }), drawNotes(pins, badges, { sizing: SHEET_SIZING })].filter(
    (list): list is DisplayList => list !== null,
  )
  if (painted.length === 0) return null
  const bounds = painted.map((list) => list.bounds).reduce((a, b) => ({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x),
    h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y),
  }))
  return {
    space: 'floor',
    bounds,
    // Marks under pins: an Annotation is drawn content and a pin is chrome over all of it, which is
    // the order the canvas paints them in too.
    layers: painted.flatMap((list) => list.layers),
    missingGlyphs: [],
  }
}
