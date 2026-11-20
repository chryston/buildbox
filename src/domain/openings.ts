/**
 * The questions every consumer asks of an Opening (#65).
 *
 * Three families live here, all of them answers about data rather than about pixels:
 * the derived numbers an Opening implies (its far jamb, its height, the chord it cuts
 * across an arc Wall), the words around a placement that does not fit, and the list of
 * Openings that lean on one Wall.
 *
 * The fit wording belongs to `domain` rather than to the interface because three callers
 * need the identical sentence — the validator, the Intent that would move an Opening, and
 * the placement preview that follows the pointer — and a second copy of a sentence is a
 * second sentence. `ui` may read this file; it may not be read *by* `edit`, which is why
 * the sentence is built here and not there (#20 §2).
 */
import { openingChord, openingEnd, type BlockCause, type Pt, type WallRefLine } from '../geometry'
import type { Opening, OpeningKind, Project } from './project'

/** The noun each kind reads as, in a label or a sentence. */
const OPENING_NOUNS: Record<OpeningKind, string> = {
  door: 'door',
  window: 'window',
  removed_section: 'removed section',
}

/** The noun each kind reads as, for a message that names the thing rather than its label. */
export const openingNoun = (kind: OpeningKind): string => OPENING_NOUNS[kind]

/** `Door 2`, `Window 1`, `Removed section 3` — the default label of the nth of its kind. */
export const defaultOpeningLabel = (kind: OpeningKind, index: number): string => {
  const noun = OPENING_NOUNS[kind]
  return noun.charAt(0).toUpperCase() + noun.slice(1) + ` ${index}`
}

/**
 * The label a new Opening of `kind` gets: one above the highest number already used by
 * that kind in the whole Project. A deleted door leaves its number spent, the way a
 * deleted Wall leaves `W-4` spent (#64 §1) — reusing a number would make two messages
 * about different openings read the same.
 */
export const nextOpeningLabel = (openings: readonly Opening[], kind: OpeningKind): string => {
  const prefix = defaultOpeningLabel(kind, 0)
  let highest = 0
  for (const opening of openings) {
    if (opening.kind !== kind || !opening.label.startsWith(prefix)) continue
    const rest = opening.label.slice(prefix.length)
    if (!/^\d+$/.test(rest)) continue
    highest = Math.max(highest, Number(rest))
  }
  return defaultOpeningLabel(kind, highest + 1)
}

/** The Vertical Extent of an Opening: `head − sill`, in millimetres. */
export const openingHeight = (opening: Opening): number => opening.head - opening.sill

/** An Opening's derived geometry along its host's reference line and in Floor coordinates. */
export interface OpeningSpan {
  /** Distance along the reference line of the far jamb — `start + width` on a straight Wall. */
  end: number
  /** The arc length the opening covers, which is more than the chord on an arc Wall. */
  arcLength: number
  /** The two jambs, in Floor coordinates: the chord itself. */
  from: Pt
  to: Pt
}

/**
 * What an Opening of this `kind` measures to: its far jamb, and the chord it cuts across
 * the Wall. On an arc Wall the far jamb is further along than `start + width`, because
 * `width` is the chord and the reference line runs along the arc (#65 §2).
 */
export const openingSpan = (line: WallRefLine, start: number, width: number): OpeningSpan => {
  const end = openingEnd(line, start, width)
  const chord = openingChord(line, start, width)
  return { end, arcLength: end - start, from: chord.from, to: chord.to }
}

/** Every Opening cut into `wallId`, in the order the Project lists them. */
export const openingsOfWall = (project: Project, wallId: string): Opening[] =>
  project.existingModel.openings.filter((opening) => opening.hostWallId === wallId)

/** Every Opening of one Floor. */
export const openingsOfFloor = (project: Project, floorId: string): Opening[] =>
  project.existingModel.openings.filter((opening) => opening.floorId === floorId)

/**
 * One thing that leans on a Wall, for the review a delete shows before it goes through
 * (#65 §8). The shape is the Floor review's: a row the dialog lists, and the words that
 * row reads.
 */
export interface OpeningDependency {
  readonly id: string
  /** `Door 1` — what the row names. */
  readonly label: string
  readonly kind: OpeningKind
  /** `Door 1 · Door` — the row's whole right-hand side. */
  readonly text: string
}

/**
 * The Openings that go with a Wall when it is deleted. Deleting the Wall never reassigns
 * them to a neighbour: an Opening is an absence in one Wall, and with the Wall gone there
 * is nothing left to be an absence in.
 */
export const openingDependencies = (project: Project, wallId: string): OpeningDependency[] =>
  openingsOfWall(project, wallId).map((opening) => ({
    id: opening.id,
    label: opening.label,
    kind: opening.kind,
    text: `${opening.label} · ${OPENING_NOUNS[opening.kind]}`,
  }))

/** Whether a Wall carries anything a delete would have to talk about first. */
export const wallHasOpenings = (project: Project, wallId: string): boolean =>
  project.existingModel.openings.some((opening) => opening.hostWallId === wallId)

/** Why an Opening does not fit, as the fit rule found it. */
export interface FitFailure {
  readonly reason: 'ok' | 'no-room' | 'blocked'
  readonly cause: BlockCause | null
}

/** Millimetres in a sentence: whole when they are whole, one decimal when they are not. */
const mm = (value: number): string => `${Math.round(value * 10) / 10}`

/**
 * The one sentence that says why an Opening does not fit (#65 §5), in plain words and
 * naming the Walls it names. `refOf` turns a Wall ID into the `W-<n>` a person reads.
 *
 * Three sentences cover every refusal: the Wall is too short for the thing at all, the
 * opening would stand over an end of its host, or it would cut across a Junction.
 */
export const fitProblem = (
  opening: { label: string; kind: OpeningKind; width: number },
  hostRef: string,
  failure: FitFailure,
  refOf: (wallId: string) => string,
): string => {
  if (failure.reason === 'no-room') {
    return `This wall is shorter than a ${mm(opening.width)} mm ${OPENING_NOUNS[opening.kind]}.`
  }
  const cause = failure.cause
  if (cause !== null && cause.kind === 'junction') {
    return `${opening.label} would cross the join with ${refOf(cause.wallId)}.`
  }
  return `${opening.label} would run past the end of ${hostRef}. Move or narrow it first.`
}
