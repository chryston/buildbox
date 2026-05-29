import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import ImportModal from './ImportModal'
import type { Design } from '../../types'

const mockIncoming = {
  projects: [{ id: 'p1', name: 'Imported', units: [{ type: 'cabinet' as const, id: 'u1', label: 'Unit 1', x: 0, y: 0, settings: { unit: 'mm' as const, height: 800, width: 600, depth: 500, thickness: 18, backThickness: 6, toeKick: null, material: 'oak' as const }, root: { id: 'r1', elementType: 'void' as const, accessories: [] } }] }] as Design[],
  activeProjectId: 'p1',
}

describe('ImportModal', () => {
  it('renders replace and merge options', () => {
    render(<ImportModal incoming={mockIncoming} onConfirm={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /replace workspace/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /merge projects/i })).toBeInTheDocument()
  })

  it('calls onConfirm with replace when Replace clicked', async () => {
    const onConfirm = vi.fn()
    render(<ImportModal incoming={mockIncoming} onConfirm={onConfirm} onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /replace workspace/i }))
    expect(onConfirm).toHaveBeenCalledWith('replace')
  })

  it('calls onConfirm with merge when Merge clicked', async () => {
    const onConfirm = vi.fn()
    render(<ImportModal incoming={mockIncoming} onConfirm={onConfirm} onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /merge projects/i }))
    expect(onConfirm).toHaveBeenCalledWith('merge')
  })

  it('displays error message when error prop provided', () => {
    render(<ImportModal incoming={mockIncoming} onConfirm={vi.fn()} onClose={vi.fn()} error="Invalid file" />)
    expect(screen.getByText(/invalid file/i)).toBeInTheDocument()
  })

  it('calls onClose when cancelled', async () => {
    const onClose = vi.fn()
    render(<ImportModal incoming={mockIncoming} onConfirm={vi.fn()} onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
