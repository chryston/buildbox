/**
 * The Room inspector as the field it is (#67 behaviours 3–4).
 *
 * The rendered sentences are the acceptance text, not the key names: `Area` reads `12.00 m²` to
 * two decimals whatever the display unit, and the name commits once — on Enter or on blur — with
 * a name the domain will accept. An empty field is the person changing their mind, so it writes
 * nothing and shows the stored name again.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { DerivedRoom } from '../../../derive'
import type { Room } from '../../../domain'
import { RoomInspector } from './RoomInspector'

/** A Room Outline's path: `DerivedRoom` reads it as its own `path`, so no cast is needed. */
const rect = (maxX: number, maxY: number) => ({
  start: { x: 0, y: 0 },
  segments: [
    { kind: 'line' as const, to: { x: maxX, y: 0 } },
    { kind: 'line' as const, to: { x: maxX, y: maxY } },
    { kind: 'line' as const, to: { x: 0, y: maxY } },
    { kind: 'line' as const, to: { x: 0, y: 0 } },
  ],
})

const PATH = rect(4000, 3000)

const ROOM: Room = {
  id: 'room-kitchen',
  floorId: 'floor-main',
  name: 'Kitchen',
  outline: { kind: 'path', path: PATH, segmentIds: ['e1', 'e2', 'e3', 'e4'] },
  wallFaceRefs: [],
}

/**
 * The same Room measured. Hand-built rather than derived: `derive`'s fixture loader reads the
 * filesystem, which the DOM project has no URL for, and every figure here is the closed-form
 * answer for a 4000 × 3000 rectangle anyway — 12 m², 14 000 mm round.
 */
const derived: DerivedRoom = {
  id: ROOM.id,
  floorId: ROOM.floorId,
  name: ROOM.name,
  outline: ROOM.outline,
  path: PATH,
  areaMm2: 12_000_000,
  areaM2: 12,
  perimeterMm: 14_000,
  labelAnchor: { x: 2000, y: 1500 },
  bounds: { x: 0, y: 0, w: 4000, h: 3000 },
  anchors: [],
}

describe('the Room inspector', () => {
  it('reads the Room’s own measurements', () => {
    render(<RoomInspector room={ROOM} derived={derived} unit="mm" precision={0} onRename={() => undefined} />)
    expect(screen.getByTestId('room-inspector-title').textContent).toBe('Room')
    expect(screen.getByTestId('room-measurements-area').textContent).toBe('12.00 m²')
    // 2 × (4000 + 3000), in the Project's own unit and precision.
    expect(screen.getByTestId('room-measurements-perimeter').textContent).toBe('14,000 mm')
    expect(screen.getByTestId('room-measurements-bounds').textContent).toBe('4,000 mm × 3,000 mm')
    expect((screen.getByTestId('room-name-input') as HTMLInputElement).value).toBe('Kitchen')
  })

  it('follows the Project’s unit for length but never for area', () => {
    render(<RoomInspector room={ROOM} derived={derived} unit="cm" precision={1} onRename={() => undefined} />)
    expect(screen.getByTestId('room-measurements-area').textContent).toBe('12.00 m²')
    expect(screen.getByTestId('room-measurements-perimeter').textContent).toBe('1,400.0 cm')
  })

  it('commits the name once, on Enter', () => {
    const onRename = vi.fn()
    render(<RoomInspector room={ROOM} derived={derived} unit="mm" precision={0} onRename={onRename} />)
    const field = screen.getByTestId('room-name-input')
    fireEvent.change(field, { target: { value: ' Utility Room ' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onRename).toHaveBeenCalledWith('Utility Room')
  })

  it('writes nothing when the field is emptied', () => {
    const onRename = vi.fn()
    render(<RoomInspector room={ROOM} derived={derived} unit="mm" precision={0} onRename={onRename} />)
    const field = screen.getByTestId('room-name-input')
    fireEvent.change(field, { target: { value: '   ' } })
    fireEvent.blur(field)
    expect(onRename).not.toHaveBeenCalled()
    expect((field as HTMLInputElement).value).toBe('Kitchen')
  })
})
