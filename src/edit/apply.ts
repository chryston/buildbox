/**
 * Applying an Intent (#47, #20 §4).
 *
 * One pass, four steps: find the handler, run it on an immer draft while recording patches,
 * validate what those patches touched (#69 §8), and answer `Applied` or `Rejection`. Nothing is
 * written to the caller's Project — `applyIntent` is a pure function from
 * `(project, intent)` to the next Project, which is why #48's history can replay it, #49's
 * autosave can debounce it, and a test can call it without a store at all.
 *
 * The patches are the point. A snapshot per step would cost the reference Project about
 * 1.2 MB each; a `setNodeLabel` patch is one path and one string. Undo is
 * `applyPatches(project, inversePatches)`.
 */
import { applyPatches as applyImmerPatches, enablePatches, produceWithPatches, setAutoFreeze } from 'immer'
import type { Patch } from 'immer'
import { validateProject } from '../domain'
import type { EntityId, Project } from '../domain'
import { designOptionsOf } from '../domain'
import { problem } from '../lib'
import { validationScopeFor } from './validationScope'
import { guardAnchoredComments } from './anchoredComments'
import { guardAnchoredAnnotations } from './anchoredAnnotations'
import { applyNotesResolutions, notesDependencyReport, notesReviewMessage } from './notesDependencies'
import type {
  Applied,
  DependencyReview,
  Intent,
  IntentType,
  Locator,
  NotesDependencyReport,
  Rejection,
  RejectionCode,
} from './intents'
import { IntentRejection } from './handlers/support'
import { pruneStaleAcknowledgements } from './handlers/warningHandlers'
import { INTENT_HANDLERS } from './registry'
import type { IntentHandler } from './handlers/context'

enablePatches()
// Immer deep-freezes every result by default. On the reference Project that is 15k nodes
// frozen per Intent, which the 30 ms budget cannot pay for — and the Project is validated
// whole on the way out anyway (#42 §5).
setAutoFreeze(false)

/** An erased handler, for the one dispatch below. The registry's key is the proof. */
type AnyHandler = IntentHandler<IntentType>

function handlerFor(type: IntentType): AnyHandler | undefined {
  // An Intent can arrive from a file or another tab (#49), so its type is only as
  // trustworthy as the registry: an unknown one is a rejection, never a crash.
  return INTENT_HANDLERS[type] as AnyHandler | undefined
}

function rejected(code: RejectionCode, path: string, message: string): Rejection {
  return { ok: false, code, problems: [problem(path, code, message)] }
}

/**
 * Whether one patch only moves a record between Drawing Layers (#71 §5).
 *
 * Layer membership is presentation: it decides whether the record is drawn, pickable and editable in
 * a given view, and never what the record is. Re-filing a baseline Wall onto another layer therefore
 * changes nothing the Options disagree about, and does not belong behind the correction dialog.
 *
 * Read off the patch path rather than the Intent type, the same way the guard above is: an Intent
 * that re-files as a side effect — `layer.delete` un-filing every member, `floor.duplicate` carrying
 * a copy's layer with it — is exempt on the same terms, and an Intent that edits the Wall *and*
 * re-files it still trips the guard on its other patches.
 */
const isLayerReassignment = (patch: Patch): boolean =>
  patch.path[patch.path.length - 1] === 'drawingLayerId'

/**
 * Run one Intent against a Project.
 *
 * `Applied` carries the next Project, the patches that got there, the inverse patches that
 * undo it, and where the edit landed. `Rejection` carries a code and at least one problem
 * that says why — and the caller's Project is untouched either way.
 *
 * `mode` is why the same run answers two questions (#82 §1). Applying needs the user's answer to
 * every note the edit strands, and refuses the Intent when one of them has gone stale. Previewing
 * asks the question instead: it drops the stranded notes from the probe so the validator has a
 * Project to judge, and returns the report the dialog is built from, because a question is not a
 * Rejection.
 */
function runIntent(
  project: Project,
  intent: Intent,
  mode: 'apply' | 'preview',
): { outcome: Applied | Rejection; notes: NotesDependencyReport | null } {
  const handler = handlerFor(intent.type)
  if (handler === undefined) {
    return { outcome: rejected('unknown-target', 'type', `No Intent type ${intent.type} is in the catalogue.`), notes: null }
  }
  const affected = handler.locate(project, intent)

  let next: Project
  let patches: Patch[]
  let inversePatches: Patch[]
  try {
    ;[next, patches, inversePatches] = produceWithPatches(project, (draft) => {
      handler.run({ project, draft, intent })
      // An acknowledgement outliving its subject would record a decision about a warning no
      // producer can ever raise again (#66 §4). Part of this same producer, so deleting a
      // Wall drops its acknowledgement in the same Edit Transaction — and one undo puts both
      // back, note included. `previewIntent` goes through here too, so a preview that would
      // prune says so.
      pruneStaleAcknowledgements(draft)
    })
  } catch (error) {
    if (error instanceof IntentRejection) return { outcome: { ok: false, code: error.code, problems: error.problems }, notes: null }
    throw error
  }

  // What this edit strands, and what the user said about each note (#82). The deletion and every
  // decision about what hung off it are one command: a second producer over the same draft, whose
  // patches join the first's, so the history entry is one step and one undo restores the target,
  // the notes and their original Anchors together.
  let notes: NotesDependencyReport | null = null
  try {
    const report = notesDependencyReport(project, next)
    if (report !== null) {
      notes = report
      if (mode === 'preview') {
        ;[next] = produceWithPatches(next, (draft) => {
          for (const row of report.rows) removeDependent(draft, row.dependentId)
        })
      } else {
        const resolutions = intent.notesResolutions
        if (resolutions === undefined) {
          return { outcome: rejected('has-dependants', `notes[${report.rows[0]!.dependentId}]`, notesReviewMessage(report)), notes }
        }
        let notesPatches: Patch[]
        let notesInverse: Patch[]
        ;[next, notesPatches, notesInverse] = produceWithPatches(next, (draft) => {
          applyNotesResolutions(project, draft, report, resolutions, intent.now)
        })
        patches = [...patches, ...notesPatches]
        inversePatches = [...notesInverse, ...inversePatches]
      }
    }
  } catch (error) {
    if (error instanceof IntentRejection) return { outcome: { ok: false, code: error.code, problems: error.problems }, notes }
    throw error
  }

  // The Comment and Annotation reference counters are monotonic, and undo does not rewind either (#80 §1 criterion 2, #81 §1). The
  // number a Comment was shown has been read out loud, so handing it to a later one would give two
  // records the same name — the same reason the ID allocator lives outside the Project and is not
  // rewound either (#42 §3). The counter itself has to live in the Project, because a Backup has to
  // arrive with a number nothing may reuse, so the forward patch stays (a replay, a redo and a Backup
  // all see it) and only its inverse is dropped.
  inversePatches = inversePatches.filter((patch) => patch.path[0] !== 'commentReferenceCounter' && patch.path[0] !== 'annotationReferenceCounter')

  // What the finished Project owes the rules a handler could not check from inside the draft
  // (#65 §7): the plain result, not a proxy, so a sweep of the Floor costs what it reads.
  try {
    handler.after?.(project, next)
  } catch (error) {
    if (error instanceof IntentRejection) return { outcome: { ok: false, code: error.code, problems: error.problems }, notes }
    throw error
  }

  // No Comment may outlive the thing it is about (#80 §14), and no Annotation may outlive the thing
  // its endpoint is anchored to (#81 §8.1). Judged on the finished Project rather than per Intent, so
  // a deletion, a Floor removal, an Option demolition and a cabinet edit that drops a node are all
  // refused by the same rule — and so is any command the catalogue gains later. After #82 they are the
  // last line rather than the only one: an Intent that came through the dependency review has already
  // moved or deleted everything they would catch.
  try {
    guardAnchoredComments(project, next)
    guardAnchoredAnnotations(project, next)
  } catch (error) {
    if (error instanceof IntentRejection) return { outcome: { ok: false, code: error.code, problems: error.problems }, notes }
    throw error
  }

  // Once a Project carries a Design Option, the Existing Model is the baseline every alternative is
  // drawn against, so changing it is a command of its own: `renovation.correctExistingModel`, which
  // previews the edit against every Option and commits it or nothing (#69 §12). The question is
  // where the edits landed, not which Intent was sent, so nothing the catalogue gains later can
  // slip past this.
  if (
    designOptionsOf(project).length > 0 &&
    intent.type !== 'renovation.correctExistingModel' &&
    patches.some((patch) => patch.path[0] === 'existingModel' && !isLayerReassignment(patch))
  ) {
    return {
      outcome: rejected(
        'baseline-correction-required',
        'existingModel',
        'Design Options are drawn against this baseline, so this edit changes the record they all share. Correct the existing model to make it.',
      ),
      notes,
    }
  }

  const result = validateProject(next, validationScopeFor(patches, project, next))
  if (!result.ok) return { outcome: { ok: false, code: 'invalid-project', problems: result.problems }, notes }
  if (patches.length === 0) {
    return { outcome: rejected('no-change', 'type', `${intent.type} left the Project exactly as it was.`), notes }
  }
  return { outcome: { ok: true, project: next, patches, inversePatches, affected }, notes }
}

/** Take one dependent note out of a draft, which is all the preview needs from an unanswered row. */
function removeDependent(draft: Project, dependentId: EntityId): void {
  const comment = draft.comments.findIndex((each) => each.id === dependentId)
  if (comment >= 0) draft.comments.splice(comment, 1)
  else {
    const annotation = draft.annotations.findIndex((each) => each.id === dependentId)
    if (annotation >= 0) draft.annotations.splice(annotation, 1)
  }
}

/**
 * Run one Intent against a Project: {@link runIntent} in apply mode, whose Notes dependency report
 * the caller does not read — the answer it asks for has already arrived inside the Intent.
 */
export function applyIntent(project: Project, intent: Intent): Applied | Rejection {
  return runIntent(project, intent, 'apply').outcome
}

/**
 * What an Intent would touch, whether it would be refused, and what it would take with it —
 * without applying it.
 *
 * #48's toolbar greys itself out with this; #50's conflict banner asks its question before
 * the user commits to the gesture. The Locator is the same best-effort one a rejection
 * would have carried, so a greyed-out button still knows what it was pointing at. `review`
 * is the dependency report of #65 §8: `null` for everything the user may do without being
 * asked first, and the list of what would go with the edit when they may not. `notes` is the
 * same answer for the Notes of #82, and the two share one dialog because they share one
 * operation: a Wall review that also strands three Comments is one question, not two.
 */
export function previewIntent(
  project: Project,
  intent: Intent,
): {
  affected: Locator
  rejection: Rejection | null
  review: DependencyReview | null
  notes: NotesDependencyReport | null
} {
  const handler = handlerFor(intent.type)
  const affected: Locator =
    handler === undefined
      ? { floorId: null, viewId: null, view: 'cabinet', itemDesignIds: [], placedItemIds: [] }
      : handler.locate(project, intent)
  const review = handler?.review?.(project, intent) ?? null
  const { outcome, notes } = runIntent(project, intent, 'preview')
  return { affected, rejection: outcome.ok ? null : outcome, review, notes }
}

/** Replay a recorded step forward, or an inverse patch backward. #48's undo is this. */
export function applyPatches(project: Project, patches: readonly Patch[]): Project {
  return applyImmerPatches(project, patches as Patch[])
}
