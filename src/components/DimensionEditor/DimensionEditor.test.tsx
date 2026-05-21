import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import DimensionEditor from './DimensionEditor'

const anchor = { x: 100, y: 200, width: 60, height: 22 }

describe('DimensionEditor', () => {
  it('renders input with current value', () => {
    render(
      <DimensionEditor
        anchor={anchor}
        currentMm={373}
        unit="mm"
        onCommit={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const input = screen.getByRole('spinbutton') as HTMLInputElement
    expect(input.value).toBe('373')
  })

  it('calls onCommit with new mm value when Enter pressed', () => {
    const onCommit = vi.fn()
    render(
      <DimensionEditor
        anchor={anchor}
        currentMm={373}
        unit="mm"
        onCommit={onCommit}
        onClose={vi.fn()}
      />,
    )
    const input = screen.getByRole('spinbutton')
    fireEvent.change(input, { target: { value: '200' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledWith(200)
  })

  it('calls onClose when Escape pressed', () => {
    const onClose = vi.fn()
    render(
      <DimensionEditor
        anchor={anchor}
        currentMm={373}
        unit="mm"
        onCommit={vi.fn()}
        onClose={onClose}
      />,
    )
    fireEvent.keyDown(screen.getByRole('spinbutton'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
