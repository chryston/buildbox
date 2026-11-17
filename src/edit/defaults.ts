/**
 * The starting point for a new cabinet (#47).
 *
 * `cabinet`'s `defaultSettings` is internal to that module and #47 leaves it untouched, so
 * the values the legacy store started a `Design` with are restated here — the same numbers
 * `src/store/store.ts` and #43's converter used, in millimetres.
 */
import type { GlobalSettings } from '../domain'

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
