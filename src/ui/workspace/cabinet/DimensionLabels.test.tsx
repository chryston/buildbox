import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Unit } from '../../../domain'
import DimensionLabels from './DimensionLabels'
import type { DimensionEditing, LabelEditing } from './DimensionLabels'
import type { UnitLayout } from './layout'

/**
 * The two inline editors a cabinet section offers (#60).
 *
 * The measurements themselves are drawn by `drawing/itemDetail.ts` and tested there; what is
 * left here is the part that is not a drawing — the target that names a section and the
 * millimetre field that resizes one.
 */

const mm: Unit = 'mm'

function makeVoid(overrides: Record<string, unknown> = {}) {
  return {
    nodeId: 'v1', x: 50, y: 50, w: 200, h: 200,
    elementType: 'void', material: 'oak', accessories: [],
    widthControlNodeId: 'w-ctrl', heightControlNodeId: 'h-ctrl',
    ...overrides,
  }
}

function makeUnit(voids: ReturnType<typeof makeVoid>[], overrides: Record<string, unknown> = {}): UnitLayout {
  return {
    kind: 'cabinet',
    unitId: 'u1',
    label: 'Unit 1',
    isActive: true,
    x: 0,
    y: 0,
    w: 300,
    h: 300,
    unit: mm,
    panels: [],
    voids,
    dividers: [],
    overConstrainedIds: [],
    ...overrides,
  } as unknown as UnitLayout
}

function renderLabels(props: Partial<React.ComponentProps<typeof DimensionLabels>> = {}) {
  const onOpenLabel = vi.fn()
  const onCommitLabel = vi.fn()
  const onCommitSize = vi.fn()
  const onClose = vi.fn()
  const onCloseLabel = vi.fn()
  const result = render(
    <svg>
      <DimensionLabels
        units={[makeUnit([makeVoid()])]}
        unit={mm}
        zoom={1}
        editing={null}
        labelEditing={null}
        onOpenLabel={onOpenLabel}
        onCommitLabel={onCommitLabel}
        onCommitSize={onCommitSize}
        onClose={onClose}
        onCloseLabel={onCloseLabel}
        {...props}
      />
    </svg>,
  )
  return { ...result, onOpenLabel, onCommitLabel, onCommitSize, onClose, onCloseLabel }
}

describe('naming a section', () => {
  it('opens the name field where the section is drawn, in scene coordinates', () => {
    const { onOpenLabel } = renderLabels()
    // The target is the middle half of the section: 50 + 200/4 = 100, and 200/2 = 100 wide.
    fireEvent.doubleClick(screen.getByTestId('section-name-v1'))
    expect(onOpenLabel).toHaveBeenCalledWith({
      nodeId: 'v1', svgX: 100, svgY: 100, svgW: 100, current: '',
    })
  })

  it('carries the section\'s own label into the field', () => {
    const { onOpenLabel } = renderLabels({ units: [makeUnit([makeVoid({ spaceLabel: 'Wine' })])] })
    fireEvent.doubleClick(screen.getByTestId('section-name-v1'))
    expect(onOpenLabel.mock.calls[0][0].current).toBe('Wine')
  })

  it('shifts the field by the unit\'s place in the scene', () => {
    const { onOpenLabel } = renderLabels({ units: [makeUnit([makeVoid()], { x: 700, y: 40 })] })
    fireEvent.doubleClick(screen.getByTestId('section-name-v1'))
    expect(onOpenLabel.mock.calls[0][0]).toMatchObject({ svgX: 800, svgY: 140 })
  })

  it('types in place, and Enter writes one label and closes', () => {
    const labelEditing: LabelEditing = { nodeId: 'v1', svgX: 100, svgY: 100, svgW: 100, current: 'Wine' }
    const { onCommitLabel, onCloseLabel } = renderLabels({ labelEditing })
    const field = document.querySelector('foreignObject input') as HTMLInputElement
    expect(field).not.toBeNull()
    expect(field.value).toBe('Wine')

    fireEvent.change(field, { target: { value: 'Books' } })
    fireEvent.keyDown(field, { key: 'Enter' })

    expect(onCommitLabel).toHaveBeenCalledWith('v1', 'Books')
    expect(onCloseLabel).toHaveBeenCalledTimes(1)
  })

  it('Escape closes without writing', () => {
    const labelEditing: LabelEditing = { nodeId: 'v1', svgX: 100, svgY: 100, svgW: 100, current: 'Wine' }
    const { onCommitLabel, onCloseLabel } = renderLabels({ labelEditing })
    const field = document.querySelector('foreignObject input') as HTMLInputElement

    fireEvent.keyDown(field, { key: 'Escape' })

    expect(onCommitLabel).not.toHaveBeenCalled()
    expect(onCloseLabel).toHaveBeenCalledTimes(1)
  })
})

describe('resizing a section', () => {
  const editing: DimensionEditing = {
    nodeId: 'v1', axis: 'h', currentMm: 400,
    anchor: { x: 0, y: 0, width: 40, height: 12 },
  }

  it('opens a millimetre field holding the measurement it replaces', () => {
    renderLabels({ editing })
    const field = document.querySelector('input') as HTMLInputElement
    expect(field.value).toBe('400')
  })

  it('writes the typed size to the axis that opened it, then closes', () => {
    const { onCommitSize, onClose } = renderLabels({ editing })
    const field = document.querySelector('input') as HTMLInputElement

    fireEvent.change(field, { target: { value: '350' } })
    fireEvent.keyDown(field, { key: 'Enter' })

    expect(onCommitSize).toHaveBeenCalledWith('v1', 350, 'h')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Escape closes without writing', () => {
    const { onCommitSize, onClose } = renderLabels({ editing })
    const field = document.querySelector('input') as HTMLInputElement

    fireEvent.keyDown(field, { key: 'Escape' })

    expect(onCommitSize).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
