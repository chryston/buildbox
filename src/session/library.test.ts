/**
 * The Library store (#48 criteria 12, and the Library half of 7): the list of Projects, the
 * Trash, and #14's backup-due rule.
 *
 * The rule is asserted twice over: as a pure function of a record and an instant, because
 * that is how the Library asks it while it renders, and end to end through
 * `markBackupInitiated`, because that is the only thing that can make it false again.
 */
import { describe, expect, it } from 'vitest'
import { createMemoryAdapter, withFaults } from '../persistence'
import type { LibraryRecord, Ports } from '../persistence'
import { intent } from '../edit/testing'
import { BACKUP_DUE_AFTER_MS, createLibraryStore, isBackupDue, openProject } from './index'
import type { LibraryStore } from './index'
import {
  createTestDeps,
  flush,
  quotaTimes,
  seedProject,
  testProject,
  TEST_NOW,
  type TestDeps,
} from './testing'

const KITCHEN = 'kitchen-1'
const BEDROOM = 'bedroom-1'
const NOW_MS = Date.parse(TEST_NOW)
const DAY_MS = 24 * 60 * 60 * 1000

/** The store and the Library over it, sharing one clock, one ID source and one registry. */
function libraryOver(ports: Ports, test: TestDeps): LibraryStore {
  return createLibraryStore({ ports, clock: test.clock, ids: test.ids, registry: test.registry })
}

function record(store: LibraryStore, id: string): LibraryRecord {
  const found = [...store.getSnapshot().projects, ...store.getSnapshot().trash].find((row) => row.id === id)
  if (found === undefined) throw new Error(`no Library record for ${id}`)
  return found
}

describe('the Library store', () => {
  it('lists Projects and Trash separately, and says when it is loading', async () => {
    const base = createMemoryAdapter()
    await seedProject(base, testProject(KITCHEN, 'Kitchen'))
    await seedProject(base, testProject(BEDROOM, 'Bedroom'))
    await base.projects.trash(BEDROOM, TEST_NOW)
    const library = libraryOver(base, createTestDeps(base))

    expect(library.getSnapshot()).toEqual({ projects: [], trash: [], loading: false })
    const pending = library.refresh()
    expect(library.getSnapshot().loading).toBe(true)
    expect((await pending).ok).toBe(true)

    const snapshot = library.getSnapshot()
    expect(snapshot.loading).toBe(false)
    expect(snapshot.projects.map((row) => row.name)).toEqual(['Kitchen'])
    expect(snapshot.trash.map((row) => row.name)).toEqual(['Bedroom'])
    expect(snapshot.trash[0]?.trashedAt).toBe(TEST_NOW)
  })

  it('creates a New Project as a committed record, never a staged one (#14)', async () => {
    const base = createMemoryAdapter()
    const test = createTestDeps(base)
    const library = libraryOver(base, test)

    const created = await library.createProject('Study')
    if (!created.ok) throw new Error(`createProject: ${created.error.kind}`)

    const row = record(library, created.value)
    expect(row).toMatchObject({ name: 'Study', revision: 1, trashedAt: null, lastBackupInitiatedAt: null })
    const loaded = await base.projects.load(created.value)
    if (!loaded.ok) throw new Error(`load: ${loaded.error.kind}`)
    expect(loaded.value.data.meta.name).toBe('Study')
    expect(loaded.value.revision).toBe(1)
    expect(library.getSnapshot().projects.map((row2) => row2.id)).toEqual([created.value])
  })

  it('moves a Project to Trash, back out, and out of existence', async () => {
    const base = createMemoryAdapter()
    await seedProject(base, testProject(KITCHEN, 'Kitchen'))
    const library = libraryOver(base, createTestDeps(base))
    await library.refresh()

    expect((await library.trash(KITCHEN)).ok).toBe(true)
    expect(library.getSnapshot().projects).toHaveLength(0)
    expect(library.getSnapshot().trash.map((row) => row.id)).toEqual([KITCHEN])

    expect((await library.restore(KITCHEN)).ok).toBe(true)
    expect(library.getSnapshot().projects.map((row) => row.id)).toEqual([KITCHEN])

    expect((await library.purge(KITCHEN)).ok).toBe(true)
    expect(library.getSnapshot().projects).toHaveLength(0)
    expect((await library.purge(KITCHEN)).ok).toBe(false)
  })

  it('refuses to trash or purge a Project holding unsaved changes (criterion 12)', async () => {
    const base = createMemoryAdapter()
    await seedProject(base, testProject(KITCHEN, 'Kitchen'))
    const ports = withFaults(base, quotaTimes(4))
    const test = createTestDeps(ports)
    const library = libraryOver(ports, test)
    await library.refresh()

    // With no session open there is nothing unsaved, so the Library may act.
    expect((await library.trash(KITCHEN)).ok).toBe(true)
    expect((await library.restore(KITCHEN)).ok).toBe(true)

    const opened = await openProject(KITCHEN, test.deps)
    if (!opened.ok) throw new Error(`openProject: ${opened.error.kind}`)
    const session = opened.value
    session.dispatch(intent('project.rename', { name: 'At Risk' }))
    await flush()
    expect(session.getSnapshot().save.kind).toBe('failed')

    expect(await library.trash(KITCHEN)).toEqual({ ok: false, error: 'guarded' })
    expect(await library.purge(KITCHEN)).toEqual({ ok: false, error: 'guarded' })
    expect(await library.markBackupInitiated(KITCHEN)).toEqual({ ok: false, error: 'guarded' })
    expect(record(library, KITCHEN).trashedAt, 'the Project is still where it was').toBeNull()

    session.markEmergencyBackupDownloaded()
    expect((await library.trash(KITCHEN)).ok).toBe(true)
    expect(test.registry.get(KITCHEN), 'a trashed Project keeps its session until it closes').not.toBeNull()
  })
})

describe('the backup-due rule', () => {
  async function seeded(): Promise<{ library: LibraryStore; row: LibraryRecord }> {
    const base = createMemoryAdapter()
    await seedProject(base, testProject(KITCHEN, 'Kitchen'))
    const library = libraryOver(base, createTestDeps(base))
    await library.refresh()
    return { library, row: record(library, KITCHEN) }
  }

  it('never offers a backup for a New Project nobody has edited (criterion 12)', async () => {
    const { row } = await seeded()
    expect(row.revision).toBe(1)
    expect(isBackupDue({ ...row, lastBackupInitiatedAt: null }, TEST_NOW)).toBe(false)
  })

  it('offers one after the first edit, with no backup yet (criterion 12)', async () => {
    const { row } = await seeded()
    expect(isBackupDue({ ...row, revision: 2, lastBackupInitiatedAt: null }, TEST_NOW)).toBe(true)
  })

  it('waits seven days after the last one, and only for a revision not yet offered (criterion 12)', async () => {
    const { row } = await seeded()
    const sixDaysAgo = new Date(NOW_MS - 6 * DAY_MS - 23 * 60 * 60 * 1000).toISOString()
    const exactlySeven = new Date(NOW_MS - BACKUP_DUE_AFTER_MS).toISOString()
    const pastSeven = new Date(NOW_MS - BACKUP_DUE_AFTER_MS - 1).toISOString()

    // The revision the last Backup covered: nothing new to offer, however long the wait.
    expect(isBackupDue({ ...row, revision: 4, lastBackupRevision: 4, lastBackupInitiatedAt: sixDaysAgo }, TEST_NOW)).toBe(false)
    expect(isBackupDue({ ...row, revision: 4, lastBackupRevision: 4, lastBackupInitiatedAt: pastSeven }, TEST_NOW)).toBe(false)
    // Something new, but the last offer is recent.
    expect(isBackupDue({ ...row, revision: 5, lastBackupRevision: 4, lastBackupInitiatedAt: sixDaysAgo }, TEST_NOW)).toBe(false)
    // Something new, and the seventh day has passed.
    expect(isBackupDue({ ...row, revision: 5, lastBackupRevision: 4, lastBackupInitiatedAt: exactlySeven }, TEST_NOW)).toBe(false)
    expect(isBackupDue({ ...row, revision: 5, lastBackupRevision: 4, lastBackupInitiatedAt: pastSeven }, TEST_NOW)).toBe(true)
  })

  it('goes quiet when the user starts a backup and loud again when the Project moves on', async () => {
    const base = createMemoryAdapter()
    await seedProject(base, testProject(KITCHEN, 'Kitchen'))
    const test = createTestDeps(base)
    const library = libraryOver(base, test)
    const opened = await openProject(KITCHEN, test.deps)
    if (!opened.ok) throw new Error(`openProject: ${opened.error.kind}`)
    await library.refresh()

    opened.value.dispatch(intent('project.rename', { name: 'Edited' }))
    await flush()
    await library.refresh()
    expect(isBackupDue(record(library, KITCHEN), test.clock.now())).toBe(true)

    expect((await library.markBackupInitiated(KITCHEN)).ok).toBe(true)
    const offered = record(library, KITCHEN)
    expect(offered.lastBackupRevision).toBe(2)
    expect(offered.lastBackupInitiatedAt).toBe(TEST_NOW)
    expect(isBackupDue(offered, test.clock.now())).toBe(false)

    // A week of further work, and the reminder comes back (#14).
    opened.value.dispatch(intent('project.rename', { name: 'Edited again' }))
    await flush()
    await library.refresh()
    expect(isBackupDue(record(library, KITCHEN), test.clock.now())).toBe(false)
    await test.clock.advance(BACKUP_DUE_AFTER_MS + 1)
    expect(isBackupDue(record(library, KITCHEN), test.clock.now())).toBe(true)
    await opened.value.close()
  })
})
