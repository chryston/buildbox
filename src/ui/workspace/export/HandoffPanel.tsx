/**
 * The `Export…` dialog's Handoff Pack tab (#85 §3).
 *
 * One archive for the person the work is handed to: the Drawing Set, the three printed lists and a
 * folder of CSVs. The tab decides only *what goes in*. Every rule about what a row means, which Floor
 * scopes it or which page shows which view belongs to `export`, which is also where the pack is
 * written — so this panel holds one scope selector, a list of outputs to tick, and a download.
 *
 * One selector, not one per output (§3.3): a pack whose drawings were scoped differently from its
 * CSVs would be a box with two different jobs in it, and the person opening it has no way to find out.
 * The statement under the controls is that scope in plain words, answered by the same call the Lists
 * tab makes, so one scope cannot read two different ways inside one dialog.
 *
 * Two notices are here because their absence would be a lie. The pack is not a Backup, and someone who
 * has just pressed the button beside the Library's `Download Backup` deserves to be told which one
 * they are holding; and the pack carries what a person typed — Floor names, item names, comments — so
 * the tab says the file leaves the device with it.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { SCOPE, viewKey } from '../../../export'
import { DEFAULT_HANDOFF_OUTPUTS, HANDOFF_TABLES } from '../../../export'
import type { HandoffRecipe, HandoffOutputs, ListsSummary, RecipeViewRef, TableId } from '../../../export'
import { UNLAYERED_LAYER_KEY } from '../../../domain'
import type { QuantityScope, RenovationState } from '../../../derive'
import { STRINGS } from '../../strings'
import { RENOVATION_STRINGS } from '../../strings/renovation'
import type { ExportPort, ExportRunOutcome, ListsOptions } from './port'

/** Every Renovation State, in the order the Item List sorts by. */
const STATES: readonly RenovationState[] = ['existing', 'demolition', 'proposed']

/** The four printed outputs, in the order the pack lists them, with the reader's word for each. */
const OUTPUT_ROWS: readonly { key: keyof HandoffOutputs; label: string; table: TableId | null }[] = [
  { key: 'drawings', label: STRINGS.exportHandoffDrawings, table: null },
  { key: 'itemList', label: STRINGS.exportHandoffItemList, table: 'items' },
  { key: 'cutList', label: STRINGS.exportHandoffCutList, table: 'cut-list' },
  { key: 'commentRegister', label: STRINGS.exportHandoffCommentRegister, table: 'comments' },
]

/** The CSVs, in the contract's order — the same order the archive holds them in. */
const DATA_ROWS: readonly { id: TableId; label: string }[] = [
  { id: 'rooms', label: STRINGS.exportListRooms },
  { id: 'walls', label: STRINGS.exportListWalls },
  { id: 'openings', label: STRINGS.exportListOpenings },
  { id: 'beams', label: STRINGS.exportListBeams },
  { id: 'skirting', label: STRINGS.exportListSkirting },
  { id: 'services', label: STRINGS.exportListServices },
  { id: 'placed-items', label: STRINGS.exportListPlacedItems },
  { id: 'items', label: STRINGS.exportListItems },
  { id: 'cut-list', label: STRINGS.exportListCutList },
  { id: 'comments', label: STRINGS.exportListComments },
  { id: 'warnings', label: STRINGS.exportListWarnings },
]

/** The pack the tab opens with: everything ticked, every CSV, the view's own full scope. */
function fullRecipe(options: ListsOptions, origin: RecipeViewRef): HandoffRecipe {
  return {
    drawing: {
      views: [origin],
      format: 'pdf',
      pageSize: 'A3',
      orientation: 'auto',
      scale: 'fit',
      pngLongEdge: 2048,
      titleBlock: true,
      grid: false,
      unit: 'mm',
      precision: 0,
    },
    outputs: { ...DEFAULT_HANDOFF_OUTPUTS },
    tables: [...HANDOFF_TABLES],
    scope: {
      ...options.defaultScope,
      ...(origin.kind === 'item-detail' ? { itemDesignId: origin.itemDesignId } : {}),
    },
  }
}

/** A remembered pack's scope, made safe for the Project it arrived in — the Lists tab's rule. */
function recalledScope(remembered: QuantityScope, options: ListsOptions): QuantityScope {
  const known = new Set(options.floors.map((floor) => floor.id))
  const floors = remembered.floorIds.filter((floorId) => known.has(floorId))
  return { ...remembered, floorIds: floors.length > 0 ? floors : [...known] }
}

export interface HandoffPanelProps {
  readonly origin: RecipeViewRef
  readonly unsavedChanges: boolean
  readonly port: ExportPort
  readonly onClose: () => void
  /** Where a Backup is actually downloaded — the Library, which this tab never duplicates (#85 §3.4). */
  readonly onOpenBackup: () => void
}

export function HandoffPanel({
  origin,
  unsavedChanges,
  port,
  onOpenBackup,
  onClose,
}: HandoffPanelProps): ReactNode {
  const [options, setOptions] = useState<ListsOptions | null>(null)
  const [recipe, setRecipe] = useState<HandoffRecipe | null>(null)
  const [summary, setSummary] = useState<ListsSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<ExportRunOutcome | null>(null)
  const [warnings, setWarnings] = useState(0)

  // The recipe is remembered per Project and saved view on this device, and never in a Backup
  // (#85 §3.6).
  useEffect(() => {
    let live = true
    void Promise.all([port.listsOptions(origin), port.recallHandoff(viewKey(origin))]).then(([held, remembered]) => {
      if (!live) return
      setOptions(held)
      setRecipe(
        remembered === null
          ? fullRecipe(held, origin)
          : { ...remembered, scope: recalledScope(remembered.scope, held) },
      )
      setWarnings(port.unacknowledgedWarnings())
    })
    return () => {
      live = false
    }
  }, [port, origin])

  // The statement and the row counts are answers, not arithmetic done here.
  useEffect(() => {
    if (recipe === null) return
    let live = true
    void port.summariseLists(recipe.scope, origin, recipe.includeResolvedComments === true).then((held) => {
      if (live) setSummary(held)
    })
    return () => {
      live = false
    }
  }, [port, origin, recipe])

  if (options === null || recipe === null) {
    return <div className="bb-export-panel" data-testid="export-handoff-loading" />
  }

  const patch = (over: Partial<HandoffRecipe>): void => {
    setRecipe({ ...recipe, ...over })
  }
  const toggleFloor = (floorId: string): void => {
    const held = recipe.scope.floorIds
    patch({
      scope: {
        ...recipe.scope,
        floorIds: held.includes(floorId) ? held.filter((each) => each !== floorId) : [...held, floorId],
      },
    })
  }
  const toggleState = (state: RenovationState): void => {
    const held = recipe.scope.renovationStates
    patch({
      scope: {
        ...recipe.scope,
        renovationStates: held.includes(state) ? held.filter((each) => each !== state) : [...held, state],
      },
    })
  }
  const toggleTable = (table: TableId): void => {
    const held = recipe.tables
    patch({ tables: held.includes(table) ? held.filter((each) => each !== table) : [...held, table] })
  }
  const existingOnly = recipe.scope.designOptionIds === 'existing-only'
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

  const run = async (): Promise<void> => {
    port.rememberHandoff(viewKey(origin), recipe)
    setBusy(true)
    setOutcome(null)
    const answer = await port.runHandoff(recipe, () => {})
    setOutcome(answer)
    setBusy(false)
    // The same rule the other two tabs follow: a pack that went out with nothing to say closes,
    // because the person asked for a file and has it. It stays open only when the missing-glyph
    // notice is the thing they still have to read (#85 §3).
    if (answer.kind === 'downloaded' && answer.missingGlyphs.length === 0) onClose()
  }

  const nothing =
    !recipe.outputs.drawings &&
    !recipe.outputs.itemList &&
    !recipe.outputs.cutList &&
    !recipe.outputs.commentRegister &&
    recipe.tables.length === 0
  const cutListCapable = summary?.cutListCapable ?? true

  return (
    <>
      <fieldset disabled={busy}>
        <legend>{STRINGS.exportHandoffGroupOutputs}</legend>
        <ul className="bb-export-views" data-testid="export-handoff-outputs">
          {OUTPUT_ROWS.map((row) => {
            const held = row.key === 'cutList' ? recipe.outputs.cutList && cutListCapable : recipe.outputs[row.key]
            return (
              <li key={row.key}>
                <label>
                  <input
                    type="checkbox"
                    data-testid={`export-handoff-output-${row.key}`}
                    checked={held}
                    disabled={row.key === 'cutList' && !cutListCapable}
                    onChange={() => {
                      patch({ outputs: { ...recipe.outputs, [row.key]: !recipe.outputs[row.key] } })
                    }}
                  />
                  <span>{row.label}</span>
                  {row.table !== null && summary !== null && (
                    <span className="helper">{STRINGS.exportHandoffRows(summary.rows[row.table])}</span>
                  )}
                </label>
              </li>
            )
          })}
        </ul>
        {!cutListCapable && (
          <p className="helper" data-testid="export-handoff-no-cut-list">
            {STRINGS.exportHandoffNoCutList}
          </p>
        )}
      </fieldset>

      <fieldset disabled={busy}>
        <legend>{STRINGS.exportHandoffGroupData}</legend>
        <ul className="bb-export-views" data-testid="export-handoff-data">
          {DATA_ROWS.map((row) => (
            <li key={row.id}>
              <label>
                <input
                  type="checkbox"
                  data-testid={`export-handoff-data-${row.id}`}
                  checked={recipe.tables.includes(row.id)}
                  onChange={() => {
                    toggleTable(row.id)
                  }}
                />
                <span>{row.label}</span>
                {summary !== null && (
                  <span className="helper">{STRINGS.exportHandoffRows(summary.rows[row.id])}</span>
                )}
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      <fieldset disabled={busy}>
        <legend>{STRINGS.exportListsGroupScope}</legend>
        <p className="helper" data-testid="export-handoff-scope-one">
          {STRINGS.exportHandoffScopeOne}
        </p>
        <div className="bb-export-floors" data-testid="export-handoff-floors">
          <span className="helper">{STRINGS.exportListsFloors}</span>
          {options.floors.map((floor) => (
            <label key={floor.id}>
              <input
                type="checkbox"
                data-testid={`export-handoff-floor-${floor.id}`}
                checked={recipe.scope.floorIds.includes(floor.id)}
                onChange={() => {
                  toggleFloor(floor.id)
                }}
              />
              <span>{floor.label}</span>
            </label>
          ))}
        </div>
        {options.designOptions.length === 0 && (
          <p className="helper" data-testid="export-handoff-design-option-none">
            {STRINGS.exportListsExistingOnly}
          </p>
        )}
        <div className="bb-export-states" data-testid="export-handoff-states">
          <span className="helper">{STRINGS.exportListsStates}</span>
          {STATES.map((state) => (
            <label key={state}>
              <input
                type="checkbox"
                data-testid={`export-handoff-state-${state}`}
                checked={existingOnly || recipe.scope.renovationStates.includes(state)}
                disabled={existingOnly}
                onChange={() => {
                  toggleState(state)
                }}
              />
              <span>{SCOPE.states[state]}</span>
            </label>
          ))}
        </div>
        {options.layers.length > 0 && (
          <div className="bb-export-layers" data-testid="export-handoff-layers">
            <span className="helper">{RENOVATION_STRINGS.exportListsGroupLayers}</span>
            {options.layers.map((layer) => (
              <label key={layer.id}>
                <input
                  type="checkbox"
                  data-testid={`export-handoff-layer-${layer.id}`}
                  checked={layerIds.includes(layer.id)}
                  onChange={() => {
                    toggleLayer(layer.id)
                  }}
                />
                <span>{layer.label}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <div className="bb-export-notices" data-testid="export-handoff-notices">
        {summary !== null && summary.hiddenInView !== null && summary.hiddenInView.count > 0 && (
          <p className="bb-export-notice" data-testid="export-handoff-notice-hidden">
            {STRINGS.exportHandoffHidden(summary.hiddenInView.count)}
          </p>
        )}
        {warnings > 0 && (
          <p className="bb-export-notice" data-testid="export-handoff-notice-warnings">
            {STRINGS.exportHandoffWarnings(warnings)}
          </p>
        )}
        <p className="bb-export-notice" data-testid="export-handoff-notice-content">
          {STRINGS.exportHandoffUserContent}
        </p>
        <p className="bb-export-notice" data-testid="export-handoff-notice-backup">
          <span>{STRINGS.exportHandoffNotBackup}</span>{' '}
          <button
            type="button"
            className="bb-export-link"
            data-testid="export-handoff-open-backup"
            onClick={onOpenBackup}
          >
            {STRINGS.exportHandoffOpenBackup}
          </button>
        </p>
        {unsavedChanges && (
          <p className="bb-export-notice" data-testid="export-handoff-notice-unsaved">
            {STRINGS.exportUnsavedNotice}
          </p>
        )}
        {outcome !== null && outcome.kind === 'failed' && (
          <div className="bb-export-failed" data-testid="export-handoff-failed" role="alert">
            <p>{STRINGS.exportFailedHeading}</p>
            <ul>
              {outcome.failures.map((each) => (
                <li key={`${each.output}:${each.reason}`}>
                  {STRINGS.exportFailedRow(each.output, STRINGS.exportFailedReason(each.reason))}
                </li>
              ))}
            </ul>
            <p data-testid="export-handoff-retry">{STRINGS.exportFailedRetry}</p>
          </div>
        )}
      </div>

      {summary !== null && (
        <p className="bb-export-scope" data-testid="export-handoff-statement">
          {summary.statement}
        </p>
      )}

      <div className="bb-export-actions">
        <button
          type="button"
          className="button primary"
          data-testid="export-handoff-run"
          disabled={busy || nothing}
          onClick={() => {
            void run()
          }}
        >
          {STRINGS.exportHandoffRun}
        </button>
        {busy && (
          <button
            type="button"
            data-testid="export-handoff-cancel"
            onClick={() => {
              port.cancel()
            }}
          >
            {STRINGS.cancel}
          </button>
        )}
        {outcome !== null && outcome.kind === 'downloaded' && (
          <button type="button" data-testid="export-handoff-done" onClick={onClose}>
            {STRINGS.exportHandoffClose}
          </button>
        )}
      </div>
    </>
  )
}
