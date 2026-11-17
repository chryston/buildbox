/**
 * Object URLs for stored assets (#49, #20 §5).
 *
 * An `<img>` cannot read the Asset Store, so a Plan Image is shown through an object URL.
 * Those URLs are process-wide memory the browser cannot reclaim until they are revoked, so
 * they are created once per hash here, and revoked when the Project session that asked for
 * them closes — never per render.
 */
import type { PersistenceError, Result, StoredAsset } from '../persistence'

export interface ObjectUrlCache {
  /** Re-read when a URL arrives or fails; the Plan Image is one subscriber. */
  subscribe(listener: () => void): () => void
  /** The URL for one hash, or `null` while it is unread or could not be read. */
  urlFor(sha256: string): string | null
  /** Make one hash displayable from memory: an upload that is not in the store yet. */
  put(sha256: string, bytes: Blob): void
  /** Read one hash from the Asset Store unless it is cached or missing already. */
  load(sha256: string): void
  /** Revoke every URL this cache made. The Project session closed; nothing displays them. */
  revokeAll(): void
}

/**
 * A cache of object URLs keyed by asset hash, reading through `getAsset`.
 *
 * A hash that failed to read is remembered as failed: retrying on every render would
 * re-issue a failing read forever, and a Plan Image whose asset is gone renders as no
 * image, which is what the legacy editor did with a missing `dataUrl`.
 */
export function createObjectUrlCache(
  getAsset: (sha256: string) => Promise<Result<StoredAsset, PersistenceError>>,
): ObjectUrlCache {
  const urls = new Map<string, string>()
  const unread = new Set<string>()
  const reading = new Set<string>()
  const listeners = new Set<() => void>()

  function notify(): void {
    for (const listener of [...listeners]) listener()
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    urlFor(sha256) {
      return urls.get(sha256) ?? null
    },
    put(sha256, bytes) {
      if (urls.has(sha256) || unread.has(sha256)) return
      urls.set(sha256, URL.createObjectURL(bytes))
      notify()
    },
    load(sha256) {
      if (urls.has(sha256) || reading.has(sha256) || unread.has(sha256)) return
      reading.add(sha256)
      void getAsset(sha256).then(
        (found) => {
          reading.delete(sha256)
          if (found.ok) urls.set(sha256, URL.createObjectURL(found.value.blob))
          else unread.add(sha256)
          notify()
        },
        () => {
          reading.delete(sha256)
          unread.add(sha256)
          notify()
        },
      )
    },
    revokeAll() {
      for (const url of urls.values()) URL.revokeObjectURL(url)
      urls.clear()
      unread.clear()
      reading.clear()
    },
  }
}
