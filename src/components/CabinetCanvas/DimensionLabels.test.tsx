import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { LayoutVoid } from '../../types'
import DimensionLabels from './DimensionLabels'

function makeTestVoid(id: string, parentSplitAxis: 'horizontal' | 'vertical'): LayoutVoid {
  return {
    nodeId: id, x: 0, y: 0, w: 200, h: 300,
    parentSplitAxis,
    elementType: 'void',
    material: 'oak',
    accessories: [],
  }
}

describe('DimensionLabels font scaling', () => {
  it.each([
    { zoom: 0.5, expectedFontSize: 28 },
    { zoom: 1.0, expectedFontSize: 14 },
    { zoom: 2.0, expectedFontSize: 7  },
  ])('fontSize = 14/zoom: at zoom=$zoom → $expectedFontSize SVG units', ({ zoom, expectedFontSize }) => {
    const { container } = render(
      <svg>
        <DimensionLabels
          voids={[makeTestVoid('v1', 'horizontal')]}
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

describe('DimensionLabels lock icons', () => {
  it('non-editable width label shows lock icon', () => {
    // parentSplitAxis=horizontal → canEditH=true, canEditW=false
    render(
      <svg>
        <DimensionLabels
          voids={[makeTestVoid('n1', 'horizontal')]}
          unit="mm"
          onCommitSize={vi.fn()}
          zoom={1}
        />
      </svg>
    )
    expect(screen.getByTestId('dim-label-n1-w-lock')).toBeInTheDocument()
    expect(screen.queryByTestId('dim-label-n1-h-lock')).not.toBeInTheDocument()
    expect(screen.getByTestId('dim-label-n1-w')).toHaveAttribute('opacity', '0.4')
    expect(screen.getByTestId('dim-label-n1-w')).toHaveAttribute('text-decoration', 'none')
  })

  it('vertical split: width editable (no w-lock), height locked (h-lock present)', () => {
    // parentSplitAxis=vertical → canEditW=true, canEditH=false
    render(
      <svg>
        <DimensionLabels
          voids={[makeTestVoid('n2', 'vertical')]}
          unit="mm"
          onCommitSize={vi.fn()}
          zoom={1}
        />
      </svg>
    )
    expect(screen.queryByTestId('dim-label-n2-w-lock')).not.toBeInTheDocument()
    expect(screen.getByTestId('dim-label-n2-h-lock')).toBeInTheDocument()
    expect(screen.getByTestId('dim-label-n2-w')).toHaveAttribute('opacity', '1')
    expect(screen.getByTestId('dim-label-n2-w')).toHaveAttribute('text-decoration', 'underline')
    expect(screen.getByTestId('dim-label-n2-w')).toHaveAttribute('cursor', 'pointer')
  })

  it('unsplit void (no parentSplitAxis): both labels locked', () => {
    render(
      <svg>
        <DimensionLabels
          voids={[{ nodeId: 'n3', x: 0, y: 0, w: 200, h: 300, elementType: 'void', material: 'oak', accessories: [] }]}
          unit="mm"
          onCommitSize={vi.fn()}
          zoom={1}
        />
      </svg>
    )
    expect(screen.getByTestId('dim-label-n3-w-lock')).toBeInTheDocument()
    expect(screen.getByTestId('dim-label-n3-h-lock')).toBeInTheDocument()
  })
})
