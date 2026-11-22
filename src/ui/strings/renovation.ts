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
