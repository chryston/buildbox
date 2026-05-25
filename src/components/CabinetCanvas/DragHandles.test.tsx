import { createRef } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { Design, LayoutDivider } from '../../types'
import { useStore } from '../../store/store'
import DragHandles from './DragHandles'

function createDesign(): Design {
  return {
    id: 'design-1',
    name: 'Test Cabinet',
    units: [{
      type: 'cabinet',
      id: 'unit-1',
      label: 'Unit 1',
      x: 0,
      y: 0,
      settings: {
        unit: 'mm',
        height: 800,
        width: 600,
        depth: 500,
        thickness: 18,
        backThickness: 6,
        toeKick: null,
        defaultMaterial: 'oak',
      },
      root: {
        id: 'root',
        splitAxis: 'horizontal',
        children: [
          { id: 'top' },
          { id: 'bottom' },
        ],
      },
    }],
  }
}

describe('DragHandles', () => {
  beforeAll(() => {
    if (!globalThis.PointerEvent) {
      globalThis.PointerEvent = MouseEvent as typeof PointerEvent
    }
  })

  afterEach(() => {
    localStorage.clear()
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

    const { container } = render(
      <svg ref={svgRef}>
        <DragHandles dividers={[divider]} snapGrid={snapGrid} svgRef={svgRef} zoom={zoom} />
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

    return { handle, setPointerCapture }
  }

  function seedStore() {
    useStore.setState((state) => ({
      ...state,
      projects: [createDesign()],
      activeProjectId: 'design-1',
      activeUnitId: 'unit-1',
      selectedId: null,
      snapGrid: 1,
    }))
  }

  it('anchors handle movement to the initial handle position during drag', () => {
    const divider = {
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

    const { handle } = renderDragHandles({ divider })

    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 0 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 10 })
    expect(handle).toHaveAttribute('y', '113')

    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 20 })
    expect(handle).toHaveAttribute('y', '123')

    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 30 })
    expect(handle).toHaveAttribute('y', '133')
  })

  it('scales pointer movement by zoom before committing the drag ratio', () => {
    seedStore()
    const divider = {
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

    const { handle } = renderDragHandles({ divider, zoom: 2 })

    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 0 })
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 20 })

    const state = useStore.getState()
    expect(state.projects[0].units[0].root.splitRatio).toBeCloseTo(0.55, 5)
  })

  it('uses the snapped effective delta for the sibling size before committing the ratio', () => {
    seedStore()
    const divider = {
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

    const { handle } = renderDragHandles({ divider, snapGrid: 10 })

    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 0 })
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 13 })

    const state = useStore.getState()
    expect(state.projects[0].units[0].root.splitRatio).toBeCloseTo(0.55, 5)
  })

  it('commits the drag ratio to the split parent node', () => {
    seedStore()
    const divider = {
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

    const { handle } = renderDragHandles({ divider })

    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 0 })
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 20 })

    const state = useStore.getState()
    expect(state.projects[0].units[0].root.splitRatio).toBe(0.6)
    expect(state.projects[0].units[0].root.children?.[0].splitRatio).toBeUndefined()
  })
})
