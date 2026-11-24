/**
 * The Clearance Envelope group end-to-end through the real UI (#76 §4): the group in the Item
 * Design section reads the Design, adds an envelope as a zone off one Item Footprint edge with a
 * typed Depth, opens the shape editor on the envelope path, edits `Bottom` and `Height`, removes
 * it, and says `shared by <N> placements` — every commit one Edit Transaction on the Design, so
 * one undo puts the whole envelope back.
 */
import { act, fireEvent, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import App from '../App'
import { designHeight } from '../domain'
import type { Project } from '../domain'
import { PLAN_IMAGE_ACCEPT, WorkspaceProvider, type WorkspaceServices } from '../ui'
import { workspaceStore } from '../ui'
import type { Viewport, ViewportCache } from '../ui'
import { openTestView, renderWithBindings as render, TEST_EXPORT_PORT, type TestView } from '../ui/legacy/testing'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')

const scene = (
  JSON.parse(readFileSync(join(fixturesRoot, 'domain', 'v11', 'clearance.json'), 'utf8')) as {
    project: Project
  }
).project

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
    readPlanImage: () => Promise.reject(new Error('jsdom models no file reader')),
    planImageAccept: PLAN_IMAGE_ACCEPT,
    planCatalogue: [],
    viewportCache,
    exportDrawings: TEST_EXPORT_PORT,
  }
}

let view: TestView

/** Mount the workspace over `project` with one placement selected. */
async function open(selectId: string | null): Promise<void> {
  view = await openTestView(structuredClone(scene))
  workspaceStore.getState().reset()
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
  if (selectId !== null) {
    await act(async () => {
      workspaceStore.getState().select(selectId)
      await Promise.resolve()
    })
  }
}

const settle = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
  })
}

const project = () => view.project()
const envelopeOf = (designId: string) =>
  project().itemDesigns.find((each) => each.id === designId)!.clearanceEnvelope ?? null

/** Commit a `Bottom`/`Height` field: type, press Enter, let the Transaction land. */
async function commitField(testId: string, value: string): Promise<void> {
  const field = screen.getByTestId(testId) as HTMLInputElement
  fireEvent.change(field, { target: { value } })
  fireEvent.keyDown(field, { key: 'Enter' })
  await settle()
}

describe('the Clearance Envelope group (#76 §4)', () => {
  it('shows Bottom, Height and Remove for a design that has one, and who it is shared by', async () => {
    await open('pr-005')
    expect(screen.getByTestId('clearance-envelope-section')).toBeInTheDocument()
    expect(screen.getByTestId('clearance-bottom')).toHaveValue(0)
    expect(screen.getByTestId('clearance-height')).toHaveValue(860)
    expect(screen.getByTestId('clearance-remove')).toBeInTheDocument()
    expect(screen.getByTestId('clearance-caption').textContent).toBe('shared by 2 placements')
    expect(envelopeOf('pr-004')).not.toBeNull()
  })

  it('edits Height as one Transaction and one undo restores it', async () => {
    await open('pr-005')
    await commitField('clearance-height', '900')
    expect(envelopeOf('pr-004')!.height).toBe(900)
    expect(envelopeOf('pr-004')!.bottomOffset).toBe(0)
    expect(envelopeOf('pr-004')!.path.segments).toHaveLength(4)
    await act(async () => {
      view.session.undo()
      await Promise.resolve()
    })
    expect(envelopeOf('pr-004')!.height).toBe(860)
  })

  it('edits Bottom too, keeping the path and the height', async () => {
    await open('pr-005')
    await commitField('clearance-bottom', '100')
    const envelope = envelopeOf('pr-004')!
    expect(envelope.bottomOffset).toBe(100)
    expect(envelope.height).toBe(860)
  })

  it('removes the envelope, and one undo puts it back', async () => {
    await open('pr-005')
    fireEvent.click(screen.getByTestId('clearance-remove'))
    await settle()
    expect(envelopeOf('pr-004')).toBeNull()
    // The group has switched to the `Zone off one edge` offer.
    expect(screen.getByTestId('clearance-add')).toBeInTheDocument()
    await act(async () => {
      view.session.undo()
      await Promise.resolve()
    })
    expect(envelopeOf('pr-004')).not.toBeNull()
  })

  it('adds a zone off one edge for a design that has none, with no default depth', async () => {
    await open('pr-011')
    const add = screen.getByTestId('clearance-add') as HTMLButtonElement
    const depth = screen.getByTestId('clearance-depth') as HTMLInputElement
    // Nothing is committed while the Depth is empty, and no number is offered in its place.
    expect(add.disabled).toBe(true)
    expect(depth.value).toBe('')
    expect(depth.placeholder).toContain('measure yours')
    const edge = screen.getByTestId('clearance-edge') as HTMLSelectElement
    const straight = [...edge.options].filter((option) => option.value !== '' && !option.disabled)
    expect(straight.length).toBe(4)
    expect(straight[0]!.textContent).toMatch(/^Edge 1 — \d+(,\d{3})? mm$/)
    fireEvent.change(edge, { target: { value: '0' } })
    expect((screen.getByTestId('clearance-add') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(depth, { target: { value: '300' } })
    await settle()
    expect((screen.getByTestId('clearance-add') as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByTestId('clearance-add'))
    await settle()
    const envelope = envelopeOf('pr-010')!
    expect(envelope).not.toBeNull()
    expect(envelope.bottomOffset).toBe(0)
    expect(envelope.height).toBe(designHeight(project().itemDesigns.find((each) => each.id === 'pr-010')!))
    expect(envelope.path.segments).toHaveLength(4)
    // The zone is the footprint's edge pushed 300 mm outward: a strip 300 deep off a 600 edge.
    const xs = [envelope.path.start, ...envelope.path.segments.map((segment) => segment.to)]
    const width = Math.max(...xs.map((p) => p.x)) - Math.min(...xs.map((p) => p.x))
    const height = Math.max(...xs.map((p) => p.y)) - Math.min(...xs.map((p) => p.y))
    expect([width, height].sort((a, b) => a - b).join('×')).toBe('300×600')
    // The group has switched to the envelope it just made.
    expect(screen.getByTestId('clearance-remove')).toBeInTheDocument()
  })

  it('opens the shape editor on the envelope path from Custom Path…', async () => {
    await open('pr-011')
    expect(screen.queryByTestId('clearance-custom-editor')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('clearance-custom'))
    await settle()
    expect(screen.getByTestId('clearance-custom-editor').querySelector('[data-testid="shape-editor"]')).not.toBeNull()
    // A cabinet's envelope is editable even though its footprint is not: the read-only note the
    // footprint editor shows for a cabinet is absent inside the envelope editor.
    expect(screen.getByTestId('clearance-custom-editor').querySelector('[data-testid="shape-editor-note"]')).toBeNull()
    fireEvent.click(screen.getByTestId('clearance-custom-close'))
    await settle()
    expect(screen.queryByTestId('clearance-custom-editor')).not.toBeInTheDocument()
  })

  it('says so in the Warning strip when an Item is moved into an envelope, and Locate selects it', async () => {
    await open('pr-005')
    // The Tall cupboard moves onto the Base cabinet's Clearance Envelope — the intrusion the
    // producer measures in m² and percent, and the strip is where it gets said.
    await view.dispatch('plan.movePlacement', { placedItemId: 'el-002', translation: { x: 700, y: 800 } })
    await settle()
    fireEvent.click(screen.getByTestId('warning-toggle'))
    await settle()
    const sentences = screen.getAllByTestId(/^warning-sentence-/)
    const intrusion = sentences.find((row) => row.textContent!.includes('Clearance Envelope'))
    expect(intrusion).toBeDefined()
    expect(intrusion!.textContent).toMatch(/^Tall cupboard takes up \d+\.\d\d m² \(\d+%\)/)
    const key = intrusion!.getAttribute('data-testid')!.replace('warning-sentence-', '')
    await act(async () => {
      workspaceStore.getState().select(null)
      await Promise.resolve()
    })
    fireEvent.click(screen.getByTestId(`warning-locate-${key}`))
    await settle()
    // Locate answers for the warning's primary subject: the Item that moved in.
    expect(workspaceStore.getState().selection).toBe('el-002')
  })
})
