import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import Toolbar from './Toolbar'
import type { GlobalSettings } from '../../domain'

const settings: GlobalSettings = {
  unit: 'mm', height: 800, width: 600, depth: 500,
  thickness: 18, backThickness: 6, toeKick: null, material: 'oak',
}

describe('Toolbar', () => {
  it('calls onSettingsChange with new unit when toggle clicked', () => {
    const onChange = vi.fn()
    render(<Toolbar settings={settings} onSettingsChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'cm' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ unit: 'cm' }))
  })

  // The workspace JSON export and import lived here. Download Backup replaced them at S4 and
  // the toolbar has no file input to offer either of them (#53 criterion 2).
  it('offers no file input and no workspace export', () => {
    render(<Toolbar settings={settings} onSettingsChange={vi.fn()} />)
    expect(document.querySelector('input[type="file"]')).toBeNull()
    expect(screen.queryByRole('button', { name: /export workspace/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /import workspace/i })).not.toBeInTheDocument()
  })

  it('shows the save status as plain text when there is no dialog to open', () => {
    render(<Toolbar settings={settings} onSettingsChange={vi.fn()} saveStatus={{ text: 'Saved', failed: false }} />)
    expect(screen.getByRole('status')).toHaveTextContent('Saved')
    expect(screen.queryByRole('button', { name: 'Saved' })).not.toBeInTheDocument()
  })

  it('makes a failed status open the dialog it describes (#51 criterion 10)', () => {
    const onClick = vi.fn()
    render(
      <Toolbar
        settings={settings}
        onSettingsChange={vi.fn()}
        saveStatus={{ text: 'Save failed', failed: true }}
        onSaveStatusClick={onClick}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save failed' }))
    expect(onClick).toHaveBeenCalled()
  })
})
