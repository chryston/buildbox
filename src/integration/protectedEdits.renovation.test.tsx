/**
 * The protected edits (#70 §7a, §7b; criteria 20, 21, 22): the two dialogs a refused baseline edit
 * opens, and the one transaction each of them answers with.
 *
 * The scene is the committed `renovation-views` fixture driven through a real session, because the
 * rule under test is a promise about the Project: the Existing Model never moves silently, `Replace`
 * writes one demolition record and one successor that carries the geometry the person was dragging
 * toward, and the danger dialog says what every Design Option will do before any of them sees it.
 * Both dialogs are opened through the store seam exactly as the workspace opens them, and every
 * assertion reads the Project the session committed.
 *
 * It runs in the browser project, where the panel and its overlays are reachable.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Project } from '../domain'
import { designOptionsOf } from '../domain'
import type { Intent } from '../edit'
import { canonicalJson } from '../lib'
import {
  openCorrectExistingDialog,
  openForcedChoiceDialog,
  PLAN_IMAGE_ACCEPT,
  RenovationOverlays,
  WorkspaceProvider,
  workspaceStore,
  type WorkspaceServices,
} from '../ui'
import { openTestView, TEST_EXPORT_PORT, type TestView } from '../ui/legacy/testing'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')

const WALL_1 = 'seed-wall-002'
const WALL_2 = 'seed-wall-003'
/**
 * W-6, the one Wall that moves alone: it is joined to nothing, so a drag of it writes one record.
 * W-1 — the Wall criterion 22 names — has a Junction on W-2 at each end, and a body drag takes the
 * joined Walls with it, so the transaction it asks about is never W-1 alone. The criterion's question
 * is "what does an Option do with a Wall it has not touched", and W-6 is the Wall that can answer it.
 */
const WALL_6 = 'seed-wall-013'
const SUCCESSOR = 'views-successor-005'
const OPTION_A = 'Option A · Open kitchen'
const OPTION_B = 'Option B · Widened opening'
/** The 200 mm the criteria move by, across the Wall: along its own axis a drag is absorbed. */
const SHIFT_W6 = { x: 0, y: 200 }
const SHIFT_W2 = { x: 200, y: 0 }

function sceneProject(): Project {
  const seed = JSON.parse(
    readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'renovation-views.json'), 'utf8'),
  ) as { projects: { data: Project }[] }
  return structuredClone(seed.projects[0]!.data)
}

const noAssets: WorkspaceServices['assetUrls'] = {
  subscribe: () => () => {},
  urlFor: () => null,
  load: () => {},
  put: () => {},
}

function servicesFor(view: TestView): WorkspaceServices {
  return {
    intent: view.services.intent,
    assetUrls: noAssets,
    readPlanImage: () => Promise.reject(new Error('jsdom models no file reader')),
    planImageAccept: PLAN_IMAGE_ACCEPT,
    planCatalogue: [],
    viewportCache: {
      read: async () => undefined,
      write: () => {},
      readActive: async () => null,
      writeActive: () => {},
    },
    exportDrawings: TEST_EXPORT_PORT,
  }
}

let view: TestView

async function renderOverlays(): Promise<void> {
  view = await openTestView(sceneProject())
  render(
    <WorkspaceProvider
      session={view.session}
      services={servicesFor(view)}
      onReturnToProjects={() => {}}
      onShowSaveFailure={() => {}}
    >
      <RenovationOverlays />
    </WorkspaceProvider>,
  )
}

/** A store write from outside React: the workspace does it from a click, a test has to say so. */
const ask = (open: () => void): Promise<void> => act(async () => {
  open()
})

/** The refused edit the workspace would be holding: a Wall dragged 200 mm along X. */
function moveOf(wallId: string, delta: { x: number; y: number }): Intent {
  return view.services.intent.build('wall.dragBody', { wallId, delta })
}

/**
 * The refused edit with an unambiguous subject: a Wall made 50 mm thicker. A body drag on a Wall whose
 * ends are joined is absorbed by the junctions, so it is the wrong witness for what the successor
 * carries.
 */
function thickenOf(wallId: string): Intent {
  return view.services.intent.build('wall.setThickness', { wallId, thickness: 250 })
}

interface OptionView {
  readonly demolishedIds: readonly string[]
  readonly proposed: { readonly walls: readonly { id: string; predecessorIds?: readonly string[]; thickness?: number; line: { start: { x: number } } }[] }
}

const optionOf = (name: string): OptionView => {
  const options = designOptionsOf(view.project())
  const found = options.find((each) => each.name === name)
  return found as unknown as OptionView
}

const wallOf = (id: string): { line: { start: { x: number } } } | undefined =>
  view.project().existingModel.walls.find((each) => each.id === id)

const revision = (): number => view.session.getSnapshot().revision

/**
 * The row's own sentence, up to the dependants and blockers the review appends after it.
 */
function rowEffect(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  for (const effect of EFFECT_WORDS) {
    const at = flat.indexOf(effect)
    if (at >= 0) return flat.slice(0, at + effect.length)
  }
  return flat
}

const EFFECT_WORDS: readonly string[] = [
  'demolishes it; its successor stays aligned',
  'demolishes it; its successor keeps its own geometry',
  'demolishes it (no successor)',
  'retains it as Existing',
]

beforeEach(() => {
  workspaceStore.getState().reset()
})

// A dialog a failed assertion left open would ride into the next test's document, and a second
// `render` would add a second copy of the overlays beside it: close and unmount every time, so each
// test starts with no dialog mounted and one tree.
afterEach(() => {
  act(() => {
    workspaceStore.getState().closeRenovationDialog()
  })
  cleanup()
})

describe('the forced choice (#70 §7a)', () => {
  it('asks with the title, the body and the three buttons in the order the issue gives them', async () => {
    await renderOverlays()
    await ask(() => openForcedChoiceDialog(moveOf(WALL_2, SHIFT_W2), WALL_2, 'combined', 'option-b'))

    const dialog = await screen.findByTestId('forced-choice-dialog')
    expect(dialog).toHaveTextContent('W-2 belongs to the Existing Model')
    expect(screen.getByTestId('forced-choice-body')).toHaveTextContent(
      'You are in Combined display editing Option B · Widened opening. Moving a baseline entity is never done silently. Choose what you mean:',
    )
    const buttons = Array.from(dialog.querySelectorAll('button'))
    expect(buttons.map((each) => each.getAttribute('data-testid'))).toEqual([
      'forced-choice-replace',
      'forced-choice-correct',
      'forced-choice-cancel',
    ])
    expect(screen.getByTestId('forced-choice-replace')).toHaveTextContent(
      'Replace in Option B · Widened opening — demolish W-2, add moved successor',
    )
    expect(screen.getByTestId('forced-choice-correct')).toHaveTextContent(
      'Correct Existing Model instead… (all options)',
    )
    expect(screen.getByTestId('forced-choice-cancel')).toHaveTextContent('Cancel — change nothing')
  })

  it('changes nothing on Esc or on Cancel — the revision, and the Existing Model, both untouched', async () => {
    const user = userEvent.setup()
    await renderOverlays()
    const before = canonicalJson(view.project())
    const revisionBefore = revision()
    await ask(() => openForcedChoiceDialog(moveOf(WALL_2, SHIFT_W2), WALL_2, 'combined', 'option-b'))
    await screen.findByTestId('forced-choice-dialog')

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('forced-choice-dialog')).toBeNull())
    expect(canonicalJson(view.project())).toBe(before)
    expect(revision()).toBe(revisionBefore)

    await ask(() => openForcedChoiceDialog(moveOf(WALL_2, SHIFT_W2), WALL_2, 'combined', 'option-b'))
    await screen.findByTestId('forced-choice-dialog')
    await user.click(screen.getByTestId('forced-choice-cancel'))
    await waitFor(() => expect(screen.queryByTestId('forced-choice-dialog')).toBeNull())
    expect(canonicalJson(view.project())).toBe(before)
    expect(revision()).toBe(revisionBefore)
  })

  it('replaces with one demolition record and one successor carrying the moved geometry (#70 criterion 21)', async () => {
    const user = userEvent.setup()
    await renderOverlays()
    const baseline = canonicalJson(view.project().existingModel)
    const demolishedBefore = optionOf(OPTION_B).demolishedIds.length
    const successorsBefore = optionOf(OPTION_B).proposed.walls.length
    // W-1 is the Wall this Option has not touched yet: `Replace` of a Wall it already demolished is a
    // different question, answered by the inspector (#69 §7).
    await ask(() => openForcedChoiceDialog(thickenOf(WALL_1), WALL_1, 'combined', 'option-b'))
    await screen.findByTestId('forced-choice-dialog')

    await user.click(screen.getByTestId('forced-choice-replace'))
    await waitFor(() => expect(screen.queryByTestId('forced-choice-dialog')).toBeNull())

    const option = optionOf(OPTION_B)
    expect(option.demolishedIds.filter((id) => id === WALL_1).length).toBe(1)
    expect(option.demolishedIds.length).toBe(demolishedBefore + 1)
    expect(option.proposed.walls.length).toBe(successorsBefore + 1)
    const made = option.proposed.walls.find((each) => (each.predecessorIds ?? []).includes(WALL_1))
    expect(made?.predecessorIds).toEqual([WALL_1])
    // The survey keeps what it said: the baseline is byte-identical, and the transaction is one step.
    expect(canonicalJson(view.project().existingModel)).toBe(baseline)

    await act(async () => {
      view.session.undo()
    })
    expect(optionOf(OPTION_B).demolishedIds.length).toBe(demolishedBefore)
    expect(optionOf(OPTION_B).proposed.walls.length).toBe(successorsBefore)
    expect(canonicalJson(view.project().existingModel)).toBe(baseline)
  })
})

describe('the danger dialog (#70 §7b)', () => {
  it('lists every Design Option with its effect, and for a retained Wall says so', async () => {
    await renderOverlays()
    await ask(() => openCorrectExistingDialog(moveOf(WALL_6, SHIFT_W6), WALL_6))

    const dialog = await screen.findByTestId('correct-existing-dialog')
    expect(dialog).toHaveTextContent('Correct the shared Existing Model?')
    expect(screen.getByTestId('correct-existing-danger')).toHaveTextContent(
      'This changes the survey baseline, not a Design Option. Every Design Option will see W-6 move:',
    )
    const rows = await screen.findAllByTestId(/^correct-existing-option-/)
    expect(rows.map((each) => rowEffect(each.textContent ?? ''))).toEqual([
      `${OPTION_A} — retains it as Existing`,
      `${OPTION_B} — retains it as Existing`,
    ])
    expect(screen.getByTestId('correct-existing-muted')).toHaveTextContent(
      'One atomic transaction with dependent updates. Use this for measuring errors, not design changes.',
    )
  })

  it('names the demolition and the aligned successor, then moves both in one transaction (#70 criterion 22)', async () => {
    const user = userEvent.setup()
    await renderOverlays()
    const baseline = canonicalJson(view.project().existingModel)
    await ask(() => openCorrectExistingDialog(moveOf(WALL_2, SHIFT_W2), WALL_2))

    const rows = await screen.findAllByTestId(/^correct-existing-option-/)
    expect(rows.map((each) => rowEffect(each.textContent ?? ''))).toEqual([
      `${OPTION_A} — demolishes it (no successor)`,
      `${OPTION_B} — demolishes it; its successor stays aligned`,
    ])
    expect(rows.every((each) => each.querySelector('[role="alert"]') === null)).toBe(true)
    const revisionBefore = revision()

    await user.click(screen.getByTestId('correct-existing-confirm'))
    await waitFor(() => expect(screen.queryByTestId('correct-existing-dialog')).toBeNull())

    // One Edit Transaction, named for the baseline entity the correction moved.
    expect(revision()).toBe(revisionBefore + 1)
    expect(view.session.getSnapshot().history.undoLabel).toBe('Correct Existing Model: W-2')
    // The baseline moved by the 200 mm, and the Option's aligned successor moved with it.
    expect(wallOf(WALL_2)?.line.start.x).toBe(9800)
    const aligned = optionOf(OPTION_B).proposed.walls.find((each) => each.id === SUCCESSOR)
    expect(aligned?.line.start.x).toBe(9800)

    // One undo restores the Existing Model and the dependent update together.
    await act(async () => {
      view.session.undo()
    })
    expect(canonicalJson(view.project().existingModel)).toBe(baseline)
    expect(optionOf(OPTION_B).proposed.walls.find((each) => each.id === SUCCESSOR)?.line.start.x).toBe(9600)
  })
})
