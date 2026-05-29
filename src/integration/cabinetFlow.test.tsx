import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { useStore } from '../store/store'
import { computeSceneLayout } from '../engine/layoutEngine'
import type { Design } from '../types'

function createDesign(): Design {
  return {
    id: 'design-1',
    name: 'Cabinet 1',
    units: [
      {
        type: 'cabinet',
        id: 'unit-1',
        label: 'Unit 1',
        settings: {
          unit: 'mm',
          height: 800,
          width: 600,
          depth: 500,
          thickness: 18,
          backThickness: 6,
          toeKick: null,
          material: 'oak',
        },
        root: { id: 'root', elementType: 'void' },
        x: 0,
        y: 0,
      },
    ],
  }
}

function resetStore() {
  localStorage.clear()
  useStore.setState({
    projects: [createDesign()],
    activeProjectId: 'design-1',
    activeUnitId: 'unit-1',
    selectedId: null,
    snapGrid: 5,
  })
  useStore.temporal.getState().clear()
}

describe('Phase B: multi-unit canvas', () => {
  beforeEach(resetStore)

  it('user adds a second unit, selects it, and sees cut list entries from both units', async () => {
    const user = userEvent.setup()
    render(<App />)

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
  beforeEach(resetStore)

  it('shows cut list in sidebar, removes right panel, and fit-all resets zoom', async () => {
    const user = userEvent.setup()
    render(<App />)

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

  it('creates a project, adds shelf and divider, and supports undo', async () => {
    const user = userEvent.setup()
    render(<App />)

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

  it('shows export and import buttons in toolbar and merge increases project count', async () => {
    const user = userEvent.setup()
    render(<App />)

    // Export and Import buttons are present in the toolbar
    expect(screen.getByRole('button', { name: /export workspace/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /import workspace/i })).toBeInTheDocument()

    // Open export modal and verify options are shown
    await user.click(screen.getByRole('button', { name: /export workspace/i }))
    expect(screen.getByText(/export workspace/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /active project/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /all projects/i })).toBeInTheDocument()

    // Close export modal via cancel
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(screen.queryByRole('button', { name: /active project/i })).not.toBeInTheDocument()

    // Merge via direct store call (file picker can't be tested in jsdom)
    const { projects, activeProjectId, importWorkspace: storeImport } = useStore.getState()
    const active = projects.find((p) => p.id === activeProjectId)!
    const initialCount = projects.length
    storeImport([active], 'merge')
    expect(useStore.getState().projects.length).toBe(initialCount + 1)
  })
})

describe('Polish features E2E', () => {
  beforeEach(resetStore)

  it('user switches to Floor Plan and back, cabinet state preserved', async () => {
    const user = userEvent.setup()
    render(<App />)

    // Add a shelf to the cabinet
    const voids = screen.queryAllByTestId(/^void-/)
    await user.click(voids[0]!)
    await user.click(screen.getByRole('button', { name: /add shelf/i }))

    // Canvas shows the cabinet
    expect(screen.getByTestId('cabinet-canvas')).toBeInTheDocument()

    // Switch to Floor Plan
    await user.click(screen.getByRole('button', { name: /floor plan/i }))
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument()
    expect(screen.queryByTestId('cabinet-canvas')).not.toBeInTheDocument()

    // Switch back to Cabinet — canvas is back and shelf still there
    await user.click(screen.getByRole('button', { name: 'Cabinet' }))
    expect(screen.getByTestId('cabinet-canvas')).toBeInTheDocument()
    // Cut list should show shelf entry
    const table = screen.getByRole('table')
    expect(within(table).getByText(/shelf/i)).toBeInTheDocument()
  })

  it('fit to page button is present and SVG has preserveAspectRatio', () => {
    render(<App />)
    expect(screen.getByLabelText('Fit to screen')).toBeInTheDocument()
    expect(screen.getByTestId('cabinet-canvas')).toHaveAttribute('preserveAspectRatio', 'xMidYMid meet')
  })
})

describe('Feature improvements E2E', () => {
  beforeEach(resetStore)

  it('shelf width becomes editable after adding a divider', () => {
    const state = useStore.getState()
    const rootId = state.projects[0].units[0].root.id
    state.addShelf(rootId)

    const layout1 = computeSceneLayout(
      useStore.getState().projects[0].units, useStore.getState().activeUnitId,
    )
    const topVoid = layout1.units[0].voids[0]
    expect(topVoid.widthControlNodeId).toBeUndefined()

    state.addDivider(topVoid.nodeId)
    const layout2 = computeSceneLayout(
      useStore.getState().projects[0].units, useStore.getState().activeUnitId,
    )
    const innerLeft = layout2.units[0].voids.find(v => v.widthControlNodeId !== undefined)
    expect(innerLeft).toBeDefined()
    expect(innerLeft!.widthControlNodeId).toBeDefined()
  })

  it('canvas label edit resizes without locking (setNodeSize does not lock)', () => {
    const state = useStore.getState()
    const rootId = state.projects[0].units[0].root.id
    state.addShelf(rootId)

    const layout1 = computeSceneLayout(
      useStore.getState().projects[0].units, useStore.getState().activeUnitId,
    )
    const topVoid = layout1.units[0].voids[0]
    const controlId = topVoid.heightControlNodeId ?? topVoid.nodeId
    useStore.getState().setNodeSize(controlId, 200)

    const unit = useStore.getState().projects[0].units.find(u => u.id === useStore.getState().activeUnitId)!
    const controlNode = unit.root.id === controlId ? unit.root
      : unit.root.children?.find(c => c.id === controlId)
    expect(controlNode?.fixedSize).toBe(200)
    expect(controlNode?.locked).not.toBe(true)

    const layout2 = computeSceneLayout(
      useStore.getState().projects[0].units, useStore.getState().activeUnitId,
    )
    expect(layout2.units[0].voids.find(v => v.nodeId === topVoid.nodeId)!.h).toBe(200)
  })

  it('pinned void size unchanged when sibling is resized', () => {
    const state = useStore.getState()
    const rootId = state.projects[0].units[0].root.id
    state.addShelf(rootId)

    const layout1 = computeSceneLayout(
      useStore.getState().projects[0].units, useStore.getState().activeUnitId,
    )
    const topVoid = layout1.units[0].voids[0]
    const bottomVoid = layout1.units[0].voids[1]
    const originalTopH = topVoid.h

    useStore.getState().pinNode(topVoid.nodeId, topVoid.h)
    useStore.getState().setNodeSize(bottomVoid.heightControlNodeId ?? bottomVoid.nodeId, 100)

    const layout2 = computeSceneLayout(
      useStore.getState().projects[0].units, useStore.getState().activeUnitId,
    )
    expect(layout2.units[0].voids.find(v => v.nodeId === topVoid.nodeId)!.h).toBe(originalTopH)
  })

  it('setCabinetMaterial changes material for all panels and voids', () => {
    useStore.getState().setCabinetMaterial('walnut')
    const layout = computeSceneLayout(
      useStore.getState().projects[0].units, useStore.getState().activeUnitId,
    )
    layout.units[0].voids.forEach(v => expect(v.material).toBe('walnut'))
    layout.units[0].panels.forEach(p => expect(p.material).toBe('walnut'))
  })

  it('setNodeLabel makes spaceLabel visible in layout', () => {
    const rootId = useStore.getState().projects[0].units[0].root.id
    useStore.getState().setNodeLabel(rootId, 'Storage')
    const layout = computeSceneLayout(
      useStore.getState().projects[0].units, useStore.getState().activeUnitId,
    )
    expect(layout.units[0].voids[0].spaceLabel).toBe('Storage')
  })

  it('distributeEvenly gives all column voids equal height', () => {
    const rootId = useStore.getState().projects[0].units[0].root.id
    useStore.getState().addShelf(rootId)

    const layout1 = computeSceneLayout(
      useStore.getState().projects[0].units, useStore.getState().activeUnitId,
    )
    useStore.getState().addShelf(layout1.units[0].voids[1].nodeId)

    const layout2 = computeSceneLayout(
      useStore.getState().projects[0].units, useStore.getState().activeUnitId,
    )
    expect(layout2.units[0].voids).toHaveLength(3)
    const voids = layout2.units[0].voids
    const evenH = voids.reduce((sum, v) => sum + v.h, 0) / 3
    useStore.getState().distributeEvenly(voids[0].columnRootId!, evenH)

    const layout3 = computeSceneLayout(
      useStore.getState().projects[0].units, useStore.getState().activeUnitId,
    )
    const heights = layout3.units[0].voids.map(v => Math.round(v.h))
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(2)
  })
})
