/**
 * Deleting a Design Option that owns the notes (#82 criterion 9, and criterion 14 for one modal).
 *
 * The shipped Notes scene carries no Design Options on purpose — deleting Existing work while Options
 * exist is refused by the baseline rule (#70) before the notes question is ever reached — so the Options
 * case runs against the same scene with Options added and the Island moved into Option B. Deleting that
 * Option is the act that strands C-007 and A-003, and the answer arrives in the *same* modal as the
 * Option's own counts: one question, one Apply, one Edit Transaction.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import type { Project } from '../domain'
import { flush } from '../session/testing'
import { notesSessionStore, PLAN_IMAGE_ACCEPT, WorkspaceProvider, workspaceStore, type WorkspaceServices } from '../ui'
import type { Viewport, ViewportCache } from '../ui'
import { openTestView, renderWithBindings as render, TEST_EXPORT_PORT, type TestView } from '../ui/legacy/testing'

if (!globalThis.PointerEvent) globalThis.PointerEvent = MouseEvent as typeof PointerEvent

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const PX = 0.05

function sceneWithOptions(): Project {
  const text = readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'notes-review-scene.json'), 'utf8')
  const envelope = JSON.parse(text) as { projects: { data: Project }[] }
  const project = structuredClone(envelope.projects[0]!.data)
  const island = project.existingModel.placedItems.find((item) => item.id === 'fp-island')
  if (island === undefined) throw new Error('the scene has no Island to move into Option B')
  const empty = { walls: [], wallJunctions: [], openings: [], rooms: [], placedItems: [], services: [], skirting: [], beams: [] }
  return {
    ...project,
    designOptions: [
      { id: 'option-a', name: 'Option A', demolishedIds: [], proposed: empty },
      { id: 'option-b', name: 'Option B', demolishedIds: [], proposed: { ...empty, placedItems: [{ ...island, predecessorIds: [] }] } },
    ],
    existingModel: { ...project.existingModel, placedItems: project.existingModel.placedItems.filter((item) => item.id !== 'fp-island') },
    annotations: project.annotations.map((mark) => (mark.reference === 'A-003' ? { ...mark, scope: 'option-b' } : mark)),
  }
}

function testWorkspaceServices(): WorkspaceServices {
  const cache = new Map<string, Viewport>()
  const viewportCache: ViewportCache = {
    read: async (viewKey) => cache.get(viewKey),
    write: (viewKey, viewport) => {
      cache.set(viewKey, viewport)
    },
    readActive: async () => null,
    writeActive: () => {},
    readPane: async () => null,
    writePane: () => {},
  }
  return {
    intent: view.services.intent,
    assetUrls: view.services.assetUrls,
    now: () => '2026-01-01T00:00:00.000Z',
    readPlanImage: () => Promise.reject(new Error('jsdom models no file reader')),
    planImageAccept: PLAN_IMAGE_ACCEPT,
    planCatalogue: [{ key: 'sofa-2', label: 'Sofa 2-seater' }],
    viewportCache,
    exportDrawings: TEST_EXPORT_PORT,
  }
}

let view: TestView

beforeEach(async () => {
  view = await openTestView(sceneWithOptions())
  workspaceStore.getState().reset()
  notesSessionStore.getState().reset()
  render(
    <WorkspaceProvider
      session={view.session}
      services={testWorkspaceServices()}
      onReturnToProjects={() => {}}
      onShowSaveFailure={() => {}}
    >
      <App />
    </WorkspaceProvider>,
    view,
    { onWorkspace: true },
  )
  await screen.findByTestId('floor-plan-canvas')
  act(() => workspaceStore.getState().setViewport(`plan:${view.project().floors[0]?.id ?? ''}`, { zoom: PX, panX: 0, panY: 0 }))
})

describe('deleting the Design Option that owns the notes (#82 criterion 9)', () => {
  it('asks in the same modal as the Option counts, and Keep moves C-007 to a Floor Point with All Options', async () => {
    await userEvent.click(screen.getByTestId('project-settings'))
    await screen.findByTestId('design-options-section')
    await userEvent.click(screen.getByTestId('design-option-delete-option-b'))
    await screen.findByTestId('delete-option-dialog')
    const section = screen.getByTestId('notes-review-section')
    expect(section.textContent).toContain('C-007')
    expect(section.textContent).toContain('A-003')
    const confirmButton = screen.getByTestId('delete-option-confirm')
    // Preset to Delete, so Apply is reachable at once — and it is the only Apply in the modal.
    expect(confirmButton.hasAttribute('disabled')).toBe(false)

    const c007 = screen.getAllByTestId('notes-review-row').find((row) => row.textContent?.includes('C-007'))
    if (c007 === undefined) throw new Error('C-007 has no row')
    fireEvent.click(within(c007).getByTestId('notes-review-choice-keep'))
    expect(within(c007).getByText('Keep → Floor Point, All Options')).toBeTruthy()
    await userEvent.click(confirmButton)
    await act(async () => {
      await flush()
    })

    const project = view.project()
    const note = project.comments.find((entry) => entry.reference === 'C-007')
    expect(note?.anchor.kind).toBe('floor_point')
    expect(note?.scope).toBe('all')
    expect(project.annotations.some((entry) => entry.reference === 'A-003')).toBe(false)
    expect((project.designOptions ?? []).some((option) => option.id === 'option-b')).toBe(false)
  })

  it('changes nothing when the Option dialog is cancelled with the notes unanswered', async () => {
    const before = view.session.getSnapshot().revision
    await userEvent.click(screen.getByTestId('project-settings'))
    await screen.findByTestId('design-options-section')
    await userEvent.click(screen.getByTestId('design-option-delete-option-b'))
    await screen.findByTestId('delete-option-dialog')
    await userEvent.click(screen.getByTestId('delete-option-cancel'))
    await act(async () => {
      await flush()
    })
    expect(view.session.getSnapshot().revision).toBe(before)
    expect((view.project().designOptions ?? []).some((option) => option.id === 'option-b')).toBe(true)
    expect(view.project().comments.find((entry) => entry.reference === 'C-007')?.anchor.kind).toBe('entity')
  })
})
