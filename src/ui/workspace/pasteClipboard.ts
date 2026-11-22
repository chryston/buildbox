/**
 * The clipboard of this browser tab (#72 §3).
 *
 * A copy is not Project data, not an Edit Transaction, and not something to remember. It is one
 * person's intention to put this work somewhere else, so it lives in a module singleton that
 * `workspaceStore.reset()` never touches — walking back to the Library and opening another Project
 * is exactly the moment the copy has to still be there — and nothing writes it to storage: a reload
 * ends it, and two tabs are two people working, neither of whom sees the other's clipboard.
 *
 * It holds the snapshot `Copy` took, never a live reference: editing or deleting the source records
 * afterwards changes nothing about what will be pasted.
 */
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { CopySet } from '../../edit'

export interface PasteClipboardSnapshot {
  /** The copy this tab holds, or `null` when nothing has been copied yet. */
  copy: CopySet | null
  /**
   * The Project the copy came from, kept beside it so the command can say whether it has anywhere
   * to go: pasting a Project's work back into that same Project is not what this command is for.
   */
  sourceProjectId: string | null
  /** Take the copy. The previous one is dropped — there is one clipboard, not a stack. */
  hold(copySet: CopySet): void
  /** Empty it. A reload does this by never having filled it. */
  clear(): void
}

export const pasteClipboardStore = createStore<PasteClipboardSnapshot>()((set) => ({
  copy: null,
  sourceProjectId: null,
  hold: (copySet) => set({ copy: copySet, sourceProjectId: copySet.sourceProjectId }),
  clear: () => set({ copy: null, sourceProjectId: null }),
}))

export function usePasteClipboard<T>(selector: (state: PasteClipboardSnapshot) => T): T {
  return useStore(pasteClipboardStore, selector)
}

/**
 * Whether the clipboard has something this Project may take (#72 criterion 12). The same Project is
 * not an answer: within one Project the work is already there, and `Duplicate` is the command that
 * means it.
 */
export function canPasteHere(state: Pick<PasteClipboardSnapshot, 'copy' | 'sourceProjectId'>, projectId: string): boolean {
  return state.copy !== null && state.sourceProjectId !== projectId
}
