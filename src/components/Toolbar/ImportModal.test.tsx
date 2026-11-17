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

  it('lists the problems of a file it refused, with no way to import it', () => {
    const problems = [
      { path: 'projects[0].id', code: 'missing-field', message: 'Missing an id.' },
      { path: 'projects[0].units', code: 'missing-field', message: 'Missing the cabinets in this project.' },
    ]
    render(<ImportModal problems={problems} onClose={vi.fn()} />)
    expect(screen.getByRole('heading', { name: /can't be imported/i })).toBeInTheDocument()
    expect(screen.getByText('Nothing was changed. BuildBox found these problems:')).toBeInTheDocument()
    expect(screen.getAllByTestId('problem')).toHaveLength(2)
    expect(screen.getByTestId('problem-list')).toHaveTextContent('projects[0].id — Missing an id.')
    expect(screen.queryByRole('button', { name: /replace workspace/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /merge projects/i })).not.toBeInTheDocument()
  })

  it('closes a refused file without importing anything', async () => {
    const onClose = vi.fn()
    render(<ImportModal problems={[{ path: '', code: 'bad-json', message: 'The file is not valid JSON.' }]} onClose={onClose} />)
    expect(screen.getByText('The file is not valid JSON.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onClose when cancelled', async () => {
    const onClose = vi.fn()
    render(<ImportModal incoming={mockIncoming} onConfirm={vi.fn()} onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
