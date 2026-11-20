/**
 * The main-thread half of the export (#61 §9, criterion 14).
 *
 * `app` asks for drawings; this holds a module Worker and asks `./export.worker.ts` for them,
 * forwarding progress as it arrives so the dialog can show which view is being written.
 *
 * `unavailable` is the whole of its failure vocabulary, and it means "not me": a browser that
 * refuses to construct a Worker, a Worker that dies, and a host built with `available: false` all
 * answer the same way, and the caller runs the same pure `exportFiles` on its own thread instead.
 * `platform` may not import `export` outside the files claimed out by name, so the fallback cannot
 * live here — which is the reason the host is allowed to decline rather than to explain itself.
 *
 * `cancel` retires the Worker outright. There is no way to interrupt a `exportFiles` call partway
 * through, and a thread that is still grinding away at a drawing nobody wants would hold the
 * Project's bytes and the CPU while the user does something else. The next run spawns a fresh one.
 *
 * The asset bytes are copied into the Worker, not transferred: the caller keeps them, because it
 * may still need to draw with them itself on the main thread, and a transferred `ArrayBuffer`
 * arrives there detached and empty.
 */
import type { ExportAnswer, ExportRequest } from './export.worker'
import type { ExportProgress, ExportResult } from '../export'

/** How a run ended. `unavailable` is the caller's cue to do the work itself. */
export type ExportRunOutcome =
  | { readonly kind: 'done'; readonly result: ExportResult }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'cancelled' }

/** A request without its sequence number, which this file owns. */
export type ExportRunRequest = Omit<ExportRequest, 'id'>

/** The host `app` holds: one run at a time per request, one Worker shared across runs. */
export interface ExportRunner {
  run(request: ExportRunRequest, onProgress?: (progress: ExportProgress) => void): Promise<ExportRunOutcome>
  /** Stop whatever is in flight. Already-settled runs are untouched. */
  cancel(): void
}

/**
 * An `ExportRunner` backed by one lazily-created module Worker, reused across runs.
 *
 * `available: false` builds a host that always answers `unavailable`, which is what a browser
 * without `Worker` gets and what a test asks for when it wants the main-thread path exercised
 * (criterion 14 asserts both paths write the same bytes).
 */
export function createExportRunner(options?: { available?: boolean }): ExportRunner {
  let broken = options?.available === false
  let worker: Worker | null = null
  let nextId = 0
  const pending = new Map<number, (outcome: ExportRunOutcome) => void>()

  function settle(answer: ExportAnswer): void {
    const resolve = pending.get(answer.id)
    if (resolve === undefined) return
    if (answer.kind === 'progress') {
      // Progress is a courtesy, not a result: the request stays in flight.
      return
    }
    pending.delete(answer.id)
    resolve(answer.kind === 'done' ? { kind: 'done', result: answer.result } : { kind: 'unavailable' })
  }

  function retire(): void {
    worker?.terminate()
    worker = null
  }

  function failAll(outcome: ExportRunOutcome): void {
    retire()
    for (const resolve of pending.values()) resolve(outcome)
    pending.clear()
  }

  function spawn(): Worker | null {
    if (broken) return null
    if (worker !== null) return worker
    try {
      const created = new Worker(new URL('./export.worker.ts', import.meta.url), { type: 'module' })
      created.onmessage = (event: MessageEvent<ExportAnswer>) => settle(event.data)
      // An uncaught error in the Worker is not something this run can recover from, and every
      // later run would meet the same dead thread. Retire it, answer `unavailable` for everything
      // in flight, and let the caller's fallback take over for good.
      created.onerror = () => {
        broken = true
        failAll({ kind: 'unavailable' })
      }
      worker = created
      return created
    } catch {
      broken = true
      return null
    }
  }

  return {
    run(request, onProgress) {
      const target = spawn()
      if (target === null) return Promise.resolve({ kind: 'unavailable' })
      const id = (nextId += 1)
      // The executor form rather than `Promise.withResolvers`, because the resolver has to be in
      // `pending` before the request is posted and the project's `lib` target predates ES2024.
      const promise = new Promise<ExportRunOutcome>((resolve) => {
        pending.set(id, resolve)
      })
      if (onProgress !== undefined) {
        const forward = (event: MessageEvent<ExportAnswer>): void => {
          if (event.data.id === id && event.data.kind === 'progress') onProgress(event.data.progress)
        }
        target.addEventListener('message', forward as EventListener, { once: false })
        // One run's progress listener must not outlive the run.
        void promise.then(() => target.removeEventListener('message', forward as EventListener))
      }
      target.postMessage({ ...request, id })
      return promise
    },
    cancel() {
      // `broken` is left alone: a cancelled Worker is a stopped Worker, not a broken one.
      failAll({ kind: 'cancelled' })
    },
  }
}
