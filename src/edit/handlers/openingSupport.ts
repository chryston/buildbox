/**
 * The fit rule as the handlers read it (#65 §3, §7).
 *
 * An Opening may only stand where the tidied Wall has room for it, and "room" is one
 * definition with one owner: `usableIntervals` reads the same clean-up that draws the band,
 * so a Project the handlers accept is a Project whose Openings sit where the drawing shows
 * them sitting. Every Opening Intent re-checks through here, and so does every Wall edit
 * that can move a host's ends — which is why a Wall can never be shortened out from under an
 * Opening that no longer fits.
 *
 * The refusal carries the sentence of #65 §5, built by `fitProblem` in `domain`: the words
 * live with the rule they describe, so the tool preview, the rejection and the validator
 * cannot drift apart.
 */
import type { Opening, OpeningKind, Project, Wall } from '../../domain'
import { fitProblem } from '../../domain'
import type { JoinJunction, JoinWall, UsableInterval } from '../../geometry'
import { fitOpening, usableIntervals } from '../../geometry'
import { refuse } from './support'

export const openingPath = (openingId: string): string => `existingModel.openings[${openingId}]`

/** One field of one Opening, as a rejection names it. */
export const openingField = (openingId: string, name: string): string => `${openingPath(openingId)}.${name}`

const field = openingField

/** The Opening, or a rejection: every Opening Intent names one. */
export const requireOpening = (project: Project, openingId: string): Opening => {
  const found = project.existingModel.openings.find((opening) => opening.id === openingId)
  if (found === undefined) refuse('unknown-target', openingPath(openingId), `No opening answers to ${openingId}.`)
  return found
}

/** The Opening as a handler writes to it. */
export const editOpening = (draft: Project, openingId: string): Opening => requireOpening(draft, openingId)

/** The Wall an Opening is cut into, or `undefined` when the draft has just lost it. */
export const hostOf = (project: Project, opening: Opening): Wall | undefined =>
  project.existingModel.walls.find((wall) => wall.id === opening.hostWallId)

/** `W-3` for a Wall ID, which is what a message names; the ID itself if the Wall is gone. */
const refOf =
  (project: Project) =>
  (wallId: string): string =>
    project.existingModel.walls.find((wall) => wall.id === wallId)?.ref ?? wallId

/** The usable interval of every Wall on one Floor, from the same clean-up the drawing reads. */
export const usableOfFloor = (project: Project, floorId: string): Map<string, UsableInterval> => {
  const walls: JoinWall[] = project.existingModel.walls
    .filter((wall) => wall.floorId === floorId)
    .map((wall) => ({ id: wall.id, line: wall.line, thickness: wall.thickness, justification: wall.justification }))
  const junctions: JoinJunction[] = project.existingModel.wallJunctions
    .filter((junction) => junction.floorId === floorId)
    .map((junction) => ({
      id: junction.id,
      ends: junction.ends,
      ...(junction.host === undefined ? {} : { host: junction.host }),
    }))
  return usableIntervals(walls, junctions)
}

/** What a placement is judged as: the three fields the sentence needs, plus where it stands. */
export interface Placement {
  readonly id: string
  readonly label: string
  readonly kind: OpeningKind
  readonly width: number
}

/**
 * Whether this Opening stands where the Wall has room, or the reason it does not. The
 * refusal names the Opening and the Wall, and never a coordinate (#65 §5).
 */
export const requireFit = (
  project: Project,
  host: Wall,
  placement: Placement,
  start: number,
  width: number,
): void => {
  const usable = usableOfFloor(project, host.floorId).get(host.id)
  if (usable === undefined) {
    refuse('opening-blocked', field(placement.id, 'start'), 'That wall is not on a floor this opening can stand on.')
  }
  const fit = fitOpening(host.line, usable, start, width)
  if (fit.fits) return
  refuse(
    'opening-blocked',
    field(placement.id, 'start'),
    fitProblem(placement, host.ref, { reason: fit.reason, cause: fit.cause }, refOf(project)),
  )
}

/** The same check for an Opening that is already stored, at the position a handler gives it. */
export const requireFits = (project: Project, opening: Opening, start: number, width: number): void => {
  const host = hostOf(project, opening)
  if (host === undefined) {
    refuse('unknown-target', field(opening.id, 'hostWallId'), 'This opening is cut into a wall that is not here.')
  }
  requireFit(project, host, opening, start, width)
}

/**
 * Every Opening of a Project still fits — the check a Wall edit passes on its way out
 * (#65 §7). A Wall that is being deleted is skipped: that case is a review, not a fit
 * failure, and the review has already run by the time this does.
 */
export const requireOpeningsFit = (project: Project): void => {
  if (project.existingModel.openings.length === 0) return
  const cache = new Map<string, Map<string, UsableInterval>>()
  for (const opening of project.existingModel.openings) {
    const host = hostOf(project, opening)
    if (host === undefined) continue
    let usable = cache.get(host.floorId)
    if (usable === undefined) {
      usable = usableOfFloor(project, host.floorId)
      cache.set(host.floorId, usable)
    }
    const interval = usable.get(host.id)
    if (interval === undefined) continue
    const fit = fitOpening(host.line, interval, opening.start, opening.width)
    if (fit.fits) continue
    refuse(
      'opening-blocked',
      field(opening.id, 'start'),
      fitProblem(opening, host.ref, { reason: fit.reason, cause: fit.cause }, refOf(project)),
    )
  }
}

/**
 * The door fields, checked the way the validator will check them (#65 §1) so the refusal
 * reads as a plain sentence instead of a schema complaint. `kind` decides which fields may
 * be there at all: a window carries neither, a sliding door carries `swing` alone.
 */
export const requireDoorFields = (
  openingId: string,
  kind: OpeningKind,
  swing: Opening['swing'],
  hingeSide: Opening['hingeSide'],
): void => {
  if (kind !== 'door') {
    if (swing !== undefined || hingeSide !== undefined) {
      refuse('invalid-opening', field(openingId, 'swing'), 'Only a door opens, so only a door says which way.')
    }
    return
  }
  if (swing === undefined) refuse('invalid-opening', field(openingId, 'swing'), 'This door does not say which way it opens.')
  if (swing !== 'sliding' && hingeSide === undefined) {
    refuse('invalid-opening', field(openingId, 'hingeSide'), 'This door does not say which jamb it hangs on.')
  }
  if (swing === 'sliding' && hingeSide !== undefined) {
    refuse('invalid-opening', field(openingId, 'hingeSide'), 'A sliding door has no hinge jamb.')
  }
}

/** A hinged door, or the reason this Opening has no hinge or opening side to flip. */
export const requireHinged = (opening: Opening): Extract<Opening['swing'], 'left' | 'right'> => {
  if (opening.kind !== 'door') {
    refuse('invalid-opening', openingPath(opening.id), 'Only a door opens, so only a door has a side to flip.')
  }
  if (opening.swing === undefined || opening.swing === 'sliding') {
    refuse('invalid-opening', openingPath(opening.id), 'A sliding door has no hinge jamb or opening side.')
  }
  return opening.swing
}
