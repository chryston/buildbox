import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import CutListPanel from './CutListPanel'

describe('CutListPanel', () => {
  it('renders an empty state when there are no entries', () => {
    render(<CutListPanel entries={[]} />)

    expect(screen.getByText('No parts to show')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
