/**
 * The Notes UI session (#80 §4, §5, §7).
 *
 * None of this is Project data and none of it is a step in history. Which notes are showing, which row
 * is selected, what the filters are set to: these describe the window a person is looking through, not
 * the building. So they live in a module singleton that `workspaceStore.reset()` never touches and that
 * nothing writes to storage — closing the Project and opening it again is exactly the moment the overlay
 * has to be off again (§7.1, criterion 24), and toggling it must leave the revision untouched.
 *
 * The panel's open/closed state and the overlay are deliberately two fields rather than one. Hiding the
 * panel never changes the overlay and toggling the overlay never opens or closes the panel (§4.2), and a
 * single boolean cannot express the four states those two facts allow.
 */
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { AnnotationType, CommentAnchor, CommentPriority, CommentStatus, EntityId } from '../../../domain'

/** The status filter's three settings; `any` is the only one that shows Resolved rows. */
export type NotesStatusFilter = CommentStatus | 'any'
/** The target filter: an Anchor kind, or `any` for every kind. */
export type NotesTargetFilter = CommentAnchor['kind'] | 'any'
/** The priority filter: a priority, or `any`. */
export type NotesPriorityFilter = CommentPriority | 'any'
/** Which list the panel shows (#81 §6): the Comments tab or the Annotations tab. */
export type NotesTab = 'comments' | 'annotations'
/** The Annotation type filter: a type, or `any` (#81 §6.3). */
export type NotesAnnotationTypeFilter = AnnotationType | 'any'
/** The Annotation layer filter: a layer, `Unlayered`, or `any` (#81 §6.3). */
export type NotesAnnotationLayerFilter = 'any' | 'unlayered' | EntityId

export interface NotesSessionSnapshot {
  /** Whether the docked panel is expanded. Independent of `overlayOn` (#80 §4.2). */
  panelOpen: boolean
  /** Whether the canvas draws pins and badges. **Off every time a Project or view opens** (§7.1). */
  overlayOn: boolean
  /** The row selected in the panel, which also holds the temporary focus (§7.5). */
  selectedCommentId: EntityId | null
  /**
   * How many times a row has been asked to reveal its note. Selecting the same row twice has to pan
   * there again, and a prop that compared equal to the last one would leave the canvas asleep.
   */
  revealNonce: number
  /** The search text, matched against reference, title and body across the whole Project (§5.2). */
  query: string
  /** Whether the §6 context rules are applied. On by default. */
  currentContext: boolean
  status: NotesStatusFilter
  priority: NotesPriorityFilter
  target: NotesTargetFilter
  /** Which list the panel shows (#81 §6). */
  tab: NotesTab
  /** The Annotation type filter (#81 §6.3). */
  annotationType: NotesAnnotationTypeFilter
  /** The Annotation layer filter (#81 §6.3). */
  annotationLayer: NotesAnnotationLayerFilter
  /** The Annotation row selected in the Annotations tab; also the temporary focus (#81 §6.5). */
  selectedAnnotationId: EntityId | null
  /** The Annotation whose text the editor should focus and select, or `null` (#81 §3.10). */
  annotationTextToFocus: EntityId | null
  setTab(tab: NotesTab): void
  setAnnotationType(type: NotesAnnotationTypeFilter): void
  setAnnotationLayer(layer: NotesAnnotationLayerFilter): void
  /** Select an Annotation row; a canvas selection opens the panel and the tab too (#81 §3.3a). */
  selectAnnotation(annotationId: EntityId | null): void
  /** The Annotation a tool just placed: selected, its text handed to the keyboard, panel open. */
  selectNewAnnotation(annotationId: EntityId): void
  clearAnnotationTextFocus(): void
  setPanelOpen(open: boolean): void
  setOverlayOn(on: boolean): void
  /** Turn the overlay off, which is what clearing the focus does too (§7.6). */
  clearFocus(): void
  select(commentId: EntityId | null): void
  /**
   * The note a tool or a button has just created: selected, and its title is handed to the keyboard
   * with the text selected, so the first keystroke replaces `New comment` instead of appending to it
   * (#80 §9, §10). `null` once the editor has taken the focus.
   */
  selectNew(commentId: EntityId): void
  /** The note whose title the editor should focus and select, or `null`. */
  titleToFocus: EntityId | null
  clearTitleFocus(): void
  setQuery(query: string): void
  setCurrentContext(on: boolean): void
  setStatus(status: NotesStatusFilter): void
  setPriority(priority: NotesPriorityFilter): void
  setTarget(target: NotesTargetFilter): void
  /**
   * Back to the state a freshly opened Project has: panel open, overlay off, nothing selected, default
   * filters. Called when a Project opens and when the view changes, because the overlay is off by
   * default every time a view opens (§7.1) and a stale filter would read as a missing note.
   */
  reset(): void
}

const DEFAULTS = {
  // §4.1 docks the panel on the right and §4.2 gives a `Hide Notes` / `Show Notes` control, but it does
  // not say which state a Project opens in. It starts closed: the panel is 380 px (§4.3) out of a
  // canvas region that #55 already shares with the Section pane, and taking that width from the host
  // pushes the split below STACK_BELOW_PX, so a workspace that had two panes side by side stacks them
  // and clips the Section. A note is one keystroke away; a clipped drawing is a person's whole screen.
  panelOpen: false,
  overlayOn: false,
  selectedCommentId: null,
  revealNonce: 0,
  titleToFocus: null,
  query: '',
  currentContext: true,
  status: 'open' as NotesStatusFilter,
  priority: 'any' as NotesPriorityFilter,
  target: 'any' as NotesTargetFilter,
  tab: 'comments' as NotesTab,
  annotationType: 'any' as NotesAnnotationTypeFilter,
  annotationLayer: 'any' as NotesAnnotationLayerFilter,
  selectedAnnotationId: null,
  annotationTextToFocus: null,
}

export const notesSessionStore = createStore<NotesSessionSnapshot>()((set) => ({
  ...DEFAULTS,
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  setOverlayOn: (overlayOn) => set({ overlayOn, selectedCommentId: null }),
  clearFocus: () => set({ selectedCommentId: null }),
  select: (selectedCommentId) => set((state) => ({ selectedCommentId, revealNonce: state.revealNonce + 1 })),
  selectNew: (commentId) => set({ selectedCommentId: commentId, titleToFocus: commentId, panelOpen: true }),
  clearTitleFocus: () => set({ titleToFocus: null }),
  setQuery: (query) => set({ query }),
  setCurrentContext: (currentContext) => set({ currentContext }),
  setStatus: (status) => set({ status }),
  setPriority: (priority) => set({ priority }),
  setTarget: (target) => set({ target }),
  setTab: (tab) => set({ tab }),
  setAnnotationType: (annotationType) => set({ annotationType }),
  setAnnotationLayer: (annotationLayer) => set({ annotationLayer }),
  selectAnnotation: (selectedAnnotationId) => set({ selectedAnnotationId, tab: 'annotations', panelOpen: true }),
  selectNewAnnotation: (annotationId) => set({ selectedAnnotationId: annotationId, annotationTextToFocus: annotationId, tab: 'annotations', panelOpen: true }),
  clearAnnotationTextFocus: () => set({ annotationTextToFocus: null }),
  reset: () => set({ ...DEFAULTS }),
}))

export function useNotesSession<T>(selector: (state: NotesSessionSnapshot) => T): T {
  return useStore(notesSessionStore, selector)
}
