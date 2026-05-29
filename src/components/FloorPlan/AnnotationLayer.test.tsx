import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
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

  it('double-clicking to commit wall-hack does not add a spurious extra point', async () => {
    const onAddAnnotation = vi.fn()
    const user = userEvent.setup()
    const { container } = renderInSvg(
      <AnnotationLayer annotations={[]} activeType="wall-hack" zoom={1} onAddAnnotation={onAddAnnotation} />
    )
    const layer = container.querySelector('[data-layer="annotations"]')!
    // Two single clicks to build the polyline
    await user.click(layer)
    await user.click(layer)
    // Double-click to commit — should NOT add a third point
    await user.dblClick(layer)
    expect(onAddAnnotation).toHaveBeenCalledTimes(1)
    const committed = onAddAnnotation.mock.calls[0][0]
    expect(committed.points).toHaveLength(2)
  })
})
