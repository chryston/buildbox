/**
 * The words the renovation surface speaks (#69 §2, §9, §13).
 *
 * They sit apart from `STRINGS` because they belong to one surface: the Design Option dialogs, the
 * mode bar, the layer list and the paste review. The banned-word scan in `app` reads this file the
 * same way it reads the main table, because it reads every shipped module under `ui`.
 *
 * A review from `edit` already carries the question it was asked with — `Demolish W-3?` — and the
 * dialog shows that sentence rather than writing a second one beside it. What is here is the
 * chrome around it: the field labels, the two buttons, and the one thing the delete of an Option
 * owes the person before they press it.
 */
import type { RangeClass } from '../../derive'

/** The counts the delete of an Option lists, each in the words the glossary uses. */
const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/**
 * What the Plan View Range says about a candidate (#74 §6), in the legend's own three words: the row of
 * the cycle list and the legend beside it have to read as the same three names, or the second one stops
 * telling the person anything new.
 */
export const RANGE_CLASS_LABELS: Record<RangeClass, string> = {
  in: 'In range',
  above: 'Above range',
  below: 'Below range',
}

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

  // ---- the error state (#70 §6): a Display that describes an Option with no Option to describe
  /**
   * The banner's whole sentence, in the issue's words. It says what is missing, what the canvas is
   * therefore not drawing, and that the tools are gone — the three things a person checks in order.
   */
  needsOption: (display: string): string =>
    `${display} display needs an active Design Option. Nothing is drawn from options; editing tools are disabled.`,
  /**
   * The same refusal on the Export dialog (#73 §3), in its words: the view's name first, because a
   * Drawing Set can hold four views and the person has to know which one to open. The dialog offers
   * `Open view` beside it; the Lists tab stays enabled, because its scope is chosen and never
   * inherited. `export`'s `needsActiveOption` is the predicate that decides when it is said.
   */
  exportNeedsOption: (viewName: string, display: string): string =>
    `${viewName}: ${display} display needs an active Design Option.`,
  showExisting: 'Show Existing',

  // ---- the Export dialog's Drawing tab (#73 §1)
  /** The chips' group, named the way the Layers panel names the same thing. */
  exportLayersGroup: 'Drawing Layers',
  /**
   * Above the chips, in the issue's words: the toggles start from the saved view and are temporary,
   * and the view they came from is named so a person knows which one they are not changing.
   */
  exportLayersStart: (viewName: string): string =>
    `Starts from the saved view. Toggles here are temporary and don't change “${viewName}”.`,
  /** The collapsible's heading line, verbatim: what is in there is why a repeat export is the same file. */
  exportCompositionHeading: 'Recorded composition (repeat export is deterministic):',
  exportCompositionView: 'View',
  exportCompositionOption: 'Design Option',
  exportCompositionDisplay: 'Display',
  exportCompositionLayerOrder: 'Layer order (back to front)',
  exportCompositionIncluded: 'Included layers',
  exportCompositionColors: 'Colour overrides',
  exportCompositionNotes: 'Notes overlay',
  /** The value for “nothing”: an empty list and `Existing only` both read as an absence. */
  exportCompositionNone: 'none',
  exportCompositionOn: 'on',
  exportCompositionOff: 'off',
  /** The one-click fix beside the blocking sentence: open the view, choose an Option, come back. */
  exportOpenView: 'Open view',

  // ---- the Export dialog's Lists tab: the Option and Layer controls (#73 §2)
  exportListsThisOption: (name: string): string => `This option: ${name}`,
  exportListsChooseOptions: 'Choose options…',
  /** The third radio: the Existing Model on its own, which leaves `design_option` empty. */
  exportListsExistingModelOnly: 'Existing Model only',
  exportListsGroupLayers: 'Drawing Layers',
  /**
   * The informational notice (#73 §2): these rows are in the file and the view was hiding them. It
   * never blocks, and its disclosure lists each one named the way the table names it.
   */
  exportListsHiddenInView: (n: number): string => `${n} items included that are hidden in this view`,

  // ---- the undo tooltip of a saved-view setting (#70 §2)
  // The catalogue's default label (`Set Design Option`, `Set Renovation Display`) cannot name what
  // was chosen: the Option's name is Project data and the Display's is copy. So the card composes
  // the whole line and hands it to `IntentBuilder.build`, which puts it on the transaction the undo
  // tooltip reads. `none` is the words for `— no Design Option —`, not an absence of a label.
  setDesignOption: (name: string | null): string => `Set Design Option: ${name ?? 'none'}`,
  setRenovationDisplay: (display: string): string => `Set Renovation Display: ${display}`,

  // ---- the legend under the canvas (#70 §4)
  // The three marks in the words the issue gives them, next to the same swatches the Display cards
  // use. `Existing` is the word the whole product already has for that State, so the legend reuses
  // `displayExisting` rather than saying it a second way.
  legendDemolition: 'Demolition (hatch overlay)',
  legendProposed: 'Proposed (halo overlay)',
  /** The muted sentence after the three: the overlay never replaces the layer's own colour. */
  legendLayerNote: 'Layer colour is kept underneath renovation graphics',

  // ---- the on-canvas candidate list (#70 §8)
  // The header counts the click that has been made, not the ones still to come: `1/2` is "this is
  // the first of two", which is what a person reading it while deciding whether to click again wants
  // to know. The row is the State in brackets and the entity's full name — never shortened, because
  // `W-2` and `W-2′` are one character apart and a truncated name cannot tell them apart.
  overlapHeader: (index: number, total: number): string => `Overlap ${index}/${total} · click again to cycle`,
  /**
   * One row of the list: the State, which of the candidates this one is, the entity's full name, and
   * what the Plan View Range says about it (#74 §6) — `[Existing] 2 of 2 · Wall cabinet #1 · Above
   * range`. The count is the position in the cycle the click is walking, so the row says where a
   * further click goes next to it.
   *
   * The name is never shortened and never broken at a `#`: `Wall cabinet #1` beside `Wall cabinet #12`
   * is exactly the pair a truncated name cannot tell apart, and `W-2` beside `W-2′` is the other one.
   */
  overlapRow: (stateLabel: string, index: number, total: number, name: string, rangeLabel: string): string =>
    `[${stateLabel}] ${index} of ${total} · ${name} · ${rangeLabel}`,

  // ---- the inspector's renovation block (#70 §5)
  // The row labels and the action labels are the issue's words. `Kind` and `Owner` are the two the
  // card never had: a person deciding whether to demolish something needs to know what it is and
  // who owns the edit before anything else. `Existing Model (shared)` is the answer that says an
  // edit here is seen by every option, which is the whole reason Existing display is careful.
  inspectorKind: 'Kind',
  inspectorOwner: 'Owner',
  inspectorReplaces: 'Replaces',
  inspectorSuccessor: 'Successor',
  inspectorActions: 'Actions',
  ownerExistingModel: 'Existing Model (shared)',
  kindWall: 'Wall',
  kindOpening: 'Opening',
  kindRoom: 'Room',
  /** The Renovation inspector's `Kind` for a Beam (#77 §3): the record's own word for itself. */
  kindBeam: 'Beam',
  /** The Renovation inspector's `Kind` for a Skirting (#78 §5). */
  kindSkirting: 'Skirting',
  kindPlacedItem: 'Placed Item',
  actionMove: 'Move',
  actionRestore: 'Restore',
  actionDelete: 'Delete',
  actionCorrect: 'Correct Existing Model…',
  /** §5's notice: Proposed work is not editable where it is not drawn as work. */
  proposedInDemolitionNotice: 'Proposed work is edited in Proposed or Combined display',
  /** §5's nothing-selected sentence, in the issue's words. */
  nothingSelected:
    'Nothing selected. Click an entity; click the same spot again to cycle overlapping Existing / Demolition / Proposed candidates.',
  /** §7c: the tooltip on a shut field — what to press, and why the record is shared. */
  correctLocked:
    'Every Design Option is drawn against this record. Press Correct Existing Model… below to change it.',
  /** The title of a Replaces/Successor link that needs a Display change to be seen. */
  switchDisplayToFind: (name: string, display: string): string => `Select ${name} — it is drawn in ${display} display`,

  // ---- the protected edits (#70 §7a, §7b)
  // §7a's sentence is one thought with the two names inside it, so it is stored as the three pieces
  // around them: the Display and the Option are the words a person is being warned about, and the
  // dialog bolds them without the copy table having to carry markup.
  forcedChoiceTitle: (ref: string): string => `${ref} belongs to the Existing Model`,
  forcedChoiceLead: 'You are in',
  forcedChoiceBetween: 'display editing',
  forcedChoiceTail: '. Moving a baseline entity is never done silently. Choose what you mean:',
  forcedChoiceReplace: (option: string, ref: string): string =>
    `Replace in ${option} — demolish ${ref}, add moved successor`,
  forcedChoiceCorrect: 'Correct Existing Model instead… (all options)',
  forcedChoiceCancel: 'Cancel — change nothing',
  // §7b: the danger dialog. `Every Design Option` is the phrase the whole warning turns on, so it
  // is the one thing in the paragraph the dialog sets in bold.
  correctTitle: 'Correct the shared Existing Model?',
  correctLead: 'This changes the survey baseline, not a Design Option.',
  correctEvery: 'Every Design Option',
  correctWillSee: (ref: string, change: string): string => `will see ${ref} ${change}:`,
  correctRetains: '— retains it as Existing',
  correctDemolishes: '— demolishes it (no successor)',
  correctAligned: '— demolishes it; its successor stays aligned',
  correctOwnGeometry: '— demolishes it; its successor keeps its own geometry',
  correctMuted: 'One atomic transaction with dependent updates. Use this for measuring errors, not design changes.',
  correctConfirm: 'Correct Existing Model',
  /** The `<change>` word, chosen from what the pending edit does to the record. */
  changeMove: 'move',
  changeChange: 'change',
  changeRemoved: 'be removed',
  changeAppear: 'appear',
  /** The transaction label §7a's `Delete` writes: a demolition record, never a deletion. */
  markDemolitionLabel: (ref: string): string => `Mark demolition: ${ref}`,
  // §7d: `Restore W-2?`. The question is the review's own sentence, so only the consequence is
  // copy: which Option loses the record, and which of its successors falls with it.
  restoreBody: (option: string): string => `Removes the demolition record in ${option}.`,
  restoreDeletes: (refs: string): string => `Also deletes successor(s): ${refs}`,
  /** §7e: `Mark demolition` aimed at something that is not baseline work. */
  notExisting: (ref: string, state: string): string =>
    `${ref} is ${state} — only Existing Model entities can be demolished`,

  // ---- the Drawing Layers (#71 §2, §5, §8)
  // The undo label is the row's own words plus what was chosen, the way `Set Design Option: Option A`
  // reads (#70 §2): a history entry has to say which layer, because "Rename layer" four times deep is
  // no help at all. The layer's name is Project data, so it arrives as an argument.
  layerAddLabel: (name: string): string => `New layer: ${name}`,
  layerRenameLabel: (name: string): string => `Rename layer: ${name}`,
  layerSetColorLabel: (name: string): string => `Set layer colour: ${name}`,
  layerMoveLabel: (name: string, edge: string): string => `Reorder layer: ${name} → ${edge}`,
  layerDeleteLabel: (name: string): string => `Delete layer: ${name}`,
  layerSettingLabel: (name: string, state: string): string => `Set layer: ${name} — ${state}`,
  layerOrderLabel: (name: string): string => `Reorder layers: ${name}`,
  layerActiveLabel: (name: string): string => `Set active layer: ${name}`,
  layerSnapLabel: (state: string): string => `Snap to hidden content: ${state}`,
  entitySetLayerLabel: (name: string): string => `Move to layer: ${name}`,
  /** The row that holds content with no layer of its own. One word, said the same way everywhere. */
  layerUnlayered: 'Unlayered',
  /** Which end a `Reorder Layer` moved a layer to, in the label's `→ <end>`. */
  layerEdgeFront: 'front',
  layerEdgeBack: 'back',
  /** The three states of a layer's own row, as the label names them. */
  layerStateVisible: 'visible',
  layerStateHidden: 'hidden',
  layerStateSelectable: 'selectable',
  layerStateNotSelectable: 'not selectable',
  layerStateEditable: 'editable',
  layerStateNotEditable: 'read-only',
  layerStateColour: 'colour',
  layerStateDefault: 'follow the Project',
  /** The one word for whether this view may snap to content it is not drawing. */
  layerOn: 'On',
  layerOff: 'Off',
  // `Delete Services?` — the question is the review's own sentence, so only the rows beside it are copy.
  deleteLayerModel: (n: number): string => count(n, 'Model entity', 'Model entities'),
  deleteLayerAnnotations: (n: number): string => count(n, 'Annotation', 'Annotations'),
  deleteLayerOverrides: (n: number): string => count(n, 'saved view', 'saved views'),
  deleteLayerOnIt: 'On this layer:',
  deleteLayerMore: (n: number): string => `and ${n} more`,
  /** The consequence the dialog cannot leave out: where the content goes, and whether it is seen. */
  deleteLayerBecomes: 'The content becomes Unlayered and stays drawn.',
  deleteLayerHidden: 'The Unlayered row is currently HIDDEN in this view, so this content stops being drawn here.',
  deleteLayerConfirm: 'Delete layer',
  // The three columns are read as one sentence per row — `Model entities · 12 · become Unlayered` —
  // and the row that answers with a consequence of its own is the one about saved views.
  deleteLayerColumnDependency: 'Dependency',
  deleteLayerColumnCount: 'Count',
  deleteLayerColumnResult: 'Result',
  deleteLayerResultUnlayered: 'Becomes Unlayered',
  deleteLayerResultOverrides: (n: number): string => `${n} ${n === 1 ? 'loses' : 'lose'} their own settings`,
  /** The way out that changes nothing, said as what it does (#71 §5). */
  deleteLayerCancel: 'Cancel — change nothing',
  /** A press that wanted to edit content this view has made read-only (#71 §4, criterion 11). */
  layerReadOnlyNotice: (layer: string): string => `${layer} is read-only in this view — inspect only`,
  /** The inspector's row that moves content between layers (#71 §5). One word, like `Owner` above it. */
  inspectorLayer: 'Layer',
  /**
   * The line the inspector prints while the selected content stands on a read-only layer (#71 §4,
   * criterion 11). It says both halves of read-only: what the view will not do, and what it still
   * will — inspecting is not a consolation prize, it is the point of leaving the layer drawn.
   */
  inspectorReadOnly: '[RO] Read-only in this view: inspect only.',
  /**
   * The suffix on a warning-strip row whose subject this view does not draw (#71 §7, criterion 9).
   * The row stays because the warning is a fact about the model, not about this view's drawing; the
   * suffix says why the thing it warns about is nowhere to be seen.
   */
  warningHiddenSuffix: (layer: string): string => `· ${layer} hidden in this view — warning still applies`,

  // ---- the Layers list itself (#71 §3)
  // `Layers (front first)` is the header because the list is drawn in the order content is drawn,
  // not the order the array stores: the top row is the one on top of the drawing.
  layersHeader: 'Layers (front first)',
  /** The name a layer made by `+` starts with, and the accessible name of the `+` button. */
  layerNewName: 'New layer',
  layerSelectable: 'Selectable',
  layerEditable: 'Editable',
  layerActive: 'Active',
  layerColourInView: 'Colour in this view',
  layerReset: 'reset',
  layerViewOrder: 'View order',
  layerForward: 'forward',
  layerBack: 'back',
  layerProjectSection: 'Project:',
  layerProjectColour: 'Project default colour',
  layerDelete: 'Delete…',
  layersNone: 'No Drawing Layers. All content is Unlayered.',
  layerSnapToHidden: 'Snap to hidden content',
  layerUseProjectOrder: 'Use Project layer order',
  /** The three markers, each of which says why a row does not answer the way its switches read. */
  layerMarkNotSelectable: 'Not selectable',
  layerMarkReadOnly: 'Read-only',
  layerMarkOverride: 'View style override',
  // A row's controls are named with the layer in them: `Hide Furniture in this view`, because the
  // list has a dozen checkboxes and `Hide` on its own is a question.
  layerShow: (name: string): string => `Show ${name} in this view`,
  layerHide: (name: string): string => `Hide ${name} in this view`,
  layerRenameAria: (name: string): string => `Rename ${name}`,
  layerProjectColourAria: (name: string): string => `Project default colour for ${name}`,
  layerViewColourAria: (name: string): string => `Colour for ${name} in this view`,
  layerMoveUpAria: (name: string): string => `Move ${name} toward the front in the Project layer order`,
  layerMoveDownAria: (name: string): string => `Move ${name} toward the back in the Project layer order`,
  layerViewOrderUpAria: (name: string): string => `Move ${name} toward the front in this view`,
  layerViewOrderDownAria: (name: string): string => `Move ${name} toward the back in this view`,
  layerExpandAria: (name: string): string => `Show the settings for ${name}`,
  layerCollapseAria: (name: string): string => `Hide the settings for ${name}`,
  layerActiveAria: (name: string): string => `Draw new content on ${name} in this view`,

  // ---- the cross-Project paste (#72 §6)
  // The transaction label is the count of what comes across and the name of the Project it came
  // from, both of which are data: a released bundle holds neither the number of records in a copy
  // nor the name of a Project it has never seen, so the row that sends the paste composes the
  // sentence from the review it was built from.
  pasteLabel: (n: number, sourceName: string): string =>
    `Paste ${count(n, 'entity', 'entities')} from “${sourceName}”`,

  // ---- Copy, and the clipboard it fills (#72 §3)
  //
  // The notice is the copy being honest about its own edge: a copy takes records, and a demolition
  // record stands for something the Existing Model keeps. Saying the count out loud is cheaper than
  // letting it be discovered as a gap in the other Project.
  actionCopy: 'Copy',
  copyDemolished: (n: number): string => `${count(n, 'demolished entity was', 'demolished entities were')} not copied`,

  // ---- `Paste from other Project…` and its mapping review (#72 §5)
  //
  // The command is offered from the card footer, where the copy's destination is the thing on screen.
  // The dialog's job is one question per layer the copy brings, and it is asked before anything is
  // written: a suggestion is shown, never applied, because a name that happens to match is not an
  // answer a person gave.
  pasteFromOtherProject: 'Paste from other Project…',
  pasteNeedsCopy: 'Copy something in another Project first.',
  pasteTitle: (source: string): string => `Paste from “${source}” — map Drawing Layers`,
  pasteIntro: (n: number, source: string): string =>
    `${count(n, 'entity', 'entities')} from “${source}”. Choose where each layer’s work lands.`,
  pasteUnlayered: (n: number): string => `${count(n, 'Unlayered entity stays', 'Unlayered entities stay')} Unlayered.`,
  pasteColSource: 'Source layer',
  pasteColItems: 'Items',
  pasteColDestination: 'Destination',
  pasteChoose: '— choose —',
  pasteNameMatch: (name: string): string => `${name} (name match)`,
  pasteCreateHere: (name: string): string => `Create “${name}” here`,
  pasteUseSuggested: (name: string): string => `Use suggested “${name}”`,
  pasteNotComingAcross: 'Will not come across:',
  pasteWillDetach: 'Will be detached:',
  pasteExistingDanger:
    'Existing display: pasted entities join the shared Existing Model and every Design Option will see them.',
  pasteCorrectAndPaste: 'Correct Existing Model and paste',
  pasteConfirm: 'Paste with this mapping',
  /** `Include Comments` (#80 §13), naming how many the copy would bring. */
  pasteIncludeComments: (n: number): string => `Include ${n} ${n === 1 ? 'Comment' : 'Comments'} about this work`,
  /** `Include Annotations` (#81 §11), naming how many the copy would bring. */
  pasteIncludeAnnotations: (n: number): string => `Include ${n} ${n === 1 ? 'Annotation' : 'Annotations'} on this work`,

  // ---- the buttons every one of them ends with
  cancel: 'Cancel',
} as const
