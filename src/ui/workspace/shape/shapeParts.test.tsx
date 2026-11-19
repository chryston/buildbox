/**
 * The shape editor's parts, each on its own (#58 §3–§5).
 *
 * These are the readings of a footprint that do not need a session: what the Edges table says
 * about a Circle, what Measurements works out for it, what the canvas draws when a proposal has
 * failed, what the Convert dialog promises. The wiring — field to controller to Intent — is
 * `src/integration/shapeEditorFlow.test.tsx`; keeping these separate is what lets a wrong number
 * be blamed on the one component that printed it.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { footprintAsPath, footprintPath, rectangleFootprint } from '../../../domain'
import type { ItemFootprint } from '../../../domain'
import { EdgesTab } from './EdgesTab'
import { MeasurementsTab } from './MeasurementsTab'
import { FootprintCanvas } from './FootprintCanvas'
import { ShapeTab } from './ShapeTab'
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

  it('lists exactly the eight presets, each with a name a person can read (criterion 1)', () => {
    render(<ShapesGallery current={null} onPick={vi.fn()} />)
    const entries = within(screen.getByTestId('shapes-gallery')).getAllByRole('menuitemradio')
    // In this order, because it is the order §3 lists them and the order the gallery is read.
    expect(entries.map((entry) => entry.textContent?.trim())).toEqual([
      'Square', 'Rectangle', 'Rounded Rectangle', 'Circle', 'Ellipse', 'Capsule', 'Triangle', 'Regular Polygon',
    ])
    // A glyph alone would leave a screen reader with nothing to say.
    for (const entry of entries) expect(entry.textContent?.trim() ?? '').not.toBe('')
    // The equality above is the whole claim: nine entries would be one too many, and the
    // prototype's two odd shapes are not among these eight. Custom Path is reached through
    // Convert until #59 adds the Line tool that starts one.
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

/**
 * The prototype's shorthand (#58 criterion 23). Each of these was a label in Variant A and each
 * was rejected with it: `ell ` and `∠` are notation rather than words, `Floor bbox` and
 * `(local)` name a coordinate space at a person who never asked about one, `face L`/`face R` are
 * the prototype's own abbreviations, `… · 4 centre` repeats a number the field beside it already
 * gives, and `Origin X`/`Origin Y` is a placement label for what the glossary calls the Item
 * Origin. A shape editor that says any of them has drifted back towards the prototype.
 */
const BANNED: readonly (string | RegExp)[] = [
  'ell ', '∠', 'Floor bbox', '(local)', 'face L', 'face R', 'Origin X', 'Origin Y',
  /W-\d+ · \d+ centre/,
]

/** One footprint per catalog entry, plus the Custom Path the tabs also have to read. */
const EVERY_SHAPE: readonly ItemFootprint[] = [
  { kind: 'preset', preset: { kind: 'square', side: 600 }, centre: { x: 300, y: 300 }, orientationDeg: 0 },
  { kind: 'preset', preset: { kind: 'rectangle', width: 1000, depth: 500 }, centre: { x: 500, y: 250 }, orientationDeg: 0 },
  { kind: 'preset', preset: { kind: 'roundedRectangle', width: 1000, depth: 500, radius: 40 }, centre: { x: 500, y: 250 }, orientationDeg: 0 },
  { kind: 'preset', preset: { kind: 'roundedRectangle', width: 1000, depth: 500, radii: { topLeft: 40, topRight: 80, bottomRight: 20, bottomLeft: 60 } }, centre: { x: 500, y: 250 }, orientationDeg: 0 },
  { kind: 'preset', preset: { kind: 'circle', diameter: 1600 }, centre: { x: 800, y: 800 }, orientationDeg: 0 },
  { kind: 'preset', preset: { kind: 'ellipse', width: 1200, depth: 700 }, centre: { x: 600, y: 350 }, orientationDeg: 0 },
  { kind: 'preset', preset: { kind: 'capsule', length: 1200, width: 400 }, centre: { x: 600, y: 200 }, orientationDeg: 0 },
  { kind: 'preset', preset: { kind: 'triangle', baseWidth: 900, depth: 600 }, centre: { x: 450, y: 300 }, orientationDeg: 0 },
  { kind: 'preset', preset: { kind: 'regularPolygon', sideCount: 6, sideLength: 300 }, centre: { x: 0, y: 0 }, orientationDeg: 0 },
  footprintAsPath(rectangleFootprint(600, 400)),
]

describe('the words a shape editor never says', () => {
  it('names nothing in the prototype’s shorthand, in any state it can be in (criterion 23)', () => {
    const nothing = (): void => undefined
    const seen: string[] = []

    /** Render, keep the text, take it down again — one page on screen at a time. */
    const say = (node: ReactNode): void => {
      const { unmount, asFragment } = render(node as ReactElement)
      seen.push(asFragment().textContent ?? '')
      unmount()
    }

    for (const footprint of EVERY_SHAPE) {
      for (const readOnly of [false, true]) {
        say(
          <ShapeTab
            footprint={footprint}
            format={MM}
            invalidField={null}
            invalidMessage={null}
            readOnly={readOnly}
            onGesture={nothing}
            onDiscard={nothing}
            onConvert={nothing}
          />,
        )
      }
      say(<EdgesTab path={footprintPath(footprint)} format={MM} />)
      say(<MeasurementsTab footprint={footprint} format={MM} boundsLabel="Bounds" />)
    }

    // The sentence itself, where it is shown: under the field it marks, and in the draft bar.
    say(
      <ShapeTab
        footprint={EVERY_SHAPE[2]}
        format={MM}
        invalidField="topRight"
        invalidMessage="Corner radii on the top side overlap (100 + 901 > 1,000 mm)"
        readOnly={false}
        onGesture={nothing}
        onDiscard={nothing}
        onConvert={nothing}
      />,
    )
    say(<ShapesGallery current="circle" onPick={nothing} />)
    say(<ShapesGallery current={null} onPick={nothing} />)
    for (const preset of [
      { kind: 'rectangle', width: 1000, depth: 600 } as const,
      { kind: 'regularPolygon', sideCount: 6, sideLength: 300 } as const,
    ]) {
      say(<ConvertDialog designName="Sofa" preset={preset} onConvert={nothing} onCancel={nothing} />)
    }

    const words = seen.join('\n')
    expect(words.length).toBeGreaterThan(1000)
    for (const banned of BANNED) {
      expect(words, banned instanceof RegExp ? String(banned) : banned).not.toMatch(banned)
    }
  })
})
