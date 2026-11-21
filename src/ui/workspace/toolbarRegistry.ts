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
import type { DrawTool } from './shape/draftPath'
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

/**
 * A drawing tool: a `WorkspaceToolDefinition` whose id is one of the three the Custom Path
 * editor arms, so the editor can hand `id` straight to the draft machine without a cast (#59 §1).
 */
export interface DrawToolDefinition extends WorkspaceToolDefinition {
  readonly id: DrawTool
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
 * The tooltip a tool button carries: the one sentence that says why it is out of reach, and
 * nothing when it is reachable (#64 criterion 11). A disabled button that says nothing is a bug
 * report waiting to happen, so the reason travels with the gate rather than with the button.
 */
export function toolTitle(tool: WorkspaceToolDefinition, planImage: PlanImage | null): string | undefined {
  return toolIsGated(tool, planImage) ? CALIBRATION_REQUIRED_HINT : undefined
}

/**
 * The tools the Plan View ships today. `Select` moves what is already placed and `Pan` moves
 * the camera, so neither measures; `Wall` writes millimetre coordinates and so waits for a
 * calibrated Plan Image (#64 criterion 11), which is the one rule this registry owns.
 */
export const WORKSPACE_TOOLS: readonly WorkspaceToolDefinition[] = [
  { id: 'select', label: 'Select', testId: 'tool-select', requiresCalibratedFloor: false },
  { id: 'pan', label: 'Pan', testId: 'tool-pan', requiresCalibratedFloor: false },
  {
    id: 'wall',
    label: 'Wall',
    testId: 'tool-wall',
    requiresCalibratedFloor: true,
    icon: 'M2 6 H18 M2 14 H18 M6 6 V14',
  },
  {
    id: 'opening',
    label: 'Door / window',
    testId: 'tool-opening',
    // An Opening is placed in millimetres along a Wall, so it waits for a calibrated Plan Image
    // on the same rule the Wall tool follows (#64 criterion 11, #65 §9).
    requiresCalibratedFloor: true,
    // A gap in a Wall, the leaf standing in it, the swing swept from the hinge: the symbol the
    // Plan View draws, at the size a 24-unit button holds.
    icon: 'M2 12 H7 M17 12 H22 M7 12 V4 M7 4 A8 8 0 0 1 15 12',
  },
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
export const DRAW_TOOLS: readonly DrawToolDefinition[] = [
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
