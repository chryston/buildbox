/**
 * Placing the household shelter, as the click it is (#67 behaviour 17).
 *
 * The entry is fixed, so the layer has one sentence to say and one thing to do: the hint names the
 * size a click produces, and a click places — unless the rectangle the pointer carries would take
 * floor from another Room, in which case the click answers with the overlap sentence and puts down
 * nothing. Whether the click is allowed is decided by the workspace and handed in as `overlap`, so
 * this bar and the painted proposal can never disagree.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import type { ClosedPath } from '../../../derive'
import { ShelterLayer } from './ShelterLayer'
import type { RoomOverlapPreview } from './roomDraft'

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

const CLEAN: RoomOverlapPreview = { blocked: false, regions: [], message: null }
const BLOCKED: RoomOverlapPreview = {
  blocked: true,
  regions: [{ start: { x: 0, y: 0 }, segments: [] } as unknown as ClosedPath],
  message: 'Overlaps Kitchen by 1.41 m².',
}

interface Harness {
  onCentre: Mock
  onPlace: Mock
  onCancel: Mock
}

function mount(overlap: RoomOverlapPreview = CLEAN): Harness {
  const harness: Harness = { onCentre: vi.fn(), onPlace: vi.fn(), onCancel: vi.fn() }
  render(
    <ShelterLayer
      viewport={VIEWPORT}
      onCentre={harness.onCentre}
      onPlace={harness.onPlace}
      onCancel={harness.onCancel}
      overlap={overlap}
      unit="mm"
      precision={0}
    />,
  )
  return harness
}

const layer = (): HTMLElement => screen.getByTestId('shelter-layer')

const clickAt = (x: number, y: number): void => {
  fireEvent.pointerDown(layer(), { clientX: x, clientY: y })
  fireEvent.pointerUp(layer(), { clientX: x, clientY: y })
}

describe('the armed shelter', () => {
  it('says what the click places, at the size the pack states', () => {
    mount()
    expect(screen.getByTestId('shelter-hint').textContent)
      .toBe('Placing Household shelter — click to place at 1,450 × 1,950 mm · Esc cancels')
  })

  it('follows the pointer', () => {
    const harness = mount()
    fireEvent.pointerMove(layer(), { clientX: 2200, clientY: 900 })
    expect(harness.onCentre).toHaveBeenCalledWith({ x: 2200, y: 900 })
  })

  it('places on a clean click and takes the tool down', () => {
    const harness = mount()
    clickAt(2000, 1500)
    expect(harness.onPlace).toHaveBeenCalledTimes(1)
    expect(harness.onPlace).toHaveBeenCalledWith({ x: 2000, y: 1500 })
  })

  it('refuses the click that would overlap, and says why', () => {
    const harness = mount(BLOCKED)
    expect(screen.queryByTestId('shelter-hint')).toBeNull()
    expect(screen.getByTestId('shelter-blocked').textContent).toBe('Overlaps Kitchen by 1.41 m².')
    clickAt(2000, 1500)
    expect(harness.onPlace).not.toHaveBeenCalled()
  })

  it('ignores a press that slid across the canvas', () => {
    const harness = mount()
    fireEvent.pointerDown(layer(), { clientX: 10, clientY: 10 })
    fireEvent.pointerUp(layer(), { clientX: 400, clientY: 300 })
    expect(harness.onPlace).not.toHaveBeenCalled()
  })

  it('cancels on Escape and on the Cancel button', () => {
    const harness = mount()
    fireEvent.keyDown(layer(), { key: 'Escape' })
    expect(harness.onCancel).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByTestId('shelter-cancel'))
    expect(harness.onCancel).toHaveBeenCalledTimes(2)
  })
})
