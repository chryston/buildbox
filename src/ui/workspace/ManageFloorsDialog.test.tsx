/**
 * Manage Floors (#56 criteria 1, 3, 7, 9): the one screen where a Floor is named, ordered,
 * limited, copied and deleted.
 *
 * The two rules worth testing here are the ones the issue puts words to — a Floor is named
 * and no two Floors share a name — and the manual order, which is the only ordering Floors
 * have (#25) and so the only thing a drag is allowed to change. The limits are tested through
 * the display unit because that is where a limit stops being a number and becomes a claim
 * about a room: 240 in cm is 2400 mm, and a dialog that got that wrong would be worse than
 * one with no limits at all.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Floor, Project } from '../../domain'
import { ManageFloorsDialog, floorNameProblem } from './ManageFloorsDialog'

const floor = (id: string, name: string, over: Partial<Floor> = {}): Floor => ({
  id,
  name,
  planImage: null,
  ...over,
})

const project = (floors: Floor[]): Project => ({
  id: 'project-1',
  meta: { name: 'Home' },
  preferences: { displayUnit: 'mm', displayPrecision: 0, defaultWallHeight: 2600 },
  floors,
  views: floors.map((each) => ({
    id: `view-${each.id}`, kind: 'plan', floorId: each.id, name: each.name, isDefault: true, showPlanImage: true,
  })),
  itemDesigns: [],
  existingModel: { placedItems: [], walls: [], wallJunctions: [], openings: [] },
  warningAcknowledgements: [],
})

const open = (floors: Floor[], over: Partial<Parameters<typeof ManageFloorsDialog>[0]> = {}) => {
  const props = {
    project: project(floors),
    activeFloorId: floors[0]?.id ?? null,
    unit: 'mm' as const,
    precision: 0,
    onRename: vi.fn(),
    onReorder: vi.fn(),
    onSetLimits: vi.fn(),
    onSetWallHeight: vi.fn(),
    onAddFloor: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    onClose: vi.fn(),
    ...over,
  }
  render(<ManageFloorsDialog {...props} />)
  return props
}

const two = (): Floor[] => [floor('floor-1', 'Kitchen level'), floor('floor-2', 'Loft')]

describe('naming a Floor', () => {
  it('says the sentence the issue prescribes when the name is taken', () => {
    expect(floorNameProblem(project(two()), 'floor-2', 'Kitchen level'))
      .toBe('Another Floor is already called Kitchen level')
  })

  it('says a Floor has to have a name', () => {
    expect(floorNameProblem(project(two()), 'floor-2', '   ')).toBe('Give this Floor a name')
  })

  it('ignores the Floor\'s own name and surrounding spaces', () => {
    expect(floorNameProblem(project(two()), 'floor-2', '  Loft  ')).toBeNull()
    expect(floorNameProblem(project(two()), 'floor-2', 'Mezzanine')).toBeNull()
  })

  it('refuses the rename in the row and writes nothing', () => {
    const props = open(two())
    const input = screen.getByTestId('floor-name-floor-2')
    fireEvent.change(input, { target: { value: 'Kitchen level' } })
    fireEvent.blur(input)
    expect(screen.getByTestId('floor-name-error-floor-2')).toHaveTextContent(
      'Another Floor is already called Kitchen level',
    )
    expect(props.onRename).not.toHaveBeenCalled()
  })

  it('commits a free name on blur, trimmed', () => {
    const props = open(two())
    fireEvent.change(screen.getByTestId('floor-name-floor-2'), { target: { value: '  Mezzanine ' } })
    fireEvent.blur(screen.getByTestId('floor-name-floor-2'))
    expect(props.onRename).toHaveBeenCalledWith('floor-2', 'Mezzanine')
  })
})

describe('ordering Floors', () => {
  it('moves a Floor to the neighbour it was dropped on', () => {
    const props = open(two())
    fireEvent.click(screen.getByTestId('floor-up-floor-2'))
    expect(props.onReorder).toHaveBeenLastCalledWith('floor-2', 0)
    fireEvent.click(screen.getByTestId('floor-down-floor-1'))
    expect(props.onReorder).toHaveBeenLastCalledWith('floor-1', 1)
  })

  it('has nowhere to move the first Floor up to, or the last down to', () => {
    open(two())
    expect(screen.getByTestId('floor-up-floor-1')).toBeDisabled()
    expect(screen.getByTestId('floor-down-floor-2')).toBeDisabled()
  })
})

describe('the Floor limits', () => {
  it('reads both bounds in the display unit', () => {
    const props = open(two(), { unit: 'cm' })
    fireEvent.click(screen.getByTestId('floor-settings-floor-1'))
    fireEvent.change(screen.getByTestId('floor-lower-floor-1'), { target: { value: '0' } })
    fireEvent.change(screen.getByTestId('floor-upper-floor-1'), { target: { value: '240' } })
    fireEvent.click(screen.getByTestId('floor-limits-save-floor-1'))
    expect(props.onSetLimits).toHaveBeenCalledWith('floor-1', 0, 2400)
  })

  it('keeps a blank field as no limit', () => {
    const props = open(two())
    fireEvent.click(screen.getByTestId('floor-settings-floor-1'))
    fireEvent.click(screen.getByTestId('floor-limits-save-floor-1'))
    expect(props.onSetLimits).toHaveBeenCalledWith('floor-1', null, null)
  })

  it('refuses a lower limit at or above the upper one', () => {
    const props = open(two())
    fireEvent.click(screen.getByTestId('floor-settings-floor-1'))
    fireEvent.change(screen.getByTestId('floor-lower-floor-1'), { target: { value: '3000' } })
    fireEvent.change(screen.getByTestId('floor-upper-floor-1'), { target: { value: '2400' } })
    fireEvent.click(screen.getByTestId('floor-limits-save-floor-1'))
    expect(screen.getByTestId('floor-limits-error-floor-1')).toHaveTextContent(
      'The lower limit has to sit below the upper limit',
    )
    expect(props.onSetLimits).not.toHaveBeenCalled()
  })

  it('shows the limits the Floor already has', () => {
    open([floor('floor-1', 'Kitchen level', { limits: { lowerMm: 0, upperMm: 2400 } }), floor('floor-2', 'Loft')])
    fireEvent.click(screen.getByTestId('floor-settings-floor-1'))
    expect(screen.getByTestId('floor-lower-floor-1')).toHaveValue(0)
    expect(screen.getByTestId('floor-upper-floor-1')).toHaveValue(2400)
  })
})

describe('the row actions', () => {
  it('hands Duplicate and Delete the Floor the row is', () => {
    const props = open(two())
    fireEvent.click(screen.getByTestId('floor-duplicate-floor-2'))
    fireEvent.click(screen.getByTestId('floor-delete-floor-1'))
    fireEvent.click(screen.getByTestId('add-floor'))
    expect(props.onDuplicate).toHaveBeenCalledWith('floor-2')
    expect(props.onDelete).toHaveBeenCalledWith('floor-1')
    expect(props.onAddFloor).toHaveBeenCalled()
  })
})
