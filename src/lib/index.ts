/**
 * The public face of the `lib` module (#20 §2, ADR 0003): the only way in from outside
 * this folder. `lib` is the innermost module — it imports nothing at all, not even
 * another target module — and is pure: no DOM, no React, no state library.
 *
 * Byte-stable primitives and the shared `ValidationProblem` shape (#42 §1), the #19 §12
 * banned-word list every copy check reads (#63 criterion 3), and the ZIP
 * half of the package codec: `fflate` is a `lib` dependency so that `package` stays
 * free of it (#44).
 */
export { decodeBase64 } from './base64'
export { BANNED_WORDS, bannedWordsIn, mentionsWord } from './bannedWords'
export { CanonicalJsonError, canonicalJson, canonicalJsonBytes } from './canonicalJson'
export { sha256Hex } from './sha256Hex'
export { compareCodePoints, stableSort } from './stableSort'
export {
  ROOT_PATH,
  childPath,
  problem,
  type ValidationProblem,
} from './validation'
export {
  readZipIndex,
  unzipEntries,
  zipEntries,
  type ZipDateTime,
  type ZipEntry,
  type ZipEntryInput,
  type ZipFailure,
  type ZipFailureCode,
  type ZipIndexEntry,
  type ZipIndexResult,
  type ZipLimits,
  type ZipResult,
} from './zip'
