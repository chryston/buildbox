/**
 * The main-thread half of the Backup encoder (#50, #20 Q9).
 *
 * `session` asks for bytes; this holds a module Worker and asks `./backup.worker.ts` for them.
 * Encoding a Project with a dozen Plan Images is a few hundred milliseconds of deflate, and
 * #20 Q9 puts that off the main thread so the Library keeps painting while the dialog waits.
 *
 * The port answers `null` for "no Worker here", and that is the whole of its failure vocabulary:
 * a browser that refuses to construct a Worker, a Worker that dies, and a host built without one
 * are all the same answer, and the caller encodes on its own thread instead. `platform` may not
 * import `package`, so the fallback cannot live here — which is the reason the port is allowed
 * to say "not me" rather than having to explain why.
 *
 * The asset bytes are copied into the Worker, not transferred. The caller keeps them, because it
 * may still need to encode with them itself, and a transferred `ArrayBuffer` arrives there
 * detached and empty. A copy of a Plan Image is a memcpy; the encoding is what costs.
 */
import type { BackupAsset, BackupEncoderPort, BackupMeta } from '../session'
import type { Project } from '../domain'
import type { BackupAnswer, BackupRequest } from './backup.worker'

/**
 * A `BackupEncoderPort` backed by one lazily-created module Worker, reused across encodes.
 *
 * `available: false` builds a host that always answers `null`, which is what a browser without
 * `Worker` gets and what a test asks for when it wants the main-thread path exercised.
 */
export function createBackupEncoder(options?: { available?: boolean }): BackupEncoderPort {
  const allowed = options?.available ?? true
  let worker: Worker | null = null
  let broken = !allowed
  let nextId = 0
  const pending = new Map<number, (bytes: Uint8Array | null) => void>()

  function settle(answer: BackupAnswer): void {
    const resolve = pending.get(answer.id)
    if (resolve === undefined) return
    pending.delete(answer.id)
    resolve(answer.ok ? answer.bytes : null)
  }

  function failAll(): void {
    broken = true
    worker?.terminate()
    worker = null
    for (const resolve of pending.values()) resolve(null)
    pending.clear()
  }

  function spawn(): Worker | null {
    if (broken) return null
    if (worker !== null) return worker
    try {
      const created = new Worker(new URL('./backup.worker.ts', import.meta.url), { type: 'module' })
      created.onmessage = (event: MessageEvent<BackupAnswer>) => settle(event.data)
      // An uncaught error in the Worker is not something this call can recover from, and every
      // later call would meet the same dead thread. Retire it, answer `null` for everything in
      // flight, and let the caller's fallback take over for good.
      created.onerror = () => failAll()
      worker = created
      return created
    } catch {
      broken = true
      return null
    }
  }

  return {
    encode(project: Project, assets: readonly BackupAsset[], meta: BackupMeta): Promise<Uint8Array | null> {
      const target = spawn()
      if (target === null) return Promise.resolve(null)
      const id = (nextId += 1)
      const request: BackupRequest = { id, project, assets, meta }
      // The executor form rather than `Promise.withResolvers`, because the resolver has to be
      // stored in `pending` before the request is posted and the project's `lib` target predates
      // ES2024. Same shape, one line longer.
      const promise = new Promise<Uint8Array | null>((resolve) => {
        pending.set(id, resolve)
      })
      target.postMessage(request)
      return promise
    },
  }
}
