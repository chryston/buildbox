import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import CustomShapeModal from './CustomShapeModal'

describe('CustomShapeModal', () => {
  it('calls onConfirm with label, width, height from form', async () => {
    const onConfirm = vi.fn()
    const user = userEvent.setup()
    render(<CustomShapeModal onConfirm={onConfirm} onClose={vi.fn()} />)

    await user.clear(screen.getByLabelText(/label/i))
    await user.type(screen.getByLabelText(/label/i), 'Study Nook')
    await user.clear(screen.getByLabelText(/width/i))
    await user.type(screen.getByLabelText(/width/i), '1200')
    await user.clear(screen.getByLabelText(/depth/i))
    await user.type(screen.getByLabelText(/depth/i), '900')
    await user.click(screen.getByRole('button', { name: /save/i }))

    expect(onConfirm).toHaveBeenCalledWith('Study Nook', 1200, 900)
  })

  it('calls onClose when cancel is clicked', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<CustomShapeModal onConfirm={vi.fn()} onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
