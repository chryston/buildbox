import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import ZoomControls, { ZOOM_MAX, ZOOM_MIN } from './ZoomControls'

describe('ZoomControls', () => {
  it('calls onZoomIn when + clicked', async () => {
    const onZoomIn = vi.fn()
    render(<ZoomControls zoom={1} onZoomIn={onZoomIn} onZoomOut={vi.fn()} onFitAll={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /zoom in/i }))
    expect(onZoomIn).toHaveBeenCalledOnce()
  })

  it('calls onZoomOut when − clicked', async () => {
    const onZoomOut = vi.fn()
    render(<ZoomControls zoom={1} onZoomIn={vi.fn()} onZoomOut={onZoomOut} onFitAll={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /zoom out/i }))
    expect(onZoomOut).toHaveBeenCalledOnce()
  })

  it('calls onFitAll when ⊡ clicked', async () => {
    const onFitAll = vi.fn()
    render(<ZoomControls zoom={1} onZoomIn={vi.fn()} onZoomOut={vi.fn()} onFitAll={onFitAll} />)
    await userEvent.click(screen.getByRole('button', { name: /fit to screen/i }))
    expect(onFitAll).toHaveBeenCalledOnce()
  })

  it('disables + button at ZOOM_MAX', () => {
    render(<ZoomControls zoom={ZOOM_MAX} onZoomIn={vi.fn()} onZoomOut={vi.fn()} onFitAll={vi.fn()} />)
    expect(screen.getByRole('button', { name: /zoom in/i })).toBeDisabled()
  })

  it('disables − button at ZOOM_MIN', () => {
    render(<ZoomControls zoom={ZOOM_MIN} onZoomIn={vi.fn()} onZoomOut={vi.fn()} onFitAll={vi.fn()} />)
    expect(screen.getByRole('button', { name: /zoom out/i })).toBeDisabled()
  })
})
