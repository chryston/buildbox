/**
 * What a drag in an Elevation View may change, and what it says while it does (#75 §6).
 *
 * A drag here is vertical and nothing else: the plan owns where a thing stands, the Elevation View owns
 * how high. That single constraint is what makes the whole gesture expressible as two numbers — the
 * entity's bottom and its top — and one delta, which is why this file can hold all of it as pure
 * functions and the component can hold none.
 *
 * The words are the issue's, down to the separator and the minus sign: `Base 860 mm · Δ −640`. A chip
 * that read `Base: 860mm (-640)` would say the same thing and match no test, no screenshot and no
 * review of the mock-up, so the format lives here where one test can hold it.
 */
import type { ElevationRowKind } from '../../../derive'
import { STRINGS } from '../../strings'

/**
 * The three Vertical Extent fields, written here rather than imported: `edit` exports them only
 * through its Intent payload map, and the call site that builds the payload is where the type is
 * checked. A wider entry point for a three-word union would let any UI name any field.
 */
export type ElevationExtentField = 'base' | 'height' | 'top'

/** Which handle the hand is on, and so which edge of the extent follows it. */
export type ElevationDragKind = 'top' | 'bottom' | 'body'

/** The two edges of a vertical extent, in millimetres above the Floor Datum. */
export interface ElevationEdges {
  readonly bottom: number
  readonly top: number
}

/**
 * The handles one kind of entity offers.
 *
 * An entity that owns its height — a Wall, an Opening, and later a Beam or a run of Skirting — has
 * three: it can be made taller from either end or moved whole. A Placed Item's size belongs to its
 * Item Design, so it has the move handle and nothing else: dragging its top would edit a number the
 * Design owns, which is the one thing the pane must never do.
 */
export function elevationHandleKinds(kind: ElevationRowKind): readonly ElevationDragKind[] {
  return kind === 'item' ? ['body'] : ['top', 'bottom', 'body']
}

/**
 * Where the extent ends up for a delta on one handle.
 *
 * `top` and `bottom` resize with the other edge fixed; `body` moves both, so the height is the same
 * number it was. A resize that would put an edge through the other is refused by the caller rather
 * than clamped here — the same rule the number boxes follow, and for the same reason: a silent clamp
 * tells the reader nothing about the drag they just made.
 */
export function draggedEdges(kind: ElevationDragKind, edges: ElevationEdges, deltaMm: number): ElevationEdges {
  if (kind === 'top') return { bottom: edges.bottom, top: edges.top + deltaMm }
  if (kind === 'bottom') return { bottom: edges.bottom + deltaMm, top: edges.top }
  return { bottom: edges.bottom + deltaMm, top: edges.top + deltaMm }
}

/** A resize that would turn the extent inside out; a body drag cannot. */
export function draggedEdgesAreInvalid(kind: ElevationDragKind, edges: ElevationEdges): boolean {
  return kind !== 'body' && edges.top < edges.bottom
}

/**
 * The Intent's field for a finished drag.
 *
 * `base` and `top` are the two ends; `height` is what a Wall or an Opening calls the distance between
 * them, and it is the field a resize changes when the fixed end is the bottom. A Placed Item owns no
 * height of its own — its Item Design does — so a move is written as its `top`, which is the field the
 * handler turns back into a base.
 */
export function elevationCommit(
  kind: ElevationDragKind,
  rowKind: ElevationRowKind,
  edges: ElevationEdges,
): { readonly field: ElevationExtentField, readonly value: number } {
  if (kind === 'body') {
    return rowKind === 'item'
      ? { field: 'top', value: Math.round(edges.top) }
      : { field: 'base', value: Math.round(edges.bottom) }
  }
  if (kind === 'bottom') return { field: 'base', value: Math.round(edges.bottom) }
  // A top drag on an entity that owns its height changes the height; on one that does not, it changes
  // the top the handler will read back as a base.
  return rowKind === 'item'
    ? { field: 'top', value: Math.round(edges.top) }
    : { field: 'height', value: Math.round(edges.top - edges.bottom) }
}

/**
 * A whole millimetre with the sign the issue writes: a true minus (U+2212), and no `+` on the way up.
 *
 * Nothing in a Building is 0.4 mm, and a hyphen in a number the interface just formatted would sit
 * narrower than the minus in the delta beside it.
 */
const mm = (value: number): string => {
  const rounded = Math.round(value)
  return rounded < 0 ? `−${-rounded}` : String(rounded)
}

/**
 * The chip beside the ghost: the value being changed, its delta, and the height when the drag changes
 * the height too.
 *
 * A body drag and a bottom drag both move the base, so both read `Base … · Δ …`; only a top drag reads
 * `Top …`, and only a resize adds the third part, because a move leaves the height alone and saying so
 * would be noise.
 */
export function elevationChipText(
  kind: ElevationDragKind,
  edges: ElevationEdges,
  original: ElevationEdges,
): string {
  const moved = kind === 'top'
    ? { label: STRINGS.elevationChipTop, value: edges.top, from: original.top }
    : { label: STRINGS.elevationChipBase, value: edges.bottom, from: original.bottom }
  const head = `${moved.label} ${mm(moved.value)} mm · ${STRINGS.elevationChipDelta} ${mm(moved.value - moved.from)}`
  const resized = kind !== 'body'
  return resized ? `${head} · ${STRINGS.elevationChipHeight} ${mm(edges.top - edges.bottom)} mm` : head
}
