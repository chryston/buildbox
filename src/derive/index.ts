/**
 * The pure read-only derivations that turn domain data into the shapes the rest of the app
 * consumes (#43, #20 §13.4, #57).
 *
 * Two families live here. `cabinetSceneUnits` is the inverse projection back into the
 * cabinet scene vocabulary; `placement` is where a Placed Item actually sits — the one
 * pinned reading of Item Origin, rotation and Item Footprint, which `ui` can only reach
 * through this module because it may not import `geometry` (#20 §2).
 *
 * `derive` is pure — no DOM, no React, no state library — and may import only `domain`,
 * `geometry`, `cabinet` and `lib` (#20 §2). It never writes anything back: every function
 * here returns a fresh value built from the Project it was handed.
 */
export { cabinetSceneUnits } from './cabinetSceneUnits'
export {
  designDefaultOrigin,
  floorBounds,
  floorBoundsSize,
  footprintPath,
  localPointOf,
  localPointValid,
  nearestOriginCandidate,
  normaliseRotation,
  originCandidates,
  originMoveTranslations,
  pathOrigin,
  placementContext,
  placementTransform,
  worldPoint,
  worldPointOf,
} from './placement'
export type { OriginMove, PlacementContext } from './placement'
