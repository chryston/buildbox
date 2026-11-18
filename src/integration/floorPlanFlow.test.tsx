import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { projectFloorPlan } from '../ui/legacy/projectView'
import { openTestView, renderWithBindings as render, type TestView } from '../ui/legacy/testing'

describe('Floor plan integration', () => {
  let view: TestView
  beforeEach(async () => { view = await openTestView() })

  it('user navigates to Floor Plan tab, adds a sofa, the Project holds it', async () => {
    const user = userEvent.setup()
    render(<App />, view)

    // Navigate to Floor Plan module
    await user.click(screen.getByRole('button', { name: /floor plan/i }))

    // Add an object from the sidebar
    await user.click(screen.getByText('Sofa 2-seater'))

    // The placement is in the Project the session is holding, and the canvas draws it.
    const objects = projectFloorPlan(view.project(), null).objects
    expect(objects).toHaveLength(1)
    expect(objects[0].type).toBe('sofa-2')
    expect(screen.getByTestId(`placed-object-${objects[0].id}`)).toBeInTheDocument()
  })
})
