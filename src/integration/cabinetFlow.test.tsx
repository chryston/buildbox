import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { computeSceneLayout } from '../cabinet'
import { projectUnits } from '../ui/legacy/projectView'
import { testCabinet } from '../session/testing'
import { openTestView, renderWithBindings as render, type TestView } from '../ui/legacy/testing'

/**
 * The whole app, clicked. Every write goes through a session over the in-memory store, so the
 * assertions read the Project the session committed — the equivalent of reading the store, with
 * the history, the revision and the validation that comes with a real write (#49, #53).
 */
let view: TestView
beforeEach(async () => { view = await openTestView() })

/** The one cabinet's design id, which is what the view calls the unit. */
const designId = (): string => testCabinet(view.project()).id
const rootId = (): string => testCabinet(view.project()).construction.root.id
const layoutOf = () => computeSceneLayout(projectUnits(view.project()), designId())

describe('Phase B: multi-unit canvas', () => {
  it('user adds a second unit, selects it, and sees cut list entries from both units', async () => {
    const user = userEvent.setup()
    render(<App />, view)

    // Initial state: 1 unit "Unit 1" in sidebar
    expect(screen.getByDisplayValue('Unit 1')).toBeInTheDocument()

    // Add a second unit
    await user.click(screen.getByRole('button', { name: /add unit/i }))

    // Unit 2 should appear in sidebar
    expect(screen.getByDisplayValue('Unit 2')).toBeInTheDocument()

    // Click Unit 2 to select it
    await user.click(screen.getByDisplayValue('Unit 2'))

    // Canvas should now show 2 unit groups
    const canvas = screen.getByTestId('cabinet-canvas')
    expect(within(canvas).getAllByTestId('unit-group')).toHaveLength(2)

    // Open cut list (in sidebar details — summary element acts as button)
    const aside = screen.getByRole('complementary')
    const cutListSummary = within(aside).getByText(/cut list/i, { selector: 'summary' })
    await user.click(cutListSummary)

    // Both unit sections should appear in cut list
    expect(within(aside).getAllByText('Unit 1').length).toBeGreaterThan(0)
    expect(within(aside).getAllByText('Unit 2').length).toBeGreaterThan(0)
  })
})

describe('Cabinet design flow', () => {
  it('shows cut list in sidebar, removes right panel, and fit-all resets zoom', async () => {
    const user = userEvent.setup()
    render(<App />, view)

    // Cut list lives inside the sidebar <aside>, not in a standalone right panel
    const aside = screen.getByRole('complementary')
    expect(within(aside).getAllByText(/cut list/i).length).toBeGreaterThan(0)

    // Zoom controls are rendered on the canvas
    const zoomInBtn = screen.getByRole('button', { name: /zoom in/i })
    const zoomOutBtn = screen.getByRole('button', { name: /zoom out/i })
    const fitAllBtn = screen.getByRole('button', { name: /fit to screen/i })
    expect(zoomInBtn).toBeInTheDocument()
    expect(zoomOutBtn).toBeInTheDocument()
    expect(fitAllBtn).toBeInTheDocument()

    // Saturate zoom to ZOOM_MAX so fit-all has real signal
    // 1.25^11 ≈ 11.6 > ZOOM_MAX=10, so 12 clicks is sufficient
    for (let i = 0; i < 12; i++) await user.click(zoomInBtn)
    expect(zoomInBtn).toBeDisabled()

    // Fit-all resets zoom to 1 — zoom-in re-enables
    await user.click(fitAllBtn)
    expect(zoomInBtn).toBeEnabled()
  })

  it('adds a shelf and a divider, and supports undo', async () => {
    const user = userEvent.setup()
    render(<App />, view)

    expect(screen.getByTestId('cabinet-canvas')).toBeInTheDocument()

    const voids = screen.queryAllByTestId(/^void-/)
    const initialVoid = voids[0] ?? null
    expect(initialVoid).not.toBeNull()
    await user.click(initialVoid!)

    const addShelfButton = screen.getByRole('button', { name: /add shelf/i })
    expect(addShelfButton).toBeEnabled()
    await user.click(addShelfButton)

    await waitFor(() => {
      expect(screen.queryAllByTestId(/^dim-label-/).length).toBeGreaterThanOrEqual(2)
    })

    const shelfVoids = screen.queryAllByTestId(/^void-/)
    expect(shelfVoids).toHaveLength(2)
    await user.click(shelfVoids[0]!)

    await user.click(screen.getByRole('button', { name: /add divider/i }))

    await waitFor(() => {
      expect(screen.queryAllByTestId(/^void-/)).toHaveLength(3)
    })

    const cutListTable = screen.getByRole('table')
    expect(within(cutListTable).getByText(/side panel/i)).toBeInTheDocument()
    expect(within(cutListTable).getByText(/shelf/i)).toBeInTheDocument()
    expect(within(cutListTable).getByText(/divider/i)).toBeInTheDocument()

    await user.keyboard('{Control>}z{/Control}')

    await waitFor(() => {
      expect(screen.queryAllByTestId(/^void-/)).toHaveLength(2)
      expect(within(screen.getByRole('table')).queryByText(/divider/i)).not.toBeInTheDocument()
    })
  })

  // The workspace JSON export and import were the toolbar's. Download Backup replaced them at
  // S4, so the app has no file input at all and no modal behind one (#53 criterion 2).
  it('offers no workspace export, import or file input', () => {
    render(<App />, view)
    expect(document.querySelector('input[type="file"]')).toBeNull()
    expect(screen.queryByRole('button', { name: /export workspace/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /import workspace/i })).not.toBeInTheDocument()
  })
})

describe('Polish features E2E', () => {
  it('user switches to Floor Plan and back, cabinet state preserved', async () => {
    const user = userEvent.setup()
    render(<App />, view)

    // Add a shelf to the cabinet
    const voids = screen.queryAllByTestId(/^void-/)
    await user.click(voids[0]!)
    await user.click(screen.getByRole('button', { name: /add shelf/i }))

    // Canvas shows the cabinet
    expect(screen.getByTestId('cabinet-canvas')).toBeInTheDocument()

    // Switch to Floor Plan — the workspace shell replaces the cabinet chrome (#55).
    await user.click(screen.getByRole('button', { name: /floor plan/i }))
    expect(screen.getByTestId('floor-workspace')).toBeInTheDocument()
    expect(screen.queryByTestId('cabinet-canvas')).not.toBeInTheDocument()

    // Switch back to Cabinet — canvas is back and shelf still there
    await user.click(screen.getByRole('button', { name: 'Cabinet' }))
    expect(screen.getByTestId('cabinet-canvas')).toBeInTheDocument()
    // Cut list should show shelf entry
    const table = screen.getByRole('table')
    expect(within(table).getByText(/shelf/i)).toBeInTheDocument()
  })

  it('fit to page button is present and SVG has preserveAspectRatio', () => {
    render(<App />, view)
    expect(screen.getByLabelText('Fit to screen')).toBeInTheDocument()
    expect(screen.getByTestId('cabinet-canvas')).toHaveAttribute('preserveAspectRatio', 'xMidYMid meet')
  })
})

describe('Feature improvements E2E', () => {
  it('shelf width becomes editable after adding a divider', async () => {
    await view.dispatch('cabinet.addShelf', { itemDesignId: designId(), nodeId: rootId() })

    const topVoid = layoutOf().units[0].voids[0]
    expect(topVoid.widthControlNodeId).toBeUndefined()

    await view.dispatch('cabinet.addDivider', { itemDesignId: designId(), nodeId: topVoid.nodeId })
    const innerLeft = layoutOf().units[0].voids.find((v) => v.widthControlNodeId !== undefined)
    expect(innerLeft).toBeDefined()
    expect(innerLeft!.widthControlNodeId).toBeDefined()
  })

  it('canvas label edit resizes without locking (setNodeSize does not lock)', async () => {
    await view.dispatch('cabinet.addShelf', { itemDesignId: designId(), nodeId: rootId() })

    const topVoid = layoutOf().units[0].voids[0]
    const controlId = topVoid.heightControlNodeId ?? topVoid.nodeId
    await view.dispatch('cabinet.setNodeSize', { itemDesignId: designId(), nodeId: controlId, sizeMm: 200 })

    const root = testCabinet(view.project()).construction.root
    const controlNode = root.id === controlId
      ? root
      : root.children?.find((child) => child.id === controlId)
    expect(controlNode?.fixedSize).toBe(200)
    expect(controlNode?.locked).not.toBe(true)

    expect(layoutOf().units[0].voids.find((v) => v.nodeId === topVoid.nodeId)!.h).toBe(200)
  })

  it('pinned void size unchanged when sibling is resized', async () => {
    await view.dispatch('cabinet.addShelf', { itemDesignId: designId(), nodeId: rootId() })

    const [topVoid, bottomVoid] = layoutOf().units[0].voids
    const originalTopH = topVoid.h

    await view.dispatch('cabinet.pinNode', { itemDesignId: designId(), nodeId: topVoid.nodeId, sizeMm: topVoid.h })
    await view.dispatch('cabinet.setNodeSize', {
      itemDesignId: designId(),
      nodeId: bottomVoid.heightControlNodeId ?? bottomVoid.nodeId,
      sizeMm: 100,
    })

    expect(layoutOf().units[0].voids.find((v) => v.nodeId === topVoid.nodeId)!.h).toBe(originalTopH)
  })

  it('setCabinetMaterial changes material for all panels and voids', async () => {
    await view.dispatch('cabinet.setMaterial', { itemDesignId: designId(), material: 'walnut' })

    const layout = layoutOf()
    layout.units[0].voids.forEach((v) => expect(v.material).toBe('walnut'))
    layout.units[0].panels.forEach((p) => expect(p.material).toBe('walnut'))
  })

  it('setNodeLabel makes spaceLabel visible in layout', async () => {
    await view.dispatch('cabinet.setNodeLabel', { itemDesignId: designId(), nodeId: rootId(), label: 'Storage' })

    expect(layoutOf().units[0].voids[0].spaceLabel).toBe('Storage')
  })

  it('distributeEvenly gives all column voids equal height', async () => {
    await view.dispatch('cabinet.addShelf', { itemDesignId: designId(), nodeId: rootId() })
    await view.dispatch('cabinet.addShelf', { itemDesignId: designId(), nodeId: layoutOf().units[0].voids[1].nodeId })

    const voids = layoutOf().units[0].voids
    expect(voids).toHaveLength(3)
    const evenH = voids.reduce((sum, v) => sum + v.h, 0) / 3
    await view.dispatch('cabinet.distributeEvenly', { itemDesignId: designId(), columnRootId: voids[0].columnRootId!, evenH })

    const heights = layoutOf().units[0].voids.map((v) => Math.round(v.h))
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(2)
  })
})
