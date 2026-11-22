/**
 * The words the renovation surface speaks (#69 §2, §9, §13).
 *
 * They sit apart from `STRINGS` because the whole surface is dark until `VITE_FF_RENOVATION` is
 * on: a flag-off build ships no sentence about a command it cannot run, and a table reached only
 * from a flagged branch is dropped with it. The banned-word scan in `app` reads this file the
 * same way it reads the main table, because it reads every shipped module under `ui`.
 *
 * A review from `edit` already carries the question it was asked with — `Demolish W-3?` — and the
 * dialog shows that sentence rather than writing a second one beside it. What is here is the
 * chrome around it: the field labels, the two buttons, and the one thing the delete of an Option
 * owes the person before they press it.
 */

/** The counts the delete of an Option lists, each in the words the glossary uses. */
const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

export const RENOVATION_STRINGS = {
  // ---- the `Design Options` section of Project settings (#69 §15)
  designOptions: 'Design Options',
  designOptionName: 'Name',
  designOptionAdd: '+ New Design Option',
  designOptionDelete: 'Delete…',
  designOptionNameRequired: 'A Design Option needs a name.',
  designOptionNameTaken: (name: string): string => `An option called "${name}" already exists.`,
  designOptionNameTooLong: 'A Design Option name is at most 60 characters.',
  designOptionSuggested: (label: string): string => `Option ${label}`,
  designOptionNone: 'No Design Options yet. Each one is the Existing Model with its own work drawn on it.',

  // ---- `Delete Option B?` (#69 §2, criterion 9)
  deleteOptionHeading: (name: string): string => `Delete ${name}?`,
  deleteOptionUnchanged: 'Nothing in the Existing Model changes.',
  deleteOptionConfirm: 'Delete option',
  deleteOptionWalls: (n: number): string => count(n, 'Wall', 'Walls'),
  deleteOptionJunctions: (n: number): string => count(n, 'Wall Junction', 'Wall Junctions'),
  deleteOptionOpenings: (n: number): string => count(n, 'Opening', 'Openings'),
  deleteOptionRooms: (n: number): string => count(n, 'Room', 'Rooms'),
  deleteOptionPlacedItems: (n: number): string => count(n, 'Placed Item', 'Placed Items'),
  deleteOptionDemolished: (n: number): string => count(n, 'Existing entity removed', 'Existing entities removed'),
  deleteOptionAcknowledgements: (n: number): string => count(n, 'Warning acknowledgement', 'Warning acknowledgements'),

  // ---- `Demolish W-3?` (#69 §9, criterion 3)
  demolishTakes: 'This goes with it:',
  demolishNothing: 'Nothing else stands on this Wall.',
  demolishBlocked: 'These have to be dealt with first:',
  demolishConfirm: (openings: number): string =>
    openings === 0 ? 'Demolish wall' : `Demolish wall and ${count(openings, 'opening', 'openings')}`,

  // ---- `Move to a Design Option?` (#69 §13, criterion 8)
  moveToOption: 'Move to a Design Option…',
  moveHeading: 'Move to a Design Option?',
  moveTargetOption: 'Design Option',
  moveDanger:
    'This changes the survey baseline, not a Design Option. Every Design Option will see these items leave the Existing Model:',
  moveItems: (n: number): string => count(n, 'entity', 'entities'),
  moveRemovesDemolitions: (n: number): string =>
    `Drops ${count(n, 'demolition record', 'demolition records')} — the entity is no longer Existing work here.`,
  moveDetaches: (names: readonly string[]): string =>
    names.length === 0 ? '' : `Detaches ${count(names.length, 'Room', 'Rooms')}: ${names.join(', ')}`,
  moveBlocked: 'This Option cannot take the move:',
  moveConfirm: (optionName: string): string => `Move to ${optionName}`,

  // ---- the saved-view card's renovation block (#70 §2)
  // The Display names are the four words the whole feature is read by: the card grid, the mode bar,
  // the `Pick:` chips, the undo label and the legend all say the same one for the same Display.
  displayExisting: 'Existing',
  displayDemolition: 'Demolition',
  displayProposed: 'Proposed',
  displayCombined: 'Combined',
  designOptionField: 'Design Option',
  renovationDisplayField: 'Renovation Display',
  /** The first entry of the Design Option picker: the Existing Model on its own, which is a choice. */
  noDesignOption: '— no Design Option —',
  /** The card's footer. `Paste from other Project…` arrives with #72 and reserves its slot. */
  exportEllipsis: 'Export…',
  /** The two renovation tools the contextual strip can show (#70 §3). */
  toolMarkDemolition: 'Mark demolition',
  toolReplace: 'Replace…',

  // ---- the mode bar (#70 §3): the Display, the Option, and what editing means right now
  noDesignOptionShort: 'No Design Option',
  modeExisting: 'Surveying the shared baseline. Changes here are explicit corrections seen by every option.',
  modeDemolition: 'Marking what the option removes or replaces.',
  modeProposed: 'Editing new work owned by the option. Demolished baseline is hidden.',
  modeCombined: 'Everything together. All state-aware tools; overlaps cycle on repeated click.',
  /** `3 tools hidden in this display` — the count the strip prints beside the tools it allows. */
  toolsHidden: (n: number): string => `${n} tools hidden in this display`,
  /** The temporary selection filter beside the strip: `Pick: Existing Demolition Proposed`. */
  pickFilter: 'Pick:',
  /** Why a hidden tool's shortcut did nothing: `Mark demolition works in Demolition / Combined display`. */
  toolWorksIn: (tool: string, displays: string): string => `${tool} works in ${displays} display`,
  /** The strip's row that opens the shipped pack's library (#70 §3). */
  toolPlaceItem: 'Place item',
  /**
   * Why a row is shown but inert. A disabled control explains itself (#55 §3), and these two say
   * where the command actually lives: `Place item` is a menu the toolbar owns, and `Replace…` needs
   * the dialog that asks what takes the entity's place, which lands with the correction dialogs.
   */
  placeItemLivesInLibrary: 'Choose what to place from the Library menu.',
  replaceNeedsDialog: 'Replace… needs the dialog that asks what takes this one’s place, which is not in this build.',
  /** Why `Mark demolition` waits: it marks one named thing, and nothing is named yet. */
  markDemolitionNeedsOne: 'Select one thing to mark for demolition.',

  // ---- the undo tooltip of a saved-view setting (#70 §2)
  // The catalogue's default label (`Set Design Option`, `Set Renovation Display`) cannot name what
  // was chosen: the Option's name is Project data and the Display's is copy. So the card composes
  // the whole line and hands it to `IntentBuilder.build`, which puts it on the transaction the undo
  // tooltip reads. `none` is the words for `— no Design Option —`, not an absence of a label.
  setDesignOption: (name: string | null): string => `Set Design Option: ${name ?? 'none'}`,
  setRenovationDisplay: (display: string): string => `Set Renovation Display: ${display}`,

  // ---- the buttons every one of them ends with
  cancel: 'Cancel',
} as const
