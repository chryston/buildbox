import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
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

  it('lets users type decimal inches before committing on blur', async () => {
    const user = userEvent.setup()

    function ToolbarHarness() {
      const [currentSettings, setCurrentSettings] = useState<GlobalSettings>({
        ...settings,
        unit: 'in',
      })

      return (
        <Toolbar
          settings={currentSettings}
          onSettingsChange={(patch) => setCurrentSettings((prev) => ({ ...prev, ...patch }))}
        />
      )
    }

    render(<ToolbarHarness />)

    const heightInput = screen.getByLabelText('Height') as HTMLInputElement
    await user.clear(heightInput)
    await user.type(heightInput, '1.5')

    expect(heightInput.value).toBe('1.5')

    fireEvent.blur(heightInput)

    expect(heightInput.value).toBe('1.5')
  })

  it('rounds inch display values to four decimals', () => {
    render(
      <Toolbar
        settings={{ ...settings, unit: 'in' }}
        onSettingsChange={vi.fn()}
      />,
    )

    expect((screen.getByLabelText('Height') as HTMLInputElement).value).toBe('31.4961')
  })
})
