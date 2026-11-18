/**
 * The browser's one legacy value, behind the two operations #52 allows (#20 §2, §5).
 *
 * `buildbox-store` is the key the pre-Projects app's zustand `persist` middleware wrote. This
 * file is the only place in the new code that names it, and it names it in two directions only:
 * read the string, and delete the key. There is no `setItem` here because there is no
 * `setItem` anywhere in the Projects code — a migration that could write the old value back
 * could also corrupt it, and #52's whole promise is that the source stays byte-identical until
 * the user presses `Remove old copy`.
 *
 * The value is returned unparsed. Parsing it is `package/legacy`'s job, and routing it through
 * the old `persist` rehydrator would put the new flow back on the code path it exists to leave.
 */
import type { LegacySourcePort } from '../session'

/** The key the legacy app stores its whole state under. */
export const LEGACY_STORE_KEY = 'buildbox-store'

/** The `buildbox-store` value of this origin's `localStorage`. */
export function createLegacySource(storage: Pick<Storage, 'getItem' | 'removeItem'> = window.localStorage): LegacySourcePort {
  return {
    read: () => storage.getItem(LEGACY_STORE_KEY),
    remove: () => storage.removeItem(LEGACY_STORE_KEY),
  }
}
