/**
 * The Web Locks API behind `session`'s `LockPort` (#49, #20 §5).
 *
 * One exclusive lock per Project id: the tab that holds it is the only one writing that
 * Project, and a tab that cannot take it opens the Project read-only and waits. The lock
 * is held by keeping the callback's promise pending, which is how the API expresses
 * "held until I say so"; `release` settles it.
 */
import type { LockHandle, LockPort } from '../session'

/** One Project, one writer: the key is the whole namespace BuildBox locks. */
export function projectLockKey(projectId: string): string {
  return `buildbox:project:${projectId}`
}

/**
 * A lock whose holder is the browser: `release` ends the held promise, and with it the
 * lock. Releasing twice is a no-op because the second call has nothing left to give up.
 */
async function request(name: string, ifAvailable: boolean): Promise<LockHandle | null> {
  // The callback stays pending for as long as the lock is held, so the promise it waits on
  // is resolved by `release` and by nothing else.
  let giveUp: () => void = () => {}
  const held = new Promise<void>((resolve) => {
    giveUp = resolve
  })
  let released = false
  const handle: LockHandle = {
    release() {
      if (released) return
      released = true
      giveUp()
    },
  }
  // `lib.dom` types the callback as returning `T` and `request` as resolving to `T`, which
  // cannot say what actually happens: the browser awaits whatever the callback returns, so
  // the promise below is the one `request` settles. Awaiting it here unwraps it once.
  return globalThis.navigator.locks.request<Promise<LockHandle | null>>(
    name,
    ifAvailable ? { ifAvailable: true } : {},
    async (lock) => {
      if (lock === null) return null
      await held
      return handle
    },
  )
}

/**
 * Web Locks, with the single-tab fallback #51 owns: where the API is missing there is no
 * other tab to contend with, so every Project is editable and nothing ever waits.
 */
export function createWebLocksPort(): LockPort {
  const supported = globalThis.navigator?.locks !== undefined
  return {
    async acquire(projectId) {
      if (!supported) return { release() {} }
      return request(projectLockKey(projectId), true)
    },
    async waitFor(projectId) {
      if (!supported) return { release() {} }
      const handle = await request(projectLockKey(projectId), false)
      // A queued request only comes back `null` when it was cancelled, which BuildBox
      // never does: the wait ends when the holder lets go.
      return handle ?? { release() {} }
    },
  }
}
