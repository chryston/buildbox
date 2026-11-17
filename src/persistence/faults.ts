/**
 * The fault-injecting decorator (#45): wrap any adapter in a plan and its writes start
 * failing on purpose.
 *
 * `session` (#48) has to show Save failed, keep the last good snapshot and offer an
 * emergency Backup when the browser refuses a write, and the only honest way to test that
 * is to make a real adapter refuse. The decorator never touches state: a matched call
 * resolves the typed failure and does not reach the wrapped adapter at all, which is the
 * strongest version of #14's rule — a quota, abort or serialisation failure preserves the
 * last successful snapshot.
 *
 * `abort` stands for a write that died part-way through a multi-record transaction. The
 * contract suite runs against the decorated adapter too, so an adapter that let half a
 * commit land would fail the suite rather than the fault injection.
 */
import type { PersistenceError, Ports, Result } from './ports'

/** The write methods a plan can fail. `set` covers both `prefs.set` and `meta.set`. */
export type FaultMethod =
  | 'commit'
  | 'put'
  | 'create'
  | 'trash'
  | 'restore'
  | 'purge'
  | 'markBackupInitiated'
  | 'set'

/** The failure to inject. `abort` surfaces as `{ kind: 'aborted' }`. */
export type FaultKind = 'abort' | 'quota' | 'serialization'

/**
 * One injected failure: fail the `nth` call (1-based, default the first) of `method` with
 * `fault`. A plan is an ordered list, and each rule fires at most once. Calls are counted
 * per method, so `set` counts `prefs.set` and `meta.set` together, and a rule matches a
 * method rather than its arguments.
 */
export interface FaultRule {
  method: FaultMethod
  nth?: number
  fault: FaultKind
}

/** Every write method, in the order the fault matrix runs them. */
export const FAULT_METHODS: readonly FaultMethod[] = [
  'commit',
  'put',
  'create',
  'trash',
  'restore',
  'purge',
  'markBackupInitiated',
  'set',
]

/** Every injectable failure. */
export const FAULT_KINDS: readonly FaultKind[] = ['abort', 'quota', 'serialization']

/** The port error a fault stands for. */
function faultError(fault: FaultKind): PersistenceError {
  switch (fault) {
    case 'abort':
      return { kind: 'aborted' }
    case 'quota':
      return { kind: 'quota' }
    case 'serialization':
      return { kind: 'serialization', path: '$.data' }
  }
}

/**
 * `adapter` with `plan` in front of it. Reads pass straight through; a write whose method
 * and call number match an unused rule resolves that rule's typed error instead of
 * running, leaving the wrapped adapter's state exactly as it was.
 */
export function withFaults(adapter: Ports, plan: readonly FaultRule[]): Ports {
  const calls = new Map<FaultMethod, number>()
  const fired = new Set<FaultRule>()

  function guard<T>(method: FaultMethod, run: () => Promise<Result<T, PersistenceError>>): Promise<Result<T, PersistenceError>> {
    const nth = (calls.get(method) ?? 0) + 1
    calls.set(method, nth)
    const rule = plan.find((entry) => !fired.has(entry) && entry.method === method && (entry.nth ?? 1) === nth)
    if (rule === undefined) return run()
    fired.add(rule)
    return Promise.resolve({ ok: false, error: faultError(rule.fault) })
  }

  return {
    projects: {
      list: (options) => adapter.projects.list(options),
      load: (id) => adapter.projects.load(id),
      commit: (input, expectedRevision) =>
        guard('commit', () => adapter.projects.commit(input, expectedRevision)),
      markBackupInitiated: (id, change) =>
        guard('markBackupInitiated', () => adapter.projects.markBackupInitiated(id, change)),
      trash: (id, at) => guard('trash', () => adapter.projects.trash(id, at)),
      restore: (id) => guard('restore', () => adapter.projects.restore(id)),
      purge: (id) => guard('purge', () => adapter.projects.purge(id)),
    },
    assets: {
      put: (bytes, mediaType, dims, storedAt) =>
        guard('put', () => adapter.assets.put(bytes, mediaType, dims, storedAt)),
      get: (sha256) => adapter.assets.get(sha256),
      has: (sha256) => adapter.assets.has(sha256),
      gc: (liveHashes, now) => adapter.assets.gc(liveHashes, now),
    },
    recovery: {
      create: (point) => guard('create', () => adapter.recovery.create(point)),
      list: (projectId) => adapter.recovery.list(projectId),
      load: (id) => adapter.recovery.load(id),
      prune: (projectId, clock) => adapter.recovery.prune(projectId, clock),
    },
    prefs: {
      get: (key) => adapter.prefs.get(key),
      set: (key, value) => guard('set', () => adapter.prefs.set(key, value)),
    },
    meta: {
      get: (key) => adapter.meta.get(key),
      set: (key, value) => guard('set', () => adapter.meta.set(key, value)),
    },
  }
}
