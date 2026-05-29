import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { useStore } from '../store/store'

function resetStore() {
  useStore.setState({
    projects: [{
      id: 'p1',
      name: 'Test Project',
      units: [{
        id: 'u1',
        type: 'cabinet',
        label: 'Unit 1',
        x: 0, y: 0,
        settings: { unit: 'mm', height: 800, width: 600, depth: 500, thickness: 18, backThickness: 6, toeKick: null, material: 'oak' },
        root: { id: 'r1', elementType: 'void' }
      }]
    }],
    activeProjectId: 'p1',
    selectedId: null,
    snapGrid: 5,
    activeUnitId: 'u1',
    floorPlanSelectedId: null,
    floorPlan: { image: null, pixelsPerMm: null, objects: [], annotations: [], customTemplates: [] },
  })
}

describe('Floor plan integration', () => {
  beforeEach(resetStore)

  it('user navigates to Floor Plan tab, adds a sofa, sofa appears in store', async () => {
    const user = userEvent.setup()
    render(<App />)

    // Navigate to Floor Plan module
    await user.click(screen.getByRole('button', { name: /floor plan/i }))

    // Add an object from the sidebar
    await user.click(screen.getByText('Sofa 2-seater'))

    // Verify it was added to the store
    const objects = useStore.getState().floorPlan.objects
    expect(objects).toHaveLength(1)
    expect(objects[0].type).toBe('sofa-2')
  })
})
