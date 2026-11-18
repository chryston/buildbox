/**
 * The Copy/Move to Floor dialog (#56 criterion 11).
 *
 * The sentence is the point: Floors are independent spatial silos (#25), so the dialog must
 * not imply it aligned anything. It prefills the destination with the same local numbers the
 * Item has now, states that Floors don't share coordinates, and leaves the person to change
 * the position if the two plans are not the same plan. The two buttons are the whole
 * difference between a copy and a move, so they are asserted as two calls with the same
 * target — the geometry they carry is identical.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Floor } from '../../domain'
import { TransferToFloorDialog } from './TransferToFloorDialog'

const floors: Floor[] = [
  { id: 'floor-1', name: 'Kitchen level', planImage: null },
  { id: 'floor-2', name: 'Loft', planImage: null },
]

const open = (over: { unit?: 'mm' | 'cm' | 'm'; precision?: number } = {}) => {
  const props = {
    floors,
    fromFloorName: 'Kitchen level',
    initial: { x: 420, y: 450, baseElevation: 120 },
    unit: over.unit ?? ('mm' as const),
    precision: over.precision ?? 0,
    onCopy: vi.fn(),
    onMove: vi.fn(),
    onClose: vi.fn(),
  }
  render(<TransferToFloorDialog {...props} />)
  return props
}

describe('the sentence', () => {
  it('says the coordinates are not shared, in the words the issue prescribes', () => {
    open()
    expect(screen.getByTestId('transfer-note')).toHaveTextContent(
      "Floors don't share coordinates; check the position on the destination Floor",
    )
  })
})

describe('the prefilled position', () => {
  it('is the same local numbers the Item has on its own Floor', () => {
    open()
    expect(screen.getByTestId('transfer-x')).toHaveValue(420)
    expect(screen.getByTestId('transfer-y')).toHaveValue(450)
    expect(screen.getByTestId('transfer-elevation')).toHaveValue(120)
    expect(screen.getByTestId('transfer-floor')).toHaveValue('floor-2')
  })

  it('is read back in the display unit', () => {
    const props = open({ unit: 'cm' })
    expect(screen.getByTestId('transfer-x')).toHaveValue(42)
    fireEvent.change(screen.getByTestId('transfer-x'), { target: { value: '50' } })
    fireEvent.click(screen.getByTestId('transfer-copy'))
    expect(props.onCopy).toHaveBeenCalledWith({ floorId: 'floor-2', x: 500, y: 450, baseElevation: 120 })
  })
})

describe('the two buttons', () => {
  it('copy sends a new placement to the destination and move takes the reference there', () => {
    const props = open()
    fireEvent.click(screen.getByTestId('transfer-copy'))
    expect(props.onCopy).toHaveBeenCalledWith({ floorId: 'floor-2', x: 420, y: 450, baseElevation: 120 })
    fireEvent.click(screen.getByTestId('transfer-move'))
    expect(props.onMove).toHaveBeenCalledWith({ floorId: 'floor-2', x: 420, y: 450, baseElevation: 120 })
  })

  it('cancels without touching either Floor', () => {
    const props = open()
    fireEvent.click(screen.getByTestId('transfer-cancel'))
    expect(props.onClose).toHaveBeenCalled()
    expect(props.onCopy).not.toHaveBeenCalled()
    expect(props.onMove).not.toHaveBeenCalled()
  })
})
