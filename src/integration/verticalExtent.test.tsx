/**
 * The inspector's Vertical Extent rows, driven through the real workspace (#74 §5, criteria 12–17).
 *
 * These run against the #74 fixture scene rather than the default test Project, because the criteria
 * are stated against its numbers: a Wall at 0–2600, a window with a 900 sill, a Wall cabinet standing
 * at 1500 under a ceiling it does not reach. The selection is put on the store rather than clicked
 * out of the canvas — which row the rail shows is the store's answer, and where a click lands is
 * e2e's and the screenshot's business.
 *
 * What is pinned per kind is the thing that differs between kinds: a Wall and an Opening both have a
 * `Height` of their own, a Placed Item has none, and editing its `Top` moves it instead of stretching
 * it. The last case is why the record is dumped and searched for `height` at the end.
 */
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from '../App'
import { designHeight } from '../domain'
import { withComments } from '../domain/testing'
import type { Project } from '../domain'
import { PLAN_IMAGE_ACCEPT, WorkspaceProvider, type WorkspaceServices } from '../ui'
import { workspaceStore } from '../ui'
import type { Viewport, ViewportCache } from '../ui'
import { openTestView, renderWithBindings as render, TEST_EXPORT_PORT, type TestView } from '../ui/legacy/testing'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')

const scene = withComments(
  (
    JSON.parse(readFileSync(join(fixturesRoot, 'domain', 'v9', 'plan-range-scene.json'), 'utf8')) as {
      project: Project
    }
  ).project,
)

const wall = (ref: string) => scene.existingModel.walls.find((each) => each.ref === ref) ?? expect.fail(`no ${ref}`)
const opening = scene.existingModel.openings[0]!
const design = (name: string) => scene.itemDesigns.find((each) => each.name === name) ?? expect.fail(`no ${name}`)
const placement = (name: string) =>
  scene.existingModel.placedItems.find((each) => each.itemDesignId === design(name).id) ?? expect.fail(`no ${name}`)

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

/** The scene's one Floor and one Plan View, with the given entity selected. */
async function openScene(select: () => void): Promise<void> {
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
  await act(async () => {
    select()
    await Promise.resolve()
  })
}

const selectWall = (id: string): Promise<void> => openScene(() => workspaceStore.getState().selectWall(id))
const selectOpening = (): Promise<void> => openScene(() => workspaceStore.getState().selectOpening(opening.id))
const selectItem = (name: string): Promise<void> =>
  openScene(() => workspaceStore.getState().select(placement(name).id))

/** Type a new number into one extent box and commit it with Enter, then let the commit land. */
const typeExtent = async (testId: string, value: string): Promise<void> => {
  const field = screen.getByTestId(testId)
  await userEvent.clear(field)
  await userEvent.type(field, `${value}{enter}`)
  // The session notifies on a microtask after the commit, so the render it causes has to be waited
  // for before the rail can be read again (#49).
  await act(async () => {
    await Promise.resolve()
  })
}

const project = () => view.project()
const wallOf = (ref: string) => {
  const found = project().existingModel.walls.find((each) => each.ref === ref) ?? expect.fail(`no ${ref}`)
  return { base: found.baseElevation, height: found.height, top: found.baseElevation + found.height }
}
const openingOf = () => {
  const found = project().existingModel.openings.find((each) => each.id === opening.id) ?? expect.fail('gone')
  return { sill: found.sill, head: found.head, host: found.hostWallId, height: found.head - found.sill }
}
const itemOf = (name: string) => {
  const found = project().existingModel.placedItems.find((each) => each.id === placement(name).id) ?? expect.fail('gone')
  const height = designHeight(project().itemDesigns.find((each) => each.id === design(name).id)!)
  return { base: found.baseElevation, top: found.baseElevation + height, height }
}

describe('the Vertical Extent rows', () => {
  it('shows a Wall its three own numbers (#74 criterion 12)', async () => {
    await selectWall(wall('W-1').id)
    expect(screen.getByTestId('wall-extent')).toBeInTheDocument()
    expect(screen.getByTestId('wall-extent-base')).toHaveValue(0)
    expect(screen.getByTestId('wall-extent-height')).toHaveValue(2600)
    expect(screen.getByTestId('wall-extent-top')).toHaveValue(2600)
    expect(screen.getByTestId('wall-extent-shown-as').textContent).toBe('Shown as: In range')
    // A Wall has a Height of its own, so there is no read-only line and nothing to fork.
    expect(screen.queryByTestId('wall-extent-height-line')).not.toBeInTheDocument()
  })

  it('shows an Opening its sill by its own name (#74 criterion 12)', async () => {
    await selectOpening()
    const sill = screen.getByTestId('opening-extent-base') as HTMLInputElement
    expect(sill.labels?.[0]?.textContent).toContain('Base (sill)')
    expect(sill).toHaveValue(900)
    expect(screen.getByTestId('opening-extent-height')).toHaveValue(1200)
    expect(screen.getByTestId('opening-extent-top')).toHaveValue(2100)
    expect(screen.getByTestId('opening-extent-shown-as').textContent).toBe('Shown as: In range')
  })

  it('shows a Placed Item two boxes and the height it does not own (#74 criterion 12)', async () => {
    await selectItem('Wall cabinet')
    expect(screen.getByTestId('placed-extent-base')).toHaveValue(1500)
    expect(screen.getByTestId('placed-extent-top')).toHaveValue(2200)
    expect(screen.getByTestId('placed-extent-top-caption').textContent).toBe('moves item')
    expect(screen.queryByTestId('placed-extent-height')).not.toBeInTheDocument()
    expect(screen.getByTestId('placed-extent-height-line').textContent).toBe(
      '700 mm · from Item Design Wall cabinet · shared by 1 placement',
    )
    expect(screen.getByTestId('placed-extent-shown-as').textContent).toBe('Shown as: Above range')
    // `Fork design…` sits under the line whose number it would copy, not at the far end of the rail.
    const line = screen.getByTestId('placed-extent-height-line')
    const fork = screen.getByTestId('placed-extent-fork')
    expect(fork.contains(screen.getByTestId('fork-design'))).toBe(true)
    expect(line.compareDocumentPosition(fork) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('moves a Placed Item when its Top moves, and keeps the Design’s height (#74 criterion 13)', async () => {
    await selectItem('Wall cabinet')
    await typeExtent('placed-extent-top', '2160')
    expect(itemOf('Wall cabinet')).toEqual({ base: 1460, top: 2160, height: 700 })
    expect(screen.getByTestId('placed-extent-base')).toHaveValue(1460)

    await typeExtent('placed-extent-base', '1400')
    expect(itemOf('Wall cabinet')).toEqual({ base: 1400, top: 2100, height: 700 })
  })

  it('keeps a Wall’s Base when its Top moves, and its Base when its Height does (#74 criterion 14)', async () => {
    await selectWall(wall('W-1').id)
    await typeExtent('wall-extent-top', '2400')
    expect(wallOf('W-1')).toEqual({ base: 0, height: 2400, top: 2400 })

    await typeExtent('wall-extent-height', '2500')
    expect(wallOf('W-1')).toEqual({ base: 0, height: 2500, top: 2500 })
  })

  it('lifts an Opening with its sill and never touches its host (#74 criterion 15)', async () => {
    await selectOpening()
    const host = openingOf().host
    await typeExtent('opening-extent-base', '1050')
    expect(openingOf()).toEqual({ sill: 1050, head: 2250, host, height: 1200 })
  })

  it('stores a metre input as exact millimetres (#74 criterion 16)', async () => {
    await selectItem('Wall cabinet')
    await userEvent.click(screen.getByTestId('project-settings'))
    await userEvent.selectOptions(screen.getByTestId('settings-unit'), 'm')
    await userEvent.click(screen.getByTestId('settings-save'))
    expect(screen.getByTestId('placed-extent-top')).toHaveValue(2.2)

    await typeExtent('placed-extent-top', '2.16')
    expect(itemOf('Wall cabinet')).toEqual({ base: 1460, top: 2160, height: 700 })
  })

  it('never writes a height onto a Placed Item (#74 criterion 17)', async () => {
    await selectItem('Wall cabinet')
    await typeExtent('placed-extent-top', '2160')
    await typeExtent('placed-extent-base', '1400')
    const record = project().existingModel.placedItems.find((each) => each.id === placement('Wall cabinet').id)!
    expect(Object.keys(record)).not.toContain('height')
    expect(JSON.stringify(record)).not.toContain('"height"')
  })

  it('refuses a height of nothing, in the edit layer’s own words (#74 §5)', async () => {
    await selectWall(wall('W-1').id)
    await userEvent.clear(screen.getByTestId('wall-extent-height'))
    await userEvent.type(screen.getByTestId('wall-extent-height'), '0{enter}')
    expect(screen.getByTestId('wall-extent-height-error').textContent).toBe('A height has to be more than 0 mm.')
    expect(wallOf('W-1')).toEqual({ base: 0, height: 2600, top: 2600 })
  })
})
