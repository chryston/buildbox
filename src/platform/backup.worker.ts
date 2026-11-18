/**
 * The Backup codec, off the main thread (#50, #20 Q9).
 *
 * This is the Worker entry of a pair: `./backupEncoder.ts` is its host and lives on the main
 * thread. The entry imports `package` and nothing else — no DOM, no ports, no `persistence` —
 * which is what makes it safe to run in a thread that has none of those. A Backup is a Project
 * plus the bytes it references, both handed in, and the answer is bytes back.
 *
 * The request and the answer are declared here rather than imported from the host so that this
 * file stays the only place the wire format is written down; the host reads these types, not
 * the other way round.
 */
import { encodeProject } from '../package'
import type { Project } from '../domain'

/** One asset as it crosses into the Worker: its hash, its bytes, and what it claims to be. */
export interface WorkerBackupAsset {
  readonly sha256: string
  readonly bytes: Uint8Array
  readonly mediaType: string
}

/** One encode request. `id` is echoed back so concurrent requests cannot be mixed up. */
export interface BackupRequest {
  readonly id: number
  readonly project: Project
  readonly assets: readonly WorkerBackupAsset[]
  readonly meta: { exportedAt: string; buildboxVersion: string; preview: boolean }
}

/** The answer: the archive, or the fact that the codec refused to write one. */
export type BackupAnswer = { id: number; ok: true; bytes: Uint8Array } | { id: number; ok: false }

interface WorkerScope {
  onmessage: ((event: MessageEvent<BackupRequest>) => void) | null
  postMessage(message: BackupAnswer): void
}

const scope = self as unknown as WorkerScope

scope.onmessage = (event) => {
  const { id, project, assets, meta } = event.data
  const byHash = new Map(assets.map((asset) => [asset.sha256, asset]))
  // `encodeProject` never throws for a well-formed Project, but a Backup nobody can open is a
  // worse outcome than a download that did not start, so a throw is answered the same way an
  // invalid Project would be and the host falls back to the main thread.
  void encodeProject(
    project,
    async (sha256) => {
      const asset = byHash.get(sha256)
      if (asset === undefined) throw new Error(`no bytes for referenced asset ${sha256}`)
      return { bytes: asset.bytes, mediaType: asset.mediaType }
    },
    meta,
  )
    .then((bytes) => scope.postMessage({ id, ok: true, bytes }))
    .catch(() => scope.postMessage({ id, ok: false }))
}
