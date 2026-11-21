/**
 * Duplicate Floor (#56 criterion 9).
 *
 * Two defaults carry the judgement here, and both are the issue's rather than the dialog's:
 * the Placed Items come along checked (copying a Floor usually means copying the room), and
 * the Plan Image does not (the picture belongs to the Floor it was photographed for — a
 * second Floor wearing the first one's plan is how a project starts lying). Everything else
 * is a form: name, position, and the checklist that decides which Item Designs cross over.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { rectangleFootprint } from '../../domain'
import type { Project } from '../../domain'
import { DuplicateFloorDialog, duplicateGroups } from './DuplicateFloorDialog'

const project = (): Project => ({
  id: 'project-1',
  meta: { name: 'Home' },
  preferences: { displayUnit: 'mm', displayPrecision: 0, defaultWallHeight: 2600 },
  floors: [
    { id: 'floor-1', name: 'Kitchen level', planImage: {
      assetHash: 'a'.repeat(64), mediaType: 'image/png', widthPx: 10, heightPx: 10, pixelsPerMm: 0.1,
    } },
    { id: 'floor-2', name: 'Loft', planImage: null },
  ],
  views: [
    { id: 'view-1', kind: 'plan', floorId: 'floor-1', name: 'Kitchen level', isDefault: true, showPlanImage: true },
    { id: 'view-2', kind: 'plan', floorId: 'floor-2', name: 'Loft', isDefault: true, showPlanImage: true },
  ],
  itemDesigns: [
    { id: 'd-sofa', kind: 'generic', name: 'Sofa 3-seater', footprint: rectangleFootprint(600, 220), origin: { x: 300, y: 110 }, height: 850, heightIsTypical: true, color: 'indigo' },
    { id: 'd-fridge', kind: 'generic', name: 'Fridge', footprint: rectangleFootprint(600, 600), origin: { x: 300, y: 300 }, height: 1800, heightIsTypical: true, color: 'indigo' },
  ],
  existingModel: {
    walls: [],
    wallJunctions: [],
    openings: [],
    placedItems: [
      { id: 'p1', itemDesignId: 'd-sofa', floorId: 'floor-1', translation: { x: 0, y: 0 }, rotationDeg: 0, baseElevation: 0 },
      { id: 'p2', itemDesignId: 'd-sofa', floorId: 'floor-1', translation: { x: 100, y: 0 }, rotationDeg: 0, baseElevation: 0 },
      { id: 'p3', itemDesignId: 'd-fridge', floorId: 'floor-1', translation: { x: 0, y: 200 }, rotationDeg: 0, baseElevation: 0 },
      { id: 'p4', itemDesignId: 'd-fridge', floorId: 'floor-2', translation: { x: 0, y: 0 }, rotationDeg: 0, baseElevation: 0 },
    ],
  },
  warningAcknowledgements: [],
})

const open = (sourceFloorId = 'floor-1') => {
  const props = { project: project(), sourceFloorId, onConfirm: vi.fn(), onClose: vi.fn() }
  render(<DuplicateFloorDialog {...props} />)
  return props
}

describe('the checklist', () => {
  it('groups the Floor\'s Placed Items by Item Design, and no one else\'s', () => {
    expect(duplicateGroups(project(), 'floor-1')).toEqual([
      { itemDesignId: 'd-sofa', label: 'Sofa 3-seater', placedItemIds: ['p1', 'p2'] },
      { itemDesignId: 'd-fridge', label: 'Fridge', placedItemIds: ['p3'] },
    ])
  })

  it('starts with every Item Design checked and the Plan Image not copied', () => {
    const props = open()
    expect(screen.getByTestId('duplicate-group-d-sofa')).toBeChecked()
    expect(screen.getByTestId('duplicate-group-d-fridge')).toBeChecked()
    expect(screen.getByTestId('duplicate-include-plan-image')).not.toBeChecked()
    fireEvent.click(screen.getByTestId('duplicate-confirm'))
    expect(props.onConfirm).toHaveBeenCalledWith({
      name: 'Kitchen level copy',
      toIndex: 1,
      placedItemIds: ['p1', 'p2', 'p3'],
      includePlanImage: false,
    })
  })

  it('drops the unchecked Item Designs and keeps the rest', () => {
    const props = open()
    fireEvent.click(screen.getByTestId('duplicate-group-d-fridge'))
    fireEvent.click(screen.getByTestId('duplicate-confirm'))
    expect(props.onConfirm).toHaveBeenCalledWith(expect.objectContaining({ placedItemIds: ['p1', 'p2'] }))
  })

  it('copies the Plan Image only when asked', () => {
    const props = open()
    fireEvent.click(screen.getByTestId('duplicate-include-plan-image'))
    fireEvent.click(screen.getByTestId('duplicate-confirm'))
    expect(props.onConfirm).toHaveBeenCalledWith(expect.objectContaining({ includePlanImage: true }))
  })
})

describe('name and position', () => {
  it('offers the positions the new Floor can actually take', () => {
    const props = open()
    const select = screen.getByTestId('duplicate-position')
    expect(select).toHaveValue('1')
    expect(select).toHaveTextContent('At the top')
    expect(select).toHaveTextContent('Between Kitchen level and Loft')
    expect(select).toHaveTextContent('At the end')
    fireEvent.change(select, { target: { value: '0' } })
    fireEvent.click(screen.getByTestId('duplicate-confirm'))
    expect(props.onConfirm).toHaveBeenCalledWith(expect.objectContaining({ toIndex: 0 }))
  })

  it('refuses a name another Floor has, and an empty one', () => {
    open()
    fireEvent.change(screen.getByTestId('duplicate-name'), { target: { value: 'Loft' } })
    expect(screen.getByTestId('duplicate-name-error')).toHaveTextContent('Another Floor is already called Loft')
    expect(screen.getByTestId('duplicate-confirm')).toBeDisabled()
    fireEvent.change(screen.getByTestId('duplicate-name'), { target: { value: '   ' } })
    expect(screen.getByTestId('duplicate-name-error')).toHaveTextContent('Give this Floor a name')
    expect(screen.getByTestId('duplicate-confirm')).toBeDisabled()
  })

  it('cancels without duplicating', () => {
    const props = open()
    fireEvent.click(screen.getByTestId('duplicate-cancel'))
    expect(props.onClose).toHaveBeenCalled()
    expect(props.onConfirm).not.toHaveBeenCalled()
  })
})
