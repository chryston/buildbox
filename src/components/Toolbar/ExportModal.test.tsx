import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import ExportModal from './ExportModal'
import type { Design } from '../../types'

const mockProjects: Design[] = [
  { id: 'p1', name: 'Cabinet 1', units: [{ type: 'cabinet', id: 'u1', label: 'Unit 1', x: 0, y: 0, settings: { unit: 'mm', height: 800, width: 600, depth: 500, thickness: 18, backThickness: 6, toeKick: null, defaultMaterial: 'oak' }, root: { id: 'r1', elementType: 'void', accessories: [] } }] },
  { id: 'p2', name: 'Cabinet 2', units: [{ type: 'cabinet', id: 'u2', label: 'Unit 1', x: 0, y: 0, settings: { unit: 'mm', height: 800, width: 600, depth: 500, thickness: 18, backThickness: 6, toeKick: null, defaultMaterial: 'oak' }, root: { id: 'r2', elementType: 'void', accessories: [] } }] },
]

describe('ExportModal', () => {
  it('renders export options', () => {
    render(<ExportModal projects={mockProjects} activeProjectId="p1" onClose={vi.fn()} />)
    expect(screen.getByText(/active project/i)).toBeInTheDocument()
    expect(screen.getByText(/all projects/i)).toBeInTheDocument()
  })

  it('calls onClose when cancelled', async () => {
    const onClose = vi.fn()
    render(<ExportModal projects={mockProjects} activeProjectId="p1" onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
