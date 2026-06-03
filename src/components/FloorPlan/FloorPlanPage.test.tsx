import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import FloorPlanPage from './FloorPlanPage'
import { useStore } from '../../store/store'

function resetStore() {
  useStore.setState({
    projects: [{ id: 'p1', name: 'Test', units: [{ type: 'cabinet', id: 'u1', label: 'Unit 1', x: 0, y: 0, settings: { unit: 'mm', height: 800, width: 600, depth: 500, thickness: 18, backThickness: 6, toeKick: null, material: 'oak' }, root: { id: 'r1', elementType: 'void' } }] }],
    activeProjectId: 'p1', selectedId: null, snapGrid: 5, activeUnitId: 'u1',
    floorPlanSelectedId: null,
    floorPlan: { image: null, pixelsPerMm: null, objects: [], annotations: [], customTemplates: [] },
  })
}

describe('FloorPlanPage', () => {
  beforeEach(resetStore)

  it('clicking Sofa 2-seater adds object to store', async () => {
    const user = userEvent.setup()
    render(<FloorPlanPage />)
    await user.click(screen.getByText('Sofa 2-seater'))
    expect(useStore.getState().floorPlan.objects).toHaveLength(1)
    expect(useStore.getState().floorPlan.objects[0].type).toBe('sofa-2')
  })

  it('shows Calibrate Scale button', () => {
    render(<FloorPlanPage />)
    expect(screen.getByRole('button', { name: /calibrate scale/i })).toBeInTheDocument()
  })
})
