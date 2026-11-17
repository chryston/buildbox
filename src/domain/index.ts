/**
 * The public face of the `domain` module (#20 §2, ADR 0003): the only way in from
 * outside this folder. `domain` is pure — no DOM, no React, no state library — and may
 * import only `geometry` and `lib`.
 *
 * Today it holds the cabinet Item Design payload vocabulary and unit conversion. S2's
 * domain schema v1, validators and migrators land beside them (#42).
 */
export type {
  Accessory,
  AccessoryType,
  CabinetMaterialId,
  CabinetNode,
  Divider,
  DrawerConfig,
  ElementType,
  GlobalSettings,
  SlideType,
  SplitAxis,
  ToeKick,
  Unit,
} from './cabinetPayload'
export { formatDisplay, fromMm, toMm } from './units/unitConversion'
