/**
 * The Project session against the ports (#48, criteria 1–10 and 13).
 *
 * Everything here runs on the in-memory adapter, the fault decorator, the fake clock and the
 * fake lock — no IndexedDB, no browser, no real timers (#45, #20 §9.1). The three fakes that
 * make the hard criteria possible live in `src/session/testing.ts`: a clock the test
 * advances by hand, a lock a test can hold from "another tab", and a gate that parks commits
 * so the single-flight writer can be counted from the outside.
 */
import { describe, expect, it } from 'vitest'
import type { Intent, Locator } from '../edit'
import type { Project } from '../domain'
import { createMemoryAdapter, withFaults } from '../persistence'
import type { FaultRule, Ports } from '../persistence'
import { canonicalJson } from '../lib'
import { cabinetOf, intent } from '../edit/testing'
import { createLibraryStore, HISTORY_LIMIT, IDLE_RECOVERY_MS, openProject } from './index'
import type { ProjectSession } from './index'
import {
  countPrunes,
  createTestDeps,
  flush,
  gateCommits,
  pointsOfKind,
  quotaTimes,
  seedProject,
  testProject,
  TEST_NOW,
  type GatedPorts,
  type TestDeps,
} from './testing'

const PROJECT_ID = 'project-1'
const OTHER_ID = 'project-2'

interface Fixture {
  /** The adapter the session writes through, gate and faults included. */
  ports: Ports
  /** The plain adapter underneath, for writing behind the session's back. */
  base: Ports
  gate: GatedPorts | null
  test: TestDeps
  session: ProjectSession
  project: Project
}

async function openFixture(
  options: { id?: string; name?: string; fault?: readonly FaultRule[]; gate?: boolean } = {},
): Promise<Fixture> {
  const project = testProject(options.id ?? PROJECT_ID, options.name ?? 'Kitchen')
  const base = createMemoryAdapter()
  await seedProject(base, project)
  // The gate sits outside the faults, so it counts every attempt the writer makes, including
  // the ones the store then refuses.
  let ports: Ports = options.fault === undefined ? base : withFaults(base, options.fault)
  const gate = options.gate === true ? gateCommits(ports) : null
  if (gate !== null) ports = gate.ports
  const test = createTestDeps(ports)
  const opened = await openProject(project.id, test.deps)
  if (!opened.ok) throw new Error(`openProject: ${opened.error.kind}`)
  return { ports, base, gate, test, session: opened.value, project }
}

/** The content of the open Project, as bytes: two Projects are the same when these match. */
function content(session: ProjectSession): string {
  return canonicalJson(session.getSnapshot().project)
}

function rename(name: string): Intent {
  return intent('project.rename', { name })
}

describe('the history of one Project', () => {
  it('makes one step per dispatch and undoes it as a forward revision (criterion 1)', async () => {
    const { session } = await openFixture()
    const before = content(session)

    expect(session.dispatch(rename('Galley'))).toEqual({ ok: true })
    const edited = session.getSnapshot()
    expect(edited.revision).toBe(2)
    expect(edited.history).toMatchObject({ canUndo: true, canRedo: false, size: 1, undoLabel: 'Rename Project' })
    expect(content(session)).not.toBe(before)
    await flush()

    expect(session.undo()).toEqual({ ok: true, value: undefined })
    const undone = session.getSnapshot()
    expect(content(session)).toBe(before)
    // Undo is a new forward revision, not a rewind of the counter (#26).
    expect(undone.revision).toBe(3)
    expect(undone.history).toMatchObject({ canUndo: false, canRedo: true, size: 0 })
    await flush()

    expect(session.redo()).toEqual({ ok: true, value: undefined })
    expect(content(session)).toBe(canonicalJson(edited.project))
    expect(session.getSnapshot().revision).toBe(4)
    expect(session.getSnapshot().history).toMatchObject({ canUndo: true, canRedo: false, size: 1 })
    await flush()
  })

  it('keeps 200 steps and drops the oldest (criterion 2)', async () => {
    const { session } = await openFixture()
    let afterFirst = ''
    for (let index = 1; index <= HISTORY_LIMIT + 1; index += 1) {
      expect(session.dispatch(rename(`Kitchen ${String(index)}`))).toEqual({ ok: true })
      if (index === 1) afterFirst = content(session)
    }
    expect(session.getSnapshot().history.size).toBe(HISTORY_LIMIT)
    expect(session.getSnapshot().revision).toBe(HISTORY_LIMIT + 2)
    await flush()

    for (let index = 0; index < HISTORY_LIMIT; index += 1) {
      expect(session.undo().ok, `undo number ${String(index + 1)}`).toBe(true)
    }
    // Two hundred steps back is the state after the first dispatch: the step that fell off
    // the front of the cap is gone, and the initial state is unreachable (#20 §8).
    expect(content(session)).toBe(afterFirst)
    expect(session.getSnapshot().history.canUndo).toBe(false)
    await flush()
  })

  it('navigates to the Intent it undid, without a step or a revision of its own (criterion 3)', async () => {
    const { session, project } = await openFixture()
    const design = cabinetOf(project)
    const placed = project.existingModel.placedItems[0]
    if (placed === undefined) throw new Error('the New Project places no object')
    const rootId = design.construction.root.id
    const affected: Locator = {
      floorId: placed.floorId,
      viewId: null, view: 'cabinet',
      itemDesignIds: [design.id],
      placedItemIds: [placed.id],
    }
    const navigations: Locator[] = []
    session.onNavigate((locator) => {
      navigations.push(locator)
    })

    const label: Intent = intent('cabinet.setNodeLabel', { itemDesignId: design.id, nodeId: rootId, label: 'Top shelf' })
    expect(session.dispatch(label)).toEqual({ ok: true })
    await flush()
    expect(navigations, 'an edit is not a navigation').toHaveLength(0)

    expect(session.undo().ok).toBe(true)
    // The Locator is the one the original Intent carried (#26).
    expect(navigations).toEqual([affected])
    const afterUndo = session.getSnapshot()
    expect(afterUndo.history.size).toBe(0)

    expect(session.redo().ok).toBe(true)
    expect(navigations[1]).toEqual(affected)
    // Navigation added no step of its own: the one step in the stack is the redo putting the
    // undo back, and the only new revision is the one the redo took.
    expect(session.getSnapshot().history.size).toBe(1)
    expect(session.getSnapshot().revision).toBe(afterUndo.revision + 1)
    await flush()
  })

  it('switches Projects behind a close Recovery Point and starts empty (criterion 4)', async () => {
    const { session, ports, test } = await openFixture()
    await seedProject(ports, testProject(OTHER_ID, 'Bedroom'))
    expect(session.dispatch(rename('Galleon'))).toEqual({ ok: true })
    await flush()
    expect(session.getSnapshot().persistedRevision).toBe(2)

    const switched = await session.switchTo(OTHER_ID)
    if (!switched.ok) throw new Error(`switchTo: ${String(switched.error)}`)

    const [close] = await pointsOfKind(ports, PROJECT_ID, 'close')
    if (close === undefined) throw new Error('no close Recovery Point was stored')
    expect(close.revision).toBe(2)
    const loaded = await ports.recovery.load(close.id)
    if (!loaded.ok) throw new Error(`recovery.load: ${loaded.error.kind}`)
    expect(loaded.value.data.meta.name).toBe('Galleon')

    expect(switched.value.getSnapshot().history).toMatchObject({ size: 0, canUndo: false, canRedo: false })
    expect(switched.value.getSnapshot().revision).toBe(1)
    expect(test.registry.get(PROJECT_ID), 'the closed session is no longer the open one').toBeNull()
    expect(test.lock.held()).toEqual([OTHER_ID])
    await switched.value.close()
  })

  it('writes no close Recovery Point for a Project that never changed', async () => {
    const { session, ports } = await openFixture()
    expect((await session.close()).ok).toBe(true)
    expect(await ports.recovery.list(PROJECT_ID)).toEqual({ ok: true, value: [] })
  })
})

describe('what a dispatch may not do', () => {
  it('leaves nothing behind when the Intent is refused (criterion 5)', async () => {
    const { session, gate } = await openFixture({ gate: true })
    if (gate === null) throw new Error('the fixture has no gate')
    const before = session.getSnapshot()

    const refused = session.dispatch(
      intent('cabinet.setNodeLabel', { itemDesignId: 'no-such-design', nodeId: 'no-such-node', label: 'Nowhere' }),
    )
    expect(refused).toMatchObject({ ok: false, code: 'unknown-target' })

    const after = session.getSnapshot()
    expect(after.revision).toBe(before.revision)
    expect(after.history).toEqual(before.history)
    expect(content(session)).toBe(canonicalJson(before.project))
    expect(gate.calls, 'a refused Intent never reaches the store').toHaveLength(0)
  })

  it('opens read-only when another tab holds the lock (criterion 13)', async () => {
    const project = testProject(PROJECT_ID)
    const ports = createMemoryAdapter()
    await seedProject(ports, project)
    const test = createTestDeps(ports)
    const giveUp = test.lock.hold(PROJECT_ID)

    const opened = await openProject(PROJECT_ID, test.deps)
    if (!opened.ok) throw new Error(`openProject: ${opened.error.kind}`)
    const session = opened.value
    expect(session.getSnapshot().readOnly).toBe(true)
    expect(session.dispatch(rename('Elsewhere'))).toMatchObject({ ok: false, code: 'read-only' })
    expect(session.getSnapshot().revision).toBe(1)
    expect(session.undo()).toEqual({ ok: false, error: 'no-history' })

    // The holder closes its tab, and this one takes the Project over (#20 §5).
    giveUp()
    await flush()
    expect(session.getSnapshot().readOnly).toBe(false)
    expect(session.dispatch(rename('Here'))).toEqual({ ok: true })
    expect(session.getSnapshot().revision).toBe(2)
    await flush()
    expect(session.getSnapshot().save.kind).toBe('saved')
    await session.close()
  })
})

describe('the single-flight writer', () => {
  it('writes one at a time and only the newest snapshot (criterion 6)', async () => {
    const { session, gate } = await openFixture({ gate: true })
    if (gate === null) throw new Error('the fixture has no gate')

    for (let index = 1; index <= 10; index += 1) {
      expect(session.dispatch(rename(`Kitchen ${String(index)}`))).toEqual({ ok: true })
    }
    expect(session.getSnapshot().revision).toBe(11)
    expect(session.getSnapshot().save).toEqual({ kind: 'saving' })
    expect(gate.calls, 'nine dispatches coalesced behind the one in flight').toHaveLength(1)
    expect(gate.calls[0]?.input.revision).toBe(2)
    expect(gate.calls[0]?.expectedRevision).toBe(1)
    expect(gate.waiting()).toBe(true)

    await gate.release()
    expect(gate.calls).toHaveLength(2)
    expect(gate.calls[1]?.input.revision).toBe(11)
    expect(gate.calls[1]?.expectedRevision).toBe(2)
    expect(gate.calls[1]?.input.project.meta.name).toBe('Kitchen 10')
    expect(session.getSnapshot().save).toEqual({ kind: 'saving' })

    // The second commit is the one that decides the time the Library shows.
    gate.openGate()
    await gate.release()
    expect(gate.calls).toHaveLength(2)
    expect(session.getSnapshot()).toMatchObject({
      persistedRevision: 11,
      save: { kind: 'saved', at: gate.calls[1]?.input.savedAt },
    })
  })

  it('waits for a write in flight before writing the close Recovery Point', async () => {
    const { session, ports, gate } = await openFixture({ gate: true })
    if (gate === null) throw new Error('the fixture has no gate')
    session.dispatch(rename('In Flight'))
    expect(gate.waiting()).toBe(true)

    const closing = session.close()
    await gate.release()
    expect((await closing).ok).toBe(true)

    const [close] = await pointsOfKind(ports, PROJECT_ID, 'close')
    if (close === undefined) throw new Error('no close Recovery Point was stored')
    // The point holds the state the write was carrying, not the one before it (#14).
    expect(close.revision).toBe(2)
  })

  it('stops writing after a failure and waits for the user', async () => {
    const { session, gate } = await openFixture({ gate: true, fault: quotaTimes(1) })
    if (gate === null) throw new Error('the fixture has no gate')

    session.dispatch(rename('First'))
    await gate.release()
    expect(session.getSnapshot().save.kind).toBe('failed')
    expect(gate.calls).toHaveLength(1)

    session.dispatch(rename('Second'))
    session.dispatch(rename('Third'))
    await flush()
    expect(gate.calls, 'a failed save writes nothing more until the user retries').toHaveLength(1)
    expect(session.getSnapshot().revision).toBe(4)

    gate.openGate()
    expect((await session.retry()).ok).toBe(true)
    expect(gate.calls).toHaveLength(2)
    expect(gate.calls[1]?.input.revision).toBe(4)
    expect(gate.calls[1]?.expectedRevision).toBe(1)
    expect(session.getSnapshot().save.kind).toBe('saved')
  })
})

describe('Save failed', () => {
  it('refuses to close, switch, trash or purge the Project (#20 §13.9, criterion 7)', async () => {
    const { session, test } = await openFixture({ fault: quotaTimes(6) })
    session.dispatch(rename('At Risk'))
    await flush()

    expect(session.getSnapshot().save).toEqual({ kind: 'failed', lastSavedAt: TEST_NOW, reason: 'quota' })
    expect(session.getSnapshot().guard).toEqual({ blocked: true, resolvedBy: null })
    expect(await session.close()).toEqual({ ok: false, error: 'guarded' })
    expect(await session.switchTo(OTHER_ID)).toEqual({ ok: false, error: 'guarded' })

    const library = createLibraryStore({
      ports: test.deps.ports,
      clock: test.clock,
      ids: test.ids,
      registry: test.registry,
    })
    expect(await library.trash(PROJECT_ID)).toEqual({ ok: false, error: 'guarded' })
    expect(await library.purge(PROJECT_ID)).toEqual({ ok: false, error: 'guarded' })
    expect(await library.restore(PROJECT_ID)).toEqual({ ok: false, error: 'guarded' })
    expect(await library.markBackupInitiated(PROJECT_ID)).toEqual({ ok: false, error: 'guarded' })
  })

  it('lifts the block when the user retry succeeds', async () => {
    const { session } = await openFixture({ fault: quotaTimes(1) })
    session.dispatch(rename('At Risk'))
    await flush()
    expect(session.getSnapshot().guard.blocked).toBe(true)

    const retried = await session.retry()
    expect(retried.ok).toBe(true)
    expect(session.getSnapshot()).toMatchObject({
      save: { kind: 'saved', at: TEST_NOW },
      guard: { blocked: false, resolvedBy: null },
      persistedRevision: 2,
    })
  })

  it('lifts the block for the emergency download, and re-arms on the next edit', async () => {
    const { session } = await openFixture({ fault: quotaTimes(6) })
    session.dispatch(rename('At Risk'))
    await flush()

    session.markEmergencyBackupDownloaded()
    expect(session.getSnapshot().guard).toEqual({ blocked: false, resolvedBy: 'emergency-download' })
    // An emergency download proves the user has the bytes, not that the store took them.
    expect(session.getSnapshot().save.kind).toBe('failed')

    session.dispatch(rename('And More'))
    expect(session.getSnapshot().guard).toEqual({ blocked: true, resolvedBy: null })
    expect(await session.close()).toEqual({ ok: false, error: 'guarded' })
  })

  it('lifts the block on an explicit discard, back to what is stored', async () => {
    const { session, ports } = await openFixture({ fault: quotaTimes(6) })
    const stored = content(session)
    session.dispatch(rename('At Risk'))
    await flush()

    const discarded = await session.discardUnsaved()
    expect(discarded.ok).toBe(true)
    expect(content(session)).toBe(stored)
    const snapshot = session.getSnapshot()
    expect(snapshot).toMatchObject({
      revision: 1,
      persistedRevision: 1,
      save: { kind: 'saved', at: TEST_NOW },
      guard: { blocked: false, resolvedBy: null },
      notice: { kind: 'previous-state-saved' },
    })
    expect(snapshot.history.size).toBe(0)

    // What was thrown away is kept, because the discard was best-effort and not a deletion.
    const [point] = await pointsOfKind(ports, PROJECT_ID, 'pre-discard')
    if (point === undefined) throw new Error('no pre-discard Recovery Point was stored')
    expect(point.revision).toBe(2)
    const loaded = await ports.recovery.load(point.id)
    if (!loaded.ok) throw new Error(`recovery.load: ${loaded.error.kind}`)
    expect(loaded.value.data.meta.name).toBe('At Risk')
  })

  it('keeps undo and redo working in memory (criterion 8)', async () => {
    const { session } = await openFixture({ fault: quotaTimes(6) })
    session.dispatch(rename('One'))
    const afterOne = content(session)
    session.dispatch(rename('Two'))
    await flush()

    const failed = session.getSnapshot()
    expect(failed.save.kind).toBe('failed')
    expect(failed.revision).toBe(3)

    expect(session.undo().ok).toBe(true)
    expect(content(session)).toBe(afterOne)
    expect(session.getSnapshot().revision).toBe(4)
    expect(session.getSnapshot().save.kind).toBe('failed')

    expect(session.redo().ok).toBe(true)
    expect(session.getSnapshot().project.meta.name).toBe('Two')
    expect(session.getSnapshot().revision).toBe(5)
  })

  it('stops on a revision conflict without overwriting the stored record (criterion 9)', async () => {
    const { session, base } = await openFixture()
    const elsewhere = await base.projects.commit(
      { project: testProject(PROJECT_ID, 'Written Elsewhere'), revision: 5, savedAt: '2026-01-02T00:00:00.000Z' },
      1,
    )
    if (!elsewhere.ok) throw new Error(`the other writer failed: ${elsewhere.error.kind}`)

    session.dispatch(rename('Mine'))
    await flush()

    expect(session.getSnapshot().save).toEqual({
      kind: 'failed',
      lastSavedAt: TEST_NOW,
      reason: 'revision-conflict',
    })
    const stored = await base.projects.load(PROJECT_ID)
    if (!stored.ok) throw new Error(`load: ${stored.error.kind}`)
    expect(stored.value.revision).toBe(5)
    expect(stored.value.data.meta.name).toBe('Written Elsewhere')
  })
})

describe('the Recovery Point schedule', () => {
  it('writes one idle point two minutes after the last dispatch (criterion 10)', async () => {
    const { session, ports, test } = await openFixture()
    session.dispatch(rename('Quiet'))
    await flush()
    expect(await ports.recovery.list(PROJECT_ID)).toEqual({ ok: true, value: [] })

    await test.clock.advance(IDLE_RECOVERY_MS - 1)
    expect(await pointsOfKind(ports, PROJECT_ID, 'idle')).toHaveLength(0)

    await test.clock.advance(1)
    const idle = await pointsOfKind(ports, PROJECT_ID, 'idle')
    expect(idle).toHaveLength(1)
    expect(idle[0]?.revision).toBe(2)

    // One point per change, not one per minute of silence (#26).
    await test.clock.advance(IDLE_RECOVERY_MS * 3)
    expect(await pointsOfKind(ports, PROJECT_ID, 'idle')).toHaveLength(1)
  })

  it('arms no idle point while the save has failed', async () => {
    const { session, ports, test } = await openFixture({ fault: quotaTimes(6) })
    session.dispatch(rename('Stuck'))
    await flush()
    await test.clock.advance(IDLE_RECOVERY_MS + 1)
    expect(await pointsOfKind(ports, PROJECT_ID, 'idle')).toHaveLength(0)
  })

  it('restores behind a pre-restore point, clearing history and saying so (criterion 10)', async () => {
    const { session, ports } = await openFixture()
    session.dispatch(rename('Worth Keeping'))
    await flush()
    expect((await session.checkpoint('pre-import-replace')).ok).toBe(true)
    const [point] = await pointsOfKind(ports, PROJECT_ID, 'pre-import-replace')
    if (point === undefined) throw new Error('no pre-import-replace Recovery Point was stored')
    expect(point.revision).toBe(2)

    session.dispatch(rename('Later Work'))
    await flush()
    expect(session.getSnapshot().history.size).toBe(1)

    const restored = await session.restoreRecoveryPoint(point.id)
    expect(restored.ok).toBe(true)
    const snapshot = session.getSnapshot()
    expect(snapshot.project.meta.name).toBe('Worth Keeping')
    expect(snapshot.history).toMatchObject({ size: 0, canUndo: false, canRedo: false })
    expect(snapshot.notice).toEqual({ kind: 'previous-state-saved' })
    // The restore is a forward revision, and it is in the store already.
    expect(snapshot.revision).toBe(4)
    expect(snapshot.persistedRevision).toBe(4)
    expect(snapshot.save.kind).toBe('saved')

    const preRestore = await pointsOfKind(ports, PROJECT_ID, 'pre-restore')
    expect(preRestore).toHaveLength(1)
    expect(preRestore[0]?.revision).toBe(3)
  })

  it('adds no close point after a restore: the stored state is a copy of an existing point (#51 criterion 13)', async () => {
    const { session, ports } = await openFixture()
    session.dispatch(rename('Worth Keeping'))
    await flush()
    expect((await session.checkpoint('pre-import-replace')).ok).toBe(true)
    const [point] = await pointsOfKind(ports, PROJECT_ID, 'pre-import-replace')
    if (point === undefined) throw new Error('no pre-import-replace Recovery Point was stored')
    session.dispatch(rename('Later Work'))
    await flush()

    expect((await session.restoreRecoveryPoint(point.id)).ok).toBe(true)
    const before = await ports.recovery.list(PROJECT_ID)
    expect((await session.close()).ok).toBe(true)
    const after = await ports.recovery.list(PROJECT_ID)
    if (!before.ok || !after.ok) throw new Error('could not list Recovery Points')
    expect(after.value).toHaveLength(before.value.length)
    expect(await pointsOfKind(ports, PROJECT_ID, 'close')).toHaveLength(0)
  })

  it('prunes after every Recovery Point it creates (criterion 10)', async () => {
    const base = createMemoryAdapter()
    await seedProject(base, testProject(PROJECT_ID))
    const counted = countPrunes(base)
    const test = createTestDeps(counted.ports)
    const opened = await openProject(PROJECT_ID, test.deps)
    if (!opened.ok) throw new Error(`openProject: ${opened.error.kind}`)
    const session = opened.value

    session.dispatch(rename('Quiet'))
    await flush()
    expect(counted.prunes, 'a commit is not a Recovery Point').toHaveLength(0)

    await test.clock.advance(IDLE_RECOVERY_MS)
    expect(counted.prunes).toEqual([PROJECT_ID])
    expect((await session.checkpoint('pre-migration')).ok).toBe(true)
    expect(counted.prunes).toHaveLength(2)
    await session.close()
  })
})
