/**
 * The starting point for a new cabinet (#47).
 *
 * `cabinet`'s `defaultSettings` is internal to that module and #47 leaves it untouched, so
 * the values the legacy store started a `Design` with are restated here — the same numbers
 * `src/store/store.ts` and #43's converter used, in millimetres.
 *
 * The Wall defaults are here for the same reason: nothing in `domain` mints a Wall, so the
 * values a new one starts with live beside the cabinet's.
 */
import type { Floor, GlobalSettings, Project, Wall } from '../domain'
import { DEFAULT_WALL_HEIGHT_MM } from '../domain'

export const LEGACY_DEFAULT_SETTINGS: GlobalSettings = {
  unit: 'mm',
  height: 800,
  width: 600,
  depth: 500,
  thickness: 18,
  backThickness: 6,
  toeKick: null,
  material: 'oak',
}

/**
 * The thickness a new Wall starts with: the HDB BTO Preset Pack's `wall.internal` entry, pinned
 * here the way `DEFAULT_WALL_HEIGHT_MM` pins the pack's ceiling height. Editing a Wall never
 * points back at the pack.
 */
export const DEFAULT_WALL_THICKNESS_MM = 100

/**
 * What a new Wall takes from its Floor and Project: the Floor's own default height when it has
 * one, the Project's otherwise (#64 §1).
 */
export const newWallDefaults = (
  project: Project,
  floor: Floor,
): Pick<Wall, 'thickness' | 'justification' | 'baseElevation' | 'height'> => ({
  thickness: DEFAULT_WALL_THICKNESS_MM,
  justification: 'centre',
  baseElevation: 0,
  height: floor.defaultWallHeight ?? project.preferences.defaultWallHeight,
})

/**
 * The section a new Beam starts with (#77 §2): two placeholders the tool panel captions
 * `measure yours`. They are placeholders and nothing more — the HDB BTO preset pack holds no Beam
 * entries, so no Beam string may call either value typical.
 */
export const DEFAULT_BEAM_WIDTH_MM = 200
export const DEFAULT_BEAM_DEPTH_MM = 300

/**
 * The `Top at` reference when the Floor sets no upper limit: the pack's nominal storey height, used
 * as an input-time reference and for no other purpose (#77 §2 criterion 4). It is never stored on
 * the Beam and never written to a Floor's limits — the Beam keeps only the underside it implies.
 */
export const DEFAULT_BEAM_TOP_MM = DEFAULT_WALL_HEIGHT_MM

/** The `Top at` a Beam drawn on this Floor is offered: its upper limit, else the nominal 2600. */
export const newBeamTopReference = (floor: Floor): number => floor.limits?.upperMm ?? DEFAULT_BEAM_TOP_MM
