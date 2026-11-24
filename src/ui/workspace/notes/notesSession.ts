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
import type { CommentAnchor, CommentPriority, CommentStatus, EntityId } from '../../../domain'

/** The status filter's three settings; `any` is the only one that shows Resolved rows. */
export type NotesStatusFilter = CommentStatus | 'any'
/** The target filter: an Anchor kind, or `any` for every kind. */
export type NotesTargetFilter = CommentAnchor['kind'] | 'any'
/** The priority filter: a priority, or `any`. */
export type NotesPriorityFilter = CommentPriority | 'any'

export interface NotesSessionSnapshot {
  /** Whether the docked panel is expanded. Independent of `overlayOn` (#80 §4.2). */
  panelOpen: boolean
  /** Whether the canvas draws pins and badges. **Off every time a Project or view opens** (§7.1). */
  overlayOn: boolean
  /** The row selected in the panel, which also holds the temporary focus (§7.5). */
  selectedCommentId: EntityId | null
  /** The search text, matched against reference, title and body across the whole Project (§5.2). */
  query: string
  /** Whether the §6 context rules are applied. On by default. */
  currentContext: boolean
  status: NotesStatusFilter
  priority: NotesPriorityFilter
  target: NotesTargetFilter
  setPanelOpen(open: boolean): void
  setOverlayOn(on: boolean): void
  /** Turn the overlay off, which is what clearing the focus does too (§7.6). */
  clearFocus(): void
  select(commentId: EntityId | null): void
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
  panelOpen: true,
  overlayOn: false,
  selectedCommentId: null,
  query: '',
  currentContext: true,
  status: 'open' as NotesStatusFilter,
  priority: 'any' as NotesPriorityFilter,
  target: 'any' as NotesTargetFilter,
}

export const notesSessionStore = createStore<NotesSessionSnapshot>()((set) => ({
  ...DEFAULTS,
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  setOverlayOn: (overlayOn) => set({ overlayOn, selectedCommentId: null }),
  clearFocus: () => set({ selectedCommentId: null }),
  select: (selectedCommentId) => set({ selectedCommentId }),
  setQuery: (query) => set({ query }),
  setCurrentContext: (currentContext) => set({ currentContext }),
  setStatus: (status) => set({ status }),
  setPriority: (priority) => set({ priority }),
  setTarget: (target) => set({ target }),
  reset: () => set({ ...DEFAULTS }),
}))

export function useNotesSession<T>(selector: (state: NotesSessionSnapshot) => T): T {
  return useStore(notesSessionStore, selector)
}
