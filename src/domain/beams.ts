/**
 * The Beam questions that belong to `domain` (#77).
 *
 * A Beam stores four numbers and one line, and every other number the app shows is arithmetic on
 * those: the Top is Underside plus Depth, the Length is the reference line's own length. Nothing
 * here knows a Wall — a Beam has no host and takes no Junction, so there is no relationship to
 * resolve and nothing to keep in step. Faces are not here either: they come from
 * `geometry.linearElement`, which `derive` calls with the same three inputs a Wall hands it.
 */
import { beamsOf, type Project } from './project'

/** The prefix every default Beam label carries, before its number. */
export const BEAM_LABEL_PREFIX = 'Beam B-'

/**
 * The next Beam's default label: `Beam B-1`, `Beam B-2`, the lowest number no Beam of this Project
 * already uses.
 *
 * Numbering is Project-wide rather than per Floor, because a Beam is named on the plan and in a
 * warning sentence, and two Beams called `B-1` on two Floors would make every one of those
 * sentences ambiguous. A renamed Beam drops out of the count — only the default shape reserves a
 * number — and the number is never reused while a Beam holds it.
 */
export function nextBeamLabel(project: Project): string {
  const used = new Set<number>()
  const claim = (label: string | undefined): void => {
    const digits = /^Beam B-(\d+)$/.exec(label ?? '')
    if (digits !== null) used.add(Number(digits[1]))
  }
  for (const beam of beamsOf(project.existingModel)) claim(beam.label)
  for (const option of project.designOptions ?? []) for (const beam of beamsOf(option.proposed)) claim(beam.label)
  for (let candidate = 1; ; candidate += 1) if (!used.has(candidate)) return `${BEAM_LABEL_PREFIX}${candidate}`
}
