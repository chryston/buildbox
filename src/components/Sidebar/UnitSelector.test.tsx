import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import UnitSelector from './UnitSelector'
import type { CabinetSceneUnit } from '../../types'

const baseSettings = { unit: 'mm' as const, height: 800, width: 600, depth: 500, thickness: 18, backThickness: 6, toeKick: null, defaultMaterial: 'oak' as const }

function makeUnit(id: string, label: string): CabinetSceneUnit {
  return { type: 'cabinet', id, label, x: 0, y: 0, settings: baseSettings, root: { id: `r-${id}`, elementType: 'void' } }
}

const noop = () => {}

describe('UnitSelector', () => {
  it('renders all unit labels', () => {
    const units = [makeUnit('u1', 'Base Left'), makeUnit('u2', 'Upper')]
    render(<UnitSelector units={units} activeUnitId="u1" onSelect={noop} onAdd={noop} onRemove={noop} onRename={noop} />)
    expect(screen.getByDisplayValue('Base Left')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Upper')).toBeInTheDocument()
  })

  it('clicking a unit fires onSelect with its id', async () => {
    const user = userEvent.setup()
    const units = [makeUnit('u1', 'Base'), makeUnit('u2', 'Upper')]
    const onSelect = vi.fn()
    render(<UnitSelector units={units} activeUnitId="u1" onSelect={onSelect} onAdd={noop} onRemove={noop} onRename={noop} />)
    await user.click(screen.getByDisplayValue('Upper'))
    expect(onSelect).toHaveBeenCalledWith('u2')
  })

  it('"Add unit" button fires onAdd', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    render(<UnitSelector units={[makeUnit('u1', 'Base')]} activeUnitId="u1" onSelect={noop} onAdd={onAdd} onRemove={noop} onRename={noop} />)
    await user.click(screen.getByRole('button', { name: /add unit/i }))
    expect(onAdd).toHaveBeenCalled()
  })

  it('"Remove" button hidden when only 1 unit', () => {
    render(<UnitSelector units={[makeUnit('u1', 'Base')]} activeUnitId="u1" onSelect={noop} onAdd={noop} onRemove={noop} onRename={noop} />)
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument()
  })

  it('"Remove" button visible and fires onRemove when >= 2 units', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    const units = [makeUnit('u1', 'Base'), makeUnit('u2', 'Upper')]
    render(<UnitSelector units={units} activeUnitId="u1" onSelect={noop} onAdd={noop} onRemove={onRemove} onRename={noop} />)
    await user.click(screen.getAllByRole('button', { name: /remove/i })[0])
    expect(onRemove).toHaveBeenCalledWith('u1')
  })

  it('rename field fires onRename on blur', async () => {
    const user = userEvent.setup()
    const onRename = vi.fn()
    render(<UnitSelector units={[makeUnit('u1', 'Base')]} activeUnitId="u1" onSelect={noop} onAdd={noop} onRemove={noop} onRename={onRename} />)
    const input = screen.getByDisplayValue('Base')
    await user.clear(input)
    await user.type(input, 'New Name')
    await user.tab()
    expect(onRename).toHaveBeenCalledWith('u1', 'New Name')
  })
})
