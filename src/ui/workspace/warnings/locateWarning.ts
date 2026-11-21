/**
 * Where a warning is, in millimetres (#66 §13).
 *
 * Locate is navigation, not an Edit Transaction: it selects the primary subject, opens the
 * warning's Floor if the reader is standing on another, and moves the viewport so that every
 * subject is on screen. Nothing here writes, so no history entry and no revision change — the
 * criterion is that a person can walk the whole list and the Undo stack is exactly as long as
 * when they started.
 *
 * The box is the union of the subjects' own boxes, each grown by half a thickness so a Wall
 * seen end-on is not a line of zero height that the fitter then zooms to 10×. An arc
 * contributes its `through` point as well, which is the plainest bound that does not need the
 * arc's centre: a locate that shows slightly more of the Floor than it had to is a locate that
 * worked.
 */
import type { Project, Wall, WallRefLine } from '../../../domain'
import type { Warning } from '../../../derive'

/** A box in Floor millimetres. */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** The three points a reference line is drawn through. */
const linePoints = (line: WallRefLine): { x: number; y: number }[] =>
  line.kind === 'line' ? [line.start, line.end] : [line.start, line.through, line.end]

/** A Wall's box: its reference line grown by its own thickness. */
export function wallBox(wall: Wall): Box {
  const pad = wall.thickness / 2
  const points = linePoints(wall.line)
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const minX = Math.min(...xs) - pad
  const minY = Math.min(...ys) - pad
  return { x: minX, y: minY, w: Math.max(...xs) + pad - minX, h: Math.max(...ys) + pad - minY }
}

const union = (a: Box, b: Box): Box => {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  }
}

/**
 * Where each subject of `warning` is, in the order the warning names them.
 *
 * Locate wants the union; the badges want each one, because a badge belongs to an entity and not
 * to a warning. One function answers both rather than a second copy of the three cases.
 */
export function subjectBoxes(
  warning: Warning,
  project: Project,
  placements: readonly { id: string; worldBounds: Box | null }[],
): Box[] {
  const { walls, openings, placedItems } = project.existingModel
  const out: Box[] = []
  for (const subject of warning.subjects) {
    let next: Box | null = null
    if (subject.type === 'wall') {
      const wall = walls.find((each) => each.id === subject.id)
      if (wall !== undefined) next = wallBox(wall)
    } else if (subject.type === 'opening') {
      // An Opening is an absence in exactly one Wall: the host is where it is.
      const opening = openings.find((each) => each.id === subject.id)
      const host = opening === undefined ? undefined : walls.find((each) => each.id === opening.hostWallId)
      if (host !== undefined) next = wallBox(host)
    } else {
      // The derived footprint through the placement, not the stored origin: a point would fit
      // to a zoom that shows a corner of the Item and calls the rest of it off screen.
      const derived = placements.find((each) => each.id === subject.id)?.worldBounds ?? null
      const stored = placedItems.find((each) => each.id === subject.id) ?? null
      if (derived !== null) next = derived
      else if (stored !== null) next = { x: stored.translation.x, y: stored.translation.y, w: 0, h: 0 }
    }
    if (next !== null) out.push(next)
  }
  return out
}

/**
 * The box that holds every subject of `warning`, or `null` when the Project has none of them —
 * which is the state the pruning post-step makes unreachable, and is still worth answering
 * with "stay where you are" rather than with a jump to the origin.
 */
export function warningBox(
  warning: Warning,
  project: Project,
  placements: readonly { id: string; worldBounds: Box | null }[],
): Box | null {
  let box: Box | null = null
  for (const next of subjectBoxes(warning, project, placements)) {
    box = box === null ? next : union(box, next)
  }
  return box
}
