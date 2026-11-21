/**
 * The Design Option half of the catalogue (#69 §2) — dark until `VITE_FF_RENOVATION` is on.
 *
 * This module is reachable from exactly one place: the flag-gated spread in `../registry`. In a
 * build without the flag that spread folds to nothing, the import goes unused, and dead-code
 * elimination drops this file whole — which is what `scripts/check-bundle-strings.mjs` proves by
 * grepping a production bundle for `RENOVATION_MARKER`, the string below. Nothing here is
 * importable through any other path: no label in `../labels`, no row in `../intents`'
 * `INTENT_ID_ORDER`, no sentence in a dialog.
 *
 * What is registered is the Option itself — create, rename, delete. The renovation *edits* (rows
 * 7–11 of #69's table) arrive as parameters of the Intents that already exist: every Wall,
 * Opening, Room and Placed Item payload carries `target: { designOptionId }`, so a proposed Wall
 * is edited by `wall.setThickness` and not by a second family of handlers that fork on which
 * container a record lives in.
 */
import { designOptionsOf } from '../../domain'
import type { DesignOption, EntityId, Project } from '../../domain'
import type { DeleteDesignOptionReview, Locator, RenovationIntentType } from '../intents'
import type { Handler, IntentHandler } from './context'
import { refuse, spendIds } from './support'

/**
 * The string a flag-off bundle is checked for. It appears nowhere else in `src`, and this module
 * is the only thing that mentions it, so finding it in `dist` means something reached the
 * renovation set without the flag.
 */
export const RENOVATION_MARKER = '__renovation_intents__'

/** The Option half of the renovation set; the edit table lives in `./renovationEdits`. */
type OptionIntentType = Extract<RenovationIntentType, `designOption.${string}`>

/** The IDs each renovation Intent spends, in order — the same contract `INTENT_ID_ORDER` states. */
export const RENOVATION_INTENT_ID_ORDER: { [T in OptionIntentType]: readonly string[] } = {
  'designOption.create': ['optionId'],
  'designOption.rename': [],
  'designOption.delete': [],
}

/** The default label per renovation Intent, kept out of `../labels` for the same reason. */
export const RENOVATION_INTENT_LABELS: { [T in OptionIntentType]: string } = {
  'designOption.create': 'New Design Option',
  'designOption.rename': 'Rename Design Option',
  'designOption.delete': 'Delete Design Option',
}

const emptyProposed = (): DesignOption['proposed'] => ({
  walls: [],
  wallJunctions: [],
  openings: [],
  rooms: [],
  placedItems: [],
})

const optionNamed = (project: Project, name: string, except?: EntityId): DesignOption | undefined =>
  designOptionsOf(project).find((option) => option.name === name && option.id !== except)

/** An Option is a Project-level thing: no Floor, no View, nothing to select. */
const optionLocator = (): Locator => ({ floorId: null, viewId: null, view: 'plan', itemDesignIds: [], placedItemIds: [] })

const createOption: Handler<'designOption.create'> = (ctx) => {
  const { name } = ctx.intent.payload
  if (optionNamed(ctx.project, name) !== undefined)
    refuse('option-blocked', 'designOptions', `There is already a Design Option called ${name}.`)
  const [optionId] = spendIds(ctx.intent.ids, 1, ctx.intent.type)
  if (ctx.draft.designOptions === undefined) ctx.draft.designOptions = []
  // A new Option holds nothing, which is not an empty Project: the Existing Model is what every
  // Option starts from, so "Option B is unchanged" is a sentence about records, not about walls.
  ctx.draft.designOptions.push({ id: optionId, name, proposed: emptyProposed(), demolishedIds: [] })
}

const renameOption: Handler<'designOption.rename'> = (ctx) => {
  const { optionId, name } = ctx.intent.payload
  const option = ctx.draft.designOptions?.find((entry) => entry.id === optionId)
  if (option === undefined) refuse('unknown-target', 'designOptions', `There is no Design Option ${optionId} to rename.`)
  if (optionNamed(ctx.project, name, optionId) !== undefined)
    refuse('option-blocked', 'designOptions', `There is already a Design Option called ${name}.`)
  // Only the name moves. Every record keeps the Option id it is owned by, so nothing carried with
  // the Option is rewritten and no Comment or reference is left pointing at a gone ID.
  option.name = name
}

/** What deleting an Option would take with it, in the order the dialog lists it (#69 criterion 9). */
function reviewDeleteOption(project: Project, optionId: EntityId): DeleteDesignOptionReview | null {
  const option = designOptionsOf(project).find((entry) => entry.id === optionId)
  if (option === undefined) return null
  const proposed = option.proposed
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
    },
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
}
