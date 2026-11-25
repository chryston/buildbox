/**
 * `Restore W-2?` — the confirmation a restoration asks for, and what its answer writes (#70 §7d).
 *
 * Restoring is not the mirror of demolishing: the record leaving one Design Option can bring that
 * Option's own proposed work down with it, because a successor stands on the baseline record it
 * replaces. The dialog says which successors fall before anything is written, and the write is one
 * Edit Transaction — one undo brings the record and everything that hung off it back together.
 *
 * The fixture is the `renovation-views` scene: W-2 (`seed-wall-003`) is demolished by both Options,
 * and Option B answers it with `W-2′` (`views-successor-005`), a successor whose predecessor is that
 * very record. Option A demolishes it with no successor at all, which is the other half of the rule:
 * a restoration with nothing standing on the record says nothing about successors.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { currentSchemaOf } from '../domain/testing'
import type { Project } from '../domain'
import { designOptionsOf } from '../domain'
import {
  openRestoreDialog,
  PLAN_IMAGE_ACCEPT,
  RenovationOverlays,
  WorkspaceProvider,
  workspaceStore,
  type WorkspaceServices,
} from '../ui'
import { openTestView, TEST_EXPORT_PORT, type TestView } from '../ui/legacy/testing'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')

/** W-2, demolished by both Options; Option B answers it with the successor `W-2′`. */
const WALL_2 = 'seed-wall-003'
const SUCCESSOR = 'views-successor-005'
const OPTION_A = 'option-a'
const OPTION_B = 'option-b'

function sceneProject(): Project {
  const seed = JSON.parse(
    readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'renovation-views.json'), 'utf8'),
  ) as { projects: { data: Project }[] }
  return currentSchemaOf(seed.projects[0]!.data, 8)
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
    now: () => '2026-01-01T00:00:00.000Z',
    readPlanImage: () => Promise.reject(new Error('jsdom models no file reader')),
    planImageAccept: PLAN_IMAGE_ACCEPT,
    planCatalogue: [],
    viewportCache: { read: async () => undefined, write: () => {}, readActive: async () => null, writeActive: () => {}, readPane: async () => null, writePane: () => {} },
    exportDrawings: TEST_EXPORT_PORT,
  }
}

let view: TestView

async function renderOverlays(project: Project = sceneProject()): Promise<void> {
  view = await openTestView(project)
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
const ask = (open: () => void): Promise<void> => act(async () => { open() })

const optionOf = (optionId: string) => designOptionsOf(view.project()).find((each) => each.id === optionId)!
const successorIds = (): string[] => optionOf(OPTION_B).proposed.walls.map((each) => each.id)

beforeEach(() => {
  workspaceStore.getState().reset()
})

describe('the Restore review', () => {
  it('asks the question with the successor that falls with the record', async () => {
    await renderOverlays()
    const before = JSON.stringify(view.project())
    await ask(() => openRestoreDialog(WALL_2, OPTION_B))

    const dialog = await screen.findByTestId('restore-dialog')
    expect(dialog).toHaveTextContent('Restore W-2?')
    expect(dialog).toHaveTextContent('Removes the demolition record in Option B · Widened opening.')
    expect(dialog).toHaveTextContent('Also deletes successor(s): W-2′')
    // Asking is not doing: the Project is untouched until the answer.
    expect(JSON.stringify(view.project())).toBe(before)
  })

  it('writes the record and the successor as one transaction, and one undo brings both back', async () => {
    const user = userEvent.setup()
    await renderOverlays()
    expect(optionOf(OPTION_B).demolishedIds).toContain(WALL_2)
    expect(successorIds()).toContain(SUCCESSOR)
    const revision = view.session.getSnapshot().revision
    await ask(() => openRestoreDialog(WALL_2, OPTION_B))

    await user.click(await screen.findByTestId('restore-confirm'))

    // One revision for both halves of the answer: the demolition record and the work standing on it.
    expect(view.session.getSnapshot().revision).toBe(revision + 1)
    expect(optionOf(OPTION_B).demolishedIds).not.toContain(WALL_2)
    expect(successorIds()).not.toContain(SUCCESSOR)
    // The transaction is named for the restoration, not for a Display change (#70 §7d).
    const label = view.session.getSnapshot().history?.undoLabel ?? ''
    expect(label).not.toContain('Set Renovation Display')
    expect(label).toMatch(/W-2|Restore/i)

    await act(async () => { view.session.undo() })
    expect(optionOf(OPTION_B).demolishedIds).toContain(WALL_2)
    expect(successorIds()).toContain(SUCCESSOR)
  })

  it('says nothing about successors when none stand on the record', async () => {
    await renderOverlays()
    // The same Wall in the other Option: Option A's record has no successor of its own, and Option
    // B's `W-2′` stands on a record this restoration leaves where it is.
    await ask(() => openRestoreDialog(WALL_2, OPTION_A))

    const dialog = await screen.findByTestId('restore-dialog')
    expect(dialog).toHaveTextContent('Restore W-2?')
    expect(dialog).toHaveTextContent('Removes the demolition record in Option A · Open kitchen.')
    expect(screen.queryByTestId('restore-danger')).not.toBeInTheDocument()
  })

  it('changes nothing on Cancel or Escape', async () => {
    const user = userEvent.setup()
    await renderOverlays()
    const before = JSON.stringify(view.project())

    await ask(() => openRestoreDialog(WALL_2, OPTION_B))
    await user.click(await screen.findByTestId('restore-cancel'))
    expect(screen.queryByTestId('restore-dialog')).not.toBeInTheDocument()

    await ask(() => openRestoreDialog(WALL_2, OPTION_B))
    await user.keyboard('{Escape}')
    expect(screen.queryByTestId('restore-dialog')).not.toBeInTheDocument()
    expect(JSON.stringify(view.project())).toBe(before)
    expect(optionOf(OPTION_B).demolishedIds).toContain(WALL_2)
    expect(successorIds()).toContain(SUCCESSOR)
  })
})
