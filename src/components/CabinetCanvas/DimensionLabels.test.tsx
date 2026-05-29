import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CabinetNode, LayoutVoid } from '../../types'
import DimensionLabels from './DimensionLabels'

function makeVoid(overrides: Partial<LayoutVoid> = {}): LayoutVoid {
  return {
    nodeId: 'v1', x: 50, y: 50, w: 200, h: 200,
    elementType: 'void', material: 'oak', accessories: [],
    ...overrides,
  }
}

describe('DimensionLabels font scaling', () => {
  it.each([
    { zoom: 0.5, expectedFontSize: 24 },
    { zoom: 1.0, expectedFontSize: 12 },
    { zoom: 2.0, expectedFontSize: 8  },
  ])('fontSize = Math.max(12/zoom,8): at zoom=$zoom → $expectedFontSize SVG units', ({ zoom, expectedFontSize }) => {
    const { container } = render(
      <svg>
        <DimensionLabels
          voids={[makeVoid({ heightControlNodeId: 'v1' })]}
          unit="mm"
          onCommitSize={() => {}}
          zoom={zoom}
        />
      </svg>
    )
    for (const t of container.querySelectorAll('text')) {
      expect(Number(t.getAttribute('font-size'))).toBe(expectedFontSize)
    }
  })
})

describe('editability using control node IDs', () => {
  it('width label is clickable when widthControlNodeId is set', () => {
    const onCommit = vi.fn()
    render(
      <svg>
        <DimensionLabels voids={[makeVoid({ widthControlNodeId: 'v1' })]}
          unit="mm" onCommitSize={onCommit} zoom={1} />
      </svg>
    )
    const label = screen.getByTestId('dim-label-v1-w')
    expect(label).toHaveAttribute('cursor', 'pointer')
  })

  it('width label shows lock icon when widthControlNodeId is absent', () => {
    render(
      <svg>
        <DimensionLabels voids={[makeVoid()]} unit="mm" onCommitSize={vi.fn()} zoom={1} />
      </svg>
    )
    expect(screen.getByTestId('lock-icon-v1-w')).toBeInTheDocument()
  })

  it('height label shows lock icon when heightControlNodeId is absent', () => {
    render(
      <svg>
        <DimensionLabels voids={[makeVoid()]} unit="mm" onCommitSize={vi.fn()} zoom={1} />
      </svg>
    )
    expect(screen.getByTestId('lock-icon-v1-h')).toBeInTheDocument()
  })

  it('pinned void shows lock icons on both labels (via selectedNode prop)', () => {
    const pinnedNode: CabinetNode = { id: 'v1', elementType: 'void', locked: true, fixedSize: 200 }
    render(
      <svg>
        <DimensionLabels
          voids={[makeVoid({ heightControlNodeId: 'v1', widthControlNodeId: 'v1' })]}
          selectedNode={pinnedNode}
          unit="mm" onCommitSize={vi.fn()} zoom={1} />
      </svg>
    )
    expect(screen.getByTestId('lock-icon-v1-h')).toBeInTheDocument()
    expect(screen.getByTestId('lock-icon-v1-w')).toBeInTheDocument()
  })
})

describe('spaceLabel overlay', () => {
  it('renders spaceLabel text when set', () => {
    render(
      <svg>
        <DimensionLabels
          voids={[makeVoid({ spaceLabel: 'Pots' })]}
          unit="mm" onCommitSize={vi.fn()} zoom={1} />
      </svg>
    )
    expect(screen.getByTestId('space-label-v1')).toHaveTextContent('Pots')
  })
})

describe('DimensionLabels lock icons (backward compat)', () => {
  it('unsplit void: both width and height labels are non-editable', () => {
    render(
      <svg>
        <DimensionLabels
          voids={[makeVoid()]}
          unit="mm"
          onCommitSize={vi.fn()}
          zoom={1}
        />
      </svg>
    )
    expect(screen.getByTestId('lock-icon-v1-w')).toBeInTheDocument()
    expect(screen.getByTestId('lock-icon-v1-h')).toBeInTheDocument()
    expect(screen.getByTestId('dim-label-v1-w')).toHaveAttribute('cursor', 'default')
    expect(screen.getByTestId('dim-label-v1-h')).toHaveAttribute('cursor', 'default')
  })

  it('void with only heightControlNodeId: only h is editable', () => {
    render(
      <svg>
        <DimensionLabels
          voids={[makeVoid({ heightControlNodeId: 'v1' })]}
          unit="mm"
          onCommitSize={vi.fn()}
          zoom={1}
        />
      </svg>
    )
    expect(screen.queryByTestId('lock-icon-v1-h')).not.toBeInTheDocument()
    expect(screen.getByTestId('lock-icon-v1-w')).toBeInTheDocument()
    expect(screen.getByTestId('dim-label-v1-h')).toHaveAttribute('cursor', 'pointer')
  })
})
