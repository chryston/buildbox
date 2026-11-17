/**
 * The browser's ID mint behind `session`'s `IdSource` (#49, #42 §3).
 *
 * Pure modules never mint an ID, so `edit` is handed these; the UI mints the same way when
 * it builds an Intent, because an Intent carries the ids it will use (#48).
 */
import type { IdSource } from '../session'

/** `crypto.randomUUID`, in the order the Intent asked for them. */
export function createRandomIdSource(): IdSource {
  return (count = 1) => Array.from({ length: count }, () => globalThis.crypto.randomUUID())
}
