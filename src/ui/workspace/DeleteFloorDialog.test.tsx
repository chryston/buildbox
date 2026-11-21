/**
 * The Delete Floor dialog (#56 criterion 10).
 *
 * The rule is the whole screen: a Floor with something on it cannot be deleted, and the
 * person has to be told what is on it in a form they can act on. So the counts come from the
 * one summary the app has (`summarizeFloorDependencies`), the `Show` button is what turns the
 * message into a way out, and `Delete Floor` is disabled by the same numbers the list shows —
 * never by a second opinion of its own.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Floor, Project } from '../../domain'
import { summarizeFloorDependencies } from '../../domain'
import { DeleteFloorDialog, deleteFloorIsBlocked } from './DeleteFloorDialog'

const kitchen: Floor = { id: 'floor-1', name: 'Kitchen level', planImage: {
  assetHash: 'a'.repeat(64), mediaType: 'image/png', widthPx: 10, heightPx: 10, pixelsPerMm: null,
} }
const loft: Floor = { id: 'floor-2', name: 'Loft', planImage: null }

const project = (over: Partial<Project> = {}): Project => ({
  id: 'project-1',
  meta: { name: 'Home' },
  preferences: { displayUnit: 'mm', displayPrecision: 0, defaultWallHeight: 2600 },
  floors: [kitchen, loft],
  views: [
    { id: 'view-1', kind: 'plan', floorId: 'floor-1', name: 'Kitchen level', isDefault: true, showPlanImage: true },
    { id: 'view-2', kind: 'plan', floorId: 'floor-1', name: 'Furniture', isDefault: false, showPlanImage: true },
    { id: 'view-3', kind: 'plan', floorId: 'floor-2', name: 'Loft', isDefault: true, showPlanImage: true },
  ],
  itemDesigns: [],
  existingModel: {
    walls: [],
    wallJunctions: [],
    openings: [],
    placedItems: [
      { id: 'p1', itemDesignId: 'd1', floorId: 'floor-1', translation: { x: 0, y: 0 }, rotationDeg: 0, baseElevation: 0 },
      { id: 'p2', itemDesignId: 'd1', floorId: 'floor-1', translation: { x: 0, y: 0 }, rotationDeg: 0, baseElevation: 0 },
      { id: 'p3', itemDesignId: 'd2', floorId: 'floor-2', translation: { x: 0, y: 0 }, rotationDeg: 0, baseElevation: 0 },
    ],
  },
  ...over,
})

const open = (target: Project, floor: Floor) => {
  const props = {
    floor,
    rows: summarizeFloorDependencies(target, floor.id),
    onShow: vi.fn(),
    onDelete: vi.fn(),
    onClose: vi.fn(),
  }
  render(<DeleteFloorDialog {...props} />)
  return props
}

describe('what is leaning on the Floor', () => {
  it('counts 2 Placed Items, 1 Plan Image and 1 named Plan View, and blocks the delete', () => {
    open(project(), kitchen)
    expect(screen.getByTestId('dependency-placedItems')).toHaveTextContent('2 Placed Items')
    expect(screen.getByTestId('dependency-planImage')).toHaveTextContent('1 Plan Image')
    expect(screen.getByTestId('dependency-planViews')).toHaveTextContent('1 named Plan View')
    expect(screen.getByTestId('delete-floor-confirm')).toBeDisabled()
    expect(deleteFloorIsBlocked(summarizeFloorDependencies(project(), 'floor-1'))).toBe(true)
  })

  it('offers `Show` for each thing that is there', () => {
    const props = open(project(), kitchen)
    fireEvent.click(screen.getByTestId('dependency-show-placedItems'))
    expect(props.onShow).toHaveBeenCalledWith('placedItems')
  })

  it('says so and lets the delete through once the Floor is empty', () => {
    const empty: Project = {
      ...project(),
      floors: [loft],
      views: [{ id: 'view-3', kind: 'plan', floorId: 'floor-2', name: 'Loft', isDefault: true, showPlanImage: true }],
      existingModel: { placedItems: [], walls: [], wallJunctions: [], openings: [] },
    }
    const props = open(empty, loft)
    expect(screen.getByTestId('dependency-placedItems')).toHaveTextContent('0 Placed Items')
    expect(screen.getByTestId('dependency-show-placedItems')).toBeDisabled()
    expect(deleteFloorIsBlocked(summarizeFloorDependencies(empty, 'floor-2'))).toBe(false)
    fireEvent.click(screen.getByTestId('delete-floor-confirm'))
    expect(props.onDelete).toHaveBeenCalled()
  })

  it('cancels without a word', () => {
    const props = open(project(), kitchen)
    fireEvent.click(screen.getByTestId('delete-floor-cancel'))
    expect(props.onClose).toHaveBeenCalled()
    expect(props.onDelete).not.toHaveBeenCalled()
  })
})
