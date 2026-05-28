import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import FloorPlanPlaceholder from './FloorPlanPlaceholder'

describe('FloorPlanPlaceholder', () => {
  it('shows coming soon message', () => {
    render(<FloorPlanPlaceholder />)
    expect(screen.getByText(/floor plan/i)).toBeInTheDocument()
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument()
  })
})
