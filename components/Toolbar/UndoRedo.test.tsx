import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import UndoRedo from './UndoRedo'

describe('UndoRedo', () => {
  it('calls onUndo when undo button clicked', () => {
    const onUndo = vi.fn()
    render(<UndoRedo canUndo onUndo={onUndo} canRedo={false} onRedo={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Undo'))
    expect(onUndo).toHaveBeenCalledOnce()
  })

  it('undo button disabled when canUndo is false', () => {
    render(<UndoRedo canUndo={false} onUndo={vi.fn()} canRedo={false} onRedo={vi.fn()} />)
    expect(screen.getByLabelText('Undo')).toBeDisabled()
  })

  it('redo button disabled when canRedo is false', () => {
    render(<UndoRedo canUndo={false} onUndo={vi.fn()} canRedo={false} onRedo={vi.fn()} />)
    expect(screen.getByLabelText('Redo')).toBeDisabled()
  })

  it('calls onRedo when redo button clicked', () => {
    const onRedo = vi.fn()
    render(<UndoRedo canUndo={false} onUndo={vi.fn()} canRedo onRedo={onRedo} />)
    const redoButton = screen.getByLabelText('Redo')
    expect(redoButton).toHaveAttribute('title', 'Redo (Ctrl+Y / Ctrl+Shift+Z)')
    fireEvent.click(redoButton)
    expect(onRedo).toHaveBeenCalledOnce()
  })
})
