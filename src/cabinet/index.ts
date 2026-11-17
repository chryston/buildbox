/**
 * The public face of the `cabinet` module (#20 §2, ADR 0003, ADR 0004): the only way in
 * from outside this folder. `cabinet` is pure — no DOM, no React, no state library — and
 * may import only `domain`.
 *
 * It is the sole interpreter of the cabinet Item Design payload: layout, tree
 * mutations, accessories and the cut list. Everything else treats the payload as opaque.
 */
export { computeSceneLayout, computeUnitLayout } from './layoutEngine'
export {
  addDivider,
  addShelf,
  deleteBoard,
  distributeEvenly,
  findNode,
  mapNode,
  pinNode,
  setDrawerConfig,
  setElementType,
  setNodeLabel,
  setNodeSize,
  setSplitRatio,
  unpinNode,
} from './treeMutations'
export { addAccessory, getAccessories, removeAccessory } from './accessories'
export { computeCutListForUnits } from './cutList'
export type {
  CabinetSceneUnit,
  CabinetUnit,
  CutListEntry,
  LayoutDivider,
  LayoutPanel,
  LayoutResult,
  LayoutVoid,
  SceneLayout,
  UnitBase,
  UnitLayoutResult,
  UnitType,
} from './types'
