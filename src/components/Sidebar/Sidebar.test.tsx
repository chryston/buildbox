import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import Sidebar from './Sidebar'
import type { AccessoryType, CabinetNode } from '../../types'

const baseProps = {
  selectedId: 'v1',
  selectedNode: { id: 'v1', elementType: 'void' } as CabinetNode,
  onAddShelf: vi.fn(),
  onAddDivider: vi.fn(),
  onDelete: vi.fn(),
  onToggleLock: vi.fn(),
  onSetCabinetMaterial: vi.fn(),
  onSetElementType: vi.fn(),
  onSetDrawerConfig: vi.fn(),
  onAddAccessory: vi.fn(),
  onRemoveAccessory: vi.fn(),
}

describe('Sidebar', () => {
  it('Add Shelf button calls onAddShelf', () => {
    const onAddShelf = vi.fn()
    render(<Sidebar {...baseProps} onAddShelf={onAddShelf} />)
    fireEvent.click(screen.getByRole('button', { name: /add shelf/i }))
    expect(onAddShelf).toHaveBeenCalledWith('v1')
  })

  it('Add Divider button calls onAddDivider', () => {
    const onAddDivider = vi.fn()
    render(<Sidebar {...baseProps} onAddDivider={onAddDivider} />)
    fireEvent.click(screen.getByRole('button', { name: /add divider/i }))
    expect(onAddDivider).toHaveBeenCalledWith('v1')
  })

  it('Delete button is disabled when no selection', () => {
    render(<Sidebar {...baseProps} selectedId={null} selectedNode={null} />)
    expect(screen.getByRole('button', { name: /delete/i })).toBeDisabled()
  })

  it('exposes material swatches with accessible labels', () => {
    render(<Sidebar {...baseProps} />)
    expect(screen.getByRole('button', { name: 'Oak' })).toBeInTheDocument()
  })

  it('buffers drawer reveal changes until blur', () => {
    const onSetDrawerConfig = vi.fn()
    render(
      <Sidebar
        {...baseProps}
        selectedNode={{
          id: 'v1',
          elementType: 'drawer',
          drawerConfig: { slideType: 'side-mount', reveal: 3 },
        }}
        onSetDrawerConfig={onSetDrawerConfig}
      />,
    )

    const revealInput = screen.getByRole('spinbutton', { name: /reveal/i })
    fireEvent.change(revealInput, { target: { value: '1.5' } })

    expect(onSetDrawerConfig).not.toHaveBeenCalled()
    expect(revealInput).toHaveValue(1.5)

    fireEvent.blur(revealInput)

    expect(onSetDrawerConfig).toHaveBeenCalledWith('v1', {
      slideType: 'side-mount',
      reveal: 1.5,
    })
  })

  it('shows accessory actions and removal controls for selected node', () => {
    const onAddAccessory = vi.fn()
    const onRemoveAccessory = vi.fn()

    render(
      <Sidebar
        {...baseProps}
        selectedNode={{
          id: 'v1',
          elementType: 'void',
          accessories: [{ id: 'a1', type: 'door', label: 'Main door' }],
        }}
        onAddAccessory={onAddAccessory}
        onRemoveAccessory={onRemoveAccessory}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '+ door' }))
    expect(onAddAccessory).toHaveBeenCalledWith('v1', 'door' satisfies AccessoryType)

    fireEvent.click(screen.getByRole('button', { name: /remove main door/i }))
    expect(onRemoveAccessory).toHaveBeenCalledWith('v1', 'a1')
  })
})

import type { LayoutVoid } from '../../types'

const mockVoid: LayoutVoid = {
  nodeId: 'v1', x: 0, y: 0, w: 200, h: 200,
  elementType: 'void', material: 'oak', accessories: [],
  heightControlNodeId: 'v1',
  columnRootId: 'parent',
}

describe('Even Space button', () => {
  it('shows Even Space button when selectedVoid has columnRootId and evenH is provided', () => {
    render(
      <Sidebar
        {...baseProps}
        selectedVoid={mockVoid}
        evenH={200}
        onDistributeEvenly={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: /even space/i })).toBeInTheDocument()
  })

  it('calls onDistributeEvenly with columnRootId and evenH when clicked', () => {
    const onDistributeEvenly = vi.fn()
    render(
      <Sidebar
        {...baseProps}
        selectedVoid={mockVoid}
        evenH={200}
        onDistributeEvenly={onDistributeEvenly}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /even space/i }))
    expect(onDistributeEvenly).toHaveBeenCalledWith('parent', 200)
  })

  it('does not show Even Space button when selectedVoid has no columnRootId', () => {
    const voidNoColumn: LayoutVoid = { ...mockVoid, columnRootId: undefined }
    render(
      <Sidebar
        {...baseProps}
        selectedVoid={voidNoColumn}
        evenH={200}
        onDistributeEvenly={vi.fn()}
      />
    )
    expect(screen.queryByRole('button', { name: /even space/i })).not.toBeInTheDocument()
  })
})

describe('Global material swatch', () => {
  it('material swatch calls onSetCabinetMaterial', () => {
    const onSetCabinetMaterial = vi.fn()
    render(<Sidebar {...baseProps} onSetCabinetMaterial={onSetCabinetMaterial} currentMaterial="oak" />)
    fireEvent.click(screen.getByRole('button', { name: 'Walnut' }))
    expect(onSetCabinetMaterial).toHaveBeenCalledWith('walnut')
  })
})
