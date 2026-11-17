/**
 * The live hash set a garbage collection is given (#46, #20 §7): every asset hash still
 * referenced by a saved Project or a Recovery Point.
 *
 * An asset is live if *anything* points at it, which is why a trashed Project keeps its
 * images and why a Recovery Point keeps them even after the Project is gone for good. The
 * set is a `Set`, so a hash two Projects share is one entry, and the sweep that consumes it
 * never deletes a byte twice.
 *
 * This is the generic walk: it asks the five ports and nothing else, so it works against
 * any adapter. It can only reach the Recovery Points of Projects it is able to list, so an
 * adapter that can scan a whole store is invited to offer its own `collectLiveHashes` — the
 * IndexedDB adapter does exactly that, off cursors, one record in memory at a time (#46).
 */
import { referencedAssetHashes } from '../domain'
import type { LiveHashes, PersistenceError, Ports, Result } from './ports'

export async function collectLiveHashes(ports: Ports): Promise<Result<LiveHashes, PersistenceError>> {
  if (ports.collectLiveHashes !== undefined) return ports.collectLiveHashes()

  // Trashed Projects count: trash is reversible, so their images are not garbage yet.
  const listed = await ports.projects.list({ includeTrashed: true })
  if (!listed.ok) return listed

  const hashes = new Set<string>()
  for (const record of listed.value) {
    const project = await ports.projects.load(record.id)
    if (!project.ok) return project
    for (const hash of referencedAssetHashes(project.value.data)) hashes.add(hash)

    const points = await ports.recovery.list(record.id)
    if (!points.ok) return points
    for (const meta of points.value) {
      const point = await ports.recovery.load(meta.id)
      if (!point.ok) return point
      for (const hash of referencedAssetHashes(point.value.data)) hashes.add(hash)
    }
  }
  return { ok: true, value: hashes }
}
