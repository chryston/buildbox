/**
 * The Elevation View card (#75 §3).
 *
 * The second half of the rail's view-card slot, beside the Plan View card: one Elevation View open at
 * a time, exactly as one Plan View is open at a time, and the same rule about what a view is — a way
 * of looking, never model content. So the card writes through the same undoable Intent path the Plan
 * View card uses (`elevationView.edit`, one field at a time), and the one destructive item it offers
 * says what it removes and what it leaves alone before it offers anything.
 *
 * The fields themselves are `ElevationDefinitionSection`'s; this card owns only the two things that
 * are about the pane rather than the view: which view is open, and the item that opens the confirm.
 *
 * The picker lists the Floor's Elevation Views and nothing else. The Floor is never a choice here: an
 * Elevation View belongs to the Floor its card is open on, and changing that would move the view line
 * to a different set of coordinates.
 */
import type { ReactNode } from 'react'
import type { ElevationView, Floor } from '../../domain'
import type { DisplayUnit } from '../../domain'
import { STRINGS } from '../strings'
import { ElevationDefinitionSection } from './ElevationDefinitionSection'
import type { ElevationDefinition } from './ElevationDefinitionSection'

export interface ElevationViewCardProps {
  floor: Floor
  /** The Floor's Elevation Views, in the order the document lists them. */
  views: readonly ElevationView[]
  /** The open one, or `null` for the empty state. */
  view: ElevationView | null
  unit: DisplayUnit
  precision: number
  /** `Open Elevation View`: the pane shows this one and the rail follows it. */
  onOpen(viewId: string): void
  /** `elevationView.edit`, one field at a time. */
  onEdit(change: ElevationDefinition): void
  /** The `Delete Elevation View…` item; the confirm dialog is the caller's. */
  onDelete(): void
}

export function ElevationViewCard(props: ElevationViewCardProps): ReactNode {
  const { floor, views, view, unit, precision, onOpen, onEdit, onDelete } = props
  return (
    <section className="bb-view-card" data-testid="elevation-view-card" aria-label={STRINGS.elevationView}>
      <label className="bb-workspace-field-label" htmlFor="elevation-view-picker">
        {STRINGS.elevationView}
      </label>
      <select
        id="elevation-view-picker"
        data-testid="elevation-view-picker"
        className="bb-workspace-select"
        value={view?.id ?? ''}
        onChange={(event) => {
          if (event.target.value !== '') onOpen(event.target.value)
        }}
      >
        {views.length === 0 && <option value="">{STRINGS.noElevationViews}</option>}
        {views.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.name}
          </option>
        ))}
      </select>

      {view === null ? (
        <p className="bb-workspace-hint" data-testid="elevation-empty">
          {STRINGS.elevationNoneBody} {STRINGS.elevationNoneHint}
        </p>
      ) : (
        <>
          <ElevationDefinitionSection
            view={view}
            unit={unit}
            precision={precision}
            nameTaken={(name) => views.some((other) => other.id !== view.id && other.name === name)}
            onCommit={onEdit}
          />
          <button type="button" data-testid="elevation-delete" className="bb-workspace-button-danger" onClick={onDelete}>
            {STRINGS.deleteElevationViewEllipsis}
          </button>
        </>
      )}
      {/* The Floor the view line is drawn on, named because the coordinates below it belong to it. */}
      <p className="bb-workspace-hint" data-testid="elevation-floor-note">
        {STRINGS.floor}: {floor.name}
      </p>
    </section>
  )
}
