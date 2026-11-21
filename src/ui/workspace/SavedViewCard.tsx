/**
 * The saved-view card (#55 criterion 6, #56 criteria 1, 5, 7, 13): the top block of the
 * rail, where the person says which Floor and which Plan View they are looking at.
 *
 * The Floor select lists Floors in the Project's manual order; the view picker lists that
 * Floor's Plan Views with its own default first and the named ones after it, then
 * `+ Plan View`. Below them is what the view is made of: the Plan Image's scale readout —
 * the one place the Plan View states whether its millimetres mean anything — the per-view
 * `Show Plan Image` checkbox (#19 §4 says the drawing follows the saved view's visibility),
 * and `Fit`.
 *
 * Nothing here is Project data except what an Intent writes: switching is view state, and
 * the card only reports it.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { DisplayUnit, Floor, PlanImage, PlanView, Project } from '../../domain'
import { planViewNameTaken } from '../../domain'
import { STRINGS } from '../strings'
import { formatMm } from './displayUnits'
import { CALIBRATION_REQUIRED_HINT, floorNeedsCalibration } from './toolbarRegistry'

export interface SavedViewCardProps {
  project: Project
  floor: Floor | null
  views: readonly PlanView[]
  view: PlanView | null
  /** The Floor's Plan Image, whether or not this view draws it. */
  planImage: PlanImage | null
  unit: DisplayUnit
  precision: number
  onFloor(floorId: string): void
  onView(viewId: string): void
  onAddPlanView(name: string): void
  onManageFloors(): void
  onShowPlanImage(showPlanImage: boolean): void
  onCalibrate(): void
  onFit(): void
}

/**
 * The scale readout. `1 px = 12.50 mm` at 0.08 px per mm, in the Project's display unit and
 * never fewer than two decimals — a scale is a fine measure, and `1 px = 12 mm` would be a
 * different number from the one calibration produced.
 */
export function planImageScaleText(
  planImage: PlanImage | null,
  unit: DisplayUnit,
  precision: number,
): string {
  if (planImage === null) return ''
  if (planImage.pixelsPerMm === null) return STRINGS.planImageUncalibrated
  return STRINGS.planImageScale(formatMm(1 / planImage.pixelsPerMm, unit, Math.max(2, precision)), unit)
}

/** The words for a Plan View name this Floor cannot hold. */
export function planViewNameProblem(project: Project, floorId: string, name: string): string | null {
  const trimmed = name.trim()
  if (trimmed === '') return STRINGS.planViewNameRequired
  if (planViewNameTaken(project, floorId, trimmed)) {
    return STRINGS.planViewNameTaken(trimmed)
  }
  return null
}

export function SavedViewCard(props: SavedViewCardProps): ReactNode {
  const {
    project, floor, views, view, planImage, unit, precision,
    onFloor, onView, onAddPlanView, onManageFloors, onShowPlanImage, onCalibrate, onFit,
  } = props
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)

  const suggest = (): string => {
    const base = floor === null ? STRINGS.planView : floor.name
    let name = `${base} 2`
    let n = 2
    while (planViewNameTaken(project, floor?.id ?? '', name)) {
      n += 1
      name = `${base} ${String(n)}`
    }
    return name
  }

  const commitAdd = (): void => {
    if (floor === null) return
    const problem = planViewNameProblem(project, floor.id, newName)
    if (problem !== null) {
      setNameError(problem)
      return
    }
    setNameError(null)
    setAdding(false)
    setNewName('')
    onAddPlanView(newName.trim())
  }

  const scaleText = planImageScaleText(planImage, unit, precision)
  const uncalibrated = floorNeedsCalibration(planImage)

  return (
    <>
      <label className="bb-workspace-field-label" htmlFor="floor-select">{STRINGS.floor}</label>
      <select
        id="floor-select"
        data-testid="floor-select"
        className="bb-workspace-select"
        value={floor?.id ?? ''}
        onChange={(event) => onFloor(event.target.value)}
      >
        {project.floors.map((each) => (
          <option key={each.id} value={each.id}>{each.name}</option>
        ))}
      </select>
      <label className="bb-workspace-field-label" htmlFor="view-picker">{STRINGS.planView}</label>
      <select
        id="view-picker"
        data-testid="view-picker"
        className="bb-workspace-select"
        value={view?.id ?? ''}
        onChange={(event) => onView(event.target.value)}
      >
        {views.map((each) => (
          <option key={each.id} value={each.id}>{each.isDefault ? `${each.name} (default)` : each.name}</option>
        ))}
      </select>
      <div className="bb-workspace-view-actions">
        <button
          type="button"
          data-testid="add-plan-view"
          className="bb-workspace-tool-button"
          disabled={floor === null}
          onClick={() => {
            setAdding(true)
            setNewName(suggest())
          }}
        >
          + Plan View
        </button>
        <button
          type="button"
          data-testid="manage-floors"
          className="bb-workspace-tool-button"
          onClick={onManageFloors}
        >
          {STRINGS.manageFloorsEllipsis}
        </button>
      </div>
      {adding && (
        <div className="bb-workspace-add-view" data-testid="add-view-form">
          <label className="bb-workspace-field-label" htmlFor="add-view-name">{STRINGS.planViewNameField}</label>
          <input
            id="add-view-name"
            className="bb-workspace-input"
            data-testid="add-view-name"
            type="text"
            value={newName}
            autoFocus
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitAdd()
            }}
          />
          <div className="bb-workspace-view-actions">
            <button
              type="button"
              data-testid="add-view-confirm"
              className="bb-workspace-primary-button"
              onClick={commitAdd}
            >
              {STRINGS.addPlanView}
            </button>
            <button
              type="button"
              data-testid="add-view-cancel"
              className="bb-workspace-secondary-button"
              onClick={() => {
                setAdding(false)
                setNameError(null)
              }}
            >
              {STRINGS.cancel}
            </button>
          </div>
          {nameError !== null && (
            <p className="bb-workspace-field-error" data-testid="add-view-error" role="alert">{nameError}</p>
          )}
        </div>
      )}
      {planImage !== null && (
        <p className="bb-workspace-scale-readout" data-testid="plan-image-scale">{scaleText}</p>
      )}
      {view !== null && (
        <label className="bb-workspace-check" data-testid="show-plan-image-row">
          <input
            type="checkbox"
            data-testid="show-plan-image"
            checked={view.showPlanImage}
            disabled={planImage === null}
            onChange={(event) => onShowPlanImage(event.target.checked)}
          />
          {STRINGS.showPlanImage}
        </label>
      )}
      {planImage !== null && (
        <div className="bb-workspace-view-actions">
          <button
            type="button"
            data-testid="calibrate-action"
            className="bb-workspace-tool-button"
            title={uncalibrated ? CALIBRATION_REQUIRED_HINT : undefined}
            onClick={onCalibrate}
          >
            {STRINGS.calibrateEllipsis}
          </button>
        </div>
      )}
      <div className="bb-workspace-view-actions">
        <button
          type="button"
          data-testid="fit-view"
          className="bb-workspace-tool-button"
          onClick={onFit}
        >
          {STRINGS.fit}
        </button>
      </div>
    </>
  )
}
