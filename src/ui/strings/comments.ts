/**
 * The words the Notes surface speaks (#80 §5, §8, §9, §10).
 *
 * They sit apart from `STRINGS` because they belong to one surface: the docked panel, the Comment rows,
 * the inspector's Comments section, the `✎ Comment` tool and the editor. The banned-word scan in `app`
 * reads this file the same way it reads the main table, because it reads every shipped module under `ui`.
 *
 * The rule these tables exist to enforce is #80 §5.5: a person never reads a code. `entity`, `point`,
 * `face-kitchen` and `left_face` are storage, and every one of them has a plain label here — the target
 * type a filter offers, the Anchor a row names, the feature a button offers.
 */
import type { CommentAnchor, CommentPriority, CommentStatus } from '../../domain'

/** The seven target types the panel filters by, in the order the filter lists them. */
export const COMMENT_TARGET_LABELS = {
  project: 'Project',
  floor: 'Floor',
  design_option: 'Design Option',
  item_design: 'Item Design',
  entity: 'Element or Placed Item',
  feature: 'Feature',
  floor_point: 'Floor Point',
} as const satisfies Record<CommentAnchor['kind'], string>

/** The kind word a row leads its Anchor label with, shorter than the filter's name for the same thing. */
export const COMMENT_KIND_LABELS = {
  project: 'Project',
  floor: 'Floor',
  design_option: 'Design Option',
  item_design: 'Item Design',
  entity: 'Placed Item',
  feature: 'Feature',
  floor_point: 'Floor Point',
} as const satisfies Record<CommentAnchor['kind'], string>

/** The status a row and the editor name, and the three the status filter offers. */
export const COMMENT_STATUS_LABELS: Record<CommentStatus, string> = { open: 'Open', resolved: 'Resolved' }
export const COMMENT_STATUS_FILTERS = { open: 'Open', resolved: 'Resolved', any: 'Any' } as const

/** The four priority words: three priorities and the filter's `Any`. */
export const COMMENT_PRIORITY_LABELS: Record<CommentPriority, string> = { low: 'Low', normal: 'Normal', high: 'High' }

export const COMMENT_STRINGS = {
  // Panel chrome.
  notesPanel: 'Notes',
  hideNotes: 'Hide Notes',
  showNotes: 'Show Notes',
  commentsTab: 'Comments',
  annotationsTab: 'Annotations',
  searchNotes: 'Search all notes…',
  currentContext: 'Current context',
  anyPriority: 'Any priority',
  anyTarget: 'Any target',
  selectNoteToEdit: 'Select a note to edit it.',
  linkedWarningSuffix: ' · linked Warning',

  // Overlay.
  overlayOff: 'Notes overlay off',
  overlayOn: 'Notes overlay on',
  overlayHint: 'Show a pin on the Plan View for every note in this context',
  toolHint: 'Click to place Comment. Click an entity to anchor it.',
  commentTool: '✎ Comment',

  // Rows and the editor.
  resolve: 'Resolve',
  reopen: 'Reopen',
  delete: 'Delete',
  anchor: 'Anchor',
  scope: 'Scope',
  priority: 'Priority',
  status: 'Status',
  scopeAllOptions: 'All Options',
  scopeExisting: 'Existing Model',
  bodyPlaceholder: 'Plain-text body',
  newCommentTitle: 'New comment',
  editorEyebrow: (reference: string): string => `Comment ${reference}`,
  statusLine: (status: string, updated: string): string => `${status} · updated ${updated}`,
  warningLinkNote: (message: string): string =>
    `Linked from Warning “${message}”. Resolving this does not acknowledge the Warning.`,
  followUpTitle: (message: string): string => `Follow up: ${message}`,
  createLinked: 'Create linked Comment',

  // Inspector.
  onThisPlacement: (n: number): string => `On this placement (${n})`,
  onThisRoom: (n: number): string => `On this room (${n})`,
  onThisWall: (n: number): string => `On this wall (${n})`,
  onThisKind: (kind: string, n: number): string => `On this ${kind} (${n})`,
  onItemDesign: (name: string, n: number): string => `On Item Design “${name}” — shared by every placement (${n})`,
  commentOnThisPlacement: '+ Comment on this placement',
  commentOnThisRoom: '+ Comment on this room',
  commentOnThisWall: '+ Comment on this wall',
  commentOnThisKind: (kind: string): string => `+ Comment on this ${kind}`,
  commentOnItemDesign: '+ Comment on Item Design',
  commentOnFeature: (label: string): string => `+ Comment on ${label}`,
  /**
   * The word a note's heading uses for an entity that has no heading of its own. `Wall`, `Room` and a
   * Placed Item have their own sentence above; these four are named by what they are.
   */
  kindOpening: 'Opening',
  kindBeam: 'Beam',
  kindSkirting: 'Skirting',
  kindService: 'Service',
} as const
