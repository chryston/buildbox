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
    globalSettings: {
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
  }
}

function resetStore() {
  localStorage.clear()
  useStore.setState({
    projects: [createDesign()],
    activeProjectId: 'design-1',
    selectedId: null,
    snapGrid: 5,
  })
  useStore.temporal.getState().clear()
}

describe('Cabinet design flow', () => {
  beforeEach(resetStore)

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
})
