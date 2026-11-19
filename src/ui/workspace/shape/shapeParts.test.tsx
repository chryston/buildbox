/**
 * The shape editor's parts, each on its own (#58 §3–§5).
 *
 * These are the readings of a footprint that do not need a session: what the Edges table says
 * about a Circle, what Measurements works out for it, what the canvas draws when a proposal has
 * failed, what the Convert dialog promises. The wiring — field to controller to Intent — is
 * `src/integration/shapeEditorFlow.test.tsx`; keeping these separate is what lets a wrong number
 * be blamed on the one component that printed it.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { rectangleFootprint } from '../../../domain'
import type { ItemFootprint } from '../../../domain'
import { footprintPath } from '../../../domain'
import { EdgesTab } from './EdgesTab'
import { MeasurementsTab } from './MeasurementsTab'
import { FootprintCanvas } from './FootprintCanvas'
import { ConvertDialog } from './ConvertDialog'
import { ShapesGallery } from './ShapesGallery'
import { placementDefaults, placementFootprint } from './placement'

const MM = { unit: 'mm', precision: 0 } as const

/** The canonical Ø1,600 Circle: four quarter-arcs, an area of 2.01 m², a perimeter of 5,027 mm. */
const CIRCLE: ItemFootprint = {
  kind: 'preset',
  preset: { kind: 'circle', diameter: 1600 },
  centre: { x: 800, y: 800 },
  orientationDeg: 0,
}

describe('the Edges tab', () => {
  it('reads a Circle as the four arcs it is, and names the last column Radius', () => {
    render(<EdgesTab path={footprintPath(CIRCLE)} format={MM} />)
    expect(screen.getByTestId('edges-tab')).toBeInTheDocument()
    for (const index of [1, 2, 3, 4]) {
      expect(screen.getByTestId(`edge-kind-${index}`)).toHaveTextContent('Arc')
      expect(screen.getByTestId(`edge-length-${index}`)).toHaveTextContent('1,257 mm')
      expect(screen.getByTestId(`edge-measure-${index}`)).toHaveTextContent('800 mm')
    }
    expect(screen.getByRole('columnheader', { name: 'Radius' })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Direction' })).not.toBeInTheDocument()
  })

  it('names the last column Direction when every edge is a Line', () => {
    render(<EdgesTab path={footprintPath(rectangleFootprint(1000, 600))} format={MM} />)
    expect(screen.getByRole('columnheader', { name: 'Direction' })).toBeInTheDocument()
    expect(screen.getByTestId('edge-kind-1')).toHaveTextContent('Line')
    expect(screen.getByTestId('edge-measure-1')).toHaveTextContent('0°')
    expect(screen.getByTestId('edge-measure-2')).toHaveTextContent('90°')
  })
})

describe('the Measurements tab', () => {
  it('gives area in square metres and everything else in the Project unit', () => {
    render(<MeasurementsTab footprint={CIRCLE} format={MM} boundsLabel="Bounds" />)
    expect(screen.getByTestId('measurements-area')).toHaveTextContent('2.01 m²')
    expect(screen.getByTestId('measurements-perimeter')).toHaveTextContent('5,027 mm')
    expect(screen.getByTestId('measurements-bounds')).toHaveTextContent('1,600 mm × 1,600 mm')
  })

  it('keeps area in square metres when the Project is measured in metres', () => {
    render(<MeasurementsTab footprint={CIRCLE} format={{ unit: 'm', precision: 3 }} boundsLabel="Floor bounds" />)
    expect(screen.getByTestId('measurements-area')).toHaveTextContent('2.01 m²')
    expect(screen.getByTestId('measurements-perimeter')).toHaveTextContent('5.027 m')
    expect(screen.getByTestId('measurements-bounds-label')).toHaveTextContent('Floor bounds')
  })

  it('offers nothing to type', () => {
    render(<MeasurementsTab footprint={CIRCLE} format={MM} boundsLabel="Bounds" />)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  })
})

describe('the footprint canvas', () => {
  it('draws the shape, its axes through the Item Origin, and no ghost or marker when nothing failed', () => {
    render(<FootprintCanvas footprint={CIRCLE} ghost={null} marker={null} origin={{ x: 800, y: 800 }} invalid={false} />)
    expect(screen.getByTestId('footprint-canvas')).toBeInTheDocument()
    expect(screen.getByTestId('footprint-outline')).toHaveAttribute('d')
    expect(screen.getByTestId('footprint-origin')).toBeInTheDocument()
    expect(screen.getByTestId('footprint-axis-x')).toBeInTheDocument()
    expect(screen.getByTestId('footprint-axis-y')).toBeInTheDocument()
    expect(screen.queryByTestId('footprint-ghost')).not.toBeInTheDocument()
    expect(screen.queryByTestId('footprint-marker')).not.toBeInTheDocument()
    expect(screen.getByTestId('footprint-canvas')).toHaveAttribute('data-invalid', 'false')
  })

  it('draws the failed proposal solid and red, the last valid shape dashed, and a marker where the kernel said', () => {
    render(
      <FootprintCanvas
        footprint={rectangleFootprint(1200, 600)}
        ghost={rectangleFootprint(1000, 600)}
        marker={{ x: 500, y: 300 }}
        origin={{ x: 500, y: 300 }}
        invalid
      />,
    )
    expect(screen.getByTestId('footprint-canvas')).toHaveAttribute('data-invalid', 'true')
    expect(screen.getByTestId('footprint-ghost')).toBeInTheDocument()
    expect(screen.getByTestId('footprint-marker')).toHaveAttribute('cx', '500')
    expect(screen.getByTestId('footprint-marker')).toHaveAttribute('cy', '300')
  })
})

describe('the Convert dialog', () => {
  it('says what this preset loses, and starts on the answer that changes nothing', async () => {
    const onConvert = vi.fn()
    render(<ConvertDialog designName="Sofa" preset={{ kind: 'rectangle', width: 1000, depth: 600 }} onConvert={onConvert} onCancel={vi.fn()} />)
    expect(screen.getByTestId('convert-modal-heading')).toHaveTextContent('Sofa')
    expect(screen.getByTestId('convert-modal-warning')).toHaveTextContent(
      "The Rectangle's width, depth and orientation fields will be removed.",
    )
    expect(screen.getByTestId('convert-cancel')).toHaveFocus()
    await userEvent.setup().click(screen.getByTestId('convert-confirm'))
    expect(onConvert).toHaveBeenCalledOnce()
  })

  it('names only the parameters this shape actually stores', () => {
    render(
      <ConvertDialog
        designName="Top"
        preset={{ kind: 'roundedRectangle', width: 1000, depth: 600, radius: 40 }}
        onConvert={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const warning = screen.getByTestId('convert-modal-warning').textContent ?? ''
    expect(warning).toContain('corner radius')
    expect(warning).not.toContain('apex offset')
  })
})

describe('the Shapes gallery', () => {
  it('marks the kind in hand and offers all eight', async () => {
    const onPick = vi.fn()
    render(<ShapesGallery current="circle" onPick={onPick} />)
    expect(screen.getByTestId('shapes-gallery')).toBeInTheDocument()
    expect(screen.getByTestId('shape-preset-circle')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('shape-preset-square')).toHaveAttribute('aria-checked', 'false')
    // Each glyph is the preset itself, drawn from its geometry, not an icon of it.
    expect(screen.getByTestId('preset-glyph-regularPolygon')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByTestId('shape-preset-triangle'))
    expect(onPick).toHaveBeenCalledWith('triangle')
  })

  it('marks nothing when the shape is a Custom Path', () => {
    render(<ShapesGallery current={null} onPick={vi.fn()} />)
    expect(screen.queryByTestId('shapes-gallery-item-current')).not.toBeInTheDocument()
    for (const kind of ['square', 'circle', 'capsule']) {
      expect(screen.getByTestId(`shape-preset-${kind}`)).toHaveAttribute('aria-checked', 'false')
    }
  })
})

describe('inheriting a size when the kind changes', () => {
  it('takes the bounds, and the smaller axis when the new kind has one number', () => {
    const wide = placementDefaults(rectangleFootprint(1200, 400))
    expect(placementFootprint('rectangle', { point: { x: 0, y: 0 } }, wide).preset)
      .toEqual({ kind: 'rectangle', width: 1200, depth: 400 })
    expect(placementFootprint('circle', { point: { x: 0, y: 0 } }, wide).preset)
      .toEqual({ kind: 'circle', diameter: 400 })
    expect(placementFootprint('capsule', { point: { x: 0, y: 0 } }, wide).preset)
      .toEqual({ kind: 'capsule', length: 1200, width: 400 })
  })

  it('falls back to 600 × 600 when there is nothing to inherit', () => {
    expect(placementFootprint('square', { point: { x: 0, y: 0 } }, placementDefaults(null)).preset)
      .toEqual({ kind: 'square', side: 600 })
  })

  it('keeps the orientation, and takes the point it was clicked at as the centre', () => {
    const turned: ItemFootprint = {
      kind: 'preset',
      preset: { kind: 'rectangle', width: 1000, depth: 500 },
      centre: { x: 900, y: 250 },
      orientationDeg: 30,
    }
    const next = placementFootprint('ellipse', { point: { x: 300, y: 400 } }, placementDefaults(turned))
    expect(next.centre).toEqual({ x: 300, y: 400 })
    expect(next.orientationDeg).toBe(30)
  })
})
