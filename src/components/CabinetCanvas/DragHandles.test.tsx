import { createRef } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import type { Project } from '../../domain'
import type { LayoutDivider } from '../../cabinet'
import { testCabinet, testProject } from '../../session/testing'
import { openTestView, renderWithBindings as render, type TestView } from '../../ui/legacy/testing'
import DragHandles from './DragHandles'

/**
 * A cabinet whose one space is split in two: the divider between `top` and `bottom` is what
 * the handle drags, and the ratio it commits lands on the node that split them.
 */
function splitProject(): Project {
  const project = testProject('p-1')
  const design = testCabinet(project)
  return {
    ...project,
    itemDesigns: [{
      ...design,
      construction: {
        ...design.construction,
        root: {
          id: 'root',
          splitAxis: 'horizontal',
          splitRatio: 0.5,
          children: [{ id: 'top', elementType: 'void' }, { id: 'bottom', elementType: 'void' }],
        },
      },
    }],
  }
}

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

  let view: TestView
  beforeEach(async () => { view = await openTestView(splitProject()) })

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

    const { container } = render(
      <svg ref={svgRef}>
        <DragHandles dividers={[divider]} snapGrid={snapGrid} svgRef={svgRef} zoom={zoom} />
      </svg>,
      view,
    )

    const svg = container.querySelector('svg') as SVGSVGElement
    Object.defineProperty(svg, 'viewBox', {
      value: { baseVal: { width: 200 } },
      configurable: true,
    })
    svg.getBoundingClientRect = () => ({ width: 200 } as DOMRect)

    const handle = screen.getByTestId(`drag-handle-${divider.nodeId}`)
    ;((handle as unknown) as SVGRectElement & { setPointerCapture: ReturnType<typeof vi.fn> }).setPointerCapture = setPointerCapture

    return { handle, setPointerCapture }
  }

  /** The ratio the split node holds after the last commit. */
  const rootRatio = (): number | undefined => testCabinet(view.project()).construction.root.splitRatio

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

  it('scales pointer movement by zoom before committing the drag ratio', async () => {
    const { handle } = renderDragHandles({ divider: DIVIDER, zoom: 2 })

    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 0 })
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 20 })

    await waitFor(() => expect(rootRatio()).toBeCloseTo(0.55, 5))
  })

  it('uses the snapped effective delta for the sibling size before committing the ratio', async () => {
    const { handle } = renderDragHandles({ divider: DIVIDER, snapGrid: 10 })

    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 0 })
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 13 })

    await waitFor(() => expect(rootRatio()).toBeCloseTo(0.55, 5))
  })

  it('commits the drag ratio to the split parent node', async () => {
    const { handle } = renderDragHandles({ divider: DIVIDER })

    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 0 })
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 20 })

    await waitFor(() => expect(rootRatio()).toBe(0.6))
    const root = testCabinet(view.project()).construction.root
    expect(root.children?.[0].splitRatio).toBeUndefined()
  })
})

import { snapToAlignment } from './DragHandles'

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
