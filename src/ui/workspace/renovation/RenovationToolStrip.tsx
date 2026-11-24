/**
 * The contextual tool strip (#70 §3, criteria 4, 5, 6): the tools this Renovation Display allows, the
 * number it is hiding, and the temporary `Pick:` filter.
 *
 * The rows come from `RENOVATION_TOOL_ROWS` and nothing else. The strip has no `if (display === …)`
 * either, so the table stays the one place the Display rules live: #81 adds `Text annotation` by
 * adding a row, and this component shows it, counts it and gives it a shortcut without being touched.
 *
 * Three behaviours the criteria ask for and one honest limit:
 *
 * - **The count is derived, never typed.** `n tools hidden in this display` is the table's row count
 *   minus the rows shown, so a hidden tool can never be counted twice or missed.
 * - **A Display that forbids the current tool drops to Select.** Select is the one tool the table
 *   allows everywhere, so it is the only safe place to land. `Pan` is not in the table at all — it
 *   moves the camera and writes nothing — so it is left alone.
 * - **A hidden tool's shortcut says why.** The workspace has no tool shortcuts of its own, so the
 *   strip brings its own, gated with the flag: `V D R W O M I`. Pressing one that this Display hides
 *   does nothing to the tool and prints `Mark demolition works in Demolition / Combined display`.
 * - **Two rows have no command to run yet.** `Place item` lives in the toolbar's Library menu and
 *   `Replace…` needs the dialog that asks what takes the entity's place. Both are shown — the table
 *   says the Display allows them — and both are disabled with the reason, the way a tool gated on
 *   calibration is (#64 criterion 11).
 */
import { useEffect, type ReactNode } from 'react'
import type { RenovationState } from '../../../derive'
import { RENOVATION_STATES } from '../../../derive'
import type { RenovationDisplay } from '../../../domain'
import { STRINGS } from '../../strings'
import { RENOVATION_STRINGS } from '../../strings/renovation'
import type { WorkspaceTool } from '../workspaceStore'
import { displayLabel, swatchClass } from './displayTheme'
import type { RenovationToolId } from './toolAvailability'
import { RENOVATION_TOOL_ROWS, displaysAllowing, hiddenToolCount, toolIsAvailable } from './toolAvailability'

/** The row's word: S7's own for the tools it already ships, the renovation table's for its two. */
const TOOL_LABELS: { [T in RenovationToolId]: string } = {
  select: STRINGS.toolSelect,
  markDemolition: RENOVATION_STRINGS.toolMarkDemolition,
  replace: RENOVATION_STRINGS.toolReplace,
  wall: STRINGS.toolWall,
  opening: STRINGS.toolOpening,
  room: STRINGS.room,
  placeItem: RENOVATION_STRINGS.toolPlaceItem,
  elevation: STRINGS.newElevationView,
}

/** The strip's own shortcut per row. No workspace tool shortcut exists today, so these are new keys. */
const TOOL_KEYS: { [T in RenovationToolId]: string } = {
  select: 'v',
  markDemolition: 'd',
  replace: 'r',
  wall: 'w',
  opening: 'o',
  room: 'm',
  placeItem: 'i',
  elevation: 'e',
}

/**
 * Which row a workspace tool belongs to, so a Display change can drop it. `Pan` maps to nothing: it
 * moves the camera, writes no geometry, and no Display has a reason to forbid it. The three shape
 * tools are all one row — a Room Outline is drawn with any of them.
 */
const ROW_OF_TOOL: { [T in WorkspaceTool]: RenovationToolId | null } = {
  select: 'select',
  wall: 'wall',
  opening: 'opening',
  // A Beam documents work that already exists, so no Display has a reason to forbid drawing one:
  // the tool belongs to no row, the same way `Pan` belongs to none (#77 §1).
  beam: null,
  line: 'room',
  arc: 'room',
  ellipticalArc: 'room',
  elevation: 'elevation',
  pan: null,
}

/** The rows whose command the app cannot run yet, and what the row says instead. */
const DEFAULT_BLOCKED: Partial<Record<RenovationToolId, string>> = {
  placeItem: RENOVATION_STRINGS.placeItemLivesInLibrary,
  replace: RENOVATION_STRINGS.replaceNeedsDialog,
}

/** The `Pick:` chip's word: the State's own name, which is also the Display's when it shows one State. */
const STATE_LABELS: { [S in RenovationState]: string } = {
  existing: RENOVATION_STRINGS.displayExisting,
  demolition: RENOVATION_STRINGS.displayDemolition,
  proposed: RENOVATION_STRINGS.displayProposed,
}

/** How long the notice stays: long enough to read, short enough that it never becomes wallpaper. */
const NOTICE_MS = 5000

export interface RenovationToolStripProps {
  display: RenovationDisplay
  hasDesignOption: boolean
  activeTool: WorkspaceTool
  /** The `Pick:` filter; empty means every state. */
  pickStates: readonly RenovationState[]
  /** Why the last hidden-tool shortcut did nothing, or `null`. */
  notice: string | null
  /** Why a shown row cannot be used right now; `Mark demolition` uses it for "nothing is selected". */
  blocked?: Partial<Record<RenovationToolId, string>>
  onTool(tool: WorkspaceTool): void
  onMarkDemolition(): void
  onTogglePick(state: RenovationState): void
  onNotice(notice: string | null): void
}

/** Whether a keystroke belongs to a field rather than to the workspace. */
const isTyping = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
}

export function RenovationToolStrip(props: RenovationToolStripProps): ReactNode {
  const { display, hasDesignOption, activeTool, pickStates, notice, blocked, onTool, onMarkDemolition, onTogglePick, onNotice } = props
  const reasons = { ...DEFAULT_BLOCKED, ...blocked }
  const hidden = hiddenToolCount(display, hasDesignOption)

  const run = (tool: RenovationToolId): void => {
    if (tool === 'markDemolition') onMarkDemolition()
    else if (tool === 'wall') onTool('wall')
    else if (tool === 'opening') onTool('opening')
    else if (tool === 'room') onTool('line')
    else if (tool === 'select') onTool('select')
  }

  // Criterion 6: a Display that hides the tool in hand returns to Select, the one row every Display
  // allows. The effect runs on the Display change itself, so a saved view opened with a stale tool
  // settles on its first frame.
  useEffect(() => {
    const row = ROW_OF_TOOL[activeTool]
    if (row !== null && !toolIsAvailable(row, display, hasDesignOption)) onTool('select')
  }, [activeTool, display, hasDesignOption, onTool])

  // The strip's shortcuts, and the notice that explains a hidden one.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return
      const tool = (Object.keys(TOOL_KEYS) as RenovationToolId[]).find((each) => TOOL_KEYS[each] === event.key.toLowerCase())
      if (tool === undefined) return
      if (!toolIsAvailable(tool, display, hasDesignOption)) {
        onNotice(RENOVATION_STRINGS.toolWorksIn(TOOL_LABELS[tool], displaysAllowing(tool).map(displayLabel).join(' / ')))
        event.preventDefault()
        return
      }
      const reason = reasons[tool]
      if (reason !== undefined) {
        onNotice(reason)
        event.preventDefault()
        return
      }
      onNotice(null)
      run(tool)
      event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [display, hasDesignOption, onNotice, onTool, onMarkDemolition, reasons])

  // A notice is a notice: it says its piece and goes away.
  useEffect(() => {
    if (notice === null) return
    const timer = setTimeout(() => onNotice(null), NOTICE_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [notice, onNotice])

  return (
    <div className="bb-renovation-tool-strip" data-testid="renovation-tool-strip" data-display={display}>
      {RENOVATION_TOOL_ROWS.filter((row) => toolIsAvailable(row.id, display, hasDesignOption)).map((row) => {
        const reason = reasons[row.id]
        return (
          <button
            key={row.id}
            type="button"
            data-testid={`renovation-tool-${row.id}`}
            className="bb-renovation-tool"
            aria-pressed={ROW_OF_TOOL[activeTool] === row.id ? 'true' : 'false'}
            disabled={reason !== undefined}
            title={reason}
            onClick={() => {
              onNotice(null)
              run(row.id)
            }}
          >
            {TOOL_LABELS[row.id]}
          </button>
        )
      })}
      {hidden > 0 && (
        <span className="bb-renovation-hidden-count" data-testid="hidden-tool-count">
          {RENOVATION_STRINGS.toolsHidden(hidden)}
        </span>
      )}
      <span className="bb-renovation-pick" data-testid="pick-filter">
        <span className="bb-renovation-pick-label">{RENOVATION_STRINGS.pickFilter}</span>
        {RENOVATION_STATES.map((state) => (
          <button
            key={state}
            type="button"
            data-testid={`pick-${state}`}
            className={`bb-renovation-pick-chip ${swatchClass(state)}`}
            aria-pressed={pickStates.length === 0 || pickStates.includes(state) ? 'true' : 'false'}
            onClick={() => onTogglePick(state)}
          >
            {STATE_LABELS[state]}
          </button>
        ))}
      </span>
      {notice !== null && (
        <span className="bb-renovation-notice" role="status" data-testid="hidden-tool-notice">
          {notice}
        </span>
      )}
    </div>
  )
}
