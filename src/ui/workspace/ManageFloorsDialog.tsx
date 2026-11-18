/**
 * The `Manage Floors…` dialog (#56): the whole Floor list in one place — order, name,
 * coordination limits, duplicate and delete.
 *
 * Every control dispatches one Intent as it is used; there is no dialog-wide Save, because
 * a Project is never half-applied and the person can undo each step. The rename field
 * refuses before dispatching rather than letting a handler reject: the two rules the
 * validator enforces (a name is not empty once trimmed, and no other Floor has it ignoring
 * case) are read here through the same `domain` helpers, so the words appear inline next to
 * the field that caused them.
 *
 * Rows drag as well as stepping ↑/↓. Both end in the same `floor.reorder`, which moves one
 * array entry and no geometry — the thing criterion 2 measures byte for byte.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { DisplayUnit, Floor, Project } from '../../domain'
import { floorNameTaken } from '../../domain'
import { formatMm, parseToMm } from './displayUnits'

export interface ManageFloorsDialogProps {
  project: Project
  activeFloorId: string | null
  unit: DisplayUnit
  precision: number
  onRename(floorId: string, name: string): void
  onReorder(floorId: string, toIndex: number): void
  onSetLimits(floorId: string, lowerMm: number | null, upperMm: number | null): void
  onAddFloor(): void
  onDuplicate(floorId: string): void
  onDelete(floorId: string): void
  onClose(): void
}

/** The plain words for a name the Project cannot hold. */
export function floorNameProblem(project: Project, floorId: string, name: string): string | null {
  const trimmed = name.trim()
  if (trimmed === '') return 'Give this Floor a name'
  if (floorNameTaken(project, trimmed, floorId)) return `Another Floor is already called ${trimmed}`
  return null
}

export function ManageFloorsDialog(props: ManageFloorsDialogProps): ReactNode {
  const { project, activeFloorId, onReorder, onAddFloor, onClose } = props
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const floors = project.floors

  return (
    <div className="bb-workspace-dialog-backdrop" data-testid="manage-floors-dialog">
      <div role="dialog" aria-modal="true" aria-label="Manage Floors" className="bb-workspace-dialog">
        <h2>Manage Floors</h2>
        <ul className="bb-workspace-floor-list">
          {floors.map((floor, index) => (
            <li
              key={floor.id}
              className="bb-workspace-floor-row"
              data-testid={`floor-row-${floor.id}`}
              data-active={floor.id === activeFloorId ? 'true' : 'false'}
              draggable
              onDragStart={() => setDraggedId(floor.id)}
              onDragEnd={() => setDraggedId(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                if (draggedId !== null && draggedId !== floor.id) onReorder(draggedId, index)
                setDraggedId(null)
              }}
            >
              <FloorRow
                {...props}
                floor={floor}
                index={index}
                count={floors.length}
              />
            </li>
          ))}
        </ul>
        <div className="bb-workspace-dialog-actions">
          <button
            type="button"
            data-testid="add-floor"
            className="bb-workspace-primary-button"
            onClick={onAddFloor}
          >
            + Add Floor
          </button>
          <button
            type="button"
            data-testid="manage-floors-close"
            className="bb-workspace-secondary-button"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function FloorRow(props: ManageFloorsDialogProps & {
  floor: Floor
  index: number
  count: number
}): ReactNode {
  const { floor, index, count, project, unit, precision, onRename, onReorder, onSetLimits, onDuplicate, onDelete } = props
  const [name, setName] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const limits = floor.limits ?? {}
  const shown = (mm: number | undefined): string => (mm === undefined ? '' : formatMm(mm, unit, precision))
  const [lowerText, setLowerText] = useState<string | null>(null)
  const [upperText, setUpperText] = useState<string | null>(null)
  const [limitsError, setLimitsError] = useState<string | null>(null)

  const commitName = (): void => {
    if (name === null) return
    const problem = floorNameProblem(project, floor.id, name)
    if (problem !== null) {
      setNameError(problem)
      return
    }
    setNameError(null)
    onRename(floor.id, name.trim())
    setName(null)
  }

  /** A blank field is no limit; a typed one is read back through the display unit. */
  const readLimit = (text: string): number | null => {
    const trimmed = text.trim()
    if (trimmed === '') return null
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parseToMm(parsed, unit) : null
  }

  const commitLimits = (): void => {
    const lower = readLimit(lowerText ?? shown(limits.lowerMm))
    const upper = readLimit(upperText ?? shown(limits.upperMm))
    if (lower !== null && upper !== null && lower >= upper) {
      setLimitsError('The lower limit must be below the upper limit')
      return
    }
    setLimitsError(null)
    onSetLimits(floor.id, lower, upper)
  }

  return (
    <>
      <span className="bb-workspace-floor-drag" data-testid={`floor-drag-${floor.id}`} aria-hidden="true">⠿</span>
      <input
        className="bb-workspace-input"
        data-testid={`floor-name-${floor.id}`}
        aria-label="Floor name"
        type="text"
        value={name ?? floor.name}
        onChange={(event) => setName(event.target.value)}
        onBlur={commitName}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commitName()
        }}
      />
      <span className="bb-workspace-spacer" />
      <button
        type="button"
        data-testid={`floor-up-${floor.id}`}
        aria-label="Move up"
        className="bb-workspace-tool-button"
        disabled={index === 0}
        onClick={() => onReorder(floor.id, index - 1)}
      >
        ↑
      </button>
      <button
        type="button"
        data-testid={`floor-down-${floor.id}`}
        aria-label="Move down"
        className="bb-workspace-tool-button"
        disabled={index === count - 1}
        onClick={() => onReorder(floor.id, index + 1)}
      >
        ↓
      </button>
      <button
        type="button"
        data-testid={`floor-settings-${floor.id}`}
        aria-expanded={settingsOpen ? 'true' : 'false'}
        className="bb-workspace-tool-button"
        onClick={() => setSettingsOpen(!settingsOpen)}
      >
        Floor settings
      </button>
      <button
        type="button"
        data-testid={`floor-duplicate-${floor.id}`}
        className="bb-workspace-tool-button"
        onClick={() => onDuplicate(floor.id)}
      >
        Duplicate…
      </button>
      <button
        type="button"
        data-testid={`floor-delete-${floor.id}`}
        className="bb-workspace-danger-button"
        onClick={() => onDelete(floor.id)}
      >
        Delete…
      </button>
      {nameError !== null && (
        <p className="bb-workspace-field-error" data-testid={`floor-name-error-${floor.id}`} role="alert">
          {nameError}
        </p>
      )}
      {settingsOpen && (
        <div className="bb-workspace-floor-limits" data-testid={`floor-limits-${floor.id}`}>
          <label className="bb-workspace-field-label" htmlFor={`floor-lower-${floor.id}`}>
            Lower limit <span className="bb-workspace-unit-suffix">({unit})</span>
          </label>
          <input
            id={`floor-lower-${floor.id}`}
            className="bb-workspace-input"
            data-testid={`floor-lower-${floor.id}`}
            type="number"
            step="any"
            placeholder="none"
            value={lowerText ?? shown(limits.lowerMm)}
            onChange={(event) => setLowerText(event.target.value)}
          />
          <label className="bb-workspace-field-label" htmlFor={`floor-upper-${floor.id}`}>
            Upper limit <span className="bb-workspace-unit-suffix">({unit})</span>
          </label>
          <input
            id={`floor-upper-${floor.id}`}
            className="bb-workspace-input"
            data-testid={`floor-upper-${floor.id}`}
            type="number"
            step="any"
            placeholder="none"
            value={upperText ?? shown(limits.upperMm)}
            onChange={(event) => setUpperText(event.target.value)}
          />
          <button
            type="button"
            data-testid={`floor-limits-save-${floor.id}`}
            className="bb-workspace-secondary-button"
            onClick={commitLimits}
          >
            Save limits
          </button>
          {limitsError !== null && (
            <p className="bb-workspace-field-error" data-testid={`floor-limits-error-${floor.id}`} role="alert">
              {limitsError}
            </p>
          )}
        </div>
      )}
    </>
  )
}
