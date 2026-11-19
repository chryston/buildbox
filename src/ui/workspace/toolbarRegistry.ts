/**
 * The toolbar's tool registry and the one gating rule #56 adds to it.
 *
 * A tool that draws **measured** geometry — a wall, a room outline, a dimension — writes
 * millimetre coordinates, and millimetres mean nothing against an uncalibrated Plan Image
 * (#11 finding 6: either require calibration before measured edits, or migrate the
 * coordinates atomically). BuildBox requires it. The rule lives here rather than at each
 * button so a tool says only whether it measures, and so the toolbar can render the
 * disabled state without ever adding, removing or resizing a control: a gated tool is
 * still in its slot, still the same width, only inert with an explanation (#55 criterion 3
 * says the row never moves, and gating is the first thing that could have made it lie).
 *
 * A Floor with no Plan Image is not gated: there is no scale to get wrong, and refusing to
 * draw because a Floor has no underlay would be refusing to work.
 */
import type { PlanImage } from '../../domain'
import type { WorkspaceTool } from './workspaceStore'

/** One tool the toolbar can hold. */
export interface WorkspaceToolDefinition {
  readonly id: WorkspaceTool
  readonly label: string
  readonly testId: string
  /** Whether this tool draws measured geometry, and so needs a calibrated Plan Image. */
  readonly requiresCalibratedFloor: boolean
  /**
   * A glyph drawn in a 20 × 20 box, in front of the words (#59 §1).
   *
   * The three drawing tools carry one because the prototype's tool row was a strip of bare
   * icons with no words at all, and a person had to hover to learn what they were. The words
   * are the label; the glyph only makes the row scannable.
   */
  readonly icon?: string
}

/** The explanation a gated tool gives. One sentence, wherever it is read. */
export const CALIBRATION_REQUIRED_HINT = "Calibrate this Floor's Plan Image to draw measured shapes"

/**
 * Whether a Floor's Plan Image is in the state that gates measured tools: present, and
 * without a scale. `null` (no image) and a calibrated image both answer `false`.
 */
export function floorNeedsCalibration(planImage: PlanImage | null): boolean {
  return planImage !== null && planImage.pixelsPerMm === null
}

/** Whether `tool` is disabled on a Floor with this Plan Image. */
export function toolIsGated(tool: WorkspaceToolDefinition, planImage: PlanImage | null): boolean {
  return tool.requiresCalibratedFloor && floorNeedsCalibration(planImage)
}

/**
 * The tools the Plan View ships today. Neither measures — `Select` moves what is already
 * placed and `Pan` moves the camera — so nothing is gated on any Floor; the shape, wall,
 * opening and room tools that follow set the flag and inherit the rule.
 */
export const WORKSPACE_TOOLS: readonly WorkspaceToolDefinition[] = [
  { id: 'select', label: 'Select', testId: 'tool-select', requiresCalibratedFloor: false },
  { id: 'pan', label: 'Pan', testId: 'tool-pan', requiresCalibratedFloor: false },
]

/**
 * The three Custom Path drawing tools (#59 §1).
 *
 * They are registered here rather than hard-wired into the editor because this registry is the
 * one place that says which tools write millimetres, and all three do: a point placed against
 * an uncalibrated Plan Image is a number with no meaning. The Item Design editor renders them;
 * the Floor workspace does not yet, because a drawn path has nowhere to be aimed until Rooms
 * arrive in #67 — the target registers later through the same adapter, and it inherits this
 * gating for free.
 */
export const DRAW_TOOLS: readonly WorkspaceToolDefinition[] = [
  {
    id: 'line',
    label: 'Line',
    testId: 'draw-line',
    requiresCalibratedFloor: true,
    icon: 'M3 17 L17 3',
  },
  {
    id: 'arc',
    label: 'Arc',
    testId: 'draw-arc',
    requiresCalibratedFloor: true,
    icon: 'M3 17 A 14 14 0 0 1 17 3',
  },
  {
    id: 'ellipticalArc',
    label: 'Elliptical arc',
    testId: 'draw-elliptical-arc',
    requiresCalibratedFloor: true,
    icon: 'M2 15 A 8 6 0 0 1 18 15',
  },
]
