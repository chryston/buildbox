import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../../store/store'
import FloorPlanSidebar from './FloorPlanSidebar'

beforeEach(() => {
  useStore.setState({
    floorPlan: {
      image: null,
      pixelsPerMm: null,
      objects: [],
      annotations: [],
      customTemplates: [
        { id: 'ct1', label: 'Study Nook', defaultW: 1200, defaultH: 900, color: '#f59e0b' },
      ],
    },
  })
})

describe('FloorPlanSidebar', () => {
  it('renders all 6 category headings', () => {
    render(
      <FloorPlanSidebar
        onAddObject={vi.fn()}
        onAddCustomTemplate={vi.fn()}
        onAddCustomShape={vi.fn()}
        onSetAnnotationType={vi.fn()}
        activeAnnotationType={null}
      />,
    )
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
    render(<FloorPlanSidebar onAddObject={onAddObject} onAddCustomTemplate={vi.fn()} onAddCustomShape={vi.fn()} onSetAnnotationType={vi.fn()} activeAnnotationType={null} />)
    await user.click(screen.getByText('Sofa 2-seater'))
    expect(onAddObject).toHaveBeenCalledWith('sofa-2')
  })

  it('clicking Wall to Hack calls onSetAnnotationType with wall-hack', async () => {
    const onSetAnnotationType = vi.fn()
    const user = userEvent.setup()
    render(<FloorPlanSidebar onAddObject={vi.fn()} onAddCustomTemplate={vi.fn()} onAddCustomShape={vi.fn()} onSetAnnotationType={onSetAnnotationType} activeAnnotationType={null} />)
    await user.click(screen.getByText('Wall to Hack'))
    expect(onSetAnnotationType).toHaveBeenCalledWith('wall-hack')
  })

  it('active annotation type button uses aria-pressed', () => {
    render(<FloorPlanSidebar onAddObject={vi.fn()} onAddCustomTemplate={vi.fn()} onAddCustomShape={vi.fn()} onSetAnnotationType={vi.fn()} activeAnnotationType="wall-hack" />)
    expect(screen.getByRole('button', { name: /wall to hack/i })).toHaveAttribute('aria-pressed', 'true')
  })

  it('renders saved custom templates and custom-shape action', async () => {
    const onAddCustomTemplate = vi.fn()
    const onAddCustomShape = vi.fn()
    const user = userEvent.setup()
    render(<FloorPlanSidebar onAddObject={vi.fn()} onAddCustomTemplate={onAddCustomTemplate} onAddCustomShape={onAddCustomShape} onSetAnnotationType={vi.fn()} activeAnnotationType={null} />)
    await user.click(screen.getByText('Study Nook'))
    expect(onAddCustomTemplate).toHaveBeenCalledWith('ct1')
    await user.click(screen.getByText('+ Add Custom Shape'))
    expect(onAddCustomShape).toHaveBeenCalled()
  })
})
