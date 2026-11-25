/**
 * The `Annotations` tab, its editor and the canvas selection (#81 §3.3a, §6, §7).
 *
 * The tab lists the view's own Annotations with a live count, the editor writes one field per
 * transaction (text on Enter, a whole style with one field changed, the layer), and a click on a
 * mark on the canvas opens the panel on the Annotations tab with that row selected. The scene is the
 * one-Annotation `placedScene` so the tab has a row to read and edit without a prompt in the way.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import type { Annotation, Project } from '../domain'
import { withAnnotations, withComments } from '../domain/testing'
import { flush } from '../session/testing'
import { notesSessionStore, PLAN_IMAGE_ACCEPT, WorkspaceProvider, workspaceStore, type WorkspaceServices } from '../ui'
import type { Viewport, ViewportCache } from '../ui'
import { openTestView, renderWithBindings as render, TEST_EXPORT_PORT, type TestView } from '../ui/legacy/testing'

if (!globalThis.PointerEvent) globalThis.PointerEvent = MouseEvent as unknown as typeof PointerEvent

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const PX = 0.05

function load(name: string): Project {
  const text = readFileSync(join(fixturesRoot, 'domain', 'v16', name), 'utf8')
  return structuredClone((JSON.parse(text) as { domainSchemaVersion: number; project: Project }).project)
}

function placedScene(): Project {
  const base = withAnnotations(withComments(load('comments.json')))
  return {
    ...base,
    annotationReferenceCounter: 1,
    annotations: [
      { id: 'a-seed', reference: 'A-001', type: 'text', viewId: 'seed-view-001', position: { x: 100, y: 100 }, text: 'seed', layerId: null, scope: 'all' } as Annotation,
    ],
    views: [
      ...base.views,
      { id: 'seed-view-002', kind: 'plan', floorId: 'seed-001', name: 'Upper part', isDefault: false, planViewRange: { lowerMm: 0, upperMm: 2600 }, showPlanImage: true },
    ],
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

async function renderWorkspace(project: Project): Promise<void> {
  view = await openTestView(project)
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
  for (const f of view.project().floors)
    act(() => workspaceStore.getState().setViewport(`plan:${f.id}`, { zoom: PX, panX: 0, panY: 0 }))
}

const stored = (): Annotation[] => view.project().annotations
const flushAll = async (): Promise<void> => {
  await act(async () => {
    await flush()
  })
}

/** Open the panel and switch to the Annotations tab. */
async function openAnnotationsTab(): Promise<void> {
  const toggle = screen.getByTestId('notes-panel-toggle')
  if (toggle.textContent?.includes('Show Notes')) await userEvent.click(toggle)
  await userEvent.click(screen.getByTestId('notes-tab-annotations'))
}

describe('the Annotations tab (#81 §6)', () => {
  beforeEach(async () => {
    await renderWorkspace(placedScene())
  })

  it('counts the view’s Annotations on the tab and lists the row with its type and text', async () => {
    await openAnnotationsTab()
    expect(screen.getByTestId('notes-tab-annotations').textContent).toContain('Annotations 1')
    const row = screen.getByTestId('annotation-row-A-001')
    expect(row.textContent).toContain('A-001 · Text')
    expect(row.textContent).toContain('“seed”')
    expect(row.textContent).toContain('Unlayered')
  })

  it('opens the editor for a selected row and commits its text on Enter as one edit', async () => {
    await openAnnotationsTab()
    await userEvent.click(screen.getByTestId('annotation-select-A-001'))
    const box = screen.getByTestId('annotation-editor-text') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'moved note' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await flushAll()
    expect(stored()[0]?.text).toBe('moved note')
  })

  it('writes a whole style with one field changed when a chip is toggled', async () => {
    await openAnnotationsTab()
    await userEvent.click(screen.getByTestId('annotation-select-A-001'))
    await userEvent.click(screen.getByTestId('annotation-editor-dashed'))
    await flushAll()
    expect(stored()[0]?.style?.dashed).toBe(true)
  })

  it('sends the whole style cleared when reset to the layer style is pressed', async () => {
    await openAnnotationsTab()
    await userEvent.click(screen.getByTestId('annotation-select-A-001'))
    await userEvent.click(screen.getByTestId('annotation-editor-dashed'))
    await flushAll()
    await userEvent.click(screen.getByTestId('annotation-editor-reset'))
    await flushAll()
    expect(stored()[0]?.style ?? null).toBeNull()
  })

  it('opens the panel on the Annotations tab with the row selected when a mark is clicked on the canvas', async () => {
    // Marks draw only with the Notes overlay on; a click on one opens the panel and focuses the row
    // (#81 §3.3a).
    if (screen.getByTestId('notes-overlay-button').getAttribute('aria-pressed') !== 'true')
      await userEvent.click(screen.getByTestId('notes-overlay-button'))
    fireEvent.pointerDown(screen.getByTestId('mark-a-seed'))
    await flushAll()
    expect(screen.getByTestId('notes-tab-annotations').getAttribute('data-active')).toBe('true')
    expect(screen.getByTestId('annotation-row-A-001').getAttribute('data-selected')).toBe('true')
    expect(screen.getByTestId('inspector-annotation').textContent).toContain('A-001')
    expect(screen.getByTestId('inspector-annotation-owner').textContent).toBe('View drawing content')
  })
})
