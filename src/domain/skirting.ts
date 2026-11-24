/**
 * The Skirting questions that belong to `domain` (#78).
 *
 * A Skirting stores one host, one side, one range and three vertical numbers. Everything else the
 * app shows is either arithmetic on those — the Top, the gross length — or something only the
 * tidied model can answer, which is why the body, the gaps and the net length live in `derive`
 * beside the Wall faces they are read from. Nothing here knows a Wall: what a Skirting's range
 * *means* against a host that has been joined, split or shortened is a `derive` question, and a
 * `domain` module that guessed at it would be a second answer.
 */
import { skirtingLabel, skirtingOf, type Project, type Skirting } from './project'

/** The prefix every default Skirting label carries, before its number. */
export const SKIRTING_LABEL_PREFIX = 'Skirting SK-'

/**
 * The next Skirting's default label: `Skirting SK-1`, `Skirting SK-2`, the lowest number no
 * Skirting of this Project already uses.
 *
 * Numbering is Project-wide rather than per Floor, for the same reason a Beam's is: a Skirting is
 * named on the plan, in a warning sentence and in a schedule row, and two Skirtings called `SK-1`
 * on two Floors would make every one of those ambiguous. A renamed Skirting drops out of the
 * count — only the default shape reserves a number — and the number is never reused while a
 * Skirting holds it.
 */
export function nextSkirtingLabel(project: Project): string {
  const used = new Set<number>()
  const claim = (label: string | undefined): void => {
    const digits = /^Skirting SK-(\d+)$/.exec(label ?? '')
    if (digits !== null) used.add(Number(digits[1]))
  }
  for (const skirting of skirtingOf(project.existingModel)) claim(skirting.label)
  for (const option of project.designOptions ?? [])
    for (const skirting of skirtingOf(option.proposed)) claim(skirting.label)
  for (let candidate = 1; ; candidate += 1) if (!used.has(candidate)) return `${SKIRTING_LABEL_PREFIX}${candidate}`
}

/**
 * The gross length of a Skirting: its own range, before any gap (#78 §1).
 *
 * This is the number the record itself answers, and it is the one the schedule prints beside the
 * net length so the two can never be confused. The gaps come off in `derive`, where the Openings
 * and Junctions that cut them are visible.
 */
export const skirtingGrossLength = (skirting: Skirting): number => skirting.end - skirting.start

/**
 * One Skirting that a Wall's delete has to talk about (#78 §5). The shape is the Opening
 * dependency's: a row the review dialog lists, and the words that row reads.
 */
export interface SkirtingDependency {
  readonly id: string
  /** `Skirting SK-1` — what the row names. */
  readonly label: string
  /** `Skirting SK-1 · Skirting` — the row's whole right-hand side. */
  readonly text: string
}

/**
 * The Skirting that goes with a Wall when it is deleted. A Skirting is a range along one face of
 * one Wall, so with the Wall gone there is no face left for it to stand off — it goes with the
 * Wall, listed beside the Openings rather than removed behind the review.
 */
export const skirtingDependencies = (project: Project, wallId: string): SkirtingDependency[] =>
  skirtingOf(project.existingModel)
    .filter((entry) => entry.hostWallId === wallId)
    .map((entry) => {
      const label = skirtingLabel(entry)
      return { id: entry.id, label, text: `${label} · Skirting` }
    })
