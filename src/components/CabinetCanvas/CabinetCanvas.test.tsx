import { createRef } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { computeUnitLayout, type CabinetSceneUnit, type SceneLayout } from '../../cabinet'
import { openTestView, renderWithBindings as render, type TestView } from '../../ui/legacy/testing'
import CabinetCanvas from './CabinetCanvas'

/** The one unit the layout is computed from. `Design` is gone with the legacy store (#53), and
 * the canvas only ever needed a unit's settings and root. */
function createUnit(): CabinetSceneUnit {
  return {
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
      material: 'oak',
    },
    root: {
      id: 'root-void',
      elementType: 'void',
    },
  }
}

function makeSceneLayout(unitCount: number): SceneLayout {
  const units = Array.from({ length: unitCount }, (_, i) => ({
    kind: 'cabinet' as const,
    unitId: `u${i + 1}`,
    label: `Unit ${i + 1}`,
    isActive: i === 0,
    x: i * 700,
    y: 0,
    w: 600,
    h: 800,
    unit: 'mm' as const,
    panels: [],
    voids: [],
    dividers: [],
    overConstrainedIds: [],
  }))
  return {
    units,
    boundingBox: { x: 0, y: 0, w: unitCount * 700, h: 800 },
  }
}

function unitToSceneLayout(firstUnit: CabinetSceneUnit): SceneLayout {
  const layout = computeUnitLayout(firstUnit.settings, firstUnit.root)
  const { width: w, height: h, unit } = firstUnit.settings
  return {
    units: [
      {
        kind: 'cabinet',
        unitId: firstUnit.id,
        label: firstUnit.label,
        isActive: true,
        x: firstUnit.x,
        y: firstUnit.y,
        w,
        h,
        unit,
        panels: layout.panels,
        voids: layout.voids,
        dividers: layout.dividers,
        overConstrainedIds: layout.overConstrainedIds,
      },
    ],
    boundingBox: { x: 0, y: 0, w, h },
  }
}

function renderCabinetCanvas(view: TestView) {
  const sceneLayout = unitToSceneLayout(createUnit())
  const svgRef = createRef<SVGSVGElement>()
  const result = render(
    <CabinetCanvas
      sceneLayout={sceneLayout}
      svgRef={svgRef}
      onUnlockNode={() => {}}
      onUnitClick={() => {}}
    />,
    view,
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

  // The canvas reads its snap grid and commits its drags through the seam, so every test here
  // renders against a real session over the in-memory store (#49).
  let view: TestView
  beforeEach(async () => { view = await openTestView() })

  it('uses a matrix transform so panning stays screen-space after zooming', () => {
    const { svg, getViewport } = renderCabinetCanvas(view)

    ;(svg as SVGSVGElement & { setPointerCapture: ReturnType<typeof vi.fn> }).setPointerCapture = vi.fn()

    fireEvent.wheel(svg, { deltaY: -100 })
    fireEvent.pointerDown(svg, { pointerId: 1, clientX: 10, clientY: 20, button: 1 })
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 35, clientY: 55 })

    expect(getViewport()).toHaveAttribute('transform', 'matrix(1.25,0,0,1.25,25,35)')
  })

  it('captures the pointer on the svg element even when panning starts on a child shape', () => {
    const { svg } = renderCabinetCanvas(view)
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
    const { svg, getViewport } = renderCabinetCanvas(view)

    ;(svg as SVGSVGElement & { setPointerCapture: ReturnType<typeof vi.fn> }).setPointerCapture = vi.fn()

    fireEvent.pointerDown(svg, { pointerId: 3, clientX: 10, clientY: 10, button: 1 })
    fireEvent.pointerMove(svg, { pointerId: 3, clientX: 20, clientY: 15 })
    expect(getViewport()).toHaveAttribute('transform', 'matrix(1,0,0,1,10,5)')

    fireEvent.pointerCancel(svg, { pointerId: 3 })
    fireEvent.pointerMove(svg, { pointerId: 3, clientX: 40, clientY: 50 })

    expect(getViewport()).toHaveAttribute('transform', 'matrix(1,0,0,1,10,5)')
  })

  it('renders one <g> group per unit', () => {
    const sceneLayout = makeSceneLayout(2)
    render(
      <CabinetCanvas
        sceneLayout={sceneLayout}
        svgRef={createRef()}
        onUnlockNode={() => {}}
        onUnitClick={() => {}}
      />,
      view,
    )
    const groups = document.querySelectorAll('[data-unit-id]')
    expect(groups).toHaveLength(2)
  })

  it('clicking a unit group fires onUnitClick with that unit id', () => {
    const sceneLayout = makeSceneLayout(2)
    const onUnitClick = vi.fn()
    render(
      <CabinetCanvas
        sceneLayout={sceneLayout}
        svgRef={createRef()}
        onUnlockNode={() => {}}
        onUnitClick={onUnitClick}
      />,
      view,
    )
    const groups = document.querySelectorAll('[data-unit-id]')
    fireEvent.click(groups[1].querySelector('rect')!)
    expect(onUnitClick).toHaveBeenCalledWith('u2')
  })

  it('renders dashed border rect for active unit only', () => {
    const sceneLayout = makeSceneLayout(2)
    render(
      <CabinetCanvas
        sceneLayout={sceneLayout}
        svgRef={createRef()}
        onUnlockNode={() => {}}
        onUnitClick={() => {}}
      />,
      view,
    )
    const groups = document.querySelectorAll('[data-unit-id]')
    const activeGroup = groups[0]
    const dashedRects = activeGroup.querySelectorAll('rect[stroke-dasharray]')
    expect(dashedRects.length).toBeGreaterThan(0)
    const inactiveGroup = groups[1]
    expect(inactiveGroup.querySelectorAll('rect[stroke-dasharray]').length).toBe(0)
  })
})
