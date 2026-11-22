/**
 * The session behind the seam, driven the way the views drive it (#49 criterion 4).
 *
 * The floor-plan drag tests left with #55 — the Plan View no longer routes through these
 * bindings; what remains is the cabinet contract: every document callback builds exactly
 * one Intent, named by the catalogue. The payloads are placeholders — the Project holds no
 * such node — so the session refuses most of them. That is fine: this asserts what the
 * binding *asked for*, which is the contract; whether the handler accepts it is `edit`'s
 * own suite.
 *
 * Commits are parked at a gate, so no write is left notifying React after the test ended.
 */
import { act, render } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { intentIdCount, intentLabel, previewIntent } from '../../edit'
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
      label: intentLabel(type),
      ids: Array.from({ length: intentIdCount(type) }, () => `test-${(issued += 1)}`),
      now: TEST_NOW,
    }) as Intent
  },
  // The same report the real Intent consults, so a test that deletes a Wall with Openings sees
  // the review the app would show rather than one this file invented (#65 §8).
  preview: (project, intent) => ({ review: previewIntent(project, intent).review }),
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
})
