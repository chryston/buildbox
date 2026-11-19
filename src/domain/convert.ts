/**
 * What converting an Item Footprint to a Custom Path costs (#58 §5).
 *
 * Conversion is deliberately lossy: the outline is kept exactly and the parameters are
 * dropped, because a Custom Path has no parameters to keep. The dialog therefore has to
 * name the fields that are going away — and name only the ones that exist. A Rectangle
 * never had a corner radius, so a warning that mentions one is a warning about a shape the
 * person is not holding, which is the difference between an honest warning and a scary one.
 *
 * The table lives here rather than in the dialog because it is the domain's own statement
 * of what each preset stores: the same eight presets, the same eight sets of parameters the
 * Shape tab edits.
 */
import type { Preset, PresetKind } from '../geometry'

/** The name the Shapes gallery, the Shape tab and this warning all use. */
export const PRESET_NAMES: Record<PresetKind, string> = {
  square: 'Square',
  rectangle: 'Rectangle',
  roundedRectangle: 'Rounded Rectangle',
  circle: 'Circle',
  ellipse: 'Ellipse',
  capsule: 'Capsule',
  triangle: 'Triangle',
  regularPolygon: 'Regular Polygon',
}

/** The fields this preset's Shape tab edits, and which conversion removes. */
export function lostParametersOf(preset: Preset): string[] {
  switch (preset.kind) {
    case 'square':
      return ['side', 'orientation']
    case 'rectangle':
      return ['width', 'depth', 'orientation']
    case 'roundedRectangle':
      // Only the radii that are actually stored: a preset with four separate radii loses
      // four fields, one with a shared radius loses one.
      return ['width', 'depth', preset.radii === undefined ? 'corner radius' : 'the four corner radii', 'orientation']
    case 'circle':
      return ['diameter', 'orientation']
    case 'ellipse':
      return ['width', 'depth', 'orientation']
    case 'capsule':
      return ['length', 'width', 'orientation']
    case 'triangle':
      return ['base width', 'depth', 'apex offset', 'orientation']
    case 'regularPolygon':
      return ['sides', 'side length', 'orientation']
  }
}

/** `a, b and c`, `a and b`, or `a`. */
function andList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/**
 * The dialog's body: what stays, what goes, and how to get it back.
 *
 * Undo is named because it is true — conversion is one Edit Transaction — and because the
 * alternative reading of "will be removed" is "gone for good".
 */
export function convertWarningFor(preset: Preset): string {
  return (
    `Edges become individually editable. ` +
    `The ${PRESET_NAMES[preset.kind]}'s ${andList(lostParametersOf(preset))} fields will be removed. ` +
    'You can reverse this only with Undo.'
  )
}
