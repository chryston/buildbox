import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import WarningBanner from './WarningBanner'

describe('WarningBanner', () => {
  it('renders nothing when no over-constrained ids', () => {
    const { container } = render(<WarningBanner overConstrainedIds={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders warning message when over-constrained', () => {
    render(<WarningBanner overConstrainedIds={['a', 'b']} />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText(/2 sections are over-constrained/)).toBeInTheDocument()
  })
})
