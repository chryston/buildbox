/**
 * The shared-height preview panel (#76 §1, behaviour 17, D9).
 *
 * It opens inside the inspector — no backdrop, not full-screen — because its whole job is to be
 * read *while the canvases stay visible*: every placement it names can be seen changing behind
 * it, dashed, in the open panes. Nothing is written until `Apply to N Placed Items`; `Cancel —
 * change nothing` and Esc both commit nothing, and the dashed outlines vanish with the panel.
 *
 * The table is the promise. One row per Placed Item of this Item Design, on every Floor, in the
 * Existing Model and in every Design Option, each saying what the new height does to that
 * placement's warnings — `+ new`, `− cleared`, both, or nothing. The answer comes from
 * `sharedDesignRows`: the same Intent the Apply button will send, run through the session's
 * `evaluate` against a copy that is thrown away.
 */
import { useMemo, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import type { Intent } from '../../edit'
import type { DisplayUnit, ItemDesign, Project } from '../../domain'
import { designHeight } from '../../domain'
import { STRINGS } from '../strings'
import { formatMm, parseToMm } from './displayUnits'
import { sharedDesignRows } from './sharedDesign'
import type { SharedDesignRow } from './sharedDesign'

export interface SharedDesignPanelProps {
  design: ItemDesign
  project: Project
  /** The session's current revision, for the derive the table reads. */
  revision: number
  unit: DisplayUnit
  precision: number
  /** The one Intent this panel would commit, built but not sent. */
  buildIntent: (heightMm: number) => Intent
  evaluate: (project: Project, intent: Intent) => Project | null
  onApply: (heightMm: number) => void
  onCancel: () => void
  /** `Fork design…` — the only route to a different height for one placement (#57). */
  onFork: () => void
}

/** `+ new`, `− cleared`, both, or the empty cell the issue asks for. */
const changeCell = (row: SharedDesignRow): string => {
  const parts: string[] = []
  if (row.added) parts.push(STRINGS.warningChangeNew)
  if (row.cleared) parts.push(STRINGS.warningChangeCleared)
  return parts.join(' ')
}

export function SharedDesignPanel(props: SharedDesignPanelProps): ReactNode {
  const { design, project, unit, precision, buildIntent, evaluate, onApply, onCancel, onFork } = props
  const current = designHeight(design)
  const [text, setText] = useState<string | null>(null)
  const shown = text ?? formatMm(current, unit, precision)
  const parsed = text === null ? null : Number(text)
  const heightMm = parsed !== null && Number.isFinite(parsed) ? parseToMm(parsed, unit) : null
  const invalid = text !== null && !(heightMm !== null && heightMm > 0)
  const rows = useMemo(
    () => (heightMm === null || !(heightMm > 0)
      ? null
      : sharedDesignRows(project, props.revision, design.id, heightMm, buildIntent(heightMm), evaluate)),
    [project, props.revision, design.id, heightMm, buildIntent, evaluate],
  )
  const canApply = heightMm !== null && heightMm > 0 && rows !== null

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onCancel()
    }
  }

  return (
    <section
      className="bb-workspace-card bb-shared-design-panel"
      data-testid="shared-design-panel"
      onKeyDown={onKeyDown}
    >
      <h3 className="bb-workspace-card-title" data-testid="shared-design-title">
        {STRINGS.editSharedDesignTitle(design.name)}
      </h3>
      <label className="bb-workspace-field-label" htmlFor="shared-design-height">
        {STRINGS.designHeightField} <span className="bb-workspace-unit-suffix">({unit})</span>
      </label>
      <input
        id="shared-design-height"
        data-testid="shared-design-height"
        className="bb-workspace-input"
        type="number"
        step="any"
        aria-invalid={invalid ? 'true' : undefined}
        value={shown}
        onChange={(event) => setText(event.target.value)}
      />
      {invalid && (
        <p className="bb-workspace-field-error" data-testid="shared-design-height-error" role="alert">
          {STRINGS.extentHeightNeedsPositive}
        </p>
      )}
      <table className="bb-shared-design-table" data-testid="shared-design-table">
        <thead>
          <tr>
            <th>{STRINGS.placedItem}</th>
            <th>{STRINGS.floor}</th>
            <th>{STRINGS.designOptionColumn}</th>
            <th>{STRINGS.extentBase}</th>
            <th>{STRINGS.currentTop}</th>
            <th>{STRINGS.newTop}</th>
            <th>{STRINGS.warningChange}</th>
          </tr>
        </thead>
        <tbody>
          {(rows ?? []).map((row) => (
            <tr key={`${row.optionId ?? 'e'}|${row.placementId}`} data-testid={`shared-design-row-${row.placementId}`}>
              <td>{row.label}</td>
              <td>{row.floorName}</td>
              <td>{row.optionId === null ? STRINGS.existingModel : row.optionName}</td>
              <td>{formatMm(row.baseMm, unit, precision)}</td>
              <td>{formatMm(row.currentTopMm, unit, precision)}</td>
              <td>{formatMm(row.newTopMm, unit, precision)}</td>
              <td data-testid={`shared-design-change-${row.placementId}`}>{changeCell(row)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="bb-workspace-dialog-note" data-testid="shared-design-fork-line">
        {STRINGS.forkOnePlacement}{' '}
        <button
          type="button"
          data-testid="shared-design-fork"
          className="bb-workspace-tool-button"
          onClick={onFork}
        >
          {STRINGS.forkDesign}
        </button>
      </p>
      <div className="bb-workspace-button-row">
        <button
          type="button"
          data-testid="shared-design-apply"
          className="bb-workspace-primary-button"
          disabled={!canApply}
          onClick={() => {
            if (heightMm !== null) onApply(heightMm)
          }}
        >
          {STRINGS.applyToPlacedItems(rows?.length ?? 0)}
        </button>
        <button
          type="button"
          data-testid="shared-design-cancel"
          className="bb-workspace-secondary-button"
          onClick={onCancel}
        >
          {STRINGS.cancelChangeNothing}
        </button>
      </div>
    </section>
  )
}
