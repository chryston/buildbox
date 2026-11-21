/**
 * The Room draft bar and its pointer, as fields (#67 behaviours 4, 7).
 *
 * The layer is the only place a Room Outline exists before the Intent does, so what is asserted
 * here is what a person sees and what the layer hands back: the hint in the tool's own word, the
 * blocked sentence in place of the hint, `Close` live only from three points and only while the
 * proposal is clean, and the typed length landing the next point that many millimetres along the
 * direction the pointer is held in.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import type { Project } from '../../../domain'
import type { ClosedPath, FloorWalls, SnapKind } from '../../../derive'
import { deriveWalls } from '../../../derive'
import { clickDraft, startDraft, withCursor } from '../shape/draftPath'
import type { PathDraft } from '../shape/draftPath'
import { RoomDraftOverlay } from './RoomDraftOverlay'
import type { RoomOverlapPreview } from './roomDraft'

// jsdom ships no PointerEvent in every build; the layer listens for pointer events only.
if (typeof globalThis.PointerEvent === 'undefined') {
  globalThis.PointerEvent = class extends Event {
    clientX: number
    clientY: number

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, { ...init, bubbles: true })
      this.clientX = init.clientX ?? 0
      this.clientY = init.clientY ?? 0
    }
  } as unknown as typeof PointerEvent
}

const VIEWPORT = { zoom: 1, panX: 0, panY: 0 }

const floorWalls: FloorWalls = deriveWalls(
  // A Floor with no Walls: the resolver still answers, and the layer needs the face sources it
  // would snap to. A jsdom module cannot read the fixture files off disk, so the five collections
  // of the model are written out empty rather than left missing (#69 §5 reads all five).
  { existingModel: { walls: [], wallJunctions: [], openings: [], rooms: [], placedItems: [] } } as unknown as Project,
  'floor-main',
)

const CLEAN: RoomOverlapPreview = { blocked: false, regions: [], message: null }
const BLOCKED: RoomOverlapPreview = {
  blocked: true,
  regions: [{ start: { x: 0, y: 0 }, segments: [] } as unknown as ClosedPath],
  message: 'Overlaps Kitchen by 0.42 m².',
}

interface Harness {
  onDraft: Mock
  onCancel: Mock
  onClose: Mock
}

function mount(draft: PathDraft | null, overlap: RoomOverlapPreview = CLEAN): Harness {
  const harness: Harness = { onDraft: vi.fn(), onCancel: vi.fn(), onClose: vi.fn() }
  render(
    <RoomDraftOverlay
      viewport={VIEWPORT}
      floorWalls={floorWalls}
      roomGeometry={[]}
      tool="line"
      toolLabel="Line"
      draft={draft}
      onDraft={harness.onDraft}
      onCancel={harness.onCancel}
      onClose={harness.onClose}
      overlap={overlap}
      snapKinds={new Set<SnapKind>()}
      gridSpacingMm={100}
      angleIncrementDeg={15}
      unit="mm"
      precision={0}
    />,
  )
  return harness
}

const layer = (): HTMLElement => screen.getByTestId('room-draft-layer')

const clickAt = (x: number, y: number): void => {
  fireEvent.pointerDown(layer(), { clientX: x, clientY: y })
  fireEvent.pointerUp(layer(), { clientX: x, clientY: y })
}

/** A draft of the given corners: the first is the start, the rest are clicks. */
const draftOf = (...corners: readonly { x: number; y: number }[]): PathDraft => {
  const [first, ...rest] = corners
  return rest.reduce((draft, at) => clickDraft(draft, at), startDraft('line', first!))
}

const RECT = draftOf({ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 })

describe('the hint', () => {
  it('says what the first click does, in the tool’s own word', () => {
    mount(null)
    expect(screen.getByTestId('room-draft-hint').textContent)
      .toBe('Line · click to set the first point · Esc cancels')
  })

  it('says what the next click does once the shape has started', () => {
    mount(draftOf({ x: 0, y: 0 }, { x: 4000, y: 0 }))
    expect(screen.getByTestId('room-draft-hint').textContent)
      .toBe('Line · click to place · click start to close · Esc cancels')
  })

  it('gives way to the sentence that blocks the Room', () => {
    mount(RECT, BLOCKED)
    expect(screen.queryByTestId('room-draft-hint')).toBeNull()
    expect(screen.getByTestId('room-draft-blocked').textContent).toBe('Overlaps Kitchen by 0.42 m².')
    // A blocked proposal is not offered as a Room.
    expect(screen.getByTestId('room-draft-close')).toBeDisabled()
  })
})

describe('the pointer', () => {
  it('opens the draft at the point the first click lands on', () => {
    const harness = mount(null)
    clickAt(120, 80)
    expect(harness.onDraft).toHaveBeenCalledTimes(1)
    expect(harness.onDraft.mock.calls[0]![0].start).toEqual({ x: 120, y: 80 })
  })

  it('places the next point where the click lands', () => {
    const harness = mount(draftOf({ x: 0, y: 0 }))
    clickAt(4000, 0)
    const next = harness.onDraft.mock.calls[0]![0] as PathDraft
    expect(next.placed).toHaveLength(1)
    expect(next.placed[0]!.to).toEqual({ x: 4000, y: 0 })
  })

  it('ignores a press that slid across the canvas', () => {
    const harness = mount(null)
    fireEvent.pointerDown(layer(), { clientX: 10, clientY: 10 })
    fireEvent.pointerUp(layer(), { clientX: 90, clientY: 60 })
    expect(harness.onDraft).not.toHaveBeenCalled()
  })

  it('never places a point for a click that began on the bar', () => {
    const harness = mount(RECT)
    const button = screen.getByTestId('room-draft-close')
    fireEvent.pointerDown(button, { clientX: 300, clientY: 500 })
    fireEvent.pointerUp(button, { clientX: 300, clientY: 500 })
    expect(harness.onDraft).not.toHaveBeenCalled()
  })
})

describe('closing', () => {
  it('is not offered until the draft is a loop', () => {
    mount(draftOf({ x: 0, y: 0 }, { x: 4000, y: 0 }))
    expect(screen.getByTestId('room-draft-close')).toBeDisabled()
  })

  it('hands back the closed Outline', () => {
    const harness = mount(RECT)
    const close = screen.getByTestId('room-draft-close')
    expect(close).toBeEnabled()
    fireEvent.click(close)
    expect(harness.onClose).toHaveBeenCalledTimes(1)
    const outline = harness.onClose.mock.calls[0]![0]
    expect(outline.kind).toBe('path')
    expect(outline.path.start).toEqual({ x: 0, y: 0 })
    expect(outline.path.segments).toHaveLength(4)
    expect(outline.path.segments[3]!.to).toEqual({ x: 0, y: 0 })
  })

  it('cancels on Escape and on Cancel, and takes a point back on Backspace', () => {
    const harness = mount(RECT)
    fireEvent.keyDown(layer(), { key: 'Escape' })
    expect(harness.onCancel).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByTestId('room-draft-cancel'))
    expect(harness.onCancel).toHaveBeenCalledTimes(2)
    fireEvent.keyDown(layer(), { key: 'Backspace' })
    // Three points are still on the draft, so Backspace takes one back rather than cancelling.
    expect(harness.onCancel).toHaveBeenCalledTimes(2)
    const back = harness.onDraft.mock.calls[0]![0] as PathDraft
    expect(back.placed).toHaveLength(2)
  })
})

describe('the typed length', () => {
  it('opens on a digit and lands the point that far along', () => {
    const held = withCursor(draftOf({ x: 0, y: 0 }, { x: 1000, y: 0 }), { x: 2000, y: 0 })
    const harness = mount(held)
    fireEvent.keyDown(layer(), { key: '2' })
    const field = screen.getByTestId('room-draft-length')
    expect(field).toHaveValue('2')
    fireEvent.change(field, { target: { value: '2500' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    const next = harness.onDraft.mock.calls[0]![0] as PathDraft
    expect(next.placed).toHaveLength(2)
    expect(next.placed[1]!.to).toEqual({ x: 3500, y: 0 })
  })

  it('shows the Edge it is measuring', () => {
    mount(draftOf({ x: 0, y: 0 }, { x: 1000, y: 0 }))
    expect(screen.getByTestId('room-draft-chip').textContent).toContain('1,000 · 0°')
  })
})
