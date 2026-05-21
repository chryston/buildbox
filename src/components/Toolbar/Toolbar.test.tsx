import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import Toolbar from './Toolbar'
import type { GlobalSettings } from '../../types'

const settings: GlobalSettings = {
  unit: 'mm', height: 800, width: 600, depth: 500,
  thickness: 18, backThickness: 6, toeKick: null, defaultMaterial: 'oak',
}

describe('Toolbar', () => {
  it('calls onSettingsChange with new unit when toggle clicked', () => {
    const onChange = vi.fn()
    render(<Toolbar settings={settings} onSettingsChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'cm' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ unit: 'cm' }))
  })
})
