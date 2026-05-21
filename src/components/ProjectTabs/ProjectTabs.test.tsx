import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import ProjectTabs from './ProjectTabs'

const projects = [
  { id: 'p1', name: 'Cabinet 1' },
  { id: 'p2', name: 'Cabinet 2' },
]

describe('ProjectTabs', () => {
  it('renders all project names as tabs', () => {
    render(<ProjectTabs projects={projects} activeId="p1" onSelect={vi.fn()} onCreate={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByText('Cabinet 1')).toBeInTheDocument()
    expect(screen.getByText('Cabinet 2')).toBeInTheDocument()
  })

  it('calls onSelect when a tab is clicked', () => {
    const onSelect = vi.fn()
    render(<ProjectTabs projects={projects} activeId="p1" onSelect={onSelect} onCreate={vi.fn()} onDelete={vi.fn()} />)
    fireEvent.click(screen.getByText('Cabinet 2'))
    expect(onSelect).toHaveBeenCalledWith('p2')
  })

  it('calls onCreate when + button is clicked', () => {
    const onCreate = vi.fn()
    render(<ProjectTabs projects={projects} activeId="p1" onSelect={vi.fn()} onCreate={onCreate} onDelete={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /new project/i }))
    expect(onCreate).toHaveBeenCalled()
  })
})
