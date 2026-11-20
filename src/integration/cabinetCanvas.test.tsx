import { createRef } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { computeUnitLayout, type CabinetSceneUnit, type SceneLayout } from '../cabinet'
import { CabinetCanvas } from '../ui'
import type { CabinetCanvasProps, CabinetDetail } from '../ui'

/**
 * The cabinet canvas (#60). It no longer reads the store: the scene arrives as an Item Detail
 * and every edit leaves as a callback, so a test supplies the callbacks it wants to watch
 * rather than a session.
 */

/** The one unit the layout is computed from. The canvas only needs a unit's settings and root. */
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

const detailOf = (layout: SceneLayout, designId: string): CabinetDetail =>
  ({ kind: 'cabinet', designId, layout })

const noop = (): undefined => undefined

function renderCabinet(
  layout: SceneLayout,
  designId = 'unit-1',
  overrides: Partial<CabinetCanvasProps> = {},
) {
  const svgRef = createRef<SVGSVGElement>()
  const result = render(
    <CabinetCanvas
      detail={detailOf(layout, designId)}
      svgRef={svgRef}
      selectedNodeId={null}
      snapGrid={0}
      onUnitClick={noop}
      onSelectNode={noop}
      onCommitSize={noop}
      onCommitLabel={noop}
      onCommitDrag={noop}
      onUnlockNode={noop}
      {...overrides}
    />,
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

  it('uses a matrix transform so panning stays screen-space after zooming', () => {
    const { svg, getViewport } = renderCabinet(unitToSceneLayout(createUnit()))

    ;(svg as SVGSVGElement & { setPointerCapture: ReturnType<typeof vi.fn> }).setPointerCapture = vi.fn()

    fireEvent.wheel(svg, { deltaY: -100 })
    fireEvent.pointerDown(svg, { pointerId: 1, clientX: 10, clientY: 20, button: 1 })
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 35, clientY: 55 })

    expect(getViewport()).toHaveAttribute('transform', 'matrix(1.25,0,0,1.25,25,35)')
  })

  it('captures the pointer on the svg element even when panning starts on a child shape', () => {
    const { svg } = renderCabinet(unitToSceneLayout(createUnit()))
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
    const { svg, getViewport } = renderCabinet(unitToSceneLayout(createUnit()))

    ;(svg as SVGSVGElement & { setPointerCapture: ReturnType<typeof vi.fn> }).setPointerCapture = vi.fn()

    fireEvent.pointerDown(svg, { pointerId: 3, clientX: 10, clientY: 10, button: 1 })
    fireEvent.pointerMove(svg, { pointerId: 3, clientX: 20, clientY: 15 })
    expect(getViewport()).toHaveAttribute('transform', 'matrix(1,0,0,1,10,5)')

    fireEvent.pointerCancel(svg, { pointerId: 3 })
    fireEvent.pointerMove(svg, { pointerId: 3, clientX: 40, clientY: 50 })

    expect(getViewport()).toHaveAttribute('transform', 'matrix(1,0,0,1,10,5)')
  })

  it('renders one <g> group per unit', () => {
    renderCabinet(makeSceneLayout(2), 'u1')
    const groups = document.querySelectorAll('[data-unit-id]')
    expect(groups).toHaveLength(2)
  })

  it('clicking a unit group fires onUnitClick with that unit id', () => {
    const onUnitClick = vi.fn()
    renderCabinet(makeSceneLayout(2), 'u1', { onUnitClick })
    const groups = document.querySelectorAll('[data-unit-id]')
    fireEvent.click(groups[1].querySelector('path')!)
    expect(onUnitClick).toHaveBeenCalledWith('u2')
  })

  it('draws the dashed outline around the active unit only', () => {
    renderCabinet(makeSceneLayout(2), 'u1')
    // Every shape of the drawing is a path now, and only the active unit is outlined.
    expect(document.querySelectorAll('path[stroke-dasharray]')).toHaveLength(1)
  })
})
