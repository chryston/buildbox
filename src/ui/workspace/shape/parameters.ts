/**
 * Writing one Shape-tab parameter (#58 §4).
 *
 * The Shape tab has no idea how to rebuild a preset: it names a field and a number and gets a
 * footprint back, which it hands to the controller as a proposal. Keeping the two switches —
 * this one, and the one that reads the values out — apart from the component is what lets the
 * component stay a description of the form rather than a pile of `case` clauses.
 *
 * Nothing here validates. A width of `-5` comes back as a Rectangle of width `-5`, and the
 * controller is what says so; a field that refused to hold an impossible number could never
 * show the message the issue asks for.
 */
import { cornerRadiiOf } from '../../../derive'
import type { CornerRadii, Preset } from '../../../derive'
import { footprintCentre, footprintMovedTo } from '../../../domain'
import type { ItemFootprint } from '../../../domain'

/** Every field the Shape tab can write. The read side in `ShapeTab` uses the same names. */
export type ShapeFieldId =
  | 'positionX'
  | 'positionY'
  | 'orientation'
  | 'side'
  | 'width'
  | 'depth'
  | 'radius'
  | 'topLeft'
  | 'topRight'
  | 'bottomRight'
  | 'bottomLeft'
  | 'diameter'
  | 'length'
  | 'baseWidth'
  | 'apexOffset'
  | 'sides'
  | 'sideLength'

const CORNER_FIELDS: readonly ShapeFieldId[] = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft']

/** The four corner radii, whether the preset stores one shared radius or four. */
export const radiiOf = (preset: Preset): CornerRadii =>
  preset.kind === 'roundedRectangle'
    ? cornerRadiiOf(preset)
    : { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 }

/** The `Apex offset` a Triangle carries by default when the field is absent (#58 §4). */
export const apexOffsetOf = (preset: Preset): number =>
  preset.kind === 'triangle' ? (preset.apexOffset ?? preset.baseWidth / 2) : 0

/** The `End radius` a Capsule derives, shown read-only because it is not an input. */
export const endRadiusOf = (preset: Preset): number => (preset.kind === 'capsule' ? preset.width / 2 : 0)

/**
 * The footprint with one field set to `value`.
 *
 * Position moves the whole footprint — for a preset that means its centre, for a Custom Path
 * every point, which is what `footprintMovedTo` is for. Orientation belongs to a preset only:
 * a Custom Path has no orientation to keep in step with its edges, so #59 rotates its vertices
 * instead and this function has no opinion about it.
 */
export function withParameter(footprint: ItemFootprint, field: ShapeFieldId, value: number): ItemFootprint {
  if (field === 'positionX' || field === 'positionY') {
    const centre = footprintCentre(footprint)
    return footprintMovedTo(footprint, field === 'positionX' ? { x: value, y: centre.y } : { x: centre.x, y: value })
  }
  if (footprint.kind !== 'preset') return footprint
  const preset = footprint.preset
  if (field === 'orientation') return { ...footprint, orientationDeg: value }
  if (preset.kind === 'roundedRectangle' && (field === 'radius' || CORNER_FIELDS.includes(field))) {
    // A corner edit promotes a shared radius to four, because changing one corner while all
    // four read the same number has to leave the other three reading it too.
    const radii = cornerRadiiOf(preset)
    const next: Preset = field === 'radius'
      ? { ...preset, radius: value, radii: undefined }
      : { ...preset, radius: undefined, radii: { ...radii, [field]: value } }
    return { ...footprint, preset: next }
  }
  return { ...footprint, preset: { ...preset, [field]: value } as Preset }
}

/**
 * The four corner radii set to one value, which is what turning `Different radius per corner`
 * off means: the top-left wins, because it is the one field that was still showing a number.
 */
export function withUniformRadius(footprint: ItemFootprint, radius: number): ItemFootprint {
  if (footprint.kind !== 'preset' || footprint.preset.kind !== 'roundedRectangle') return footprint
  return { ...footprint, preset: { ...footprint.preset, radius, radii: undefined } }
}

/**
 * `Different radius per corner` on: the shared radius becomes four, so the toggle can be
 * turned off again without losing the fact that all four were equal.
 */
export function withPerCornerRadii(footprint: ItemFootprint): ItemFootprint {
  if (footprint.kind !== 'preset' || footprint.preset.kind !== 'roundedRectangle') return footprint
  return { ...footprint, preset: { ...footprint.preset, radius: undefined, radii: cornerRadiiOf(footprint.preset) } }
}
