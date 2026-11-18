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
import { afterEach, describe, expect, it, vi } from 'vitest'
import { INTENT_LABELS, intentIdCount } from '../../edit'
import type { Intent, IntentType, PayloadOf } from '../../edit'
import { createMemoryAdapter } from '../../persistence'
import { openProject } from '../../session'
import { createTestDeps, gateCommits, seedProject, TEST_NOW, testProject } from '../../session/testing'
import { LegacyViewRoot } from './LegacyViewRoot'
import { useLegacyBindings } from './bindings'
import type { LegacyBindings } from './bindings'
import type { AssetUrlSource, IntentBuilder, SessionViewServices } from './sessionBindings'

/** The app's own rule: the catalogue says how many IDs an Intent spends, and in what order. */
let issued = 0
/** Every Intent the bindings built, in order: what a callback *asked for*, accepted or not. */
const built: IntentType[] = []
const testIntents: IntentBuilder = {
  build: <T extends IntentType>(type: T, payload: PayloadOf<T>): Intent => {
    built.push(type)
    return ({
      type,
      payload,
      label: INTENT_LABELS[type],
      ids: Array.from({ length: intentIdCount(type) }, () => `test-${(issued += 1)}`),
      now: TEST_NOW,
    }) as Intent
  },
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
  const opened = await openProject('p-1', deps)
  if (!opened.ok) throw new Error(`openProject refused: ${opened.error.kind}`)

  let published: LegacyBindings | null = null
  render(
    <LegacyViewRoot
      session={opened.value}
      services={services}
      onSaveFailure={() => {}}
      onReturnToProjects={() => {}}
    >
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

/**
 * The mapping the flagged app stands on (#49): every callback that changes the document builds
 * exactly one Intent of the type the legacy action stood for, and nothing else. Selection,
 * tool, module and snap callbacks change the UI session only and are absent on purpose.
 *
 * The payloads are placeholders — the Project holds no such node — so the session refuses
 * most of them. That is fine: this asserts what the binding *asked for*, which is the
 * contract; whether the handler accepts it is `edit`'s own suite.
 */
const INTENT_TABLE: readonly (readonly [string, (bindings: LegacyBindings) => void, IntentType])[] = [
  ['updateUnitSettings', (b) => b.updateUnitSettings('d', { height: 900 }), 'cabinet.updateSettings'],
  ['setCabinetMaterial', (b) => b.setCabinetMaterial('oak'), 'cabinet.setMaterial'],
  ['addUnit', (b) => b.addUnit(), 'cabinet.addUnit'],
  ['removeUnit', (b) => b.removeUnit('d'), 'cabinet.removeUnit'],
  ['renameUnit', (b) => b.renameUnit('d', 'Tall'), 'cabinet.renameUnit'],
  ['addShelf', (b) => b.addShelf('n'), 'cabinet.addShelf'],
  ['addDivider', (b) => b.addDivider('n'), 'cabinet.addDivider'],
  ['deleteBoard', (b) => b.deleteBoard('n'), 'cabinet.deleteBoard'],
  ['setNodeSize', (b) => b.setNodeSize('n', 300), 'cabinet.setNodeSize'],
  ['pinNode', (b) => b.pinNode('n', 300), 'cabinet.pinNode'],
  ['unpinNode', (b) => b.unpinNode('n'), 'cabinet.unpinNode'],
  ['unlockNode', (b) => b.unlockNode('n'), 'cabinet.unpinNode'],
  ['setNodeLabel', (b) => b.setNodeLabel('n', 'Shoes'), 'cabinet.setNodeLabel'],
  ['distributeEvenly', (b) => b.distributeEvenly('n', 200), 'cabinet.distributeEvenly'],
  ['setElementType', (b) => b.setElementType('n', 'drawer'), 'cabinet.setElementType'],
  ['setDrawerConfig', (b) => b.setDrawerConfig('n', { slideType: 'side-mount', reveal: 2 }), 'cabinet.setDrawerConfig'],
  ['addAccessory', (b) => b.addAccessory('n', 'door'), 'cabinet.addAccessory'],
  ['removeAccessory', (b) => b.removeAccessory('n', 'a'), 'cabinet.removeAccessory'],
  ['commitDrag', (b) => b.commitDrag('n', 0.5), 'cabinet.setSplitRatio'],
  ['addFloorPlanObject', (b) => b.addFloorPlanObject('sofa-3'), 'plan.addObject'],
  ['addFloorPlanFromTemplate', (b) => b.addFloorPlanFromTemplate('t'), 'plan.addFromTemplate'],
  [
    'addCustomTemplate',
    (b) => b.addCustomTemplate({ label: 'Island', defaultW: 800, defaultH: 600, color: '#ffaa00' }),
    'plan.addTemplate',
  ],
  ['updateFloorPlanObject', (b) => b.updateFloorPlanObject('o', { x: 10 }), 'plan.updateObject'],
  ['removeFloorPlanObject', (b) => b.removeFloorPlanObject('o'), 'plan.removeObject'],
  ['setFloorPlanScale', (b) => b.setFloorPlanScale(0.25), 'plan.calibrate'],
  ['clearFloorPlan', (b) => b.clearFloorPlan(), 'plan.clear'],
  [
    'setPlanImage',
    (b) => b.setPlanImage(
      {
        src: 'blob:x',
        widthPx: 640,
        heightPx: 480,
        asset: { bytes: new Blob(['x']), sha256: 'a'.repeat(64), mediaType: 'image/png', widthPx: 640, heightPx: 480 },
      },
      { clearExisting: false },
    ),
    'plan.setImage',
  ],
]

describe('the session bindings, one Intent per document callback', () => {
  afterEach(() => vi.restoreAllMocks())

  it.each(INTENT_TABLE)('%s builds %s', async (_name, call, expected) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { bindings } = await renderSession()
    built.length = 0
    act(() => call(bindings()))
    expect(built).toEqual([expected])
  })

  it('dispatches a drag as plan.updateObject on pointer-up and not before', async () => {
    const { bindings, settle } = await renderSession()
    act(() => bindings().addFloorPlanObject('sofa-3'))
    await settle()
    const { id } = placed(bindings())
    built.length = 0
    act(() => bindings().dragFloorPlanObject(id, { x: 400, y: 0 }))
    expect(built).toEqual([])
    act(() => bindings().endFloorPlanDrag(id))
    expect(built).toEqual(['plan.updateObject'])
  })
})
