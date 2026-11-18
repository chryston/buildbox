/**
 * The Project Backup flow (#50, #14, #20 Q9).
 *
 * Three steps, in this order and no other (#50 §3): encode the Project as a `.buildbox`, hand
 * the bytes to the browser's download, and only then record that the download was *initiated*.
 * The order is the whole point of #14's wording — BuildBox cannot see where a download lands,
 * so it never says a Backup was made and never writes the record before the bytes have left.
 *
 * Encoding runs in a module Worker where the browser allows one (#20 Q9), through the
 * `BackupEncoderPort` whose host lives in `platform`. `platform` may not import `package` and
 * `session` may, so the port answers `null` for "no Worker here" and the main-thread fallback
 * is the call a few lines below — which is also what every Node test exercises.
 *
 * Nothing here touches the DOM, a clock or a random source directly (#42 §3): the clock, the
 * encoder, the download and the Library store all arrive as data, so the whole flow runs under
 * Node against the fakes in `./testing`.
 */
import { DOMAIN_SCHEMA_VERSION, migrateProject, referencedAssetHashes, type Project } from '../domain'
import type { LibraryRecord, Ports, Result } from '../persistence'
import { encodeProject } from '../package'
import type { BackupAsset, BackupEncoderPort, BackupMeta, ClockPort, DownloadPort, IdSource } from './ports'
import { err, ok } from './result'
import type { EmergencySource, LibraryStore, SessionError, BackupFailure } from './types'

/** The extension a Project Backup is written with (#19). Never `.zip` in the UI. */
export const BACKUP_EXTENSION = '.buildbox'

/** The name a Backup is downloaded as (#50 §3): the Project name, then the extension. */
export function backupFileName(name: string): string {
  // A file name is the one place a Project name meets a filesystem. Everything the browser
  // will not store — separators, reserved characters, control codes — becomes a space, and a
  // name that was nothing but those still gets a file rather than an empty one.
  const safe = name
    .replace(/[\p{Cc}<>:"/\\|?*]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/[. ]+$/u, '')
  return `${safe === '' ? 'BuildBox Project' : safe}${BACKUP_EXTENSION}`
}

/** Everything the Backup flow needs from outside: the clock, the encoder and the build's word. */
export interface BackupDeps {
  clock: ClockPort
  encoder: BackupEncoderPort
  /** IDs for whatever the migration of an older stored record has to mint (#56). */
  ids: IdSource
  /** Written to the manifest. It is a build constant, never read from the environment (#42 §3). */
  buildboxVersion: string
  /** `true` writes `preview: true`, which production imports refuse (#20 §11). */
  preview: boolean
}

/** One Backup that left the tab, and the Library record the reminder was cleared against. */
export interface BackupWritten {
  fileName: string
  byteLength: number
  record: LibraryRecord
}

function metaFor(deps: BackupDeps): BackupMeta {
  return { exportedAt: deps.clock.now(), buildboxVersion: deps.buildboxVersion, preview: deps.preview }
}

/**
 * Encode `project` with the Worker when there is one and on this thread when there is not.
 *
 * `read` is asked once per distinct hash the Project references. It returns `null` for a hash
 * with no bytes, which stops the Backup rather than writing an archive that would fail its own
 * manifest — a Project referencing a missing asset is a storage fault, and the honest answer is
 * that no Backup can be written.
 */
export async function encodeBackup(
  deps: BackupDeps,
  project: Project,
  read: (sha256: string) => Promise<BackupAsset | null>,
): Promise<Result<Uint8Array, BackupFailure>> {
  const hashes = referencedAssetHashes(project)
  const assets: BackupAsset[] = []
  for (const sha256 of hashes) {
    const asset = await read(sha256)
    if (asset === null) return err('missing-asset')
    assets.push(asset)
  }

  const meta = metaFor(deps)
  const encoded = await deps.encoder.encode(project, assets, meta)
  if (encoded !== null) return ok(encoded)

  // Q9's fallback: no Worker, so the same codec runs here. `encodeProject` throws only for a
  // Project it cannot hash, and the caller has already validated the one it passed.
  const byHash = new Map(assets.map((asset) => [asset.sha256, asset]))
  try {
    const bytes = await encodeProject(project, async (sha256) => {
      const asset = byHash.get(sha256)
      if (asset === undefined) throw new Error(`no bytes for referenced asset ${sha256}`)
      return { bytes: asset.bytes, mediaType: asset.mediaType }
    }, meta)
    return ok(bytes)
  } catch {
    return err('encode-failed')
  }
}

/** The bytes behind one stored asset, or `null` when the store has lost it. */
async function readStored(ports: Ports, sha256: string): Promise<BackupAsset | null> {
  const found = await ports.assets.get(sha256)
  if (!found.ok) return null
  return { sha256, bytes: new Uint8Array(await found.value.blob.arrayBuffer()), mediaType: found.value.mediaType }
}

/**
 * Download a Backup of the *stored* state of one Project (#50 §3).
 *
 * The stored state and not the in-memory one because the Library offers a Backup for the
 * revision the record carries, and `markBackupInitiated` records that same revision. An open
 * session's unsaved edits are #51's Save failed dialog's business, and it goes through
 * `encodeEmergencyBackup` instead.
 */
export async function downloadBackup(
  deps: BackupDeps & { ports: Ports; download: DownloadPort; library: LibraryStore },
  id: string,
): Promise<Result<BackupWritten, SessionError | BackupFailure>> {
  const loaded = await deps.ports.projects.load(id)
  if (!loaded.ok) return loaded

  // A Backup is always written at the version the codec writes, so a stored record of an older
  // domain version is migrated first — the same step `openRecord` takes when the Project is
  // opened. Writing the stored bytes under the current version's name would hand back a file
  // whose own manifest and record disagree, and the strict reader would refuse its own Backup.
  const stored = loaded.value
  if (stored.schemaVersion !== DOMAIN_SCHEMA_VERSION) {
    const migrated = migrateProject(stored.data, stored.schemaVersion, deps.ids)
    if (!migrated.ok) return err('encode-failed')
    return sendBackup(deps, id, migrated.project)
  }
  return sendBackup(deps, id, stored.data)
}

/** The three steps of #50 §3, in that order: bytes, download, then the record. */
async function sendBackup(
  deps: BackupDeps & { ports: Ports; download: DownloadPort; library: LibraryStore },
  id: string,
  data: Project,
): Promise<Result<BackupWritten, SessionError | BackupFailure>> {
  const encoded = await encodeBackup(deps, data, (sha256) => readStored(deps.ports, sha256))
  if (!encoded.ok) return encoded

  const fileName = backupFileName(data.meta.name)
  deps.download.start(fileName, encoded.value)

  // Only now (#14): the bytes have left the tab. Whether the browser kept them is not
  // something BuildBox can see, and the copy says so.
  const marked = await deps.library.markBackupInitiated(id)
  if (!marked.ok) return marked

  return ok({ fileName, byteLength: encoded.value.length, record: marked.value })
}

/**
 * Encode the in-memory Project of a blocked session as a Backup (#50, #48's `emergencySource`).
 *
 * #51 wires this to the Save failed dialog: the guard is up because storage refused the write,
 * and the one way to lift it honestly is to hand the user the bytes no commit took. The assets
 * come from two places — the session's held map for the bytes no commit has carried, the asset
 * store for everything older — because the in-memory Project references both.
 *
 * It records nothing. There is no Library write here: the Project may not even be in the
 * Library at the revision being downloaded, and claiming a Backup of it would be the exact
 * overstatement #14 exists to prevent.
 */
export async function encodeEmergencyBackup(
  deps: BackupDeps & { ports: Ports },
  source: EmergencySource,
): Promise<Result<Uint8Array, BackupFailure>> {
  return encodeBackup(deps, source.project, async (sha256) => {
    const held = source.heldAssets.get(sha256)
    if (held !== undefined) {
      return { sha256, bytes: new Uint8Array(await held.bytes.arrayBuffer()), mediaType: held.mediaType }
    }
    return readStored(deps.ports, sha256)
  })
}
