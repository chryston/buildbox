/**
 * The in-memory history of one Project (#26, #20 §8).
 *
 * One linear history, one Edit Transaction per entry, capped at 200 with the oldest
 * dropped. Two stacks — `past` and `future` — and nothing else: an entry is the patches an
 * Intent produced plus their inverses, so a step costs a path and a value rather than the
 * 1.2 MB a Project copy would (#47). `src/session/history.bench.ts` is the budget that
 * proves it: 200 representative steps of the reference Project must retain under 25 MB.
 *
 * Undo and redo do not restore an old state. They apply one patch list to the *current*
 * Project and the session commits the result as a new forward revision (#26), which is why
 * the stacks only ever move entries between themselves and never hold a Project.
 */
import type { HistoryEntry, HistoryInfo, PatchList } from './types'

/** #20 §8: 200 steps, ≤ 25 MB. The cap drops the oldest entry, never the newest. */
export const HISTORY_LIMIT = 200

/** The two stacks, in the order #26 describes them. */
export interface History {
  /** Record one Edit Transaction. Anything redoable is gone, and the oldest step goes with it. */
  push(entry: HistoryEntry): void
  /** The step to undo, newest first, or `null` when there is nothing left. */
  takeUndo(): HistoryEntry | null
  /** The step to redo, newest first, or `null` when there is nothing left. */
  takeRedo(): HistoryEntry | null
  /** Move a taken undo onto the redo stack, and the reverse. */
  commitUndo(entry: HistoryEntry): void
  commitRedo(entry: HistoryEntry): void
  /** Drop both stacks: a #26 boundary, behind a Recovery Point. */
  clear(): void
  /** What the toolbar renders. */
  describe(): HistoryInfo
  /** The entries on the past stack — the number the 200 cap holds to. */
  size(): number
  /** The patches undo would apply next, for a test or a tooltip. */
  peekUndoPatches(): PatchList | null
}

export function createHistory(): History {
  const past: HistoryEntry[] = []
  const future: HistoryEntry[] = []

  return {
    push(entry) {
      past.push(entry)
      if (past.length > HISTORY_LIMIT) past.shift()
      // A new Edit Transaction after an undo ends the redo branch, the same way every
      // linear editor's does (#26: one linear in-memory history per Project).
      future.length = 0
    },
    takeUndo() {
      return past.pop() ?? null
    },
    takeRedo() {
      return future.pop() ?? null
    },
    commitUndo(entry) {
      future.push(entry)
    },
    commitRedo(entry) {
      past.push(entry)
    },
    clear() {
      past.length = 0
      future.length = 0
    },
    describe() {
      const undo = past[past.length - 1]
      const redo = future[future.length - 1]
      return {
        canUndo: undo !== undefined,
        canRedo: redo !== undefined,
        undoLabel: undo?.label ?? null,
        redoLabel: redo?.label ?? null,
        size: past.length,
      }
    },
    size() {
      return past.length
    },
    peekUndoPatches() {
      return past[past.length - 1]?.inversePatches ?? null
    },
  }
}
