import { createRef } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import DragHandles, { snapToAlignment } from './DragHandles'
import type { LayoutDivider } from './layout'

/**
 * The divider handle (#60). A finished drag used to reach the store through the bindings seam;
 * it now reaches the app through one callback, so these tests watch that callback and check the
 * arithmetic the handle owns — pointer space, zoom, the snap grid, and the sibling's share.
 */

const DIVIDER = {
  nodeId: 'top-shelf',
  parentId: 'root',
  childAId: 'top',
  childBId: 'bottom',
  x: 0,
  y: 100,
  w: 200,
  h: 18,
  axis: 'horizontal',
  material: 'oak',
  childABounds: { x: 0, y: 0, w: 200, h: 100 },
  childBBounds: { x: 0, y: 118, w: 200, h: 100 },
} as LayoutDivider & { parentId: string }

describe('DragHandles', () => {
  beforeAll(() => {
    if (!globalThis.PointerEvent) {
      globalThis.PointerEvent = MouseEvent as typeof PointerEvent
    }
  })

  function renderDragHandles({
    divider,
    snapGrid = 1,
    zoom = 1,
  }: {
    divider: LayoutDivider & { parentId: string }
    snapGrid?: number
    zoom?: number
  }) {
    const svgRef = createRef<SVGSVGElement>()
    const setPointerCapture = vi.fn()
    const onCommitDrag = vi.fn()

    const { container } = render(
      <svg ref={svgRef}>
        <DragHandles
          dividers={[divider]}
          snapGrid={snapGrid}
          svgRef={svgRef}
          zoom={zoom}
          onCommitDrag={onCommitDrag}
        />
      </svg>,
    )

    const svg = container.querySelector('svg') as SVGSVGElement
    Object.defineProperty(svg, 'viewBox', {
      value: { baseVal: { width: 200 } },
      configurable: true,
    })
    svg.getBoundingClientRect = () => ({ width: 200 } as DOMRect)

    const handle = screen.getByTestId(`drag-handle-${divider.nodeId}`)
    ;((handle as unknown) as SVGRectElement & { setPointerCapture: ReturnType<typeof vi.fn> }).setPointerCapture = setPointerCapture

    return { handle, setPointerCapture, onCommitDrag }
  }

  it('anchors handle movement to the initial handle position during drag', () => {
    const { handle } = renderDragHandles({ divider: DIVIDER })

    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 0 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 10 })
    expect(handle).toHaveAttribute('y', '113')

    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 20 })
    expect(handle).toHaveAttribute('y', '123')

    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 30 })
    expect(handle).toHaveAttribute('y', '133')
  })

  it('scales pointer movement by zoom before committing the drag ratio', () => {
    const { handle, onCommitDrag } = renderDragHandles({ divider: DIVIDER, zoom: 2 })

    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 0 })
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 20 })

    expect(onCommitDrag).toHaveBeenCalledWith('root', expect.closeTo(0.55, 5))
  })

  it('uses the snapped effective delta for the sibling size before committing the ratio', () => {
    const { handle, onCommitDrag } = renderDragHandles({ divider: DIVIDER, snapGrid: 10 })

    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 0 })
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 13 })

    expect(onCommitDrag).toHaveBeenCalledWith('root', expect.closeTo(0.55, 5))
  })

  it('commits the drag ratio to the split parent node, once, on pointer-up', () => {
    const { handle, onCommitDrag } = renderDragHandles({ divider: DIVIDER })

    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 0 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 10 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 20 })
    expect(onCommitDrag).not.toHaveBeenCalled()

    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 20 })

    expect(onCommitDrag).toHaveBeenCalledTimes(1)
    expect(onCommitDrag).toHaveBeenCalledWith('root', 0.6)
  })
})

describe('snapToAlignment', () => {
  it('snaps to nearest candidate within threshold', () => {
    expect(snapToAlignment(198, [200, 400], 20)).toBe(200)
  })

  it('does not snap when outside threshold', () => {
    expect(snapToAlignment(175, [200, 400], 20)).toBe(175)
  })

  it('returns y unchanged when candidates is empty', () => {
    expect(snapToAlignment(100, [], 20)).toBe(100)
  })

  it('snaps to closest of multiple candidates', () => {
    expect(snapToAlignment(199, [200, 195], 20)).toBe(200)
  })
})
