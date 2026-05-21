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
  useStore.setState((state) => ({
    ...state,
    projects: [createDesign()],
    activeProjectId: 'design-1',
    selectedId: null,
    snapGrid: 10,
  }))
  useStore.temporal.getState().clear()
}

describe('Cabinet design flow', () => {
  beforeEach(resetStore)

  it('creates a project, adds shelf and divider, and supports undo', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /new project/i }))

    expect(screen.getByTestId('cabinet-canvas')).toBeInTheDocument()

    const initialVoid = document.querySelector('[data-testid^="void-"]') as HTMLElement | null
    expect(initialVoid).not.toBeNull()
    await user.click(initialVoid!)

    const addShelfButton = screen.getByRole('button', { name: /add shelf/i })
    expect(addShelfButton).toBeEnabled()
    await user.click(addShelfButton)

    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid^="dim-label-"]').length).toBeGreaterThanOrEqual(2)
    })

    const shelfVoids = document.querySelectorAll('[data-testid^="void-"]')
    expect(shelfVoids).toHaveLength(2)
    await user.click(shelfVoids[0] as HTMLElement)

    await user.click(screen.getByRole('button', { name: /add divider/i }))

    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid^="void-"]')).toHaveLength(3)
    })

    const cutListTable = screen.getByRole('table')
    expect(within(cutListTable).getByText('Side panel')).toBeInTheDocument()
    expect(within(cutListTable).getByText('Shelf')).toBeInTheDocument()
    expect(within(cutListTable).getByText('Divider')).toBeInTheDocument()

    await user.keyboard('{Control>}z{/Control}')

    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid^="void-"]')).toHaveLength(2)
      expect(within(screen.getByRole('table')).queryByText('Divider')).not.toBeInTheDocument()
    })
  })
})
