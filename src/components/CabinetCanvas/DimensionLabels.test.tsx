import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { LayoutVoid } from '../../types'
import DimensionLabels from './DimensionLabels'

function makeVoid(id: string): LayoutVoid {
  return {
    nodeId: id, x: 0, y: 0, w: 200, h: 100,
    parentSplitAxis: 'horizontal',
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
          voids={[makeVoid('v1')]}
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
