import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import Sidebar from './Sidebar'
import type { CabinetNode } from '../../types'

const baseProps = {
  selectedId: 'v1',
  selectedNode: { id: 'v1', elementType: 'void' } as CabinetNode,
  onAddShelf: vi.fn(),
  onAddDivider: vi.fn(),
  onDelete: vi.fn(),
  onToggleLock: vi.fn(),
  onSetMaterial: vi.fn(),
  onSetElementType: vi.fn(),
  onSetDrawerConfig: vi.fn(),
}

describe('Sidebar', () => {
  it('Add Shelf button calls onAddShelf', () => {
    const onAddShelf = vi.fn()
    render(<Sidebar {...baseProps} onAddShelf={onAddShelf} />)
    fireEvent.click(screen.getByRole('button', { name: /add shelf/i }))
    expect(onAddShelf).toHaveBeenCalledWith('v1')
  })

  it('Add Divider button calls onAddDivider', () => {
    const onAddDivider = vi.fn()
    render(<Sidebar {...baseProps} onAddDivider={onAddDivider} />)
    fireEvent.click(screen.getByRole('button', { name: /add divider/i }))
    expect(onAddDivider).toHaveBeenCalledWith('v1')
  })

  it('Delete button is disabled when no selection', () => {
    render(<Sidebar {...baseProps} selectedId={null} selectedNode={null} />)
    expect(screen.getByRole('button', { name: /delete/i })).toBeDisabled()
  })

  it('exposes material swatches with accessible labels', () => {
    render(<Sidebar {...baseProps} />)
    expect(screen.getByRole('button', { name: 'Oak' })).toBeInTheDocument()
  })

  it('buffers drawer reveal changes until blur', () => {
    const onSetDrawerConfig = vi.fn()
    render(
      <Sidebar
        {...baseProps}
        selectedNode={{
          id: 'v1',
          elementType: 'drawer',
          drawerConfig: { slideType: 'side-mount', reveal: 3 },
        }}
        onSetDrawerConfig={onSetDrawerConfig}
      />,
    )

    const revealInput = screen.getByRole('spinbutton', { name: /reveal/i })
    fireEvent.change(revealInput, { target: { value: '1.5' } })

    expect(onSetDrawerConfig).not.toHaveBeenCalled()
    expect(revealInput).toHaveValue(1.5)

    fireEvent.blur(revealInput)

    expect(onSetDrawerConfig).toHaveBeenCalledWith('v1', {
      slideType: 'side-mount',
      reveal: 1.5,
    })
  })
})
