/**
 * The inverse projection of a Project back into the cabinet scene vocabulary (#43, #20
 * §13.4): the pure read-only derivations that turn domain data into the shapes the
 * cabinet engine consumes.
 *
 * `derive` is pure — no DOM, no React, no state library — and may import only `domain`,
 * `geometry`, `cabinet` and `lib` (#20 §2). It never writes anything back: every function
 * here returns a fresh value built from the Project it was handed.
 */
export { cabinetSceneUnits } from './cabinetSceneUnits'
