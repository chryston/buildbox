import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { useStore } from '../store/store'
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
          defaultMaterial: 'oak',
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
