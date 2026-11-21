/**
 * The view card as the Floor switcher (#56 criteria 1, 5, 7, 13).
 *
 * Two things are worth pinning here. The scale readout is the only place the Plan View says
 * whether its millimetres mean anything, so its exact words — `Plan Image scale: 1 px =
 * 12.50 mm`, `Plan Image not calibrated` — are the acceptance text, in the display unit and
 * never rounded away. And `Show Plan Image` belongs to the Plan View rather than the Floor
 * (#19 §4: the drawing follows the saved view's visibility), which is why switching views
 * can change whether the picture is drawn without touching the Floor at all.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Floor, PlanImage, PlanView, Project } from '../../domain'
import { SavedViewCard, planImageScaleText, planViewNameProblem } from './SavedViewCard'
import type { SavedViewCardProps } from './SavedViewCard'

const image = (pixelsPerMm: number | null): PlanImage => ({
  assetHash: 'a'.repeat(64), mediaType: 'image/png', widthPx: 1000, heightPx: 800, pixelsPerMm,
})

const kitchen: Floor = { id: 'floor-1', name: 'Kitchen level', planImage: image(null) }
const loft: Floor = { id: 'floor-2', name: 'Loft', planImage: null }
const defaultView: PlanView = {
  id: 'view-1', kind: 'plan', floorId: 'floor-1', name: 'Kitchen level', isDefault: true, showPlanImage: true,
}
const furnitureView: PlanView = {
  id: 'view-2', kind: 'plan', floorId: 'floor-1', name: 'Furniture', isDefault: false, showPlanImage: false,
}

const project = (over: Partial<Project> = {}): Project => ({
  id: 'project-1',
  meta: { name: 'Home' },
  preferences: { displayUnit: 'mm', displayPrecision: 1, defaultWallHeight: 2600 },
  floors: [kitchen, loft],
  views: [defaultView, furnitureView],
  itemDesigns: [],
  existingModel: { placedItems: [], walls: [], wallJunctions: [], openings: [], rooms: [] },
  warningAcknowledgements: [],
  ...over,
})

const open = (over: Partial<SavedViewCardProps> = {}) => {
  const p = project()
  const props = {
    project: p,
    floor: kitchen,
    views: [defaultView, furnitureView],
    view: defaultView,
    planImage: kitchen.planImage,
    unit: p.preferences.displayUnit,
    precision: p.preferences.displayPrecision,
    onFloor: vi.fn(),
    onView: vi.fn(),
    onAddPlanView: vi.fn(),
    onManageFloors: vi.fn(),
    onShowPlanImage: vi.fn(),
    onCalibrate: vi.fn(),
    onFit: vi.fn(),
    ...over,
  }
  render(<SavedViewCard {...props} />)
  return props
}

describe('the scale readout', () => {
  it('is the calibrated scale in the display unit, at two decimals', () => {
    expect(planImageScaleText(image(1 / 12.5), 'mm', 0)).toBe('Plan Image scale: 1 px = 12.50 mm')
    expect(planImageScaleText(image(1 / 12.5), 'cm', 1)).toBe('Plan Image scale: 1 px = 1.25 cm')
  })

  it('says the Plan Image is not calibrated rather than inventing a scale', () => {
    expect(planImageScaleText(image(null), 'mm', 0)).toBe('Plan Image not calibrated')
  })

  it('is shown in the card', () => {
    open()
    expect(screen.getByTestId('plan-image-scale')).toHaveTextContent('Plan Image not calibrated')
  })
})

describe('the Floor and Plan View pickers', () => {
  it('lists the Floors in the Project\'s manual order', () => {
    const props = open()
    const select = screen.getByTestId('floor-select')
    expect(select).toHaveValue('floor-1')
    expect(within(select).getAllByRole('option').map((option) => option.textContent))
      .toEqual(['Kitchen level', 'Loft'])
    fireEvent.change(select, { target: { value: 'floor-2' } })
    expect(props.onFloor).toHaveBeenCalledWith('floor-2')
  })

  it('marks the Floor\'s own default Plan View as the default', () => {
    const props = open()
    const picker = screen.getByTestId('view-picker')
    expect(picker).toHaveValue('view-1')
    expect(picker).toHaveTextContent('Kitchen level (default)')
    expect(picker).toHaveTextContent('Furniture')
    fireEvent.change(picker, { target: { value: 'view-2' } })
    expect(props.onView).toHaveBeenCalledWith('view-2')
  })

  it('names a taken Plan View name on this Floor a problem', () => {
    expect(planViewNameProblem(project(), 'floor-1', 'Furniture'))
      .toBe('Another Plan View on this Floor is already called Furniture')
    expect(planViewNameProblem(project(), 'floor-1', 'Electrics')).toBeNull()
    expect(planViewNameProblem(project(), 'floor-1', ' ')).toBe('Give this Plan View a name')
    // The same name on a different Floor is a different Plan View.
    expect(planViewNameProblem(project(), 'floor-2', 'Furniture')).toBeNull()
  })

  it('adds a Plan View on the current Floor', () => {
    const props = open()
    fireEvent.click(screen.getByTestId('add-plan-view'))
    expect(screen.getByTestId('add-view-name')).toHaveValue('Kitchen level 2')
    fireEvent.change(screen.getByTestId('add-view-name'), { target: { value: 'Furniture' } })
    fireEvent.click(screen.getByTestId('add-view-confirm'))
    expect(screen.getByTestId('add-view-error')).toHaveTextContent(
      'Another Plan View on this Floor is already called Furniture',
    )
    expect(props.onAddPlanView).not.toHaveBeenCalled()
    fireEvent.change(screen.getByTestId('add-view-name'), { target: { value: 'Electrics' } })
    fireEvent.click(screen.getByTestId('add-view-confirm'))
    expect(props.onAddPlanView).toHaveBeenCalledWith('Electrics')
  })
})

describe('the Plan Image controls', () => {
  it('follows this Plan View\'s own visibility', () => {
    const props = open({ view: furnitureView })
    expect(screen.getByTestId('show-plan-image')).not.toBeChecked()
    fireEvent.click(screen.getByTestId('show-plan-image'))
    expect(props.onShowPlanImage).toHaveBeenCalledWith(true)
  })

  it('explains why the measured tools are inert while the Floor is uncalibrated', () => {
    open()
    expect(screen.getByTestId('calibrate-action')).toHaveAttribute(
      'title',
      "Calibrate this Floor's Plan Image to draw measured shapes",
    )
  })

  it('stops explaining once the Floor is calibrated', () => {
    const calibrated: Floor = { ...kitchen, planImage: image(0.08) }
    open({ floor: calibrated, planImage: calibrated.planImage })
    expect(screen.getByTestId('calibrate-action')).not.toHaveAttribute('title')
    expect(screen.getByTestId('plan-image-scale')).toHaveTextContent('Plan Image scale: 1 px = 12.50 mm')
  })

  it('opens Manage Floors', () => {
    const props = open()
    fireEvent.click(screen.getByTestId('manage-floors'))
    expect(props.onManageFloors).toHaveBeenCalled()
  })
})
