/**
 * The Design Option half of the catalogue (#69 §2).
 *
 * This module is reachable from exactly one place: the renovation half of `../registry`'s
 * catalogue. Nothing here is importable through any other path: no label in `../labels`, no row in
 * `../intents`' `INTENT_ID_ORDER`, no sentence in a dialog.
 *
 * What is registered is the Option itself — create, rename, delete. The renovation *edits* (rows
 * 7–11 of #69's table) arrive as parameters of the Intents that already exist: every Wall,
 * Opening, Room and Placed Item payload carries `target: { designOptionId }`, so a proposed Wall
 * is edited by `wall.setThickness` and not by a second family of handlers that fork on which
 * container a record lives in.
 */
import { designOptionsOf, nameKey, savedViewsOf, viewDesignOptionId } from '../../domain'
import type { DesignOption, EntityId, Project } from '../../domain'
import type { DeleteDesignOptionReview, Locator, RenovationIntentType } from '../intents'
import type { Handler, IntentHandler } from './context'
import { refuse, savedViewPath, spendIds } from './support'

/**
 * The Option half of the renovation set, plus the two saved-view settings of #70 §1. The edit table
 * lives in `./renovationEdits`, and the correction wrapper in `./correctionHandlers`.
 */
type OptionIntentType = Extract<RenovationIntentType, `designOption.${string}` | 'view.setDesignOption' | 'view.setRenovationDisplay'>

/** The IDs each renovation Intent spends, in order — the same contract `INTENT_ID_ORDER` states. */
export const RENOVATION_INTENT_ID_ORDER: { [T in OptionIntentType]: readonly string[] } = {
  'designOption.create': ['optionId'],
  'designOption.rename': [],
  'designOption.delete': [],
  // Both saved-view settings write one field of a view that already exists (#70 §1).
  'view.setDesignOption': [],
  'view.setRenovationDisplay': [],
}

/** The default label per renovation Intent, kept out of `../labels` for the same reason. */
export const RENOVATION_INTENT_LABELS: { [T in OptionIntentType]: string } = {
  'designOption.create': 'New Design Option',
  'designOption.rename': 'Rename Design Option',
  'designOption.delete': 'Delete Design Option',
  // The two below are the base of a longer label: the card that sends them appends what was chosen
  // — `Set Design Option: Option A · Open kitchen`, `Set Design Option: none`,
  // `Set Renovation Display: Combined` (#70 §2) — because the Option's name is Project data and the
  // Display's is `ui/strings` copy, neither of which this table may hold.
  'view.setDesignOption': 'Set Design Option',
  'view.setRenovationDisplay': 'Set Renovation Display',
}

const emptyProposed = (): DesignOption['proposed'] => ({
  walls: [],
  wallJunctions: [],
  openings: [],
  rooms: [],
  placedItems: [],
})

/**
 * An Option's name is unique the way a Floor's is — trimmed, case-folded, Unicode-normalised —
 * because it is the same `nameKey` the validator folds with (#69 §4). Two Options called `Option A`
 * and `option a` are two cards a person cannot tell apart on a Saved View.
 */
const optionNamed = (project: Project, name: string, except?: EntityId): DesignOption | undefined => {
  const key = nameKey(name)
  return designOptionsOf(project).find((option) => option.id !== except && nameKey(option.name) === key)
}

/** The longest name the validator accepts for an Option (`validate.ts`'s own bound). */
const OPTION_NAME_MAX_LENGTH = 60

/**
 * The words a name that cannot be used answers with, or `null` when it can. The three rules are the
 * validator's (#69 §4): filled, at most sixty characters, one per Project. A Project that would not
 * validate is never written, so refusing here is refusing earlier and in plainer words.
 */
function optionNameProblem(project: Project, name: string, except: EntityId | undefined): string | null {
  if (name.trim() === '') return 'A Design Option needs a name.'
  if (name.trim().length > OPTION_NAME_MAX_LENGTH)
    return `A Design Option name is at most ${OPTION_NAME_MAX_LENGTH} characters.`
  const taken = optionNamed(project, name, except)
  return taken === undefined ? null : `An option called "${taken.name.trim()}" already exists.`
}

/** An Option is a Project-level thing: no Floor, no View, nothing to select. */
const optionLocator = (): Locator => ({ floorId: null, viewId: null, view: 'plan', itemDesignIds: [], placedItemIds: [] })

const createOption: Handler<'designOption.create'> = (ctx) => {
  const name = ctx.intent.payload.name.trim()
  const problem = optionNameProblem(ctx.project, name, undefined)
  if (problem !== null) refuse('option-blocked', 'designOptions', problem)
  const [optionId] = spendIds(ctx.intent.ids, 1, ctx.intent.type)
  if (ctx.draft.designOptions === undefined) ctx.draft.designOptions = []
  // A new Option holds nothing, which is not an empty Project: the Existing Model is what every
  // Option starts from, so "Option B is unchanged" is a sentence about records, not about walls.
  ctx.draft.designOptions.push({ id: optionId, name, proposed: emptyProposed(), demolishedIds: [] })
}

const renameOption: Handler<'designOption.rename'> = (ctx) => {
  const { optionId } = ctx.intent.payload
  const name = ctx.intent.payload.name.trim()
  const option = ctx.draft.designOptions?.find((entry) => entry.id === optionId)
  if (option === undefined) refuse('unknown-target', 'designOptions', `There is no Design Option ${optionId} to rename.`)
  const problem = optionNameProblem(ctx.project, name, optionId)
  if (problem !== null) refuse('option-blocked', 'designOptions', problem)
  // Only the name moves. Every record keeps the Option id it is owned by, so nothing carried with
  // the Option is rewritten and no Comment or reference is left pointing at a gone ID.
  option.name = name
}

/** What deleting an Option would take with it, in the order the dialog lists it (#69 criterion 9). */
function reviewDeleteOption(project: Project, optionId: EntityId): DeleteDesignOptionReview | null {
  const option = designOptionsOf(project).find((entry) => entry.id === optionId)
  if (option === undefined) return null
  const proposed = option.proposed
  // The saved views looking through it are named here and nulled by the handler below — the same
  // list, read once, so the dialog cannot promise a count the transaction does not deliver.
  const viewNames = project.views.filter((view) => viewDesignOptionId(view) === optionId).map((view) => view.name)
  return {
    kind: 'delete-design-option',
    optionId,
    optionName: option.name,
    counts: {
      walls: proposed.walls.length,
      wallJunctions: proposed.wallJunctions.length,
      openings: proposed.openings.length,
      rooms: proposed.rooms.length,
      placedItems: proposed.placedItems.length,
      demolished: option.demolishedIds.length,
      acknowledgements: project.warningAcknowledgements.filter((record) => record.designOptionId === optionId).length,
      views: viewNames.length,
    },
    viewNames,
    message: `Delete ${option.name} and everything it proposes?`,
  }
}

const deleteOption: Handler<'designOption.delete'> = (ctx) => {
  const { optionId } = ctx.intent.payload
  const options = ctx.draft.designOptions
  const index = options?.findIndex((entry) => entry.id === optionId) ?? -1
  if (index < 0 || options === undefined)
    refuse('unknown-target', 'designOptions', `There is no Design Option ${optionId} to delete.`)
  options.splice(index, 1)
  // Its acknowledgements are its records: a decision about a warning in an Option that is gone
  // could never be shown, reopened or honoured again. Nothing else in the Project is touched —
  // the Existing Model and every other Option come back byte-identical, and one undo puts the
  // Option and its decisions back together.
  const records = ctx.draft.warningAcknowledgements
  for (let at = records.length - 1; at >= 0; at -= 1) {
    if (records[at]!.designOptionId === optionId) records.splice(at, 1)
  }
  // And every saved view that was looking through it looks at the Existing Model from now on
  // (#70 §1, criterion 11) — same transaction, so one undo brings the Option back *with* the
  // references, and no view is ever left naming an Option that no longer exists. A view that never
  // named it is not written at all, so its bytes are untouched.
  for (const view of savedViewsOf(ctx.draft)) {
    if (viewDesignOptionId(view) === optionId) view.designOptionId = null
  }
}

/**
 * The saved view whose setting is being changed. A view is addressed by id alone, because a saved
 * view is a Project-level record that names its Floor (#56) — and since #75 that record may be an
 * Elevation View, which takes a Design Option and a Renovation Display exactly as a Plan View does.
 */
function requireView(draft: Project, viewId: EntityId) {
  const view = savedViewsOf(draft).find((candidate) => candidate.id === viewId)
  if (view === undefined) refuse('unknown-target', savedViewPath(draft, viewId), `There is no saved view ${viewId} to change.`)
  return view
}

/**
 * Which Design Option this saved view looks through (#70 §1) — one undoable setting, and the
 * Display is left alone. `null` is a choice, not an absence: it is `— no Design Option —`, the
 * Existing Model on its own.
 *
 * Naming an Option this Project does not have is refused here rather than left to the validator,
 * so the answer is one sentence about the Option instead of a schema complaint about the view.
 */
const setViewDesignOption: Handler<'view.setDesignOption'> = (ctx) => {
  const { viewId, designOptionId } = ctx.intent.payload
  const view = requireView(ctx.draft, viewId)
  if (designOptionId !== null && designOptionsOf(ctx.draft).every((option) => option.id !== designOptionId)) {
    refuse('unknown-target', 'designOptions', `There is no Design Option ${designOptionId} to look through.`)
  }
  view.designOptionId = designOptionId
}

/**
 * Which Renovation Display this saved view draws (#70 §1) — one undoable setting, and the Option is
 * left alone. Switching from Proposed to Combined is not two steps, and switching Option is not a
 * way of switching Display.
 *
 * A Display that needs an Option this view does not have is accepted on purpose: that pairing is
 * the error state §6 draws, and the user has to be able to walk into it by choosing Combined from
 * the card and then reading the banner.
 */
const setViewRenovationDisplay: Handler<'view.setRenovationDisplay'> = (ctx) => {
  const { viewId, renovationDisplay } = ctx.intent.payload
  const view = requireView(ctx.draft, viewId)
  view.renovationDisplay = renovationDisplay
}

/**
 * A saved-view setting navigates to the view it changed (#70 §9): undoing `Set Renovation Display`
 * has to land the user back on the view whose Display it put right, which is what makes the undo
 * of a card click legible. The navigation is the Locator's answer, never a history step of its own.
 */
function viewSettingLocator(project: Project, intent: { payload: { viewId: EntityId } }): Locator {
  const view = savedViewsOf(project).find((candidate) => candidate.id === intent.payload.viewId)
  return {
    floorId: view?.floorId ?? null,
    viewId: intent.payload.viewId,
    view: 'plan',
    itemDesignIds: [],
    placedItemIds: [],
  }
}

/** The renovation half of the catalogue, as one gated spread. */
export const RENOVATION_HANDLERS: { [T in OptionIntentType]: IntentHandler<T> } = {
  'designOption.create': { run: createOption, locate: optionLocator },
  'designOption.rename': { run: renameOption, locate: optionLocator },
  'designOption.delete': {
    run: deleteOption,
    locate: optionLocator,
    review: (project, intent) => reviewDeleteOption(project, intent.payload.optionId),
  },
  'view.setDesignOption': { run: setViewDesignOption, locate: viewSettingLocator },
  'view.setRenovationDisplay': { run: setViewRenovationDisplay, locate: viewSettingLocator },
}
