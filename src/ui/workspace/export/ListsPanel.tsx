/**
 * The `Export…` dialog's Lists tab (#62 §9, §10).
 *
 * Four controls, one sentence and a download. The controls are the scope; the sentence is that
 * scope in plain words, regenerated from the controls rather than from what the writer happened to
 * emit, so what a person reads is what the file will hold; the download is `export`'s bytes handed
 * to the browser by the port. Like the Drawing tab, this panel never dispatches an Intent and never
 * touches a saved view — the only thing that leaves it is a file, and reading it changed nothing.
 *
 * Two of the notices are the reason the tab is a dialog rather than a button. A table with no rows
 * is a legitimate answer that must not look like a failure, so it says `0 rows` beside the table
 * that says it; and a single CSV carries no provenance at all, which is worth one sentence before
 * the download rather than a surprised reader after it.
 */
import { useEffect, useState } from 'react'
import { SCOPE, defaultCutListStates } from '../../../export'
import type { ExportProgress, ListsRecipe, ListsSummary, RecipeViewRef } from '../../../export'
import type { QuantityScope, RenovationState } from '../../../derive'
import { STRINGS } from '../../strings'
import type { ExportPort, ExportRunOutcome, ListsOptions } from './port'
import { viewKey } from './port'
import type { ReactNode } from 'react'

/** Every Renovation State, in the order the Item List sorts by. */
const STATES: readonly RenovationState[] = ['existing', 'demolition', 'proposed']

/** The scope every control starts on: everything, Existing Model only, every layer. */
function fullScope(options: ListsOptions, origin: RecipeViewRef): QuantityScope {
  return {
    floorIds: options.floors.map((floor) => floor.id),
    designOptionIds: 'existing-only',
    renovationStates: [...STATES],
    drawingLayers: 'all',
    // An export started from an Item Detail View is that item's list: `item_count` 1, one design
    // (export contract §7). The Item List is grouped by design anyway, so it is unaffected.
    ...(origin.kind === 'item-detail' ? { itemDesignId: origin.itemDesignId } : {}),
  }
}

/**
 * A remembered scope, made safe for the Project it arrived in.
 *
 * A device preference outlives Floors: a recipe remembered last month can name a Floor that has
 * since been deleted, and a scope with a missing Floor in it would silently count one fewer Floor
 * than the sentence claims. Unknown IDs are dropped, and a scope left with nothing is widened back
 * to every Floor — the default rather than an empty file.
 */
function recalledScope(remembered: QuantityScope, options: ListsOptions): QuantityScope {
  const known = new Set(options.floors.map((floor) => floor.id))
  const floors = remembered.floorIds.filter((floorId) => known.has(floorId))
  return { ...remembered, floorIds: floors.length > 0 ? floors : [...known] }
}

export interface ListsPanelProps {
  origin: RecipeViewRef
  unsavedChanges: boolean
  port: ExportPort
  onClose(): void
}

export const ListsPanel = ({ origin, unsavedChanges, port, onClose }: ListsPanelProps): ReactNode => {
  const key = viewKey(origin)
  const options = port.listsOptions()
  const [recipe, setRecipe] = useState<ListsRecipe>({
    tables: ['items', 'cut-list'],
    scope: fullScope(options, origin),
  })
  const [summary, setSummary] = useState<ListsSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [outcome, setOutcome] = useState<ExportRunOutcome | null>(null)

  // The remembered recipe is a device preference, so it arrives after the first paint — and the
  // scope it carries is re-fitted to the Project on screen rather than trusted.
  useEffect(() => {
    let alive = true
    void port.recallLists(key).then((remembered) => {
      if (!alive || remembered === null) return
      setRecipe({
        tables: remembered.tables,
        scope: recalledScope(remembered.scope, port.listsOptions()),
      })
    })
    return () => {
      alive = false
    }
  }, [port, key])

  // The statement and the row counts are derived, so they are asked for rather than kept in step
  // by hand. The scope is keyed by its own text because every control replaces the object.
  const scopeKey = JSON.stringify(recipe.scope)
  useEffect(() => {
    let alive = true
    void port.summariseLists(recipe.scope).then((next) => {
      if (alive) setSummary(next)
    })
    return () => {
      alive = false
    }
  }, [port, scopeKey])

  const patch = (next: Partial<ListsRecipe>): void => {
    setOutcome(null)
    setRecipe((current) => ({ ...current, ...next }))
  }

  // The Renovation States follow the tables: the Item List counts everything on the Floor, while a
  // Cut List is the work about to be cut — `Proposed` with a Design Option in scope, `Existing`
  // without one (export contract §7). So the states are re-seeded from that table set's default
  // whenever the set changes, and the plain-words sentence shows the effect immediately. A person
  // who wants something else ticks the states afterwards; the defaults are what make the common
  // export need no thinking about.
  const toggleTable = (table: ListsRecipe['tables'][number]): void => {
    const held = recipe.tables.includes(table)
    const next = held ? recipe.tables.filter((each) => each !== table) : [...recipe.tables, table]
    const alone = next.length === 1 && next[0] === 'cut-list'
    patch({
      tables: next,
      scope: {
        ...recipe.scope,
        renovationStates: alone ? defaultCutListStates(recipe.scope) : [...STATES],
      },
    })
  }

  const toggleFloor = (floorId: string): void => {
    const held = recipe.scope.floorIds
    const floors = held.includes(floorId) ? held.filter((each) => each !== floorId) : [...held, floorId]
    patch({ scope: { ...recipe.scope, floorIds: floors } })
  }

  const toggleState = (state: RenovationState): void => {
    const held = recipe.scope.renovationStates
    const states = held.includes(state) ? held.filter((each) => each !== state) : [...held, state]
    patch({ scope: { ...recipe.scope, renovationStates: states } })
  }

  // A design with parts to cut is the only thing that makes a Cut List worth offering. The table
  // is absent rather than disabled, because a checkbox that can never be ticked is a question.
  const capable = summary?.cutListCapable ?? true
  const tables = capable ? recipe.tables : recipe.tables.filter((each) => each !== 'cut-list')
  const blocked = tables.length === 0 ? STRINGS.exportListsNeedTables : null
  const warnings = port.unacknowledgedWarnings()

  const run = (): void => {
    if (blocked !== null || busy) return
    setBusy(true)
    setOutcome(null)
    const chosen: ListsRecipe = { tables, scope: recipe.scope }
    port.rememberLists(key, chosen)
    void port.runLists(chosen, setProgress).then((result) => {
      setBusy(false)
      setProgress(null)
      setOutcome(result)
      if (result.kind === 'downloaded') onClose()
    })
  }

  return (
    <>
      <fieldset disabled={busy}>
        <legend>{STRINGS.exportListsGroupTables}</legend>
        <ul className="bb-export-views" data-testid="export-lists-tables">
          <li>
            <label>
              <input
                type="checkbox"
                data-testid="export-lists-table-items"
                checked={tables.includes('items')}
                onChange={() => {
                  toggleTable('items')
                }}
              />
              <span>{STRINGS.exportListItems}</span>
              {summary !== null && (
                <span
                  className={summary.rows.items === 0 ? 'helper bb-export-rows-empty' : 'helper'}
                  data-testid="export-lists-rows-items"
                >
                  {STRINGS.exportListsRows(summary.rows.items)}
                </span>
              )}
            </label>
          </li>
          {capable ? (
            <li>
              <label>
                <input
                  type="checkbox"
                  data-testid="export-lists-table-cut-list"
                  checked={tables.includes('cut-list')}
                  onChange={() => {
                    toggleTable('cut-list')
                  }}
                />
                <span>{STRINGS.exportListCutList}</span>
                {summary !== null && (
                  <span
                    className={summary.rows['cut-list'] === 0 ? 'helper bb-export-rows-empty' : 'helper'}
                    data-testid="export-lists-rows-cut-list"
                  >
                    {STRINGS.exportListsRows(summary.rows['cut-list'])}
                  </span>
                )}
              </label>
            </li>
          ) : (
            <li className="helper" data-testid="export-lists-no-cabinets">
              {STRINGS.exportListsNoCabinets}
            </li>
          )}
        </ul>
      </fieldset>

      <fieldset disabled={busy}>
        <legend>{STRINGS.exportListsGroupScope}</legend>
        <p className="bb-export-scope" data-testid="export-lists-statement">
          {summary?.statement ?? ''}
        </p>
        <div className="bb-export-floors" data-testid="export-lists-floors">
          <span className="helper">{STRINGS.exportListsFloors}</span>
          {options.floors.map((floor) => (
            <label key={floor.id}>
              <input
                type="checkbox"
                data-testid={`export-lists-floor-${floor.id}`}
                checked={recipe.scope.floorIds.includes(floor.id)}
                onChange={() => {
                  toggleFloor(floor.id)
                }}
              />
              <span>{floor.label}</span>
            </label>
          ))}
        </div>
        <label>
          <span>{STRINGS.exportListsDesignOption}</span>
          <select
            data-testid="export-lists-design-option"
            value={recipe.scope.designOptionIds === 'existing-only' ? 'existing-only' : recipe.scope.designOptionIds[0]}
            disabled={options.designOptions.length === 0}
            onChange={(event) => {
              const value = event.target.value
              patch({
                scope: {
                  ...recipe.scope,
                  designOptionIds: value === 'existing-only' ? 'existing-only' : [value],
                },
              })
            }}
          >
            <option value="existing-only">{STRINGS.exportListsExistingOnly}</option>
            {options.designOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="bb-export-states" data-testid="export-lists-states">
          <span className="helper">{STRINGS.exportListsStates}</span>
          {STATES.map((state) => (
            <label key={state}>
              <input
                type="checkbox"
                data-testid={`export-lists-state-${state}`}
                checked={recipe.scope.renovationStates.includes(state)}
                onChange={() => {
                  toggleState(state)
                }}
              />
              <span>{SCOPE.states[state]}</span>
            </label>
          ))}
        </div>
        <label>
          <input type="checkbox" data-testid="export-lists-layers" checked readOnly />
          <span>{STRINGS.exportListsAllLayers}</span>
        </label>
      </fieldset>

      <div className="bb-export-notices" data-testid="export-lists-notices">
        <p data-testid="export-lists-notice-warnings">{STRINGS.exportWarningCount(warnings)}</p>
        {unsavedChanges && <p data-testid="export-lists-notice-unsaved">{STRINGS.exportUnsavedNotice}</p>}
        {tables.length === 1 && <p data-testid="export-lists-notice-single">{STRINGS.exportListsSingleNotice}</p>}
        <p className="helper" data-testid="export-lists-backup-link">
          {STRINGS.exportBackupLink}
        </p>
      </div>

      {blocked !== null && (
        <p className="bb-export-blocked" data-testid="export-lists-blocked" role="alert">
          {blocked}
        </p>
      )}

      {outcome?.kind === 'failed' && (
        <div className="bb-export-failed" data-testid="export-lists-failed" role="alert">
          <p>{STRINGS.exportFailedHeading}</p>
          <ul>
            {outcome.failures.map((failure) => (
              <li key={`${failure.output}-${failure.reason}`}>
                {STRINGS.exportFailedRow(failure.output, STRINGS.exportFailedReason(failure.reason))}
              </li>
            ))}
          </ul>
          <p className="helper">{STRINGS.exportFailedRetry}</p>
        </div>
      )}

      <div className="modal-actions">
        {busy ? (
          <button type="button" data-testid="export-lists-cancel" onClick={() => port.cancel()}>
            {STRINGS.cancel}
          </button>
        ) : (
          <button type="button" data-testid="export-lists-close" onClick={onClose}>
            {STRINGS.close}
          </button>
        )}
        <button
          type="button"
          className="button primary"
          data-testid="export-lists-run"
          disabled={busy || blocked !== null}
          onClick={run}
        >
          {busy && progress !== null
            ? `${STRINGS.exportRunning} ${progress.done}/${progress.total}`
            : busy
              ? STRINGS.exportRunning
              : STRINGS.exportRun}
        </button>
      </div>
    </>
  )
}
