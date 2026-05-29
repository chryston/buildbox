import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../../store/store'
import PlacedObject from './PlacedObject'
import type { FloorPlanObject } from '../../types'

// jsdom doesn't implement setPointerCapture; silence the unhandled error
Element.prototype.setPointerCapture = vi.fn()

const sofa: FloorPlanObject = {
  id: 'o1', type: 'sofa-2', label: 'Sofa', x: 100, y: 200,
  w: 1500, h: 800, rotation: 0, color: '#6366f1',
}

function resetStore(selectedId: string | null = null, obj: FloorPlanObject = sofa) {
  useStore.setState({
    floorPlanSelectedId: selectedId,
    floorPlan: {
      image: null,
      pixelsPerMm: null,
      objects: [obj],
      annotations: [],
      customTemplates: [],
    },
  })
}

function renderInSvg(ui: React.ReactNode) {
  return render(<svg viewBox="0 0 3000 2000">{ui}</svg>)
}

describe('PlacedObject', () => {
  beforeEach(() => resetStore())

  it('renders label text from store state', () => {
    renderInSvg(<PlacedObject id="o1" zoom={1} />)
    expect(screen.getByText('Sofa')).toBeInTheDocument()
  })

  it('clicking object selects it in the store', async () => {
    const user = userEvent.setup()
    renderInSvg(<PlacedObject id="o1" zoom={1} />)
    await user.click(screen.getByTestId('placed-object-o1'))
    expect(useStore.getState().floorPlanSelectedId).toBe('o1')
  })

  it('shows resize handles when selected', () => {
    resetStore('o1')
    renderInSvg(<PlacedObject id="o1" zoom={1} />)
    expect(screen.getAllByTestId(/^resize-handle-/)).toHaveLength(8)
  })

  it('hides resize handles when not selected', () => {
    renderInSvg(<PlacedObject id="o1" zoom={1} />)
    expect(screen.queryAllByTestId(/^resize-handle-/)).toHaveLength(0)
  })
})
