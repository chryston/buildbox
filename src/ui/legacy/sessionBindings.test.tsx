/**
 * The session behind the seam, driven the way the canvas drives it (#49 criterion 4).
 *
 * A drag is the case today's store gets wrong: `dragFloorPlanObject` writes on every pointer
 * move, so one drag is a dozen revisions, a dozen commits and a dozen undo steps. Under the
 * flag the moves are preview only and the pointer-up is the single Intent — one history
 * entry, one revision, one write. Both halves are asserted here, because a binding that
 * committed nothing at all would pass a test that only counted commits.
 *
 * Commits are parked at a gate, so the counts are read where they happen rather than raced
 * against a debounced writer, and no write is left notifying React after the test has ended.
 */
import { act, render } from '@testing-library/react'
import { useEffect } from 'react'
import { describe, expect, it } from 'vitest'
import { INTENT_LABELS, intentIdCount } from '../../edit'
import type { Intent, IntentType, PayloadOf } from '../../edit'
import { createMemoryAdapter } from '../../persistence'
import { createLibraryStore, openProject } from '../../session'
import { createTestDeps, gateCommits, seedProject, TEST_NOW, testProject } from '../../session/testing'
import { LegacyViewRoot } from './LegacyViewRoot'
import { useLegacyBindings } from './bindings'
import type { LegacyBindings } from './bindings'
import type { AssetUrlSource, IntentBuilder, SessionViewServices } from './sessionBindings'

/** The app's own rule: the catalogue says how many IDs an Intent spends, and in what order. */
let issued = 0
const testIntents: IntentBuilder = {
  build: <T extends IntentType>(type: T, payload: PayloadOf<T>): Intent =>
    ({
      type,
      payload,
      label: INTENT_LABELS[type],
      ids: Array.from({ length: intentIdCount(type) }, () => `test-${(issued += 1)}`),
      now: TEST_NOW,
    }) as Intent,
}

/** No test here loads a Plan Image, so no URL is ever asked for or handed out. */
const noAssets: AssetUrlSource = {
  subscribe: () => () => {},
  urlFor: () => null,
  load: () => {},
  put: () => {},
}

const services: SessionViewServices = {
  intent: testIntents,
  assetUrls: noAssets,
  readPlanImage: () => Promise.reject(new Error('this double models no file reader')),
}

/** The bindings a rendered view is holding, which is the only set worth testing. */
function BindingsProbe({ show }: { show: (bindings: LegacyBindings) => void }) {
  const bindings = useLegacyBindings()
  useEffect(() => show(bindings), [bindings, show])
  return null
}

async function renderSession() {
  const store = createMemoryAdapter()
  await seedProject(store, testProject('p-1'))
  const gated = gateCommits(store)
  const { deps } = createTestDeps(gated.ports)
  const library = createLibraryStore(deps)
  const opened = await openProject('p-1', deps)
  if (!opened.ok) throw new Error(`openProject refused: ${opened.error.kind}`)

  let published: LegacyBindings | null = null
  render(
    <LegacyViewRoot library={library} session={opened.value} services={services}>
      <BindingsProbe show={(bindings) => { published = bindings }} />
    </LegacyViewRoot>,
  )
  const bindings = (): LegacyBindings => {
    if (published === null) throw new Error('the view never published its bindings')
    return published
  }
  // The single-flight writer starts a commit only when the previous one has settled, so a
  // count read while one is parked would say nothing. `settle` lets the parked writes land.
  const settle = async () => { await act(async () => { await gated.release() }) }
  return { session: opened.value, calls: gated.calls, bindings, settle }
}

/** The one placement on the Floor, which the test has just added. */
function placed(bindings: LegacyBindings) {
  const [object] = bindings.floorPlan.objects
  if (object === undefined) throw new Error('the Floor holds no placement')
  return object
}

describe('the session bindings, dragging a floor-plan object', () => {
  it('previews every move and writes none of them', async () => {
    const { session, calls, bindings, settle } = await renderSession()
    act(() => bindings().addFloorPlanObject('sofa-3'))
    await settle()
    const before = session.getSnapshot()
    const { id } = placed(bindings())
    expect(calls).toHaveLength(1)

    act(() => bindings().dragFloorPlanObject(id, { x: 400, y: 0 }))

    // The view follows the pointer, because today's store moved the object on every move.
    expect(placed(bindings()).x).toBe(400)
    // …and nothing else happened: no history, no revision, no write.
    expect(session.getSnapshot().history.size).toBe(before.history.size)
    expect(session.getSnapshot().revision).toBe(before.revision)
    expect(calls).toHaveLength(1)
  })

  it('turns the whole drag into one history entry, one revision and one commit', async () => {
    const { session, calls, bindings, settle } = await renderSession()
    act(() => bindings().addFloorPlanObject('sofa-3'))
    await settle()
    const before = session.getSnapshot()
    const { id } = placed(bindings())

    act(() => {
      bindings().dragFloorPlanObject(id, { x: 400, y: 0 })
      bindings().dragFloorPlanObject(id, { x: 800, y: 200 })
      bindings().dragFloorPlanObject(id, { x: 1200, y: 400 })
      bindings().endFloorPlanDrag(id)
    })

    const after = session.getSnapshot()
    expect(after.history.size - before.history.size).toBe(1)
    expect(after.revision - before.revision).toBe(1)
    expect(after.history.undoLabel).not.toBeNull()
    expect(placed(bindings()).x).toBe(1200)

    // One write for the drag, on the revision after the add, carrying what the view shows.
    expect(calls).toHaveLength(2)
    await settle()
    const written = calls[1]
    if (written === undefined) throw new Error('the drag wrote nothing')
    expect(written.input.revision).toBe(before.revision + 1)
    const moved = written.input.project.existingModel.placedItems.find((item) => item.id === id)
    const shown = after.project.existingModel.placedItems.find((item) => item.id === id)
    expect(moved?.translation).toEqual(shown?.translation)
  })

  it('walks one undo back over the whole drag', async () => {
    const { session, calls, bindings, settle } = await renderSession()
    act(() => bindings().addFloorPlanObject('sofa-3'))
    await settle()
    const spawn = placed(bindings())
    const { id } = spawn

    act(() => {
      bindings().dragFloorPlanObject(id, { x: 400, y: 0 })
      bindings().dragFloorPlanObject(id, { x: 1200, y: 400 })
      bindings().endFloorPlanDrag(id)
    })
    expect(placed(bindings()).x).toBe(1200)
    await settle()

    let undone = false
    act(() => { undone = session.undo().ok })
    expect(undone).toBe(true)
    // Undo is a forward revision (#26), so the write count grows rather than rewinds.
    expect(calls).toHaveLength(3)
    await settle()
    expect(placed(bindings()).x).toBe(spawn.x)
    expect(session.getSnapshot().history.canRedo).toBe(true)
  })
})
