/**
 * The Notes half of a dependency review (#82 §2, §3).
 *
 * One row per Comment or Annotation that the operation would leave anchored to nothing, each with
 * the choices the edit layer offered for it and nothing more. The row is the whole answer: the
 * reference, the note's own words, what it is anchored to right now, and — where the choice needs
 * one — the target it would move to. `Keep` says out loud what it does before Apply rather than
 * after, because a silent conversion to All Options is the failure this review exists to prevent.
 *
 * It is a section rather than a dialog of its own so that a Wall with both Openings and Notes asks
 * one question in one modal (#82 criterion 14), and a delete with only Notes asks the same question
 * in a modal of its own.
 */
import type { ReactNode } from 'react'
import type { NotesChoice, NotesDependencyReport, NotesResolution, NotesSubject, NotesTargetRef } from '../../../edit'
import type { Project } from '../../../domain'
import { designOptionsOf, savedViewById } from '../../../domain'
import { STRINGS } from '../../strings'
import { commentAnchorSubject, commentFeatureLabel } from './anchorLabel'

/** The answer to one row: the choice, and the target when the choice takes one. */
export interface NotesAnswer {
  readonly choice: NotesChoice | null
  readonly target: NotesTargetRef | null
}

export type NotesAnswers = Readonly<Record<string, NotesAnswer>>

/** The answers the review opens with: every preset row already answered, every other undecided. */
export function initialNotesAnswers(report: NotesDependencyReport): NotesAnswers {
  const answers: Record<string, NotesAnswer> = {}
  for (const row of report.rows) answers[row.dependentId] = { choice: row.preset, target: null }
  return answers
}

/** Every row answered, in the order the report listed them, or `null` while one is undecided. */
export function notesResolutions(report: NotesDependencyReport, answers: NotesAnswers): NotesResolution[] | null {
  const resolutions: NotesResolution[] = []
  for (const row of report.rows) {
    const answer = answers[row.dependentId]
    if (answer === undefined || answer.choice === null) return null
    if (answer.choice === 'reanchor' && answer.target === null) return null
    resolutions.push({
      dependentId: row.dependentId,
      choice: answer.choice,
      ...(answer.choice === 'reanchor' && answer.target !== null ? { targetRef: answer.target } : {}),
      expectedAnchor: row.fingerprint,
    })
  }
  return resolutions
}

/** The rows still unanswered, which is what the Apply button counts out loud. */
export function unansweredNotes(report: NotesDependencyReport, answers: NotesAnswers): number {
  return report.rows.reduce((total, row) => {
    const answer = answers[row.dependentId]
    if (answer === undefined || answer.choice === null) return total + 1
    return answer.choice === 'reanchor' && answer.target === null ? total + 1 : total
  }, 0)
}

/**
 * The option's identity: the target itself, not its words. Two placements of one design read the same
 * and are not the same target, so a label can never be the key — React would drop the duplicate option
 * and one of the two would become unreachable.
 */
export function notesTargetKey(target: NotesTargetRef): string {
  return JSON.stringify(target)
}

/**
 * A Placed Item reads as `Base 600 #2`: the design's name and which placement of it this is, in the
 * order they were placed. The design name alone would not answer criterion 3, which is about moving a
 * note from Base 600 #2 to Base 600 #1 — two options that read alike are one option React keeps and one
 * note left in the wrong place.
 */
function placementLabel(project: Project, entityId: string): string | null {
  const placements = [
    ...project.existingModel.placedItems,
    ...designOptionsOf(project).flatMap((option) => option.proposed.placedItems),
  ]
  const at = placements.findIndex((item) => item.id === entityId)
  if (at < 0) return null
  const item = placements[at]!
  const design = project.itemDesigns.find((entry) => entry.id === item.itemDesignId)
  if (design === undefined) return null
  const occurrence = placements.reduce((count, other, index) => (index <= at && other.itemDesignId === item.itemDesignId ? count + 1 : count), 0)
  return `${design.name} #${occurrence}`
}

/** What a Reanchor target reads as: `Base 600 #1`, `Kitchen`, `Pantry · West Elevation`. */
export function notesTargetLabel(project: Project, target: NotesTargetRef): string {
  if (target.kind === 'view') {
    return savedViewById(project, target.viewId)?.name ?? STRINGS.notesChooseTarget
  }
  if (target.kind === 'entity') {
    return placementLabel(project, target.entityId) ?? commentAnchorSubject(project, target)
  }
  return commentAnchorSubject(project, target)
}

/** The subject line: what is going, in the words the rest of the app uses for it. */
export function notesSubjectLine(project: Project, subject: NotesSubject): string {
  const verb = subject.kind === 'feature' ? STRINGS.notesVerbRemove : STRINGS.notesVerbDelete
  const label =
    subject.kind === 'feature'
      ? commentFeatureLabel(project, subject.ownerId, subject.featureId)
      : subject.label
  return STRINGS.notesReviewSubject(verb, label)
}

const CHOICE_LABELS: Record<NotesChoice, string> = {
  floor_point: STRINGS.notesChoiceFloorPoint,
  reanchor: STRINGS.notesChoiceReanchor,
  delete: STRINGS.notesChoiceDelete,
  keep: STRINGS.notesChoiceKeep,
}

const NOTE_LINES: Record<string, string> = {
  'deleted-with-view': STRINGS.notesDeletedWithView,
  'keep-all-options': STRINGS.notesKeepAllOptions,
  'keep-floor-point': STRINGS.notesKeepFloorPoint,
}

export interface NotesReviewSectionProps {
  project: Project
  report: NotesDependencyReport
  answers: NotesAnswers
  onAnswer: (dependentId: string, answer: NotesAnswer) => void
}

export function NotesReviewSection(props: NotesReviewSectionProps): ReactNode {
  const { project, report, answers, onAnswer } = props
  return (
    <section className="bb-notes-review" data-testid="notes-review-section">
      <h3 className="bb-notes-review-heading" data-testid="notes-review-heading">{STRINGS.notesReviewSection}</h3>
      <p className="bb-workspace-dialog-note">{notesSubjectLine(project, report.subject)}</p>
      <ul className="bb-notes-review-rows">
        {report.rows.map((row) => {
          const answer = answers[row.dependentId] ?? { choice: null, target: null }
          return (
            <li key={row.dependentId} className="bb-notes-review-row" data-testid="notes-review-row">
              <p className="bb-notes-review-row-title">
                <span className="bb-notes-review-reference">{row.reference}</span>
                {row.kind === 'reference_marker'
                  ? ` ${row.title} · ${row.owningViewName ?? ''} → ${row.targetViewName ?? ''}`
                  : ` ${row.title}`}
              </p>
              <p className="bb-notes-review-row-anchor">{row.anchorLabel}</p>
              <div className="bb-notes-review-row-answer">
                <div className="bb-notes-review-seg" role="group" aria-label={row.reference}>
                  {row.choices.map((choice) => (
                    <button
                      key={choice}
                      type="button"
                      data-testid={`notes-review-choice-${choice}`}
                      className={`bb-notes-review-seg-button${answer.choice === choice ? ' is-selected' : ''}`}
                      disabled={choice === 'floor_point' && row.floorPointDisabled}
                      title={choice === 'floor_point' && row.floorPointDisabled ? STRINGS.notesNoPosition : undefined}
                      aria-pressed={answer.choice === choice}
                      onClick={() => onAnswer(row.dependentId, { choice, target: answer.target })}
                    >
                      {CHOICE_LABELS[choice]}
                    </button>
                  ))}
                </div>
                {row.choices.includes('reanchor') && answer.choice === 'reanchor' && (
                  <select
                    data-testid="notes-review-target"
                    className="bb-notes-review-target"
                    value={answer.target === null ? '' : notesTargetKey(answer.target)}
                    onChange={(event) => {
                      const picked = row.targets.find((target) => notesTargetKey(target) === event.target.value)
                      onAnswer(row.dependentId, { choice: 'reanchor', target: picked ?? null })
                    }}
                  >
                    <option value="">{STRINGS.notesChooseTarget}</option>
                    {row.targets.map((target) => (
                      <option key={notesTargetKey(target)} value={notesTargetKey(target)}>
                        {notesTargetLabel(project, target)}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {row.note !== null && <p className="bb-notes-review-helper">{NOTE_LINES[row.note]}</p>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
