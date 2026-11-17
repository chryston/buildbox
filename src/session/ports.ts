/**
 * The two ports `session` needs from the browser, and the ID allocator it needs from its
 * caller (#48, #20 §2, #42 §3).
 *
 * `session` is a pure module: it never reads a clock, never sets a real timer, never takes
 * a browser lock and never mints an ID. Everything browser-specific arrives here as a port
 * and is implemented in `platform` — #51 binds `ClockPort` to `Date`/`setTimeout` and
 * `LockPort` to Web Locks named `buildbox:project:<id>`. Tests bind both to the fakes in
 * `src/session/testing.ts`, which is why the idle Recovery Point schedule, the read-only
 * mode and the 7-day backup rule are all testable under Node with no timers running.
 */

/** The clock and the timer: time arrives as data, and a test can advance it by hand. */
export interface ClockPort {
  /** The current instant as an ISO 8601 string — the shape every stored timestamp uses. */
  now(): string
  /** The calendar day an ISO instant falls on, in the app's time zone; `recovery.prune` groups by it (#45). */
  dayKey(iso: string): string
  /** Run `fn` once after `ms`. Returns the cancel, which must be safe to call twice. */
  setTimer(ms: number, fn: () => void): () => void
}

/** What a held lock leaves behind: the one call that gives it up. */
export interface LockHandle {
  release(): void
}

/**
 * One-writer-per-Project (#20 §5). `acquire` is `ifAvailable`: it resolves `null` when
 * another tab holds the Project, which is what opens the session read-only. `waitFor`
 * resolves the moment the current holder releases, so a read-only session can take over
 * without polling.
 */
export interface LockPort {
  acquire(projectId: string): Promise<LockHandle | null>
  waitFor(projectId: string): Promise<LockHandle>
}

/**
 * The caller's ID allocator: `ids(2)` is the next two IDs, in order (#42 §3). The UI passes
 * something backed by `crypto.randomUUID()`; a test passes `edit`'s counter so a failure
 * names the ID it could not find.
 */
export type IdSource = (count?: number) => string[]
