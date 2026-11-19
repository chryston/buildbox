/**
 * The Custom Path editor's parts, each on its own (#59 §3–§5).
 *
 * The claim these tests exist to keep is narrow and easy to lose: that a field holds the number
 * the model holds, that a click on a row is what opens an editor, and that nine checkboxes each
 * have their own words. The wiring to the controller and to Intents is
 * `src/integration/shapeEditorFlow.test.tsx`; the pixel geometry of those checkboxes is
 * `e2e/smoke/custom-path.spec.ts`, because jsdom lays nothing out.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { distance, lengthOf, pt, segmentStart, validateLoop } from '../../../derive'
import type { ClosedPath } from '../../../derive'
import { footprintArea, footprintPerimeter } from '../../../domain'
import { EdgesTab } from './EdgesTab'
import { SnapsMenu } from '../SnapsMenu'
import { workspaceStore } from '../workspaceStore'
import type { ItemFootprint } from '../../../domain'
import type { ShapeFieldId } from './parameters'
import type { ShapeSelection } from '../workspaceStore'

const MM = { unit: 'mm', precision: 0 } as const

/**
 * The Kitchen path from the #54 fixtures, spelled out rather than imported: `src/geometry` is
 * not reachable from `src/ui` (#20 §2), and a fixture that arrived through a side door would be
 * the one thing in this file a reader could not check.
 */
const KITCHEN: ClosedPath = {
  start: pt(1200, 1300),
  segments: [
    { kind: 'line', to: pt(4800, 1300) },
    { kind: 'line', to: pt(4800, 4000) },
    { kind: 'line', to: pt(3300, 4000) },
    { kind: 'line', to: pt(3300, 5600) },
    { kind: 'line', to: pt(1200, 5600) },
    { kind: 'line', to: pt(1200, 1300) },
  ],
}

/**
 * One circular arc and one elliptical one, so both curve editors have something to edit. Both
 * meet their neighbours at a corner rather than tangentially: an arc that runs smoothly into the
 * Edges either side is a fillet, and a fillet is edited as a corner, not as an arc.
 */
const CURVED: ClosedPath = {
  start: pt(0, 0),
  segments: [
    { kind: 'arc', to: pt(2000, 0), center: pt(1000, 0), sweepDeg: 180 },
    { kind: 'ellipticalArc', to: pt(1000, 1500), center: pt(1500, 750), rx: 900, ry: 500, rotationDeg: 0, sweepDeg: 90 },
    { kind: 'line', to: pt(0, 0) },
  ],
}

const asPath = (footprint: ItemFootprint): ClosedPath => {
  if (footprint.kind !== 'path') throw new Error('expected the editor to propose a Custom Path')
  return footprint.path
}

interface Gesture {
  readonly footprint: ItemFootprint
  readonly field: ShapeFieldId | null
  readonly final: boolean
}

/** Render the tab with a live controller stand-in, and hand back what it was asked to propose. */
function editor(props: {
  readonly path?: ClosedPath
  readonly selection?: ShapeSelection
  readonly editable?: boolean
}): { readonly gestures: Gesture[]; readonly last: () => ClosedPath; readonly unmount: () => void } {
  const gestures: Gesture[] = []
  const view = render(
    <EdgesTab
      path={props.path ?? KITCHEN}
      format={MM}
      selection={props.selection ?? null}
      editable={props.editable ?? true}
      onGesture={(footprint, field, final) => gestures.push({ footprint, field, final })}
    />,
  )
  return {
    gestures,
    unmount: view.unmount,
    last: () => {
      const gesture = gestures[gestures.length - 1]
      return gesture === undefined ? (props.path ?? KITCHEN) : asPath(gesture.footprint)
    },
  }
}

const edgeLength = (path: ClosedPath, oneBased: number): number =>
  lengthOf(path.segments[oneBased - 1], segmentStart(path, oneBased - 1))

/** The two readings the criteria quote in square millimetres, through the domain's own door. */
const areaOf = (path: ClosedPath): number => footprintArea({ kind: 'path', path })
const perimeterOf = (path: ClosedPath): number => footprintPerimeter({ kind: 'path', path })

describe('the Snaps menu structure (criterion 17)', () => {
  it('lists exactly nine rows, in order, each a checkbox inside its own label with its words', async () => {
    render(<SnapsMenu />)
    await userEvent.setup().click(screen.getByTestId('snaps-menu'))
    const panel = screen.getByTestId('snaps-panel')
    expect(within(panel).getAllByTestId(/^snap-row-/).map((row) => row.getAttribute('data-testid'))).toEqual([
      'snap-row-grid', 'snap-row-endpoints', 'snap-row-centres', 'snap-row-intersections',
      'snap-row-wallFaces', 'snap-row-axis', 'snap-row-angle', 'snap-row-perpendicular', 'snap-row-tangent',
    ])
    // The prototype's misaligned checkboxes were misaligned because the box and the words were
    // siblings in a flex row. One `<label>` wrapping both is what makes them move together, and
    // it is also what makes the words clickable — so the structure is the claim, not a proxy.
    for (const row of within(panel).getAllByTestId(/^snap-row-/)) {
      const box = within(row).getByRole('checkbox')
      const label = box.closest('label')
      expect(label).not.toBeNull()
      expect(label?.contains(box)).toBe(true)
      expect(box.parentElement).toBe(label)
      expect((label?.textContent ?? '').trim().length).toBeGreaterThan(0)
      expect(box).toBeChecked()
    }
    expect(within(panel).getByRole('checkbox', { name: 'Grid' })).toBeInTheDocument()
    expect(within(panel).getByRole('checkbox', { name: 'Endpoints and midpoints' })).toBeInTheDocument()
    expect(within(panel).getByRole('checkbox', { name: 'Horizontal and vertical' })).toBeInTheDocument()
  })

  it('turns a row off without touching the others', async () => {
    render(<SnapsMenu />)
    const user = userEvent.setup()
    await user.click(screen.getByTestId('snaps-menu'))
    const tangent = screen.getByRole('checkbox', { name: 'Tangent' })
    await user.click(tangent)
    expect(tangent).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Grid' })).toBeChecked()
    expect(workspaceStore.getState().snapSettings.tangent).toBe(false)
    await user.click(tangent)
    expect(tangent).toBeChecked()
  })
})

describe('the Line editor (criteria 9, 10, 11)', () => {
  it('opens Length, Direction and Keep fixed for the selected Edge', () => {
    editor({ selection: { edge: 2 } })
    expect(screen.getByTestId('edge-editor-2')).toHaveTextContent('Edge 2 · Line')
    expect(screen.getByTestId('edge-length-field')).toHaveValue('2700')
    expect(screen.getByTestId('edge-direction-field')).toHaveValue('90')
    expect(screen.getByTestId('edge-keep-fixed-start')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('edge-keep-fixed-end')).toHaveAttribute('aria-pressed', 'false')
  })

  it('asks for the Edge under a row, and drops it when the same row is clicked again', async () => {
    const onSelect = vi.fn()
    const view = render(
      <EdgesTab path={KITCHEN} format={MM} editable onSelect={onSelect} onGesture={vi.fn()} />,
    )
    expect(screen.queryByTestId('edge-editor-1')).not.toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('edge-row-1'))
    expect(onSelect).toHaveBeenLastCalledWith({ edge: 1 })
    // The tab is controlled: it only knows a row is open because the editor says so. Clicking the
    // open row is the gesture that asks for it to be closed.
    view.rerender(
      <EdgesTab path={KITCHEN} format={MM} editable selection={{ edge: 1 }} onSelect={onSelect} onGesture={vi.fn()} />,
    )
    await user.click(screen.getByTestId('edge-row-1'))
    expect(onSelect).toHaveBeenLastCalledWith(null)
  })

  it('propagates a longer Edge the way D2 says, leaving every corner square (criterion 9)', async () => {
    const { gestures, last } = editor({ selection: { edge: 2 } })
    const field = screen.getByTestId('edge-length-field')
    await userEvent.setup().clear(field)
    await userEvent.type(field, '3200')
    await userEvent.keyboard('{Enter}')
    const final = gestures[gestures.length - 1]
    expect(final?.field).toBe('edgeLength')
    expect(final?.final).toBe(true)
    const path = last()
    expect(edgeLength(path, 2)).toBeCloseTo(3200, 6)
    expect(edgeLength(path, 3)).toBeCloseTo(1500, 6)
    expect(edgeLength(path, 4)).toBeCloseTo(1100, 6)
    expect(areaOf(path)).toBeCloseTo(13_830_000, -3)
    // Orthogonal throughout: every Edge runs along an axis, never as a 1,581 mm diagonal.
    for (const [index, segment] of path.segments.entries()) {
      const from = segmentStart(path, index)
      expect(segment.to.x === from.x || segment.to.y === from.y).toBe(true)
    }
    expect(validateLoop(path)).toEqual([])
  })

  it('moves the start endpoint when Keep fixed says end (criterion 10)', async () => {
    const user = userEvent.setup()
    const { last } = editor({ selection: { edge: 2 } })
    await user.click(screen.getByTestId('edge-keep-fixed-end'))
    expect(screen.getByTestId('edge-keep-fixed-end')).toHaveAttribute('aria-pressed', 'true')
    const field = screen.getByTestId('edge-length-field')
    await user.clear(field)
    await user.type(field, '3200')
    await user.keyboard('{Enter}')
    const path = last()
    // The far end of Edge 2 is fixed, so Edge 3 keeps its 1,500 and the propagation runs back
    // through Edge 1 instead of forward through Edge 6.
    expect(edgeLength(path, 2)).toBeCloseTo(3200, 6)
    expect(edgeLength(path, 3)).toBeCloseTo(1500, 6)
    // Edge 1 has been shifted whole: same direction, same 3,600, and the start it hangs from has
    // come with it. That the loop still closes is the whole of criterion 10.
    expect(edgeLength(path, 1)).toBeCloseTo(3600, 6)
    expect(path.start).toEqual(pt(1200, 800))
    expect(validateLoop(path)).toEqual([])
    expect(edgeLength(path, 6)).toBeCloseTo(4800, 6)
  })

  it('holds the exact millimetres the table rounds away (criterion 11)', async () => {
    const { gestures, last } = editor({ selection: { edge: 2 } })
    const field = screen.getByTestId('edge-length-field')
    await userEvent.setup().clear(field)
    await userEvent.type(field, '2700.25')
    await userEvent.keyboard('{Enter}')
    expect(edgeLength(last(), 2)).toBe(2700.25)
    // The readout rounds to the Project's display precision; the field does not, which is what
    // makes blurring past it write the same number and not a new one.
    expect(screen.getByTestId('edge-length-2')).toHaveTextContent('2,700')
    expect(gestures[gestures.length - 1]?.final).toBe(true)
  })

  it('proposes while typing and commits only on Enter or blur', async () => {
    const { gestures } = editor({ selection: { edge: 2 } })
    const field = screen.getByTestId('edge-length-field')
    await userEvent.setup().type(field, '0')
    expect(gestures.some((gesture) => !gesture.final)).toBe(true)
    expect(gestures.some((gesture) => gesture.final)).toBe(false)
    await userEvent.keyboard('{Enter}')
    expect(gestures[gestures.length - 1]?.final).toBe(true)
  })

  it('puts the old value back on Esc and tells the controller to drop the proposal', async () => {
    let discarded = 0
    render(
      <EdgesTab
        path={KITCHEN}
        format={MM}
        selection={{ edge: 2 }}
        editable
        onGesture={vi.fn()}
        onDiscard={() => { discarded += 1 }}
      />,
    )
    const field = screen.getByTestId('edge-length-field')
    const user = userEvent.setup()
    await user.clear(field)
    await user.type(field, '9999')
    await user.keyboard('{Escape}')
    expect(field).toHaveValue('2700')
    expect(discarded).toBe(1)
  })
})

describe('the curve editors (criteria 3, 12)', () => {
  it('offers Radius, Sweep and Flip for an Arc', () => {
    editor({ path: CURVED, selection: { edge: 1 } })
    expect(screen.getByTestId('edge-editor-1')).toHaveTextContent('Arc')
    expect(screen.getByTestId('edge-radius-field')).toHaveValue('1000')
    expect(screen.getByTestId('edge-sweep-field')).toHaveValue('180')
    expect(screen.getByTestId('edge-flip')).toBeEnabled()
  })

  it('keeps both endpoints when the sweep is taken past 180° (criterion 12)', async () => {
    const { last } = editor({ path: CURVED, selection: { edge: 1 } })
    const sweep = screen.getByTestId('edge-sweep-field')
    const user = userEvent.setup()
    await user.clear(sweep)
    await user.type(sweep, '270')
    await user.keyboard('{Enter}')
    const path = last()
    expect(path.start).toEqual(CURVED.start)
    expect(path.segments[0].to).toEqual(CURVED.segments[0].to)
    const arc = path.segments[0]
    if (arc.kind !== 'arc') throw new Error('expected the arc to stay an arc')
    expect(Math.abs(arc.sweepDeg)).toBeCloseTo(270, 6)
  })

  it('mirrors the bulge across the chord on Flip', async () => {
    const { gestures, last } = editor({ path: CURVED, selection: { edge: 1 } })
    await userEvent.setup().click(screen.getByTestId('edge-flip'))
    expect(gestures[gestures.length - 1]?.field).toBeNull()
    const arc = last().segments[0]
    if (arc.kind !== 'arc') throw new Error('expected the arc to stay an arc')
    // The same chord, the other way round: the sweep changes sign and keeps its size.
    expect(Math.sign(arc.sweepDeg)).toBe(-1)
    expect(Math.abs(arc.sweepDeg)).toBeCloseTo(180, 6)
  })

  it('shows both semi-axes, the axis rotation and the sweep of an elliptical arc (criterion 3)', () => {
    editor({ path: CURVED, selection: { edge: 2 } })
    expect(screen.getByTestId('edge-editor-2')).toHaveTextContent('Elliptical arc')
    expect(screen.getByTestId('edge-semi-axis-a')).toHaveValue('900')
    expect(screen.getByTestId('edge-semi-axis-b')).toHaveValue('500')
    expect(screen.getByTestId('edge-axis-rotation')).toHaveValue('0')
    expect(screen.getByTestId('edge-sweep-field')).toHaveValue('90')
    expect(screen.getByTestId('edge-flip')).toBeEnabled()
    expect(screen.getByTestId('edges-tab').textContent).not.toContain('ell ')
  })

  it('accepts a decimal axis rotation (criterion 12)', async () => {
    const { last } = editor({ path: CURVED, selection: { edge: 2 } })
    const field = screen.getByTestId('edge-axis-rotation')
    const user = userEvent.setup()
    await user.clear(field)
    await user.type(field, '22.5')
    await user.keyboard('{Enter}')
    const segment = last().segments[1]
    if (segment.kind !== 'ellipticalArc') throw new Error('expected the elliptical arc to stay one')
    expect(segment.rotationDeg).toBeCloseTo(22.5, 9)
  })
})

describe('the fillet fields (criteria 13, 14, 16)', () => {
  it('rounds the selected corner and the area gets smaller (criterion 13)', async () => {
    const { gestures, last } = editor({ selection: { vertex: 2 } })
    const field = screen.getByTestId('edge-corner-radius')
    expect(screen.getByTestId('edge-corner-radius-row')).toHaveTextContent('Corner radius')
    const user = userEvent.setup()
    await user.clear(field)
    await user.type(field, '250')
    await user.keyboard('{Enter}')
    expect(gestures[gestures.length - 1]?.field).toBe('cornerRadius')
    const path = last()
    expect(path.segments.length).toBe(7)
    expect(areaOf(path)).toBeCloseTo(13_066_587, -2)
    expect(areaOf(path)).toBeLessThan(areaOf(KITCHEN))
    const arc = path.segments[1]
    if (arc.kind !== 'arc') throw new Error('expected the corner to have become an arc')
    // The table on screen still reads the Kitchen it was given — the tab is controlled, and this
    // test's controller keeps nothing — so both readings come off the proposal itself. A quarter
    // turn of R 250 is 392.70 mm of arc, and `393 mm` is what the Length column prints: the
    // `393` in criterion 13 is the Edge's length, not its radius, which is the 250 that was typed.
    expect(distance(arc.center, arc.to)).toBeCloseTo(250, 6)
    expect(lengthOf(arc, segmentStart(path, 1))).toBeCloseTo(392.6990816987241, 6)
    // Tangent at both ends: the Edge either side is 250 shorter than it was, and still straight.
    // The corner is the one between Edges 1 and 2, so the 3,600 and the 2,700 both give up 250.
    expect(edgeLength(path, 1)).toBeCloseTo(3600 - 250, 6)
    expect(edgeLength(path, 3)).toBeCloseTo(2700 - 250, 6)
  })

  it('prefills an existing fillet with the radius that made it, and 400 re-trims both neighbours (criterion 16)', async () => {
    const first = editor({ selection: { vertex: 2 } })
    const typed = screen.getByTestId('edge-corner-radius')
    const user = userEvent.setup()
    await user.clear(typed)
    await user.type(typed, '250')
    await user.keyboard('{Enter}')
    const rounded = first.last()
    first.unmount()
    const later: ClosedPath[] = []
    render(
      <EdgesTab
        path={rounded}
        format={MM}
        selection={{ edge: 2 }}
        editable
        onGesture={(footprint) => { later.push(asPath(footprint)) }}
      />,
    )
    // The field holds the corner radius that was typed, not the 392.70 the Edge measures: typing
    // the same number again has to reproduce the same fillet, which is the same promise criterion
    // 11 makes of every other field. And the fillet is edited as a *corner* — selecting its Edge
    // opens the corner field, not the arc's Radius and Sweep.
    expect(screen.queryByTestId('edge-radius-field')).not.toBeInTheDocument()
    const field = screen.getByTestId('edge-corner-radius')
    expect(field).toHaveValue('250')
    await user.clear(field)
    await user.type(field, '400')
    await user.keyboard('{Enter}')
    const grown = later[later.length - 1]
    expect(grown.segments.length).toBe(rounded.segments.length)
    const arc = grown.segments[1]
    if (arc.kind !== 'arc') throw new Error('expected the fillet to stay an arc')
    expect(distance(arc.center, arc.to)).toBeCloseTo(400, 6)
    // Tangent still, and both neighbours gave up 400 rather than 250.
    expect(validateLoop(grown)).toEqual([])
    expect(edgeLength(grown, 1)).toBeCloseTo(3600 - 400, 6)
    expect(edgeLength(grown, 3)).toBeCloseTo(2700 - 400, 6)
  })

  it('rounds every corner in one gesture (criterion 14)', async () => {
    const { gestures, last } = editor({})
    const field = screen.getByTestId('edge-round-all')
    const user = userEvent.setup()
    await user.clear(field)
    await user.type(field, '250')
    await user.click(screen.getByTestId('edge-round-all-apply'))
    expect(gestures[gestures.length - 1]?.final).toBe(true)
    const path = last()
    expect(path.segments.length).toBe(12)
    expect(path.segments.filter((segment) => segment.kind === 'arc').length).toBe(6)
    expect(areaOf(path)).toBeCloseTo(13_026_349.54, -1)
    expect(perimeterOf(path)).toBeCloseTo(15_156.19, 1)
    expect(validateLoop(path)).toEqual([])
  })

  it('says nothing about corners when the shape is not editable', () => {
    editor({ editable: false })
    expect(screen.queryByTestId('edge-round-all-row')).not.toBeInTheDocument()
    expect(screen.getByTestId('edges-tab')).toHaveTextContent('read-only')
  })
})
