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
import type { ExportProgress, ListsRecipe, ListsSummary, RecipeViewRef, TableId } from '../../../export'
import { UNLAYERED_LAYER_KEY } from '../../../domain'

import type { QuantityScope, RenovationState } from '../../../derive'
import { STRINGS } from '../../strings'
import { RENOVATION_STRINGS } from '../../strings/renovation'
import type { ExportPort, ExportRunOutcome, ListsOptions } from './port'
import { viewKey } from './port'
import type { ReactNode } from 'react'

/** Every Renovation State, in the order the Item List sorts by. */
const STATES: readonly RenovationState[] = ['existing', 'demolition', 'proposed']

/**
 * The tables the tab offers, in the order the export contract lists them: the two of #62 first,
 * then the five of #68. The id is the contract's own — the file name is built from it — and the
 * label is the reader's word for the same thing, which is why the two are never the same string.
 */
const TABLE_ROWS: readonly { id: TableId; label: string }[] = [
  { id: 'items', label: STRINGS.exportListItems },
  { id: 'cut-list', label: STRINGS.exportListCutList },
  { id: 'rooms', label: STRINGS.exportListRooms },
  { id: 'walls', label: STRINGS.exportListWalls },
  { id: 'openings', label: STRINGS.exportListOpenings },
  { id: 'beams', label: STRINGS.exportListBeams },
  { id: 'skirting', label: STRINGS.exportListSkirting },
  { id: 'placed-items', label: STRINGS.exportListPlacedItems },
  { id: 'warnings', label: STRINGS.exportListWarnings },
]

/**
 * The scope the tab opens with (#73 §2): every Floor, the originating view's Design Option, every
 * Renovation State, every Layer. `export` computes it because it is the view's Option that decides
 * it and the dialog does not see a Project.
 */
function fullScope(options: ListsOptions, origin: RecipeViewRef): QuantityScope {
  return {
    ...options.defaultScope,
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

/**
 * The scope's Option arm for the radio the person picked (#73 §2).
 *
 * `Choose options…` keeps whatever was already ticked — it is a mode, not a reset. Arriving in it
 * from `Existing Model only` starts from the view's own Option, because that is the Option they
 * were already looking at and an empty comparison exports nothing to compare.
 */
function optionArm(
  mode: string,
  originOption: string | undefined,
  chosen: readonly string[] | 'existing-only',
  allOptions: readonly string[],
): readonly string[] | 'existing-only' {
  if (mode === 'existing') return 'existing-only'
  if (mode === 'this') return originOption === undefined ? 'existing-only' : [originOption]
  // `Choose options…` is a comparison, so it starts with every Option in and the person removes the
  // ones not being compared. A scope of one Option is the first radio's answer, so the list would
  // have nothing to show and the radio is not offered as a change — hence the length test.
  if (allOptions.length > 1) return [...allOptions]
  return chosen === 'existing-only' ? (originOption === undefined ? [] : [originOption]) : chosen
}

export interface ListsPanelProps {
  origin: RecipeViewRef
  unsavedChanges: boolean
  port: ExportPort
  onClose(): void
}

export const ListsPanel = ({ origin, unsavedChanges, port, onClose }: ListsPanelProps): ReactNode => {
  const key = viewKey(origin)
  const [options, setOptions] = useState<ListsOptions | null>(null)
  const [recipe, setRecipe] = useState<ListsRecipe | null>(null)
  const [summary, setSummary] = useState<ListsSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [outcome, setOutcome] = useState<ExportRunOutcome | null>(null)

  // The choices and the remembered recipe arrive together, after the first paint: the choices
  // because they are `export`'s view of the Project, the recipe because it is a device preference.
  // A remembered scope is re-fitted to the Project on screen rather than trusted, and until both
  // are in there is nothing honest to draw — no counts, no statement, no default tick.
  useEffect(() => {
    let alive = true
    void port.listsOptions(origin).then(async (next) => {
      const remembered = await port.recallLists(key)
      if (!alive) return
      setOptions(next)
      setRecipe({
        tables: remembered?.tables ?? ['items', 'cut-list'],
        scope: remembered === null ? fullScope(next, origin) : recalledScope(remembered.scope, next),
      })
    })
    return () => {
      alive = false
    }
  }, [port, key, origin])

  // The statement and the row counts are derived, so they are asked for rather than kept in step
  // by hand. The scope is keyed by its own text because every control replaces the object.
  const scopeKey = recipe === null ? null : JSON.stringify(recipe.scope)
  useEffect(() => {
    if (recipe === null) return
    let alive = true
    void port.summariseLists(recipe.scope, origin).then((next) => {
      if (alive) setSummary(next)
    })
    return () => {
      alive = false
    }
    // The scope is keyed by its own text: every control replaces the object.
  }, [port, scopeKey, origin])

  // Nothing to draw until the choices and the recipe are in: a checkbox with no choice behind it,
  // or a count with no scope behind it, would be a lie about a Project this panel has not read.
  if (options === null || recipe === null) return <div className="bb-export-panel" data-testid="export-lists-loading" />

  const patch = (next: Partial<ListsRecipe>): void => {
    setOutcome(null)
    setRecipe({ ...recipe, ...next })
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

  // The Layer checkboxes are the scope's own list, `Unlayered` last. All of them on is the scope
  // `'all'` rather than an enumeration, because `'all'` is what survives a layer added after this
  // recipe was remembered: a tick on every layer then is not a promise about a layer that did
  // not exist yet.
  const layerIds =
    recipe.scope.drawingLayers === 'all'
      ? options.layers.map((layer) => layer.id)
      : [
          ...recipe.scope.drawingLayers.layerIds,
          ...(recipe.scope.drawingLayers.includeUnlayered ? [UNLAYERED_LAYER_KEY] : []),
        ]
  const toggleLayer = (layerId: string): void => {
    const held = layerIds.includes(layerId)
      ? layerIds.filter((each) => each !== layerId)
      : [...layerIds, layerId]
    patch({
      scope: {
        ...recipe.scope,
        drawingLayers:
          held.length === options.layers.length
            ? 'all'
            : {
                layerIds: held.filter((each) => each !== UNLAYERED_LAYER_KEY),
                includeUnlayered: held.includes(UNLAYERED_LAYER_KEY),
              },
      },
    })
  }

  // The Design Option control is three choices, not a list (#73 §2): the view's own Option, a
  // comparison of several, or the Existing Model alone. Which radio is lit is read back out of the
  // scope, so a remembered recipe lands on the radio it was made from.
  const originOption =
    options.defaultScope.designOptionIds === 'existing-only' ? undefined : options.defaultScope.designOptionIds[0]
  const chosen = recipe.scope.designOptionIds
  const optionMode =
    chosen === 'existing-only' ? 'existing' : chosen.length === 1 && chosen[0] === originOption ? 'this' : 'choose'
  // The States rule belongs to the radio it describes: `Existing Model only` is a choice a person
  // makes between Options, and a Project with no Options has no such choice — its scope has always
  // been the Existing Model alone and the States stay as live as they were before #73.
  const existingOnly = options.designOptions.length > 0 && recipe.scope.designOptionIds === 'existing-only'
  const pickOptionMode = (mode: string): void => {
    patch({
      scope: {
        ...recipe.scope,
        designOptionIds: optionArm(
          mode,
          originOption,
          chosen,
          options.designOptions.map((each) => each.id),
        ),
        // `Existing Model only` has no States to pick between — every row in it is Existing — so
        // the boxes go grey and all-on rather than holding a filter that cannot filter (#73 §2).
        ...(mode === 'existing' ? { renovationStates: [...STATES] } : {}),
      },
    })
  }
  const toggleOption = (optionId: string): void => {
    const held = chosen === 'existing-only' ? [] : chosen
    const next = held.includes(optionId) ? held.filter((each) => each !== optionId) : [...held, optionId]
    patch({ scope: { ...recipe.scope, designOptionIds: next } })
  }

  // A design with parts to cut is the only thing that makes a Cut List worth offering. The table
  // is absent rather than disabled, because a checkbox that can never be ticked is a question.
  const capable = summary?.cutListCapable ?? true
  const tables = capable ? recipe.tables : recipe.tables.filter((each) => each !== 'cut-list')
  // The Warnings List is scoped by Floor and Design Option only (export contract §3), so on its own
  // it has no use for the State and Layer controls: they go grey and say why, rather than looking
  // like they work. Combined with any other table they stay live for that table — and the Warnings
  // rows still ignore them, which is `derive`'s rule, not this panel's.
  const warningsOnly = tables.length === 1 && tables[0] === 'warnings'
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
          {TABLE_ROWS.map(({ id, label }) =>
            id === 'cut-list' && !capable ? (
              <li className="helper" data-testid="export-lists-no-cabinets" key={id}>
                {STRINGS.exportListsNoCabinets}
              </li>
            ) : (
              <li key={id}>
                <label>
                  <input
                    type="checkbox"
                    data-testid={`export-lists-table-${id}`}
                    checked={tables.includes(id)}
                    onChange={() => {
                      toggleTable(id)
                    }}
                  />
                  <span>{label}</span>
                  {summary !== null && (
                    <span
                      className={summary.rows[id] === 0 ? 'helper bb-export-rows-empty' : 'helper'}
                      data-testid={`export-lists-rows-${id}`}
                    >
                      {STRINGS.exportListsRows(summary.rows[id])}
                    </span>
                  )}
                </label>
              </li>
            ),
          )}
        </ul>
      </fieldset>

      <fieldset disabled={busy}>
        <legend>{STRINGS.exportListsGroupScope}</legend>
        <p className="helper" data-testid="export-lists-scope-explicit">
          {STRINGS.exportListsScopeExplicit}
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
        {options.designOptions.length === 0 ? (
          // No Options to scope by: the fixed words, not a control with one choice in it.
          <p className="helper" data-testid="export-lists-design-option-none">
            {STRINGS.exportListsExistingOnly}
          </p>
        ) : (
          <div className="bb-export-options" data-testid="export-lists-options">
            <span className="helper">{STRINGS.exportListsDesignOption}</span>
            {(
              <>
                <label>
                  <input
                    type="radio"
                    name="export-lists-option"
                    data-testid="export-lists-option-this"
                    value="this"
                    checked={optionMode === 'this'}
                    disabled={originOption === undefined}
                    onChange={() => {
                      pickOptionMode('this')
                    }}
                  />
                  <span>
                    {RENOVATION_STRINGS.exportListsThisOption(
                      options.designOptions.find((each) => each.id === originOption)?.label ?? '',
                    )}
                  </span>
                </label>
                <label>
                  <input
                    type="radio"
                    name="export-lists-option"
                    data-testid="export-lists-option-choose"
                    value="choose"
                    checked={optionMode === 'choose'}
                    onChange={() => {
                      pickOptionMode('choose')
                    }}
                  />
                  <span>{RENOVATION_STRINGS.exportListsChooseOptions}</span>
                </label>
                {optionMode === 'choose' && (
                  <div className="bb-export-option-list" data-testid="export-lists-option-list">
                    {options.designOptions.map((option) => (
                      <label key={option.id}>
                        <input
                          type="checkbox"
                          data-testid={`export-lists-option-${option.id}`}
                          checked={chosen !== 'existing-only' && chosen.includes(option.id)}
                          onChange={() => {
                            toggleOption(option.id)
                          }}
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>
                )}
                <label>
                  <input
                    type="radio"
                    name="export-lists-option"
                    data-testid="export-lists-option-existing"
                    value="existing"
                    checked={optionMode === 'existing'}
                    onChange={() => {
                      pickOptionMode('existing')
                    }}
                  />
                  <span>{RENOVATION_STRINGS.exportListsExistingModelOnly}</span>
                </label>
              </>
            )}
          </div>
        )}
        <div className="bb-export-states" data-testid="export-lists-states">
          <span className="helper">{STRINGS.exportListsStates}</span>
          {STATES.map((state) => (
            <label key={state}>
              <input
                type="checkbox"
                data-testid={`export-lists-state-${state}`}
                checked={existingOnly || recipe.scope.renovationStates.includes(state)}
                disabled={warningsOnly || existingOnly}
                onChange={() => {
                  toggleState(state)
                }}
              />
              <span>{SCOPE.states[state]}</span>
            </label>
          ))}
        </div>
        {options.layers.length > 0 && (
          <div className="bb-export-layers" data-testid="export-lists-layers">
            <span className="helper">{RENOVATION_STRINGS.exportListsGroupLayers}</span>
            {options.layers.map((layer) => (
              <label key={layer.id}>
                <input
                  type="checkbox"
                  data-testid={`export-lists-layer-${layer.id}`}
                  checked={layerIds.includes(layer.id)}
                  disabled={warningsOnly}
                  onChange={() => {
                    toggleLayer(layer.id)
                  }}
                />
                <span>{layer.label}</span>
              </label>
            ))}
          </div>
        )}
        {warningsOnly && (
          <p className="helper" data-testid="export-lists-warnings-ignore-scope">
            {STRINGS.exportListsWarningsIgnoreScope}
          </p>
        )}
      </fieldset>

      <div className="bb-export-notices" data-testid="export-lists-notices">
        <p data-testid="export-lists-notice-warnings">{STRINGS.exportWarningCount(warnings)}</p>
        {unsavedChanges && <p data-testid="export-lists-notice-unsaved">{STRINGS.exportUnsavedNotice}</p>}
        {summary !== null && summary.hiddenInView.count > 0 && (
          // Informational and never blocking: the scope asked for these rows and the file holds
          // them, whatever the view on the other side of the dialog happens to hide.
          <details data-testid="export-lists-notice-hidden">
            <summary>{RENOVATION_STRINGS.exportListsHiddenInView(summary.hiddenInView.count)}</summary>
            <ul>
              {summary.hiddenInView.refs.map((ref) => (
                <li key={ref}>{ref}</li>
              ))}
            </ul>
          </details>
        )}
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

      {/* One line above the download, in the issue's words: what is about to be written, read back
          from the controls rather than from what the writer happened to emit. */}
      <p className="bb-export-scope" data-testid="export-lists-statement">
        {summary?.statement ?? ''}
      </p>

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
