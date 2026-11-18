/**
 * Applying an Intent (#47, #20 §4).
 *
 * One pass, four steps: find the handler, run it on an immer draft while recording patches,
 * validate the whole Project that came out, and answer `Applied` or `Rejection`. Nothing is
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
import type { Project } from '../domain'
import { problem } from '../lib'
import type { Applied, Intent, IntentType, Locator, Rejection, RejectionCode } from './intents'
import { IntentRejection } from './handlers/support'
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
 * Run one Intent against a Project.
 *
 * `Applied` carries the next Project, the patches that got there, the inverse patches that
 * undo it, and where the edit landed. `Rejection` carries a code and at least one problem
 * that says why — and the caller's Project is untouched either way.
 */
export function applyIntent(project: Project, intent: Intent): Applied | Rejection {
  const handler = handlerFor(intent.type)
  if (handler === undefined) {
    return rejected('unknown-target', 'type', `No Intent type ${intent.type} is in the catalogue.`)
  }
  const affected = handler.locate(project, intent)

  let next: Project
  let patches: Patch[]
  let inversePatches: Patch[]
  try {
    ;[next, patches, inversePatches] = produceWithPatches(project, (draft) => {
      handler.run({ project, draft, intent })
    })
  } catch (error) {
    if (error instanceof IntentRejection) return { ok: false, code: error.code, problems: error.problems }
    throw error
  }

  const result = validateProject(next)
  if (!result.ok) return { ok: false, code: 'invalid-project', problems: result.problems }
  if (patches.length === 0) {
    return rejected('no-change', 'type', `${intent.type} left the Project exactly as it was.`)
  }
  return { ok: true, project: next, patches, inversePatches, affected }
}

/**
 * What an Intent would touch, and whether it would be refused — without applying it.
 *
 * #48's toolbar greys itself out with this; #50's conflict banner asks its question before
 * the user commits to the gesture. The Locator is the same best-effort one a rejection
 * would have carried, so a greyed-out button still knows what it was pointing at.
 */
export function previewIntent(
  project: Project,
  intent: Intent,
): { affected: Locator; rejection: Rejection | null } {
  const handler = handlerFor(intent.type)
  const affected: Locator =
    handler === undefined
      ? { floorId: null, viewId: null, view: 'cabinet', itemDesignIds: [], placedItemIds: [] }
      : handler.locate(project, intent)
  const result = applyIntent(project, intent)
  return { affected, rejection: result.ok ? null : result }
}

/** Replay a recorded step forward, or an inverse patch backward. #48's undo is this. */
export function applyPatches(project: Project, patches: readonly Patch[]): Project {
  return applyImmerPatches(project, patches as Patch[])
}
