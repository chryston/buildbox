import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import FloorPlanPage from './FloorPlanPage'
import { projectFloorPlan } from '../../ui/legacy/projectView'
import { openTestView, renderWithBindings as render, type TestView } from '../../ui/legacy/testing'

describe('FloorPlanPage', () => {
  let view: TestView
  beforeEach(async () => { view = await openTestView() })

  it('clicking Sofa 2-seater places it on the Floor', async () => {
    const user = userEvent.setup()
    render(<FloorPlanPage />, view)
    await user.click(screen.getByText('Sofa 2-seater'))
    const objects = projectFloorPlan(view.project(), null).objects
    expect(objects).toHaveLength(1)
    expect(objects[0].type).toBe('sofa-2')
  })

  it('shows Calibrate Scale button', () => {
    render(<FloorPlanPage />, view)
    expect(screen.getByRole('button', { name: /calibrate scale/i })).toBeInTheDocument()
  })

  // The floor-plan JSON export went with the legacy store: a Project Backup carries the whole
  // Project, so there is nothing left for a per-Floor JSON file to be (#53 criterion 2).
  it('offers no floor-plan JSON export', () => {
    render(<FloorPlanPage />, view)
    expect(screen.queryByRole('button', { name: /export json/i })).not.toBeInTheDocument()
  })
})
