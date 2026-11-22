/**
 * The second entry point of `session`, for test files only (#42 §7).
 *
 * Everything the suites need to drive a session under Node with no browser: a clock the
 * test advances by hand, a lock the test holds on another tab's behalf, an adapter whose
 * commits stop at a gate the test opens, and a Project already in the store to open.
 *
 * The fake clock is the important one. #26's idle Recovery Point is "two minutes after the
 * last dispatch", which no test may wait for, and #14's backup reminder is "seven days
 * after the last one" — both are only worth asserting if time is data the test owns.
 */
import { createProject } from '../edit'
import type { CommitInput, FaultRule, Ports, RecoveryPointMeta } from '../persistence'
import type { CabinetItemDesign, Project } from '../domain'
import { sha256Hex } from '../lib'
import type { SessionDeps } from './projectSession'
import { createSessionRegistry } from './registry'
import type { BackupDeps } from './backup'
import type { BackupAsset, BackupEncoderPort, BackupMeta, DownloadPort, IdSource, ImageDecoderPort, LockHandle, LockPort } from './ports'
import type { SessionAsset, SessionRegistry } from './types'

/** The instant every fixture starts its clock at, so a stored `savedAt` is predictable. */
export const TEST_NOW = '2026-01-01T00:00:00.000Z'

/**
 * The `buildboxVersion` a test writes into a Backup manifest (#50).
 *
 * It is a constant rather than the app's real version because a test that round-trips a Backup
 * through `package` must know what the manifest will say, and the released version changes.
 */
export const TEST_VERSION = '0.0.0-test'

/**
 * A fault plan that keeps failing: `withFaults` fires each rule at most once, so a rule per
 * call is how a test makes a fault stick across writes (#45).
 */
export function quotaTimes(count: number): FaultRule[] {
  return Array.from({ length: count }, (_, index) => ({ method: 'commit', nth: index + 1, fault: 'quota' }))
}

/** Let every promise the current turn queued run to completion. */
export async function flush(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

/** The clock a test drives: `advance(120_000)` is two minutes of user silence. */
export interface FakeClock {
  now(): string
  dayKey(iso: string): string
  setTimer(ms: number, fn: () => void): () => void
  /** Move time forward, firing each timer that comes due, and let its work finish. */
  advance(ms: number): Promise<void>
  /** Timers still waiting, for a test that wants to prove nothing was armed. */
  pending(): number
}

interface FakeTimer {
  at: number
  fn: () => void
  cancelled: boolean
}

export function createFakeClock(start = TEST_NOW): FakeClock {
  let current = Date.parse(start)
  const timers: FakeTimer[] = []

  return {
    now: () => new Date(current).toISOString(),
    dayKey: (iso) => iso.slice(0, 10),
    setTimer(ms, fn) {
      const timer: FakeTimer = { at: current + ms, fn, cancelled: false }
      timers.push(timer)
      return () => {
        timer.cancelled = true
      }
    },
    async advance(ms) {
      const target = current + ms
      for (;;) {
        const due = timers
          .filter((timer) => !timer.cancelled && timer.at <= target)
          .sort((left, right) => left.at - right.at)[0]
        if (due === undefined) break
        due.cancelled = true
        current = due.at
        due.fn()
        // A timer's work is asynchronous — the idle Recovery Point awaits two port calls —
        // so each one gets the turn to finish before the next fires.
        await flush()
      }
      for (let index = timers.length - 1; index >= 0; index -= 1) {
        if (timers[index]?.cancelled === true) timers.splice(index, 1)
      }
      current = target
      await flush()
    },
    pending: () => timers.filter((timer) => !timer.cancelled).length,
  }
}

/** The lock a test can hold from "another tab". */
export interface FakeLock extends LockPort {
  /** Take a Project as if another tab had it open; the result gives it back. */
  hold(projectId: string): () => void
  held(): string[]
}

export function createFakeLock(): FakeLock {
  const held = new Set<string>()
  const waiting = new Map<string, Array<(handle: LockHandle) => void>>()

  function take(projectId: string): LockHandle {
    held.add(projectId)
    return {
      release: () => {
        held.delete(projectId)
        const next = waiting.get(projectId)?.shift()
        if (next !== undefined) next(take(projectId))
      },
    }
  }

  return {
    async acquire(projectId) {
      if (held.has(projectId)) return null
      return take(projectId)
    },
    async waitFor(projectId) {
      if (!held.has(projectId)) return take(projectId)
      return new Promise((resolve) => {
        const queue = waiting.get(projectId) ?? []
        queue.push(resolve)
        waiting.set(projectId, queue)
      })
    },
    hold(projectId) {
      held.add(projectId)
      return () => {
        held.delete(projectId)
        const next = waiting.get(projectId)?.shift()
        if (next !== undefined) next(take(projectId))
      }
    },
    held: () => [...held],
  }
}

/** `ids(2)` is the next two IDs, in order, each naming the prefix that issued it (#42 §3). */
export function idSource(prefix: string): IdSource {
  let issued = 0
  return (count = 1) => Array.from({ length: count }, () => `${prefix}-${++issued}`)
}

/** The ports, clock, lock, IDs and registry one test needs, with a fresh in-memory store. */
export interface TestDeps {
  deps: SessionDeps
  ports: Ports
  clock: FakeClock
  lock: FakeLock
  registry: SessionRegistry
  ids: IdSource
  encoder: FakeEncoder
  download: FakeDownload
}

export function createTestDeps(ports: Ports, options?: { now?: string; prefix?: string }): TestDeps {
  const clock = createFakeClock(options?.now)
  const lock = createFakeLock()
  const ids = idSource(options?.prefix ?? 'session')
  const registry = createSessionRegistry()
  const encoder = createFakeEncoder()
  const download = createFakeDownload()
  const backup: BackupDeps = { clock, encoder, ids, buildboxVersion: TEST_VERSION, preview: false }
  return { deps: { ports, clock, lock, ids, registry, backup }, ports, clock, lock, registry, ids, encoder, download }
}

/** What a test saw the Backup encoder asked for. */
export interface EncoderCall {
  projectId: string
  assetCount: number
  meta: BackupMeta
}

/**
 * A `BackupEncoderPort` with no Worker behind it, which is what a Node test really has.
 *
 * It answers `null` — the host's word for "no Worker here" — so `encodeBackup` takes its
 * main-thread fallback and the bytes a test asserts on are a real `.buildbox` written by the
 * real codec. Faking the Worker's output instead would test the fake.
 */
export interface FakeEncoder extends BackupEncoderPort {
  calls: EncoderCall[]
}

export function createFakeEncoder(): FakeEncoder {
  const encoder: FakeEncoder = {
    calls: [],
    async encode(project: Project, assets: readonly BackupAsset[], meta: BackupMeta) {
      encoder.calls.push({ projectId: project.id, assetCount: assets.length, meta })
      return null
    },
  }
  return encoder
}

/** One download a test saw: the name the browser was given and how much it was given. */
export interface DownloadedFile {
  fileName: string
  bytes: Uint8Array
}

/**
 * A `DownloadPort` that keeps the bytes instead of handing them to a browser.
 *
 * The point is the *order*: a test can assert the file is here before the Library record says a
 * Backup was offered, which is the promise #14 makes and the one a refactor is most likely to
 * quietly reverse.
 */
export interface FakeDownload extends DownloadPort {
  files: DownloadedFile[]
}

export function createFakeDownload(): FakeDownload {
  const download: FakeDownload = {
    files: [] as DownloadedFile[],
    start(fileName, bytes) {
      download.files.push({ fileName, bytes })
    },
  }
  return download
}

/** What the fake image decoder answers, and what it was asked about. */
export interface FakeImages extends ImageDecoderPort {
  asked: { mediaType: string; byteLength: number }[]
  /** Swap the answer mid-test: `() => null` is an asset that will not decode. */
  answer: (bytes: Uint8Array, mediaType: string) => { widthPx: number; heightPx: number } | null
}

/**
 * An `ImageDecoderPort` that reports fixed dimensions for every media type it is handed.
 *
 * The dimensions are a *claim*, not a copy of the record under test: step 7 compares a Plan
 * Image's record against what the decoder says, so a record that disagrees with this fake is
 * refused exactly as a truncated JPEG would be. `answer` is reassignable so one test can make a
 * single asset fail.
 */
export function createFakeImages(dims: { widthPx: number; heightPx: number } = { widthPx: 1000, heightPx: 700 }): FakeImages {
  const images: FakeImages = {
    asked: [] as { mediaType: string; byteLength: number }[],
    answer: () => dims,
    async decode(bytes, mediaType) {
      images.asked.push({ mediaType, byteLength: bytes.byteLength })
      return images.answer(bytes, mediaType)
    },
  }
  return images
}

/** One recorded commit: what the writer asked the store to write, and against which revision. */
export interface CommitCall {
  input: CommitInput
  expectedRevision: number | null
}

/**
 * `ports` with every commit stopped at a gate, so a test can watch the single-flight writer
 * from the outside: how many commits it started, what the newest one carried, and whether a
 * rejected Intent started none at all (#20 §13.8, §13.9).
 */
export interface GatedPorts {
  ports: Ports
  calls: CommitCall[]
  /** A commit is parked at the gate right now. */
  waiting(): boolean
  /** Open the gate for everything parked, and let those writes reach the store. */
  release(): Promise<void>
  /** Stop gating: later commits go straight through. */
  openGate(): void
}

export function gateCommits(ports: Ports): GatedPorts {
  const calls: CommitCall[] = []
  let parked: Array<() => void> = []
  let open = false

  const gated: Ports = {
    ...ports,
    projects: {
      ...ports.projects,
      async commit(input, expectedRevision) {
        calls.push({ input, expectedRevision })
        if (!open) await new Promise<void>((resolve) => parked.push(resolve))
        return ports.projects.commit(input, expectedRevision)
      },
    },
  }

  return {
    ports: gated,
    calls,
    waiting: () => parked.length > 0,
    async release() {
      const ready = parked
      parked = []
      for (const resolve of ready) resolve()
      await flush()
    },
    openGate() {
      open = true
    },
  }
}

/**
 * A New Project with the IDs `edit.createProject` spends, named by the test, so two
 * Projects in one suite have IDs the assertions can read (#42 §3). The last three are the
 * Drawing Layers a flagged build writes (#71 §1); a flag-off build spends six and ignores them.
 */
export function testProject(id: string, name = 'Kitchen'): Project {
  return createProject({
    ids: [
      id,
      `${id}-floor`,
      `${id}-view`,
      `${id}-design`,
      `${id}-place`,
      `${id}-root`,
      `${id}-layer-structure`,
      `${id}-layer-services`,
      `${id}-layer-furniture`,
    ],
    now: TEST_NOW,
    name,
  })
}

/**
 * The one cabinet of a test Project, narrowed out of the design list every Project carries,
 * so a test can name `construction.root` without re-checking the discriminant each time.
 */
export function testCabinet(project: Project): CabinetItemDesign {
  const design = project.itemDesigns.find((each) => each.kind === 'cabinet')
  if (design === undefined || design.kind !== 'cabinet') throw new Error('this Project holds no cabinet')
  return design
}

/** Write a Project into the store so there is something to open. */
export async function seedProject(
  ports: Ports,
  project: Project,
  options?: { revision?: number; savedAt?: string },
): Promise<void> {
  const committed = await ports.projects.commit(
    { project, revision: options?.revision ?? 1, savedAt: options?.savedAt ?? TEST_NOW },
    null,
  )
  if (!committed.ok) throw new Error(`seedProject: ${committed.error.kind}`)
}

/** Deterministic image bytes and the hash they are stored under (#44's content address). */
export async function heldAsset(seed: number): Promise<SessionAsset> {
  const bytes = new Uint8Array(64)
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = (seed * 37 + index * 11) % 256
  const blob = new Blob([bytes])
  return {
    sha256: await sha256Hex(bytes),
    bytes: blob,
    mediaType: 'image/png',
    widthPx: 640,
    heightPx: 480,
  }
}

/** `ports` with every `recovery.prune` recorded, so a test can prove the schedule ran (#26). */
export function countPrunes(ports: Ports): { ports: Ports; prunes: string[] } {
  const prunes: string[] = []
  const counted: Ports = {
    ...ports,
    recovery: {
      ...ports.recovery,
      async prune(projectId, clock) {
        prunes.push(projectId)
        return ports.recovery.prune(projectId, clock)
      },
    },
  }
  return { ports: counted, prunes }
}

/** Every Recovery Point of one kind, newest first. */
export async function pointsOfKind(
  ports: Ports,
  projectId: string,
  kind: RecoveryPointMeta['kind'],
): Promise<RecoveryPointMeta[]> {
  const listed = await ports.recovery.list(projectId)
  if (!listed.ok) throw new Error(`recovery.list: ${listed.error.kind}`)
  return listed.value.filter((point) => point.kind === kind)
}
