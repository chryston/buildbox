import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import FloorPlanProperties from './FloorPlanProperties'
import type { FloorPlanObject } from '../../types'

const sofa: FloorPlanObject = {
  id: 'o1', type: 'sofa-2', label: 'Sofa', x: 0, y: 0,
  w: 1500, h: 800, rotation: 0, color: '#6366f1',
}

describe('FloorPlanProperties', () => {
  it('shows empty state when no object selected', () => {
    render(<FloorPlanProperties obj={null} onUpdate={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByText(/select an object/i)).toBeInTheDocument()
  })

  it('shows selected object label', () => {
    render(<FloorPlanProperties obj={sofa} onUpdate={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByDisplayValue('Sofa')).toBeInTheDocument()
  })

  it('rotate button cycles rotation 0→90', async () => {
    const onUpdate = vi.fn()
    const user = userEvent.setup()
    render(<FloorPlanProperties obj={sofa} onUpdate={onUpdate} onDelete={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /rotate/i }))
    expect(onUpdate).toHaveBeenCalledWith('o1', { rotation: 90 })
  })

  it('delete button calls onDelete', async () => {
    const onDelete = vi.fn()
    const user = userEvent.setup()
    render(<FloorPlanProperties obj={sofa} onUpdate={vi.fn()} onDelete={onDelete} />)
    await user.click(screen.getByRole('button', { name: /delete/i }))
    expect(onDelete).toHaveBeenCalledWith('o1')
  })

  it('width input calls onUpdate with new w', async () => {
    const onUpdate = vi.fn()
    const user = userEvent.setup()
    render(<FloorPlanProperties obj={sofa} onUpdate={onUpdate} onDelete={vi.fn()} />)
    const widthInput = screen.getByLabelText(/width/i)
    await user.clear(widthInput)
    await user.type(widthInput, '2000')
    await user.tab()
    expect(onUpdate).toHaveBeenCalledWith('o1', { w: 2000 })
  })
})
