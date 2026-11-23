/**
 * The Elevation View pane, as the split draws it (#75 §2, criteria 1, 4, 6).
 *
 * Four things are worth a test each. The header sentence is the only place a viewer reads which view,
 * which Design Option and which Renovation Display they are looking at, so it is asserted in full, in
 * both Option cases. The direction glyph has to point *into* the band the drawing was made of — a glyph
 * that points out of it says the room is behind the viewer, which is the opposite picture. A click has
 * to reach the thing the pointer is standing on and not the Wall behind it, and a second click in the
 * same spot has to walk the stack rather than re-pick the same entity. And the highlight has to be the
 * plan's own: an id this view does not draw leaves the markup untouched, because an entity behind the
 * viewer has no pixels to highlight.
 *
 * The scene is the #75 fixture, derived through the real `elevationScene`, so the numbers under the
 * pointer are the numbers the criteria are stated against: `W-1` at 1 300 mm behind the view line, the
 * `Base cabinet #1` in front of it at 550 mm. The `<svg>` is given the box jsdom would not lay out —
 * one pixel to the millimetre, at the window's own origin — because what is under test is the mapping
 * from a pointer to a row, not the layout.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import type { ElevationView, Project } from '../../domain'
import { elevationFrameOf, elevationScene } from '../../derive'
import { drawElevationView } from '../../drawing'
import { STRINGS } from '../strings'
import { ElevationPane, elevationArrowDeg, elevationPaneTitle } from './ElevationPane'
import type { ElevationPaneProps } from './ElevationPane'
import { ZOOM_MAX, ZOOM_MIN } from './viewport'
import type { Viewport } from './viewport'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../fixtures')

/** The #75 fixture, read the way a dom test reads a file: its schema version is the current one, so
 * the file is already a Project and nothing is migrated on the way in. */
const envelope = JSON.parse(readFileSync(join(fixturesRoot, 'domain', 'v10', 'elevation-scene.json'), 'utf8')) as {
  project: Project
}
const project = envelope.project

const views = project.elevationViews ?? []
const view = views.find((candidate) => candidate.id === 'el-004')!
const angled = views.find((candidate) => candidate.id === 'el-005')!
const scene = elevationScene(project, view)
const SIZING = { kind: 'screen', pxPerMm: 1 } as const
const drawing = drawElevationView(scene, { sizing: SIZING })
const list = drawing.list

/** One pixel to the millimetre at the window's origin: a client pixel *is* a drawing millimetre. */
const VIEWPORT = { zoom: 1, panX: 0, panY: 0 }

const BASE = {
  view,
  scene,
  list,
  topMm: drawing.topMm,
  sizing: SIZING,
  optionName: null,
  display: 'existing',
  selectedIds: [],
  viewport: VIEWPORT,
  resolveAsset: () => null,
} satisfies Partial<ElevationPaneProps>

const open = (over: Partial<ElevationPaneProps> = {}) => {
  const onPick = vi.fn()
  const onViewport = vi.fn()
  // The host the pane measures itself against and hangs its wheel listener on. jsdom gives a detached
  // element no box, which is what keeps `Fit` out of the tests that hand over a viewport already.
  const hostRef = { current: document.createElement('div') }
  const props = { ...BASE, onPick, onViewport, hostRef, ...over }
  const rendered = render(<ElevationPane {...props} />)
  const canvas = screen.getByTestId('elevation-canvas')
  canvas.getBoundingClientRect = (): DOMRect => ({
    top: 0, left: 0, right: 4000, bottom: 2600, width: 4000, height: 2600, x: 0, y: 0, toJSON: () => ({}),
  })
  canvas.setPointerCapture = () => undefined
  /** The same pane with new props: the picture stays on screen, which is what a click cycle needs. */
  const rewrite = (next: Partial<ElevationPaneProps>): void => {
    rendered.rerender(<ElevationPane {...props} {...next} />)
  }
  return { onPick, onViewport, hostRef, rewrite }
}

/** jsdom has no `PointerEvent`, so a press is dispatched as the mouse event it stands in for. */
const pointer = (el: Element, type: string, x: number, y: number): void => {
  fireEvent(el, new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }))
}

/**
 * One click on the picture, aimed at a height above the Floor Datum.
 *
 * The drawing stands on its Datum, so its y grows downward from `topMm` and the pane converts the same
 * way: a click written as a height says what the criterion says, and the conversion is on the way.
 */
const click = (x: number, heightMm: number): void => {
  const canvas = screen.getByTestId('elevation-canvas')
  pointer(canvas, 'pointerdown', x, drawing.topMm - heightMm)
  pointer(canvas, 'pointerup', x, drawing.topMm - heightMm)
}

const picks = (onPick: Mock): unknown[] => onPick.mock.calls.map((call) => call[0])

/** The last viewport the pane asked for. */
const lastViewport = (onViewport: Mock): Viewport =>
  onViewport.mock.calls[onViewport.mock.calls.length - 1]![0] as Viewport

describe('the header sentence', () => {
  it('names the view, the Design Option and the Renovation Display', () => {
    expect(elevationPaneTitle(view, 'Kitchen remodel', 'proposed'))
      .toBe('Kitchen elevation · Kitchen remodel · Proposed')
  })

  it('says `No Design Option` when the view looks at the baseline', () => {
    expect(elevationPaneTitle(view, null, 'existing')).toBe('Kitchen elevation · No Design Option · Existing')
  })
})

describe('the direction glyph', () => {
  it('turns half a circle when the viewer changes side', () => {
    const left = elevationArrowDeg(view)
    const right = elevationArrowDeg({ ...view, side: 'right' } satisfies ElevationView)
    expect(Math.abs(left - right)).toBeCloseTo(180, 6)
  })

  it('points along the viewing normal, which is into the band the drawing is made of', () => {
    const frame = elevationFrameOf(view)
    const rad = (elevationArrowDeg(view) * Math.PI) / 180
    // The degrees are the frame's own normal and not its opposite, and not the view line: the arrow has
    // to say which way the room is, and the room is along `n`.
    expect(Math.cos(rad)).toBeCloseTo(frame.n.x, 9)
    expect(Math.sin(rad)).toBeCloseTo(frame.n.y, 9)
    const depth = 500
    const tip = { x: view.line.start.x + Math.cos(rad) * depth, y: view.line.start.y + Math.sin(rad) * depth }
    expect((tip.x - view.line.start.x) * frame.n.x + (tip.y - view.line.start.y) * frame.n.y)
      .toBeGreaterThan(0)
  })

  it('follows a view line that is not square to the Floor', () => {
    expect(Math.abs(elevationArrowDeg(angled) % 90)).toBeGreaterThan(1)
  })

  it('is drawn from a glyph that points right, so the degrees are all the rotation needs', () => {
    open()
    const arrow = screen.getByTestId('elevation-arrow')
    expect(arrow.getAttribute('transform')).toBe(`rotate(${elevationArrowDeg(view)})`)
    // The head's point is on +x: 0° is right, which is what makes the rotation above mean what it says.
    expect(arrow.querySelector('path:nth-child(2)')!.getAttribute('d')).toContain('15 0')
  })

  it('is named, so the picture is not the only way to learn which way it faces', () => {
    open()
    const glyph = screen.getByTestId('elevation-direction')
    expect(glyph.getAttribute('aria-label')).toBe(STRINGS.elevationDirection)
    expect(glyph.getAttribute('role')).toBe('img')
  })
})

describe('a click on the picture', () => {
  it('takes the thing the pointer is standing on, not the Wall behind it', () => {
    const { onPick } = open()
    // `Base cabinet #1` is 550 mm behind the view line and stands 0–860 high; the Wall behind it is at
    // 1 300 mm and 0–2600. The view is mirrored, so the cabinet's 300–900 along the line is drawn at
    // 3 100–3 700 across the picture.
    click(3400, 400)
    expect(picks(onPick)).toEqual(['pr-005'])
  })

  it('walks the stack on a second click in the same spot', () => {
    const { onPick, rewrite } = open()
    click(3400, 400)
    rewrite({ selectedIds: ['pr-005'] })
    click(3400, 400)
    expect(picks(onPick)).toEqual(['pr-005', 'pr-017'])
  })

  it('starts again when the click lands somewhere else', () => {
    const { onPick, rewrite } = open()
    click(3400, 400)
    rewrite({ selectedIds: ['pr-005'] })
    // 500 across is the Wall alone: the cabinet ends at 3 100, so there is no stack to walk here.
    click(500, 2400)
    expect(picks(onPick)).toEqual(['pr-005', 'pr-017'])
  })

  it('clears the pick when a press on empty space never moved', () => {
    const { onPick } = open()
    // Above the ceiling and past the ruler: nothing in this view is drawn there.
    click(3900, -400)
    expect(picks(onPick)).toEqual([null])
  })

  it('pans a drag of empty space instead of picking', () => {
    const { onPick, onViewport } = open()
    const canvas = screen.getByTestId('elevation-canvas')
    pointer(canvas, 'pointerdown', 3900, -400)
    pointer(canvas, 'pointermove', 3850, -460)
    pointer(canvas, 'pointerup', 3850, -460)
    expect(onPick).not.toHaveBeenCalled()
    expect(lastViewport(onViewport)).toEqual({ zoom: 1, panX: -50, panY: -60 })
  })
})

describe('the wheel', () => {
  it('zooms around the cursor on the host, not on the picture', () => {
    const { onViewport, hostRef } = open()
    hostRef.current?.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 100, clientY: 50 }))
    const next = lastViewport(onViewport)
    expect(next.zoom).toBeCloseTo(1.25, 6)
    // The point under the cursor stays under the cursor: 100 = 100 × 1.25 + panX.
    expect(next.panX).toBeCloseTo(100 - 100 * 1.25, 6)
    expect(next.panY).toBeCloseTo(50 - 50 * 1.25, 6)
  })
})

describe('a view with no remembered viewport', () => {
  it('fits the drawing to the host once', () => {
    const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')
    const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 800 })
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 600 })
    try {
      const { onViewport } = open({ viewport: null })
      const next = lastViewport(onViewport)
      expect(onViewport).toHaveBeenCalledTimes(1)
      expect(next.zoom).toBeGreaterThanOrEqual(ZOOM_MIN)
      expect(next.zoom).toBeLessThanOrEqual(ZOOM_MAX)
      // The whole 4 000 mm of the view line has to fit in 800 px, so the fit is well under a third.
      expect(next.zoom).toBeLessThan(0.3)
    } finally {
      if (width !== undefined) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', width)
      if (height !== undefined) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', height)
    }
  })
})

describe('the highlight', () => {
  it('leaves the picture untouched for an id this view does not draw', () => {
    const { rewrite } = open()
    const unselected = screen.getByTestId('elevation-pane').innerHTML
    rewrite({ selectedIds: ['pr-9999'] })
    // `pr-9999` is a ghost: an entity the workspace has selected that this view does not draw, so there
    // is nothing here to highlight and nothing changes.
    expect(screen.getByTestId('elevation-pane').innerHTML).toBe(unselected)
  })

  it('draws the accent around the Wall this view does draw', () => {
    open({ selectedIds: ['pr-017'] })
    expect(screen.getByTestId('elevation-pane').innerHTML).toContain('var(--bb-accent)')
  })

  it('carries the Display and the Option the picture was drawn for', () => {
    open({ display: 'combined', optionName: 'Kitchen remodel' })
    const pane = screen.getByTestId('elevation-pane')
    expect(pane.getAttribute('data-display')).toBe('combined')
    expect(pane.getAttribute('data-option')).toBe('Kitchen remodel')
  })
})
