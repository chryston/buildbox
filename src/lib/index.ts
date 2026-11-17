/**
 * The public face of the `lib` module (#20 §2, ADR 0003): the only way in from outside
 * this folder. `lib` is the innermost module — it imports nothing at all, not even
 * another target module — and is pure: no DOM, no React, no state library.
 *
 * Byte-stable primitives and the shared `ValidationProblem` shape (#42 §1). ZIP
 * (`fflate`) joins it in the package-codec issue.
 */
export { decodeBase64 } from './base64'
export { CanonicalJsonError, canonicalJson, canonicalJsonBytes } from './canonicalJson'
export { sha256Hex } from './sha256Hex'
export { stableSort } from './stableSort'
export {
  ROOT_PATH,
  childPath,
  problem,
  type ValidationProblem,
} from './validation'
