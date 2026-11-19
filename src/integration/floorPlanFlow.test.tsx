/**
 * The Floor workspace end to end in jsdom (#55): open the workspace, add an item through
 * the toolbar, undo it, redo it, and change the display unit through Project settings.
 *
 * The drag itself is e2e's (`e2e/smoke/workspace.spec.ts`): jsdom's pointer events do not
 * model the capture-and-release sequence the canvas relies on. What jsdom can pin is the
 * wiring — toolbar → Intent → Project → canvas — and that the viewport arrives without a
 * cache entry (the first `Fit`).
 */
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { PLAN_IMAGE_ACCEPT, WorkspaceProvider, type WorkspaceServices } from '../ui'
import { planItemsForFloor, workspaceStore } from '../ui'
import type { Viewport, ViewportCache } from '../ui'
import { openTestView, renderWithBindings as render, type TestView } from '../ui/legacy/testing'

function testWorkspaceServices(): WorkspaceServices {
  const cache = new Map<string, Viewport>()
  const viewportCache: ViewportCache = {
    read: async (viewKey) => cache.get(viewKey),
    write: (viewKey, viewport) => {
      cache.set(viewKey, viewport)
    },
    readActive: async () => null,
    writeActive: () => {},
  }
  return {
    intent: view.services.intent,
    assetUrls: view.services.assetUrls,
    readPlanImage: () => Promise.reject(new Error('jsdom models no file reader')),
    planImageAccept: PLAN_IMAGE_ACCEPT,
    planCatalogue: [
      { key: 'sofa-2', label: 'Sofa 2-seater' },
      { key: 'fridge', label: 'Fridge' },
    ],
    viewportCache,
  }
}

let view: TestView

async function renderWorkspace() {
  const result = render(
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
  // The workspace mounts with the render now, so its one async step — the viewport cache
  // answering for this view — settles inside the test that asked for it, not after.
  await screen.findByTestId('floor-plan-canvas')
  return result
}

describe('the Floor workspace', () => {
  beforeEach(async () => {
    view = await openTestView()
    workspaceStore.getState().reset()
  })

  it('opens on the workspace shell, which is where the app now starts', async () => {
    await renderWorkspace()
    expect(screen.getByTestId('floor-workspace')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-toolbar')).toBeInTheDocument()
    // The cabinet chrome is gone from this module (#55 criterion 1).
    expect(screen.queryByText('Cabinet Design')).not.toBeInTheDocument()
  })

  it('adds an item through the toolbar; the Project holds it and the canvas draws it', async () => {
    const user = userEvent.setup()
    await renderWorkspace()
    await user.click(screen.getByTestId('add-item-menu'))
    await user.click(screen.getByTestId('add-sofa-2'))

    const floorId = view.project().floors[0]?.id ?? null
    expect(floorId).not.toBeNull()
    const items = planItemsForFloor(view.project(), floorId)
    // The Floor's own cabinet placement is drawn here too (#57 criterion 18), so the sofa is
    // the second item on a Floor that started with one cabinet.
    expect(items).toHaveLength(2)
    const sofa = items.find((item) => item.label === 'Sofa 2-seater')
    expect(sofa).toBeDefined()
    expect(items.filter((item) => item.isCabinet)).toHaveLength(1)
    // The first viewport arrives from `Fit` once the host reports a size.
    expect(await screen.findByTestId(`placed-object-${sofa?.id}`)).toBeInTheDocument()
    // Adding selects the placement: the inspector appears in the rail.
    expect(screen.getByTestId('selection-inspector')).toBeInTheDocument()
  })

  it('undoes and redoes the add through the header', async () => {
    const user = userEvent.setup()
    await renderWorkspace()
    await user.click(screen.getByTestId('add-item-menu'))
    await user.click(screen.getByTestId('add-sofa-2'))
    const floorId = view.project().floors[0]?.id ?? null
    expect(planItemsForFloor(view.project(), floorId)).toHaveLength(2)

    await user.click(screen.getByTestId('undo-button'))
    expect(planItemsForFloor(view.project(), floorId)).toHaveLength(1)
    await waitFor(() => expect(screen.getByTestId('undo-button')).toBeDisabled())

    await user.click(screen.getByTestId('redo-button'))
    expect(planItemsForFloor(view.project(), floorId)).toHaveLength(2)
  })

  it('changes the display unit through Project settings, and the inspector follows', async () => {
    const user = userEvent.setup()
    await renderWorkspace()
    await user.click(screen.getByTestId('add-item-menu'))
    await user.click(screen.getByTestId('add-sofa-2'))
    expect(screen.getByTestId('selection-inspector')).toBeInTheDocument()
    const mmWidth = (screen.getByTestId('shape-width') as HTMLInputElement).value

    await user.click(screen.getByTestId('project-settings'))
    await user.selectOptions(screen.getByTestId('settings-unit'), 'cm')
    // The unit change presets the precision to the unit's default (cm → 1 dp).
    expect(screen.getByTestId('settings-precision')).toHaveValue(1)
    await user.click(screen.getByTestId('settings-save'))

    expect(view.project().preferences.displayUnit).toBe('cm')
    expect(view.project().preferences.displayPrecision).toBe(1)
    // The Placed Item's own two rows and the read-only Shape tab's two size fields all carry the
    // unit suffix. The Shape tab's Position rows are gone: a read-only tab reports the shape,
    // not where it is (#58 §2), so the rail does not say `Position X` twice with two meanings.
    expect(screen.getAllByText('(cm)')).toHaveLength(4)
    const width = screen.getByTestId('shape-width')
    expect(width).not.toHaveValue(mmWidth)
    expect(width).not.toHaveValue('')
  })

  it('offers no way to change the Item Footprint from the Floor inspector (#58)', async () => {
    const user = userEvent.setup()
    await renderWorkspace()
    await user.click(screen.getByTestId('add-item-menu'))
    await user.click(screen.getByTestId('add-sofa-2'))

    // The Item Footprint is read here through the same three tabs the Item Design editor has,
    // and nothing in them writes: a footprint change moves every placement of the design, which
    // is why it happens in the Item Design editor and nowhere else (#58 §2).
    expect(screen.getByTestId('inspector-shape')).toBeInTheDocument()
    expect(screen.getByTestId('shape-width')).toHaveAttribute('readonly')
    expect(screen.getByTestId('shape-depth')).toHaveAttribute('readonly')
    expect(screen.getByTestId('shape-convert')).toBeDisabled()
    expect(screen.queryByTestId('shape-placing')).not.toBeInTheDocument()
    expect(screen.queryByTestId('footprint-canvas')).not.toBeInTheDocument()
    expect(screen.getByTestId('open-item-detail')).toHaveTextContent('Edit Item Design')
    // Name and Colour are still the Item Design's own and still editable here.
    expect(screen.getByTestId('design-name')).toBeInTheDocument()
  })
})
