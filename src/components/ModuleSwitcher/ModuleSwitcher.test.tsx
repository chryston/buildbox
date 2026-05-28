import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import ModuleSwitcher from './ModuleSwitcher'

describe('ModuleSwitcher', () => {
  it('renders Cabinet and Floor Plan buttons', () => {
    render(<ModuleSwitcher activeModule="cabinet" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: /cabinet/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /floor plan/i })).toBeInTheDocument()
  })

  it('calls onChange with floorplan when Floor Plan clicked', async () => {
    const onChange = vi.fn()
    render(<ModuleSwitcher activeModule="cabinet" onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: /floor plan/i }))
    expect(onChange).toHaveBeenCalledWith('floorplan')
  })

  it('calls onChange with cabinet when Cabinet clicked', async () => {
    const onChange = vi.fn()
    render(<ModuleSwitcher activeModule="floorplan" onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: /cabinet/i }))
    expect(onChange).toHaveBeenCalledWith('cabinet')
  })
})
