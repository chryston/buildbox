/**
 * Asking the browser not to throw BuildBox's storage away (#51 §6).
 *
 * `navigator.storage.persist()` is the only way a web app can say *this data is the point of this
 * tab*. Browsers grant it silently when the person has shown real engagement and refuse it
 * otherwise, and a refusal is not worth asking about twice — so a denial is remembered for 30
 * days and a person who was asked once is not asked every week.
 *
 * It runs after the first write rather than at startup: a request made before there is anything
 * to persist is a request a browser refuses on the merits, and a silent refusal leaves no trace
 * to learn from.
 *
 * Nothing is shown either way. A grant is invisible by design and a refusal changes nothing the
 * person can see, so a notice about it would be a notice about a thing that has not happened.
 */
import type { ClockPort } from '../session'
import type { PrefsRepository } from '../persistence'

/** How long a refusal is honoured before the question may be asked again. */
export const PERSIST_RETRY_AFTER_MS = 30 * 24 * 60 * 60 * 1000

/** The part of the Storage API this needs, so a test can hand in an answer. */
export interface PersistPort {
  persisted(): Promise<boolean>
  persist(): Promise<boolean>
}

export interface PersistentStorageDeps {
  prefs: PrefsRepository
  clock: ClockPort
  /** Defaults to the browser's own `navigator.storage`. */
  persist?: PersistPort
}

/**
 * Ask once, remember the answer, and never ask a browser that has already said yes.
 *
 * Every failure here is a reason to do nothing: no Storage API, a port that throws, a prefs store
 * that will not answer. Persistent storage is an improvement to the durability of a database that
 * is already the app's only copy, and none of those cases is worth interrupting anyone for.
 */
export async function requestPersistentStorage(deps: PersistentStorageDeps): Promise<void> {
  const { prefs, clock } = deps
  const persist = deps.persist ?? globalThis.navigator?.storage
  if (persist === undefined || persist.persist === undefined) return

  const already = await persist.persisted().catch(() => false)
  if (already) return

  const asked = await prefs.get('storagePersistence')
  const previous = asked.ok ? asked.value : undefined
  const refusedRecently =
    previous !== undefined &&
    !previous.granted &&
    Date.parse(clock.now()) - Date.parse(previous.askedAt) < PERSIST_RETRY_AFTER_MS
  if (refusedRecently) return

  const granted = await persist.persist().catch(() => false)
  await prefs.set('storagePersistence', { askedAt: clock.now(), granted })
}
