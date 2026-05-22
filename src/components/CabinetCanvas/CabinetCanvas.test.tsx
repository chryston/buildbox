import { createRef } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { Design, LayoutResult } from '../../types'
import { computeLayout } from '../../engine/layoutEngine'
import CabinetCanvas from './CabinetCanvas'

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
      id: 'root-void',
      elementType: 'void',
    },
  }
}

function renderCabinetCanvas() {
  const design = createDesign()
  const layout: LayoutResult = computeLayout(design)
  const result = render(
    <CabinetCanvas
      design={design}
      layout={layout}
      svgRef={createRef<SVGSVGElement>()}
      overConstrainedIds={[]}
      onUnlockNode={() => {}}
    />
  )
  const svg = screen.getByTestId('cabinet-canvas') as unknown as SVGSVGElement
  const getViewport = () => {
    const viewport = result.container.querySelector('svg > g')
    if (!(viewport instanceof SVGGElement)) {
      throw new Error('Expected CabinetCanvas viewport group to be rendered')
    }
    return viewport
  }

  return { ...result, svg, getViewport }
}

describe('CabinetCanvas', () => {
  beforeAll(() => {
    if (!globalThis.PointerEvent) {
      globalThis.PointerEvent = MouseEvent as typeof PointerEvent
    }
  })

  beforeEach(() => {
    localStorage.clear()
  })

  it('uses a matrix transform so panning stays screen-space after zooming', () => {
    const { svg, getViewport } = renderCabinetCanvas()

    ;(svg as SVGSVGElement & { setPointerCapture: ReturnType<typeof vi.fn> }).setPointerCapture = vi.fn()

    fireEvent.wheel(svg, { deltaY: -100 })
    fireEvent.pointerDown(svg, { pointerId: 1, clientX: 10, clientY: 20, button: 1 })
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 35, clientY: 55 })

    expect(getViewport()).toHaveAttribute('transform', 'matrix(1.25,0,0,1.25,25,35)')
  })

  it('captures the pointer on the svg element even when panning starts on a child shape', () => {
    const { svg } = renderCabinetCanvas()
    const voidRect = screen.getByTestId('void-root-void')
    const originalSetPointerCapture = Element.prototype.setPointerCapture
    const setPointerCapture = vi.fn()

    Element.prototype.setPointerCapture = setPointerCapture

    try {
      fireEvent.pointerDown(voidRect, { pointerId: 7, clientX: 0, clientY: 0, button: 1 })

      expect(setPointerCapture).toHaveBeenCalledTimes(1)
      expect(setPointerCapture.mock.instances[0]).toBe(svg)
    } finally {
      Element.prototype.setPointerCapture = originalSetPointerCapture
    }
  })

  it('stops panning when the active pointer is cancelled', () => {
    const { svg, getViewport } = renderCabinetCanvas()

    ;(svg as SVGSVGElement & { setPointerCapture: ReturnType<typeof vi.fn> }).setPointerCapture = vi.fn()

    fireEvent.pointerDown(svg, { pointerId: 3, clientX: 10, clientY: 10, button: 1 })
    fireEvent.pointerMove(svg, { pointerId: 3, clientX: 20, clientY: 15 })
    expect(getViewport()).toHaveAttribute('transform', 'matrix(1,0,0,1,10,5)')

    fireEvent.pointerCancel(svg, { pointerId: 3 })
    fireEvent.pointerMove(svg, { pointerId: 3, clientX: 40, clientY: 50 })

    expect(getViewport()).toHaveAttribute('transform', 'matrix(1,0,0,1,10,5)')
  })
})
