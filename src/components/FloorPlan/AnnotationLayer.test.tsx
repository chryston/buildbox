import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import AnnotationLayer from './AnnotationLayer'
import type { Annotation } from '../../types'

const wallHack: Annotation = {
  id: 'a1', type: 'wall-hack',
  points: [{ x: 0, y: 0 }, { x: 200, y: 0 }],
}
const tileZone: Annotation = {
  id: 'a2', type: 'tile-zone',
  points: [{ x: 50, y: 50 }, { x: 300, y: 200 }],
}

function renderInSvg(ui: React.ReactNode) {
  return render(<svg>{ui}</svg>)
}

describe('AnnotationLayer', () => {
  it('renders wall-hack as a polyline', () => {
    const { container } = renderInSvg(
      <AnnotationLayer annotations={[wallHack]} activeType={null} zoom={1} onAddAnnotation={vi.fn()} />
    )
    const polyline = container.querySelector('polyline')
    expect(polyline).toBeInTheDocument()
    expect(polyline?.getAttribute('points')).toBe('0,0 200,0')
  })

  it('renders tile-zone as a rect', () => {
    const { container } = renderInSvg(
      <AnnotationLayer annotations={[tileZone]} activeType={null} zoom={1} onAddAnnotation={vi.fn()} />
    )
    const rect = container.querySelector('rect')
    expect(rect).toBeInTheDocument()
    expect(rect?.getAttribute('x')).toBe('50')
    expect(rect?.getAttribute('y')).toBe('50')
    expect(rect?.getAttribute('width')).toBe('250')
    expect(rect?.getAttribute('height')).toBe('150')
  })
})
