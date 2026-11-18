/**
 * `Copy to Floor…` / `Move to Floor…` (#56 criterion 11).
 *
 * Floors are independent spatial silos with local X/Y and local Z = 0 at their own Floor
 * Datum (#25): there is no shared frame to translate through, and BuildBox invents none. So
 * the preview prefills the destination with the *same* local numbers and says so — the
 * person confirms the position rather than trusting an alignment that does not exist.
 * Confirming without edits therefore moves nothing but the Floor reference.
 *
 * Copy spends a new ID per Placed Item; Move keeps every ID and changes only `floorId`.
 * Either way it is one Edit Transaction, and the multi-select case keeps each item's offset
 * from the first one, which is the only relationship between them the dialog can state.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { DisplayUnit, EntityId, Floor } from '../../domain'
import { formatMm, parseToMm } from './displayUnits'

export interface TransferTarget {
  floorId: EntityId
  /** Floor-local millimetres: where the first selected Item Origin lands. */
  x: number
  y: number
  /** Millimetres above the destination Floor Datum. */
  baseElevation: number
}

export interface TransferToFloorDialogProps {
  floors: readonly Floor[]
  fromFloorName: string
  /** The Item Origin and elevation the preview starts from. */
  initial: { x: number; y: number; baseElevation: number }
  unit: DisplayUnit
  precision: number
  onCopy: (target: TransferTarget) => void
  onMove: (target: TransferTarget) => void
  onClose: () => void
}

export function TransferToFloorDialog(props: TransferToFloorDialogProps): ReactNode {
  const { floors, fromFloorName, initial, unit, precision, onCopy, onMove, onClose } = props
  const others = floors.filter((floor) => floor.name !== fromFloorName)
  const [floorId, setFloorId] = useState<string>(others[0]?.id ?? '')
  const [x, setX] = useState(formatMm(initial.x, unit, precision))
  const [y, setY] = useState(formatMm(initial.y, unit, precision))
  const [elevation, setElevation] = useState(formatMm(initial.baseElevation, unit, precision))

  const read = (text: string): number => {
    const parsed = Number(text)
    return Number.isFinite(parsed) ? parseToMm(parsed, unit) : 0
  }

  const target = (): TransferTarget => ({
    floorId,
    x: read(x),
    y: read(y),
    baseElevation: read(elevation),
  })

  return (
    <div className="bb-workspace-dialog-backdrop" data-testid="transfer-dialog">
      <div role="dialog" aria-modal="true" aria-label="Copy or Move to Floor" className="bb-workspace-dialog">
        <h2>Copy or Move to Floor</h2>
        <p className="bb-workspace-dialog-note" data-testid="transfer-note">
          Floors don&apos;t share coordinates; check the position on the destination Floor
        </p>
        <label className="bb-workspace-field-label" htmlFor="transfer-floor">Destination Floor</label>
        <select
          id="transfer-floor"
          className="bb-workspace-select"
          data-testid="transfer-floor"
          value={floorId}
          onChange={(event) => setFloorId(event.target.value)}
        >
          {others.map((floor) => (
            <option key={floor.id} value={floor.id}>{floor.name}</option>
          ))}
        </select>
        {([
          ['X', 'transfer-x', x, setX],
          ['Y', 'transfer-y', y, setY],
          ['Base elevation', 'transfer-elevation', elevation, setElevation],
        ] as const).map(([label, testId, value, set]) => (
          <span key={testId}>
            <label className="bb-workspace-field-label" htmlFor={testId}>
              {label} <span className="bb-workspace-unit-suffix">({unit})</span>
            </label>
            <input
              id={testId}
              className="bb-workspace-input"
              data-testid={testId}
              type="number"
              step="any"
              value={value}
              onChange={(event) => set(event.target.value)}
            />
          </span>
        ))}
        <div className="bb-workspace-dialog-actions">
          <button
            type="button"
            data-testid="transfer-copy"
            className="bb-workspace-primary-button"
            disabled={floorId === ''}
            onClick={() => onCopy(target())}
          >
            Copy to Floor
          </button>
          <button
            type="button"
            data-testid="transfer-move"
            className="bb-workspace-secondary-button"
            disabled={floorId === ''}
            onClick={() => onMove(target())}
          >
            Move to Floor
          </button>
          <button
            type="button"
            data-testid="transfer-cancel"
            className="bb-workspace-secondary-button"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
