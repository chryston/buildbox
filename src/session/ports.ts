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

import type { Project } from '../domain'

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

/**
 * One asset's bytes beside the media type its record claims (#50). The pair travels together
 * because a Backup's `project.json` is the only thing that says what a blob is, and step 7 of a
 * restore has to compare what the decoder actually saw against that claim.
 */
export interface BackupAsset {
  sha256: string
  bytes: Uint8Array
  mediaType: string
}

/** The three manifest fields a Backup is written with (#44). */
export interface BackupMeta {
  exportedAt: string
  buildboxVersion: string
  preview: boolean
}

/**
 * Encodes a Project as a `.buildbox` Backup (#50, #20 Q9).
 *
 * The host lives in `platform` and runs the codec in a module Worker; `null` is its answer for
 * "no Worker here" — a browser that will not construct one, a Worker that died, or a host with
 * no Worker at all, which is what a Node test is. The caller then encodes on the main thread
 * itself: `session` may import `package` and `platform` may not, so the fallback belongs on
 * this side of the seam rather than inside the host.
 *
 * The assets arrive as bytes because a Worker has no access to the `persistence` ports holding
 * them; reading them is the caller's job and transferring them is cheap.
 */
export interface BackupEncoderPort {
  encode(project: Project, assets: readonly BackupAsset[], meta: BackupMeta): Promise<Uint8Array | null>
}

/**
 * Hands finished Backup bytes to the browser as a download (#50 §3).
 *
 * There is no File System Access picker: #20 §10 puts it out of scope, and a download is the
 * one thing here that needs no permission to be honest about. The port returns as soon as the
 * browser has the bytes, which is exactly the moment BuildBox is allowed to record.
 */
export interface DownloadPort {
  start(fileName: string, bytes: Uint8Array): void
}

/**
 * Decodes one image and reports what came out (#50 §4 step 7, #20 §6).
 *
 * `null` is the honest answer for bytes no decoder will accept — a truncated JPEG, a media type
 * the host does not know. It is a value rather than a thrown error because a Backup carrying
 * one is a *refusal* the user can read, not a crash.
 */
export interface ImageDecoderPort {
  decode(bytes: Uint8Array, mediaType: string): Promise<{ widthPx: number; heightPx: number } | null>
}
