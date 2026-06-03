import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import ScaleCalibrationModal from './ScaleCalibrationModal'

describe('ScaleCalibrationModal', () => {
  it('calls onConfirm with pixelsPerMm = distancePx / mm', async () => {
    const onConfirm = vi.fn()
    const user = userEvent.setup()
    render(<ScaleCalibrationModal distancePx={500} onConfirm={onConfirm} onClose={vi.fn()} />)

    await user.clear(screen.getByRole('spinbutton'))
    await user.type(screen.getByRole('spinbutton'), '2500')
    await user.click(screen.getByRole('button', { name: /confirm/i }))

    expect(onConfirm).toHaveBeenCalledWith(500 / 2500)  // 0.2
  })

  it('calls onClose when cancel clicked', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<ScaleCalibrationModal distancePx={500} onConfirm={vi.fn()} onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalled()
  })

  it('does not call onConfirm if mm input is 0', async () => {
    const onConfirm = vi.fn()
    const user = userEvent.setup()
    render(<ScaleCalibrationModal distancePx={500} onConfirm={onConfirm} onClose={vi.fn()} />)
    await user.clear(screen.getByRole('spinbutton'))
    await user.type(screen.getByRole('spinbutton'), '0')
    await user.click(screen.getByRole('button', { name: /confirm/i }))
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
