/**
 * The handles, the ghost and the chip, in a jsdom that lays nothing out (#75 §6, §7).
 *
 * `toDrawing` is handed to the layer rather than derived from the canvas, which is what lets these
 * tests say exactly what height the pointer is standing at — the mapping through zoom and pan is
 * `ElevationPane`'s own business and is pinned there. What is pinned here is the gesture: which handle
 * moves which edge, what a snap does to the answer, what the reader is shown while the drag lasts, and
 * what one Intent the release writes.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ElevationRow, VerticalSnapCandidate } from '../../../derive'
import { ElevationDragLayer } from './ElevationDragLayer'

/** A base cabinet: 600 wide along the line, 0 to 860 mm high. */
const ROW: ElevationRow = {
  id: 'P-1',
  kind: 'item',
  name: 'Base cabinet #1',
  sMin: 1000,
  sMax: 1600,
  zMin: 0,
  zMax: 860,
  distance: 500,
  crossesLine: false,
  hostWallId: null,
  color: null,
  layerKey: '00000000-0000-4000-8000-000000000001',
}

/** A Wall that owns its height, so it has a top handle too. */
const WALL: ElevationRow = { ...ROW, id: 'W-1', kind: 'wall', name: 'W-1', zMin: 0, zMax: 2600 }

const VIEWPORT = { zoom: 2, panX: 0, panY: 0 }
/** The transform the pane gives its Display List, which the layer now rides too. */
const MATRIX = `matrix(${VIEWPORT.zoom},0,0,${VIEWPORT.zoom},${VIEWPORT.panX},${VIEWPORT.panY})`

/**
 * A pointer at (x, y) on the screen stands at (x, y) in the drawing, scaled by the zoom: the same
 * arithmetic the pane does, with the host's own box taken as the origin because jsdom has none.
 */
/** The height the harness's drawing stands at: its y grows downward from here, as the real one's does. */
const TOP_MM = 3000
const yOf = (z: number): number => TOP_MM - z
const zOf = (y: number): number => TOP_MM - y

const toDrawing = (clientX: number, clientY: number): { x: number, y: number } => ({
  x: clientX / VIEWPORT.zoom,
  y: clientY / VIEWPORT.zoom,
})

const CANDIDATES: readonly VerticalSnapCandidate[] = [
  { id: 'floor-datum', mm: 0, kind: 'datum', label: 'Floor Datum' },
  { id: 'floor-limit-upper', mm: 2600, kind: 'limit', label: 'Upper limit' },
  { id: 'W-9', mm: 850, kind: 'entity', label: 'Wall 9 · top' },
  { id: 'mount-sill', mm: 1050, kind: 'mounting', label: 'Window sill (HDB BTO typical)' },
]

const setup = (row: ElevationRow = ROW, candidates: readonly VerticalSnapCandidate[] = CANDIDATES) => {
  const onCommit = vi.fn()
  render(
    <svg>
      <ElevationDragLayer
        row={row} viewport={VIEWPORT} matrix={MATRIX} toDrawing={toDrawing} yOf={yOf} zOf={zOf}
        candidates={candidates} onCommit={onCommit}
      />
    </svg>,
  )
  return onCommit
}

/**
 * A pointer event on the window, built as a `MouseEvent`.
 *
 * jsdom has no `PointerEvent` and `fireEvent.pointerMove(window, { clientY })` quietly drops the
 * coordinates on a non-Element target, which would leave every drag here reading `NaN`. A constructed
 * `MouseEvent` under the pointer type name carries them, and the layer listens by type only.
 *
 * The height is turned into a client pixel through the drawing's own mapping, so every drag below is
 * stated as the height it aims at — which is how the criteria state it — and the conversion the pane
 * does is on the way.
 */
const windowPointer = (type: string, heightMm: number): void => {
  fireEvent(window, new MouseEvent(type, { clientX: 400, clientY: yOf(heightMm) * VIEWPORT.zoom, bubbles: true }))
}

/** The drag the issue describes: press a handle, move the pointer to a height, let go. */
const drag = (handle: 'top' | 'bottom' | 'body', fromY: number, toY: number): void => {
  fireEvent.pointerDown(screen.getByTestId(`elevation-handle-${handle}`), { clientX: 400, clientY: yOf(fromY) * VIEWPORT.zoom })
  windowPointer('pointermove', toY)
  windowPointer('pointerup', toY)
}

describe('the handles on the selected entity', () => {
  it('gives a Placed Item the move handle and nothing else', () => {
    setup()
    expect(screen.getByTestId('elevation-handle-body')).toBeInTheDocument()
    expect(screen.queryByTestId('elevation-handle-top')).toBeNull()
    expect(screen.queryByTestId('elevation-handle-bottom')).toBeNull()
  })

  it('gives an entity that owns its height a top and a bottom as well', () => {
    setup(WALL)
    expect(screen.getByTestId('elevation-handle-top')).toBeInTheDocument()
    expect(screen.getByTestId('elevation-handle-bottom')).toBeInTheDocument()
    expect(screen.getByTestId('elevation-handle-body')).toBeInTheDocument()
  })

  it('draws each handle 8 CSS px wide whatever the zoom', () => {
    setup(WALL)
    // 8 screen px at zoom 2 is 4 drawing millimetres; the handle is a square, so width equals height.
    const box = screen.getByTestId('elevation-handle-top')
    expect(box.getAttribute('width')).toBe(String(8 / VIEWPORT.zoom))
    expect(box.getAttribute('height')).toBe(String(8 / VIEWPORT.zoom))
  })
})

describe('a drag', () => {
  it('writes one Intent on release, in the field the handle and the entity decide', () => {
    const onCommit = setup(WALL)
    // The top handle at 2600 mm dragged down to 2500: the Wall's height, its base fixed.
    drag('top', 2600, 2500)
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith('height', 2500)
  })

  it('writes the top for a Placed Item, whose size its Item Design owns', () => {
    const onCommit = setup()
    drag('body', 430, 630)
    expect(onCommit).toHaveBeenCalledWith('top', 1060)
  })

  it('writes nothing when the pointer never moved', () => {
    const onCommit = setup(WALL)
    drag('top', 2600, 2600)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('shows a ghost and a chip while the drag lasts, and takes both away after', () => {
    setup(WALL)
    fireEvent.pointerDown(screen.getByTestId('elevation-handle-top'), { clientX: 400, clientY: 2600 * 2 })
    windowPointer('pointermove', 2500)
    expect(screen.getByTestId('elevation-drag-ghost')).toBeInTheDocument()
    expect(screen.getByTestId('elevation-drag-chip').textContent).toBe('Top 2500 mm · Δ −100 · Height 2500 mm')
    windowPointer('pointerup', 2500)
    expect(screen.queryByTestId('elevation-drag-ghost')).toBeNull()
    expect(screen.queryByTestId('elevation-drag-chip')).toBeNull()
  })

  it('cancels on Escape and changes nothing', () => {
    const onCommit = setup(WALL)
    fireEvent.pointerDown(screen.getByTestId('elevation-handle-top'), { clientX: 400, clientY: 2600 * 2 })
    windowPointer('pointermove', 2400)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('elevation-drag-ghost')).toBeNull()
    // The pointer coming up after the cancel is not a second gesture: the drag is already over.
    windowPointer('pointerup', 2400)
    expect(onCommit).not.toHaveBeenCalled()
  })
})

describe('a snapped drag', () => {
  it('lands the edge on the target rather than on the cursor', () => {
    const onCommit = setup(WALL)
    // 855 mm is 5 mm short of Wall 9's top, well inside 12 CSS px at zoom 2 (6 mm).
    drag('top', 2600, 855)
    expect(onCommit).toHaveBeenCalledWith('height', 850)
  })

  it('draws a guide and its plain label while the snap lasts', () => {
    setup(WALL)
    fireEvent.pointerDown(screen.getByTestId('elevation-handle-top'), { clientX: 400, clientY: 2600 * 2 })
    windowPointer('pointermove', 1052)
    const guide = screen.getByTestId('elevation-snap-guide')
    // The guide lies on the target's height, which the drawing puts at its own y.
    expect(guide.getAttribute('y1')).toBe(String(yOf(1050)))
    expect(screen.getByTestId('elevation-snap-label').textContent)
      .toBe('Window sill (HDB BTO typical) · 1050 mm')
    windowPointer('pointerup', 1052)
    expect(screen.queryByTestId('elevation-snap-guide')).toBeNull()
  })

  it('lets go of the target once the pointer is past the radius', () => {
    const onCommit = setup(WALL)
    // 700 mm is 150 mm from every candidate: no snap, so the cursor's own height is the answer.
    drag('top', 2600, 700)
    expect(onCommit).toHaveBeenCalledWith('height', 700)
  })

  it('never snaps an entity to itself', () => {
    const onCommit = setup(ROW, [{ id: 'P-1', mm: 850, kind: 'entity', label: 'Base cabinet #1 · top' }])
    // The body's top lands at 855, five millimetres from the cabinet's own top — inside the radius, and
    // excluded by id. The cursor's own height is the answer, not the target it would otherwise have taken.
    drag('body', 430, 425)
    expect(onCommit).toHaveBeenCalledWith('top', 855)
  })

  it('prefers the Floor Datum to an entity edge at the same distance', () => {
    const onCommit = setup(WALL, [
      { id: 'floor-datum', mm: 18, kind: 'datum', label: 'Floor Datum' },
      { id: 'W-2', mm: 22, kind: 'entity', label: 'Wall 2 · top' },
    ])
    // 20 mm is two millimetres from both, and the Datum wins the tie whatever the zoom.
    drag('top', 2600, 20)
    expect(onCommit).toHaveBeenCalledWith('height', 18)
  })

  it('prefers an entity edge to a mounting height at the same distance', () => {
    const onCommit = setup(WALL, [
      { id: 'mount', mm: 1006, kind: 'mounting', label: 'Door height' },
      { id: 'W-3', mm: 1014, kind: 'entity', label: 'Wall 3 · top' },
    ])
    drag('top', 2600, 1010)
    expect(onCommit).toHaveBeenCalledWith('height', 1014)
  })

  it('breaks an exact tie between two entity edges on the lower id', () => {
    const onCommit = setup(WALL, [
      { id: 'W-b', mm: 1000, kind: 'entity', label: 'Wall B · top' },
      { id: 'W-a', mm: 1000, kind: 'entity', label: 'Wall A · top' },
    ])
    drag('top', 2600, 1002)
    expect(onCommit).toHaveBeenCalledWith('height', 1000)
  })

  it('keeps a body drag whole: one delta on both edges, taken by whichever edge is nearer', () => {
    const onCommit = setup(ROW, [{ id: 'W-4', mm: 100, kind: 'entity', label: 'Wall 4 · top' }])
    // The body spans 0–860. Dragged 104 mm up its bottom sits 4 mm from Wall 4's top and its top is far
    // from anything, so that one target takes the bottom and the whole body takes the same −4 mm: it
    // lands at 100–960, still 860 mm tall.
    drag('body', 430, 534)
    expect(onCommit).toHaveBeenCalledWith('top', 960)
  })

  it('writes nothing when the snap brings the entity back to where it started', () => {
    const onCommit = setup()
    // 4 mm off the Floor Datum, and the Datum takes it home. The pointer moved; the entity did not, and
    // an Intent that changes no number would put a step on the Undo stack that undoes nothing.
    drag('body', 430, 434)
    expect(onCommit).not.toHaveBeenCalled()
  })
})

describe('the acquisition radius', () => {
  /** The one candidate the two radius tests share: a Wall top at 850 mm. */
  const WALL_TOP: readonly VerticalSnapCandidate[] = [{ id: 'W-9', mm: 850, kind: 'entity', label: 'Wall 9 · top' }]

  it('acquires a target 5 mm away at zoom 2, where the radius is 6 mm', () => {
    const near = vi.fn()
    render(
      <svg>
        <ElevationDragLayer
          row={WALL}
          viewport={VIEWPORT}
          matrix={MATRIX}
          toDrawing={toDrawing}
          yOf={yOf}
          zOf={zOf}
          candidates={WALL_TOP}
          onCommit={near}
        />
      </svg>,
    )
    fireEvent.pointerDown(screen.getByTestId('elevation-handle-top'), { clientX: 400, clientY: 2600 * 2 })
    windowPointer('pointermove', 855)
    windowPointer('pointerup', 855)
    expect(near).toHaveBeenCalledWith('height', 850)
  })

  it('lets a target 9 mm away go at zoom 2, where the radius is 6 mm', () => {
    const far = vi.fn()
    render(
      <svg>
        <ElevationDragLayer
          row={WALL}
          viewport={VIEWPORT}
          matrix={MATRIX}
          toDrawing={toDrawing}
          yOf={yOf}
          zOf={zOf}
          candidates={WALL_TOP}
          onCommit={far}
        />
      </svg>,
    )
    fireEvent.pointerDown(screen.getByTestId('elevation-handle-top'), { clientX: 400, clientY: 2600 * 2 })
    windowPointer('pointermove', 859)
    windowPointer('pointerup', 859)
    expect(far).toHaveBeenCalledWith('height', 859)
  })
})
