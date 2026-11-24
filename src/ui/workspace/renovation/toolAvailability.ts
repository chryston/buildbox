/**
 * Which tools a Renovation Display allows (#70 §3, criterion 4) — the table, as data.
 *
 * The strip shows only what the Display allows and says how many it is hiding, so the count is
 * derived from the same rows the strip reads: a hidden tool can never be counted twice or missed.
 * #81 adds `Text annotation` by adding one row here — that is the whole change, which is why there
 * is no `if (display === …)` anywhere in this file and none in the strip either.
 *
 * Two rules the rows encode:
 *
 * - **Select is allowed everywhere**, including a Display with no Design Option: with nothing to
 *   edit, looking and picking is still the whole job.
 * - **A Display without a Design Option allows nothing but Select** — except the Existing Display,
 *   which needs no Option because it draws the shared baseline that always exists. Demolition,
 *   Proposed and Combined with no Option is §6's error state: there is no Option to own a demolition
 *   record or a proposed Wall, so the tools that would create one are hidden rather than refused on
 *   click.
 *
 * Copy lives in `../../strings/renovation`; this module answers questions about the table and never
 * words an answer.
 */
import type { RenovationDisplay } from '../../../domain'

/** The tools the strip can show: the S7 editing tools plus the two renovation ones (#70 §3). */
export type RenovationToolId = 'select' | 'markDemolition' | 'replace' | 'wall' | 'opening' | 'skirting' | 'room' | 'placeItem' | 'elevation'

/** One row of the table: a tool, and the Displays that allow it. */
export interface RenovationToolRow {
  readonly id: RenovationToolId
  /** Every Display that shows this tool. An empty list would mean a tool nobody can ever reach. */
  readonly allowedIn: readonly RenovationDisplay[]
  /**
   * Whether the tool creates something a Design Option has to own — a demolition record, a proposed
   * Wall. `false` for Select, which only looks: it is the one tool that works with nothing chosen.
   */
  readonly needsDesignOption: boolean
}

/**
 * The table of #70 §3, one row per tool. Reading the columns off it gives the hidden counts the
 * strip prints: Existing hides 2, Demolition hides 5, Proposed hides 2, Combined hides 0, and a
 * Display with no Design Option hides 7 of 9.
 */
export const RENOVATION_TOOL_ROWS: readonly RenovationToolRow[] = [
  { id: 'select', allowedIn: ['existing', 'demolition', 'proposed', 'combined'], needsDesignOption: false },
  { id: 'markDemolition', allowedIn: ['demolition', 'combined'], needsDesignOption: true },
  { id: 'replace', allowedIn: ['demolition', 'combined'], needsDesignOption: true },
  // Surveying the baseline means drawing it, so the shape tools stay on the Existing Display; the
  // Demolition Display has nothing for them to add — it only says what the Option removes.
  { id: 'wall', allowedIn: ['existing', 'proposed', 'combined'], needsDesignOption: true },
  { id: 'opening', allowedIn: ['existing', 'proposed', 'combined'], needsDesignOption: true },
  // A Skirting is a strip of the same kind of work as an Opening — it hangs off a Wall the same way
  // and is measured in millimetres along it — so it follows the Opening row exactly (#78 §3).
  { id: 'skirting', allowedIn: ['existing', 'proposed', 'combined'], needsDesignOption: true },
  { id: 'room', allowedIn: ['existing', 'proposed', 'combined'], needsDesignOption: true },
  { id: 'placeItem', allowedIn: ['existing', 'proposed', 'combined'], needsDesignOption: true },
  // An Elevation View is a way of looking, not model content (#75 §3): it creates a saved view, so
  // every Display can hold the tool and none of them needs a Design Option to answer for it.
  { id: 'elevation', allowedIn: ['existing', 'demolition', 'proposed', 'combined'], needsDesignOption: false },
]

/**
 * Whether a Display is meaningless without a Design Option. Three of them are: they describe what an
 * Option removes or adds, so with `designOptionId: null` there is nothing to describe — §6's error
 * state. The Existing Display is the exception, and it is the everyday one: a Project with no
 * Options at all is drawn and edited on it, exactly as it was before any of this existed.
 *
 * A tool is hidden in the error state when it needs an Option *and* the Display needs one. That is
 * what keeps Select — which needs nothing — available everywhere, and the shape tools available for
 * surveying a baseline that has no Options yet.
 */
const displayNeedsOption = (display: RenovationDisplay): boolean => display !== 'existing'

/** Whether one tool is available in this Display with this Option. */
export function toolIsAvailable(tool: RenovationToolId, display: RenovationDisplay, hasDesignOption: boolean): boolean {
  const row = RENOVATION_TOOL_ROWS.find((each) => each.id === tool)
  if (row === undefined) return false
  const blockedWithoutOption = row.needsDesignOption && displayNeedsOption(display) && !hasDesignOption
  return row.allowedIn.includes(display) && !blockedWithoutOption
}

/** The tools the strip shows, in table order — the order the user reads them left to right. */
export function availableTools(display: RenovationDisplay, hasDesignOption: boolean): RenovationToolId[] {
  return RENOVATION_TOOL_ROWS.filter((row) => toolIsAvailable(row.id, display, hasDesignOption)).map((row) => row.id)
}

/** How many tools the Display is hiding, which is the number in `n tools hidden in this display`. */
export function hiddenToolCount(display: RenovationDisplay, hasDesignOption: boolean): number {
  return RENOVATION_TOOL_ROWS.length - availableTools(display, hasDesignOption).length
}

/**
 * The Displays that allow a tool, in Display order — the list the notice names when a hidden tool's
 * shortcut is pressed: `Mark demolition works in Demolition / Combined display` (#70 §3).
 */
export function displaysAllowing(tool: RenovationToolId): RenovationDisplay[] {
  const row = RENOVATION_TOOL_ROWS.find((each) => each.id === tool)
  if (row === undefined) return []
  return (['existing', 'demolition', 'proposed', 'combined'] as const).filter((display) => row.allowedIn.includes(display))
}
