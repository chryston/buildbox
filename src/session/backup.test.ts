/**
 * Downloading a Project Backup (#50 criteria 15, 16, 28).
 *
 * The two things worth testing are the two a refactor can quietly reverse. The first is
 * *order*: the bytes must reach the browser before the Library record says a Backup was
 * offered, because that record is what silences the reminder and #14 will not silence a reminder
 * for a file that never left the tab. The second is *round-trip*: the `.buildbox` a user is
 * handed must stage back to the Project they have, byte for byte, or the Backup is a file that
 * happens to be the wrong shape.
 *
 * The encoder fake answers `null`, so the bytes asserted on are written by the real codec on the
 * main thread — the same fallback a browser without a Worker takes.
 */
import { describe, expect, it } from 'vitest'
import { createMemoryAdapter, withFaults } from '../persistence'
import type { LibraryRecord, Ports } from '../persistence'
import { canonicalJson } from '../lib'
import { stageImport } from '../package'
import type { Project } from '../domain'
import {
  BACKUP_EXTENSION,
  backupFileName,
  createLibraryStore,
  downloadBackup,
  encodeEmergencyBackup,
} from './index'
import type { BackupDeps, IdSource, LibraryStore } from './index'
import {
  createFakeDownload,
  createTestDeps,
  heldAsset,
  seedProject,
  testProject,
  TEST_NOW,
  TEST_VERSION,
  type FakeClock,
  type FakeDownload,
  type FakeEncoder,
} from './testing'
import { allocateIds } from '../package/testing'

const KITCHEN = 'kitchen-1'

/** The Backup flow's whole world: one store, one clock, one Library, one download port. */
interface BackupWorld {
  backup: BackupDeps
  library: LibraryStore
  download: FakeDownload
  encoder: FakeEncoder
  clock: FakeClock
  ids: IdSource
}

function backupWorld(ports: Ports, options?: { preview?: boolean; download?: FakeDownload }): BackupWorld {
  const test = createTestDeps(ports)
  const backup: BackupDeps = {
    clock: test.clock,
    encoder: test.encoder,
    buildboxVersion: TEST_VERSION,
    preview: options?.preview ?? false,
  }
  return {
    backup,
    library: createLibraryStore({ ports, clock: test.clock, ids: test.ids, registry: test.registry }),
    download: options?.download ?? createFakeDownload(),
    encoder: test.encoder,
    clock: test.clock,
    ids: test.ids,
  }
}

/** A Project whose one Floor carries a Plan Image, and the asset behind it. */
async function projectWithPlanImage(id: string, name = 'Kitchen'): Promise<{ project: Project; asset: Awaited<ReturnType<typeof heldAsset>> }> {
  const project = testProject(id, name)
  const asset = await heldAsset(7)
  project.floors[0]!.planImage = {
    assetHash: asset.sha256,
    mediaType: 'image/png',
    widthPx: asset.widthPx ?? 0,
    heightPx: asset.heightPx ?? 0,
    pixelsPerMm: 0.25,
  }
  return { project, asset }
}

/** Write the Project *and* hold its Plan Image, which is what a real edited Project looks like. */
async function seedWithAsset(ports: Ports, project: Project, asset: Awaited<ReturnType<typeof heldAsset>>): Promise<void> {
  const committed = await ports.projects.commit(
    {
      project,
      revision: 1,
      savedAt: TEST_NOW,
      newAssets: [
        { bytes: asset.bytes, mediaType: asset.mediaType, widthPx: asset.widthPx, heightPx: asset.heightPx },
      ],
    },
    null,
  )
  if (!committed.ok) throw new Error(`seedWithAsset: ${committed.error.kind}`)
}

describe('the Backup file name', () => {
  it('is the Project name and the extension', () => {
    expect(backupFileName('Tiong Bahru Home')).toBe(`Tiong Bahru Home${BACKUP_EXTENSION}`)
  })

  it('replaces what a filesystem will not store', () => {
    expect(backupFileName('A/B: C?*D')).toBe('A B C D.buildbox')
    expect(backupFileName('  Trailing dots...  ')).toBe('Trailing dots.buildbox')
    expect(backupFileName('///')).toBe('BuildBox Project.buildbox')
    expect(backupFileName('')).toBe('BuildBox Project.buildbox')
  })
})

describe('downloading a Backup', () => {
  it('hands over the bytes before it says a Backup was initiated (#50 criterion 16)', async () => {
    const base = createMemoryAdapter()
    const { project, asset } = await projectWithPlanImage(KITCHEN)
    await seedWithAsset(base, project, asset)

    const over = backupWorld(base)
    await over.library.refresh()

    // The Library record at the instant the file is handed over: still silent, because the
    // promise is only made once the bytes are gone.
    const atHandover: (LibraryRecord | undefined)[] = []
    const watch = over.download
    const start = watch.start
    watch.start = (fileName, bytes) => {
      atHandover.push(over.library.getSnapshot().projects.find((row) => row.id === KITCHEN))
      start(fileName, bytes)
    }

    const written = await downloadBackup({ ...over.backup, ports: base, download: watch, library: over.library }, KITCHEN)
    expect(written.ok).toBe(true)
    if (!written.ok) return

    expect(atHandover).toHaveLength(1)
    expect(atHandover[0]?.lastBackupInitiatedAt).toBeNull()
    expect(atHandover[0]?.lastBackupRevision).toBeNull()

    expect(written.value.fileName).toBe(`Kitchen${BACKUP_EXTENSION}`)
    expect(written.value.byteLength).toBe(watch.files[0]!.bytes.byteLength)
    expect(written.value.record.lastBackupInitiatedAt).toBe(TEST_NOW)
    expect(written.value.record.lastBackupRevision).toBe(1)
  })

  it('writes a Backup whose staged import is the stored Project (#50 criterion 16)', async () => {
    const base = createMemoryAdapter()
    const { project, asset } = await projectWithPlanImage(KITCHEN)
    await seedWithAsset(base, project, asset)
    const over = backupWorld(base)
    await over.library.refresh()

    const written = await downloadBackup({ ...over.backup, ports: base, download: over.download, library: over.library }, KITCHEN)
    expect(written.ok).toBe(true)
    if (!written.ok) return

    const staged = await stageImport(over.download.files[0]!.bytes, { acceptPreview: false, allocateId: allocateIds() })
    expect(staged.ok).toBe(true)
    if (!staged.ok) return
    expect(canonicalJson(staged.staged.project)).toBe(canonicalJson(project))
    expect([...staged.staged.assets.keys()]).toEqual([asset.sha256])
  })

  it('marks a flag-on Backup preview, which a released build refuses (#50 criterion 28)', async () => {
    const base = createMemoryAdapter()
    const { project, asset } = await projectWithPlanImage(KITCHEN)
    await seedWithAsset(base, project, asset)
    const over = backupWorld(base, { preview: true })
    await over.library.refresh()

    const written = await downloadBackup({ ...over.backup, ports: base, download: over.download, library: over.library }, KITCHEN)
    expect(written.ok).toBe(true)
    if (!written.ok) return

    expect(over.encoder.calls[0]!.meta.preview).toBe(true)
    expect(over.encoder.calls[0]!.meta.buildboxVersion).toBe(TEST_VERSION)
    expect(over.encoder.calls[0]!.assetCount).toBe(1)

    // The same bytes in a production build: refused, and named as a preview package.
    const refused = await stageImport(over.download.files[0]!.bytes, { acceptPreview: false, allocateId: allocateIds() })
    expect(refused.ok).toBe(false)
    if (refused.ok) return
    expect(refused.problem.code).toBe('preview-package')
  })

  it('refuses rather than write an archive that would fail its own manifest', async () => {
    const base = createMemoryAdapter()
    const { project } = await projectWithPlanImage(KITCHEN)
    // The Project references a hash the store has never held.
    await seedProject(base, project)
    const over = backupWorld(base)
    await over.library.refresh()

    const written = await downloadBackup({ ...over.backup, ports: base, download: over.download, library: over.library }, KITCHEN)
    expect(written).toEqual({ ok: false, error: 'missing-asset' })
    expect(over.download.files).toEqual([])
    expect(over.library.getSnapshot().projects[0]!.lastBackupInitiatedAt).toBeNull()
  })

  it('leaves the Library silent when the store refuses the write', async () => {
    const base = createMemoryAdapter()
    const { project, asset } = await projectWithPlanImage(KITCHEN)
    await seedWithAsset(base, project, asset)
    // `markBackupInitiated` is the only write this flow makes, so it is the only one worth
    // faulting: the file has already left the tab and the reminder must not go quiet.
    const ports = withFaults(base, [{ method: 'markBackupInitiated', fault: 'quota' }])
    const over = backupWorld(ports)
    await over.library.refresh()

    const written = await downloadBackup({ ...over.backup, ports, download: over.download, library: over.library }, KITCHEN)
    expect(written.ok).toBe(false)
    if (written.ok) return
    expect(written.error).toMatchObject({ kind: 'quota' })
    expect(over.library.getSnapshot().projects[0]!.lastBackupInitiatedAt).toBeNull()
  })
})

describe('the emergency Backup of an unsaved session', () => {
  it('encodes the bytes the session is holding, not the ones on disk', async () => {
    const base = createMemoryAdapter()
    const { project, asset } = await projectWithPlanImage(KITCHEN)
    await seedWithAsset(base, project, asset)
    const over = backupWorld(base)

    const stored = await base.projects.load(KITCHEN)
    if (!stored.ok) throw new Error('seed failed')
    // The session picked a different Plan Image and has not saved yet, so the store has never
    // seen these bytes. A Backup of the emergency source has to carry them from the session.
    const held = await heldAsset(11)
    const unsaved: Project = {
      ...stored.value.data,
      floors: [
        {
          ...stored.value.data.floors[0]!,
          name: 'Ground',
          planImage: {
            assetHash: held.sha256,
            mediaType: 'image/png',
            widthPx: held.widthPx ?? 0,
            heightPx: held.heightPx ?? 0,
            pixelsPerMm: 0.25,
          },
        },
      ],
    }

    const encoded = await encodeEmergencyBackup(
      { ...over.backup, ports: base },
      { project: unsaved, heldAssets: new Map([[held.sha256, held]]) },
    )
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return

    const staged = await stageImport(encoded.value, { acceptPreview: false, allocateId: allocateIds() })
    expect(staged.ok).toBe(true)
    if (!staged.ok) return
    expect(staged.staged.project.floors[0]!.name).toBe('Ground')
    expect([...staged.staged.assets.keys()]).toEqual([held.sha256])
    expect(staged.staged.assets.get(held.sha256)!.bytes.byteLength).toBe(held.bytes.size)
  })
})
