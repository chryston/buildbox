/**
 * The Wall tool's draft bar and its join indicator (#64 §12, criterion 11's DOM half).
 *
 * What the bar says is the whole of the tool's promise: the words that name a join, the chip
 * that measures the segment in progress, the three ways to leave a draft, and the digit that
 * turns the keyboard into a length. None of it may speak in `L`, `R` or a centreline (D6), so
 * the banned words are asserted here rather than left to a reviewer's reading.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { deriveWalls } from '../../../derive'
import type { FloorWalls, Pt, SnapKind } from '../../../derive'
import type { Project, Wall } from '../../../domain'
import { WallDraftOverlay } from './WallDraftOverlay'
import type { WallToolDefaults } from './WallDraftOverlay'
import { emptyWallDraft } from './wallDraft'
import type { WallChainDraft, WallDraft } from './wallDraft'

const PAN = { x: 100, y: 100 }
const viewport = { zoom: 1, panX: PAN.x, panY: PAN.y }

beforeAll(() => {
  // jsdom's `PointerEvent` carries no coordinates, and the draft is all coordinates.
  if (!globalThis.PointerEvent || !('clientX' in new globalThis.PointerEvent('pointermove'))) {
    globalThis.PointerEvent = MouseEvent as typeof PointerEvent
  }
})

const lineWall = (id: string, ref: string, start: Pt, end: Pt): Wall => ({
  id,
  ref,
  floorId: 'floor-main',
  line: { kind: 'line', start, end },
  thickness: 100,
  justification: 'centre',
  baseElevation: 0,
  height: 2600,
})

const WALLS: readonly Wall[] = [
  lineWall('w1', 'W-1', { x: 0, y: 0 }, { x: 4000, y: 0 }),
  lineWall('w2', 'W-2', { x: 4000, y: 0 }, { x: 4000, y: 3000 }),
  lineWall('w3', 'W-3', { x: 1000, y: 2000 }, { x: 6000, y: 2000 }),
]

const floorWalls: FloorWalls = deriveWalls(
  // `deriveWalls` reads the model's Walls and Junctions and nothing else, so the test hands it
  // exactly those: a jsdom module cannot read the fixture files off disk.
  { existingModel: { walls: [...WALLS], wallJunctions: [] } } as unknown as Project,
  'floor-main',
)

const DEFAULTS: WallToolDefaults = {
  thickness: 100,
  justification: 'centre',
  baseElevation: 0,
  height: 2600,
  classification: null,
  constructionLabel: '',
}

const SNAP_KINDS = new Set<SnapKind>(['endpoint', 'wallFace', 'angle', 'grid'])

type Callbacks = {
  onFinish?: (chain: WallChainDraft) => void
  onCancel?: () => void
  onOptions?: (defaults: WallToolDefaults) => void
}

/** The draft lives in the caller, exactly as the Floor workspace keeps it (#64 §12). */
function Harness(props: Callbacks): ReactNode {
  const { onFinish = () => undefined, onCancel = () => undefined, onOptions = () => undefined } = props
  const [draft, setDraft] = useState<WallDraft>(() => emptyWallDraft())
  return (
    <WallDraftOverlay
      viewport={viewport}
      floorWalls={floorWalls}
      draft={draft}
      onDraft={setDraft}
      onCancel={onCancel}
      onFinish={onFinish}
      floorId="floor-main"
      defaults={DEFAULTS}
      onOptions={onOptions}
      snapKinds={SNAP_KINDS}
      gridSpacingMm={0}
      angleIncrementDeg={0}
      unit="mm"
      precision={0}
    />
  )
}

const layer = (): HTMLElement => screen.getByTestId('wall-draft-layer')
const hoverAt = (at: Pt): void => {
  fireEvent.pointerMove(layer(), { clientX: at.x + PAN.x, clientY: at.y + PAN.y })
}
const clickAt = (at: Pt): void => {
  hoverAt(at)
  // A point is placed by a press and release on the canvas, each carrying its own position.
  const x = at.x + PAN.x
  const y = at.y + PAN.y
  fireEvent.pointerDown(layer(), { clientX: x, clientY: y })
  fireEvent.pointerUp(layer(), { clientX: x, clientY: y })
}
const indicator = (): HTMLElement | null => screen.queryByTestId('wall-join-indicator')
const chip = (): string => screen.getByTestId('wall-chip').textContent ?? ''

describe('WallDraftOverlay', () => {
  it('names the join a click would make, in the words the issue prescribes', () => {
    render(<Harness />)
    // The tidied face corner of W-1, not its centreline end.
    hoverAt({ x: 4000, y: -50 })
    expect(indicator()?.textContent).toBe('Join to end of W-1')
    hoverAt({ x: 3000, y: 1950 })
    expect(indicator()?.textContent).toBe('Attach to W-3')
    hoverAt({ x: 500, y: 900 })
    expect(indicator()).toBeNull()
  })

  it('never speaks of sides or a centreline', () => {
    render(<Harness />)
    for (const at of [
      { x: 4000, y: -50 }, { x: 4000, y: 50 }, { x: 3000, y: 1950 },
      { x: 1000, y: 2050 }, { x: 4000, y: 3000 }, { x: 500, y: 900 },
    ]) {
      hoverAt(at)
      for (const testId of ['wall-join-indicator', 'wall-hover-label']) {
        const text = screen.queryByTestId(testId)?.textContent ?? ''
        expect(text).not.toMatch(/\bL\b|\bR\b/i)
        expect(text.toLowerCase()).not.toContain('left')
        expect(text.toLowerCase()).not.toContain('right')
        expect(text.toLowerCase()).not.toContain('centreline')
      }
    }
  })

  it('measures the segment in progress in the chip', () => {
    render(<Harness />)
    expect(chip()).toBe('')
    // The first click starts the chain; the second is what the chip measures.
    clickAt({ x: 0, y: 0 })
    expect(chip()).toBe('')
    clickAt({ x: 4000, y: 0 })
    expect(chip()).toBe('4,000 mm · 0°')
  })

  it('undoes the last point, which leaves nothing to finish', () => {
    render(<Harness />)
    clickAt({ x: 0, y: 0 })
    clickAt({ x: 4000, y: 0 })
    expect(screen.getByTestId('wall-finish')).not.toBeDisabled()
    fireEvent.click(screen.getByTestId('wall-undo'))
    expect(screen.getByTestId('wall-finish')).toBeDisabled()
    expect(chip()).toBe('')
  })

  it('finishes the whole chain as one Intent carrying the tool defaults', () => {
    const onFinish = vi.fn()
    render(<Harness onFinish={onFinish} />)
    clickAt({ x: 0, y: 0 })
    clickAt({ x: 4000, y: 0 })
    clickAt({ x: 4000, y: 3000 })
    fireEvent.click(screen.getByTestId('wall-finish'))
    expect(onFinish).toHaveBeenCalledTimes(1)
    const chain = onFinish.mock.calls[0]![0]
    expect(chain.floorId).toBe('floor-main')
    expect(chain.walls).toHaveLength(2)
    expect(chain.walls[0]).toMatchObject({ thickness: 100, justification: 'centre', baseElevation: 0, height: 2600 })
    // The interior point joins the chain's own two segments to each other.
    expect(chain.starts[1]).toEqual({ kind: 'segment', index: 0, end: 'end' })
    expect(chain.ends[0]).toEqual({ kind: 'segment', index: 1, end: 'start' })
  })

  it('cancels without sending anything', () => {
    const onFinish = vi.fn()
    const onCancel = vi.fn()
    render(<Harness onFinish={onFinish} onCancel={onCancel} />)
    clickAt({ x: 0, y: 0 })
    clickAt({ x: 4000, y: 0 })
    fireEvent.click(screen.getByTestId('wall-cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onFinish).not.toHaveBeenCalled()
  })

  it('opens the length field with the digit that opened it', () => {
    render(<Harness />)
    clickAt({ x: 0, y: 0 })
    hoverAt({ x: 4000, y: 0 })
    fireEvent.keyDown(layer(), { key: '2' })
    const field = screen.getByTestId('wall-length-field') as HTMLInputElement
    expect(field.value).toBe('2')
    fireEvent.change(field, { target: { value: '2500' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    // The point lands 2,500 mm along the direction the pointer was held in, not where it was.
    clickAt({ x: 4000, y: 0 })
    expect(chip()).toBe('2,500 mm · 0°')
    expect(screen.queryByTestId('wall-length-field')).toBeNull()
  })
})
