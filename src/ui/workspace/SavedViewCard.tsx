/**
 * The saved-view card (#55 criterion 6): the view picker at the top of the rail and the
 * `Fit` control. Until #56 gives a Floor more than its default Plan view, the picker
 * holds exactly one entry — the Floor's name — and exists so the switcher #56 adds is a
 * longer list rather than a new control.
 */
import type { ReactNode } from 'react'

export interface SavedViewCardProps {
  /** The Floor whose default Plan view is showing; `null` while a Project has none. */
  floorName: string | null
  onFit: () => void
}

export function SavedViewCard(props: SavedViewCardProps): ReactNode {
  const { floorName, onFit } = props
  return (
    <>
      <label className="bb-workspace-field-label" htmlFor="view-picker">View</label>
      <select
        id="view-picker"
        data-testid="view-picker"
        className="bb-workspace-select"
        value="plan"
        onChange={() => undefined}
      >
        <option value="plan">{floorName === null ? 'Plan' : `${floorName} — Plan`}</option>
      </select>
      <div style={{ marginTop: 8 }}>
        <button
          type="button"
          data-testid="fit-view"
          className="bb-workspace-tool-button"
          onClick={onFit}
        >
          Fit
        </button>
      </div>
    </>
  )
}
