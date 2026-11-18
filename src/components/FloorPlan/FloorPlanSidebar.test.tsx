import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import FloorPlanSidebar from './FloorPlanSidebar'
import { projectFloorPlan } from '../../ui/legacy/projectView'
import { openTestView, renderWithBindings as render, type TestView } from '../../ui/legacy/testing'

/** The sidebar as the page renders it, with the props that are not the point of a test here. */
const sidebar = (props: Partial<React.ComponentProps<typeof FloorPlanSidebar>> = {}) => (
  <FloorPlanSidebar
    onAddObject={vi.fn()}
    onAddCustomTemplate={vi.fn()}
    onAddCustomShape={vi.fn()}
    onSetAnnotationType={vi.fn()}
    activeAnnotationType={null}
    {...props}
  />
)

describe('FloorPlanSidebar', () => {
  let view: TestView
  beforeEach(async () => { view = await openTestView() })

  it('renders all 6 category headings', () => {
    render(sidebar(), view)
    expect(screen.getByText('Seating')).toBeInTheDocument()
    expect(screen.getByText('Sleeping')).toBeInTheDocument()
    expect(screen.getByText('Appliances')).toBeInTheDocument()
    expect(screen.getByText('Bathroom')).toBeInTheDocument()
    expect(screen.getByText('Lighting & Other')).toBeInTheDocument()
    expect(screen.getByText('Carpentry')).toBeInTheDocument()
  })

  it('clicking an object type calls onAddObject with that type', async () => {
    const onAddObject = vi.fn()
    const user = userEvent.setup()
    render(sidebar({ onAddObject }), view)
    await user.click(screen.getByText('Sofa 2-seater'))
    expect(onAddObject).toHaveBeenCalledWith('sofa-2')
  })

  it('clicking Wall to Hack calls onSetAnnotationType with wall-hack', async () => {
    const onSetAnnotationType = vi.fn()
    const user = userEvent.setup()
    render(sidebar({ onSetAnnotationType, onAddAnnotation: vi.fn() }), view)
    await user.click(screen.getByText('Wall to Hack'))
    expect(onSetAnnotationType).toHaveBeenCalledWith('wall-hack')
  })

  it('hides the sketch tools where the app cannot save an annotation', () => {
    render(sidebar(), view)
    expect(screen.queryByRole('button', { name: /wall to hack/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /floor to tile/i })).not.toBeInTheDocument()
  })

  it('active annotation type button uses aria-pressed', () => {
    render(sidebar({ activeAnnotationType: 'wall-hack', onAddAnnotation: vi.fn() }), view)
    expect(screen.getByRole('button', { name: /wall to hack/i })).toHaveAttribute('aria-pressed', 'true')
  })

  it('renders saved custom templates and custom-shape action', async () => {
    const onAddCustomTemplate = vi.fn()
    const onAddCustomShape = vi.fn()
    const user = userEvent.setup()
    // A Custom Shape that has been drawn and saved but not placed: what the sidebar lists.
    await view.dispatch('plan.addTemplate', { label: 'Study Nook', w: 1200, h: 900, color: '#f59e0b' })
    const [template] = projectFloorPlan(view.project(), null).customTemplates
    if (template === undefined) throw new Error('the Project holds no Custom Shape')

    render(sidebar({ onAddCustomTemplate, onAddCustomShape }), view)
    await user.click(screen.getByText('Study Nook'))
    expect(onAddCustomTemplate).toHaveBeenCalledWith(template.id)
    await user.click(screen.getByText('+ Add Custom Shape'))
    expect(onAddCustomShape).toHaveBeenCalled()
  })
})
