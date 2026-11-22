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

/** The Walls one Junction names: its ends, and its host when it is a run-through. */
const namedBy = (junction: { ends: readonly { wallId: string }[]; host?: { wallId: string } }): string[] =>
  junction.ends.map((end) => end.wallId).concat(junction.host === undefined ? [] : [junction.host.wallId])

/**
 * The usable intervals of the Walls that matter and nothing else.
 *
 * A Wall's interval is set by the Junctions naming it and by the geometry of the Walls on the far
 * side of each of those — that is the whole dependency, so the tidy pass can run over a
 * neighbourhood instead of a Floor (#65 §7, #69 §8).
 */
const usableScoped = (project: Project, floorId: string, wanted: ReadonlySet<string>): Map<string, UsableInterval> => {
  const junctions = project.existingModel.wallJunctions.filter(
    (junction) => junction.floorId === floorId && namedBy(junction).some((wallId) => wanted.has(wallId)),
  )
  const touched = new Set<string>(wanted)
  for (const junction of junctions) for (const wallId of namedBy(junction)) touched.add(wallId)
  const walls: JoinWall[] = project.existingModel.walls
    .filter((wall) => wall.floorId === floorId && touched.has(wall.id))
    .map((wall) => ({ id: wall.id, line: wall.line, thickness: wall.thickness, justification: wall.justification }))
  const shapes: JoinJunction[] = junctions.map((junction) => ({
    id: junction.id,
    ends: junction.ends,
    ...(junction.host === undefined ? {} : { host: junction.host }),
  }))
  return usableIntervals(walls, shapes)
}

/**
 * The Walls whose ends an edit could have moved: the ones it rewrote, and the ones a Junction it
 * rewrote, added or removed runs into. Read by reference, because Immer leaves every record the edit
 * did not touch the same object on both sides (#69 §8). A Junction that went away is expanded here
 * rather than by the caller, because by then nothing in the Project names its Walls any more.
 */
export const movedHosts = (before: Project, after: Project): Set<string> => {
  const ids = new Set<string>()
  const wasWalls = new Set(before.existingModel.walls.map((wall) => wall.id))
  const nowWalls = new Map(after.existingModel.walls.map((wall) => [wall.id, wall]))
  for (const wall of before.existingModel.walls) if (nowWalls.get(wall.id) !== wall) ids.add(wall.id)
  for (const wall of after.existingModel.walls) if (!wasWalls.has(wall.id)) ids.add(wall.id)
  const wasJunctions = new Set(before.existingModel.wallJunctions.map((junction) => junction.id))
  const nowJunctions = new Map(after.existingModel.wallJunctions.map((junction) => [junction.id, junction]))
  for (const junction of before.existingModel.wallJunctions) {
    if (nowJunctions.get(junction.id) === junction) continue
    ids.add(junction.id)
    for (const wallId of namedBy(junction)) ids.add(wallId)
  }
  for (const junction of after.existingModel.wallJunctions) {
    if (wasJunctions.has(junction.id)) continue
    ids.add(junction.id)
    for (const wallId of namedBy(junction)) ids.add(wallId)
  }
  return ids
}

/** The Walls named by a set of moved records, whichever collection those records live in. */
const affectedWalls = (project: Project, moved: ReadonlySet<string>): Set<string> => {
  const walls = new Set<string>()
  for (const wall of project.existingModel.walls) if (moved.has(wall.id)) walls.add(wall.id)
  for (const junction of project.existingModel.wallJunctions) {
    if (!moved.has(junction.id)) continue
    for (const wallId of namedBy(junction)) walls.add(wallId)
  }
  return walls
}

/**
 * Every Opening of a Project still fits — the check a Wall edit passes on its way out
 * (#65 §7). A Wall that is being deleted is skipped: that case is a review, not a fit
 * failure, and the review has already run by the time this does.
 *
 * With `moved`, only the Openings whose host that edit could have shortened are re-checked, which is
 * the same scoping rule the validator applies (#69 §8): an Opening on a Wall the Transaction never
 * touched, and never joined to a Wall it did, cannot have stopped fitting.
 */
export const requireOpeningsFit = (project: Project, moved: ReadonlySet<string> | null = null): void => {
  if (project.existingModel.openings.length === 0) return
  const walls = new Map(project.existingModel.walls.map((wall) => [wall.id, wall]))
  const wanted = moved === null ? null : affectedWalls(project, moved)
  const cache = new Map<string, Map<string, UsableInterval>>()
  for (const opening of project.existingModel.openings) {
    const host = walls.get(opening.hostWallId)
    if (host === undefined) continue
    if (wanted !== null && !wanted.has(host.id)) continue
    let usable = cache.get(host.floorId)
    if (usable === undefined) {
      usable = wanted === null ? usableOfFloor(project, host.floorId) : usableScoped(project, host.floorId, wanted)
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
 * The fit check as an Intent handler's `after` step: the Openings whose host this Transaction
 * moved, re-checked against the Project it finished with (#65 §7, #69 §8).
 */
export const openingsStillFit = (before: Project, after: Project): void => {
  requireOpeningsFit(after, movedHosts(before, after))
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
