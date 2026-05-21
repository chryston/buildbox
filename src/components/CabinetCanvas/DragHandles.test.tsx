import { createRef } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { Design, LayoutDivider, LayoutVoid } from '../../types'
import { useStore } from '../../store/store'
import DragHandles from './DragHandles'

function createDesign(): Design {
  return {
    id: 'design-1',
    name: 'Test Cabinet',
    globalSettings: {
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

  it('commits the drag ratio to the split parent node', () => {
    useStore.setState((state) => ({
      ...state,
      projects: [createDesign()],
      activeProjectId: 'design-1',
      selectedId: null,
      snapGrid: 1,
    }))

    const svgRef = createRef<SVGSVGElement>()
    const setPointerCapture = vi.fn()
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
    } as LayoutDivider & { parentId: string }
    const voids: LayoutVoid[] = [
      { nodeId: 'top', x: 0, y: 0, w: 200, h: 100, elementType: 'void', material: 'oak', accessories: [] },
      { nodeId: 'bottom', x: 0, y: 118, w: 200, h: 100, elementType: 'void', material: 'oak', accessories: [] },
    ]

    const { container } = render(
      <svg ref={svgRef}>
        <DragHandles dividers={[divider]} voids={voids} snapGrid={1} svgRef={svgRef} />
      </svg>,
    )

    const svg = container.querySelector('svg') as SVGSVGElement
    Object.defineProperty(svg, 'viewBox', {
      value: { baseVal: { width: 200 } },
      configurable: true,
    })
    svg.getBoundingClientRect = () => ({ width: 200 } as DOMRect)

    const handle = screen.getByTestId('drag-handle-top-shelf')
    ;((handle as unknown) as SVGRectElement & { setPointerCapture: ReturnType<typeof vi.fn> }).setPointerCapture = setPointerCapture

    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 0 })
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 20 })

    const state = useStore.getState()
    expect(state.projects[0].root.splitRatio).toBe(0.6)
    expect(state.projects[0].root.children?.[0].splitRatio).toBeUndefined()
  })
})
