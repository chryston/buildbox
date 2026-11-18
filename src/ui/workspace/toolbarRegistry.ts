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
