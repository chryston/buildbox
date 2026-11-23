/**
 * The `Export…` dialog, Drawing tab (#61 §11–§17).
 *
 * It is a recipe form and nothing else. It reads the Project only through `ExportPort` and the
 * props the workspace hands it, never dispatches an Intent, and never writes to a saved view —
 * every control here is temporary state, and the only thing that leaves the dialog is a
 * download. The revision the drawing is taken at is the one the session is holding when the run
 * starts, which is why the dialog never sees a Project at all.
 *
 * The notices are the reason it is a dialog rather than a button. A drawing says `Not to scale`
 * unless it was drawn at a stated scale; it carries the Project name and whatever label text was
 * typed; and it can be made from changes that failed to save. Each of those is a sentence the
 * person has to see before the file exists, not after.
 *
 * Two things block an export, and both say what to do about themselves: no view selected, and a
 * fixed scale that will not fit the page — for which the fit check's suggestions are offered as
 * one-click fixes rather than described in prose.
 */
import { useEffect, useState } from 'react'
import { Modal } from '../../library/Modal'
import { STRINGS } from '../../strings'
import { RENOVATION_STRINGS } from '../../strings/renovation'
import { displayLabel } from '../renovation/displayTheme'
import { fitCheck, suggestionsFor } from '../../../export'
import type {
  DrawingLayerChip,
  ExportProgress,
  Orientation,
  Recipe,
  RecipeViewRef,
  RecordedComposition,
  ScaleDenominator,
} from '../../../export'
import { FF_RENOVATION } from '../../../derive'
import { ListsPanel } from './ListsPanel'
import { viewKey } from './port'
import type { BlockedView, ExportPort, ExportRunOutcome } from './port'
import type { Rect } from '../../../derive'
import type { DisplayUnit } from '../../../domain'
import type { ReactNode } from 'react'

/** The unit as the read-only line prints it. `mm`, `cm`, `m`. */
export const UNIT_LABEL: Record<DisplayUnit, string> = { mm: 'mm', cm: 'cm', m: 'm' }

/** The smallest box holding both, in the same millimetres. */
function unionOf(a: Rect | null, b: Rect): Rect {
  if (a === null) return b
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  }
}

/** The layers of a composition on one line, in the order the sheet paints them. */
function layerNames(rows: readonly { readonly name: string }[]): string {
  return rows.length === 0 ? RENOVATION_STRINGS.exportCompositionNone : rows.map((row) => row.name).join(', ')
}

const FORMATS = ['svg', 'png', 'pdf'] as const
const PAGE_SIZES = ['A4', 'A3'] as const
const ORIENTATIONS = ['auto', 'portrait', 'landscape'] as const
const SCALES = ['fit', 10, 20, 50, 100] as const
const PNG_SIZES = [2048, 4096] as const

export interface ExportDialogProps {
  /** The view the dialog was opened from; the picker starts here. */
  origin: RecipeViewRef
  unit: DisplayUnit
  precision: number
  /** True while the session holds changes that did not save (criterion 13). */
  unsavedChanges: boolean
  port: ExportPort
  /**
   * The one-click fix for the blocking error (#73 §3): open the view that needs an Option, so the
   * person can choose one and come back. Absent where the dialog has no workspace to move — an
   * Item Detail View, which can never be blocked anyway.
   */
  onOpenView?(viewId: string): void
  onClose(): void
}

export const ExportDialog = ({
  origin,
  unit,
  precision,
  unsavedChanges,
  port,
  onOpenView,
  onClose,
}: ExportDialogProps): ReactNode => {
  const key = viewKey(origin)
  const [recipe, setRecipe] = useState<Recipe>({
    views: [origin],
    format: 'svg',
    pageSize: 'A4',
    orientation: 'auto',
    scale: 'fit',
    pngLongEdge: 2048,
    titleBlock: true,
    grid: false,
    unit,
    precision,
  })
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [outcome, setOutcome] = useState<ExportRunOutcome | null>(null)
  // Two tabs, one dialog: `Drawing` writes sheets, `Lists` writes tables (#62). The Handoff pack
  // stays a disabled tab until #85 gives it something to do.
  const [tab, setTab] = useState<'drawing' | 'lists'>('drawing')

  // The remembered recipe is a device preference read, so it arrives after the first paint. The
  // unit and precision are not remembered: they are the Project's, copied when the dialog opens.
  useEffect(() => {
    let alive = true
    void port.recall(key).then((remembered) => {
      if (!alive || remembered === null) return
      setRecipe({ ...remembered, views: [origin], unit, precision })
    })
    return () => {
      alive = false
    }
  }, [port, key, origin, unit, precision])

  const views = port.views()
  const selected = recipe.views
  const isPdf = recipe.format === 'pdf'

  const patch = (next: Partial<Recipe>): void => {
    setOutcome(null)
    setRecipe((current) => ({ ...current, ...next }))
  }

  const toggle = (ref: RecipeViewRef): void => {
    const here = selected.some((held) => viewKey(held) === viewKey(ref))
    patch({ views: here ? selected.filter((held) => viewKey(held) !== viewKey(ref)) : [...selected, ref] })
  }

  const setFormat = (format: Recipe['format']): void => {
    // PDF takes one view because Drawing Sets arrive in #85; the first selection survives.
    patch({ format, views: format === 'pdf' ? selected.slice(0, 1) : selected })
  }

  // The union of what the selected views hold, in model millimetres. Measured rather than asked
  // for at run time because a fixed scale that will not fit is a blocking error, and a person
  // finds out about a blocking error by being told, not by being handed a failed export.
  const [bounds, setBounds] = useState<Rect | null>(null)
  // The measurement depends on which views are chosen and on nothing else — not on the array they
  // arrive in, which every other control in the dialog replaces. Depending on the identity would
  // re-measure on every keystroke and land a state update after the dialog has moved on.
  const selection = selected.map(viewKey).join(',')
  useEffect(() => {
    let alive = true
    if (selection === '') {
      setBounds(null)
      return () => {
        alive = false
      }
    }
    void Promise.all(selected.map((ref) => port.measure(ref))).then((measured) => {
      if (!alive) return
      let box: Rect | null = null
      for (const { bounds: held } of measured) {
        if (held !== null) box = unionOf(box, held)
      }
      setBounds(box)
    })
    return () => {
      alive = false
    }
  }, [port, selection])

  // ---- the Drawing tab's temporary layer toggles and the composition they record (#73 §1)
  //
  // The chips start from the saved view's own visibility and live in `recipe.views[].toggles`,
  // which `export` reads and nothing else does: the saved view, the revision and the next dialog
  // are untouched by them. The composition is asked for rather than composed here because it is
  // the same object the file's metadata will carry — the block shows what the export will say.
  const [chips, setChips] = useState<readonly DrawingLayerChip[]>([])
  useEffect(() => {
    let alive = true
    void port.drawingLayers(origin).then((next) => {
      if (alive) setChips(next)
    })
    return () => {
      alive = false
    }
  }, [port, origin])

  const originRef = selected.find((held) => viewKey(held) === key)
  const toggles = originRef?.kind === 'plan' ? originRef.toggles : undefined
  const visible = toggles?.layers ?? chips.filter((chip) => chip.visible).map((chip) => chip.id)
  const toggleChip = (layerId: string): void => {
    const next = visible.includes(layerId) ? visible.filter((each) => each !== layerId) : [...visible, layerId]
    patch({
      views: recipe.views.map((held) =>
        viewKey(held) === key && held.kind === 'plan' ? { ...held, toggles: { ...toggles, layers: next } } : held,
      ),
    })
  }

  const togglesKey = JSON.stringify(toggles ?? null)
  const [composition, setComposition] = useState<RecordedComposition | null>(null)
  useEffect(() => {
    let alive = true
    void port.composition(origin, toggles ?? {}).then((next) => {
      if (alive) setComposition(next)
    })
    return () => {
      alive = false
    }
    // The toggles are keyed by their own text: every chip replaces the object.
  }, [port, origin, togglesKey])

  // The Option names are Project data, so the composition block reads them from the same place the
  // Lists tab does rather than printing an ID a customer cannot match to anything.
  const [optionNames, setOptionNames] = useState<Record<string, string>>({})
  useEffect(() => {
    let alive = true
    void port.listsOptions(origin).then((next) => {
      if (alive) setOptionNames(Object.fromEntries(next.designOptions.map((each) => [each.id, each.label])))
    })
    return () => {
      alive = false
    }
  }, [port, origin])

  // The one blocking error #73 §3 adds: a Display with no Option to display. It is asked for, not
  // derived here, because the predicate is `export`'s and the dialog has no view to test.
  const [blockedView, setBlockedView] = useState<BlockedView | null>(null)
  useEffect(() => {
    let alive = true
    void port.blocking(selected).then((next) => {
      if (alive) setBlockedView(next)
    })
    return () => {
      alive = false
    }
    // The selection is keyed by its own text, not by the array every other control replaces.
  }, [port, selection])


  const empty = selected.length > 0 && bounds === null

  // `auto` means either edge may lead, so the drawing fits if either orientation would hold it.
  const orientations: readonly Orientation[] =
    recipe.orientation === 'auto' ? ['portrait', 'landscape'] : [recipe.orientation]
  const fit =
    isPdf && recipe.scale !== 'fit' && bounds !== null
      ? orientations.some((hold) => fitCheck(bounds, recipe.pageSize, hold, recipe.scale).fits)
      : true
  const fixes =
    !fit && bounds !== null && recipe.scale !== 'fit'
      ? suggestionsFor(bounds, recipe.pageSize, orientations[0] ?? 'portrait')
      : []

  const blocked =
    selected.length === 0
      ? STRINGS.exportNeedViews
      : // The flag, not merely `blockedView`: a runtime ternary would leave the renovation sentence in
        // a flag-off bundle, and that copy is what the bundle scan looks for (#69 criterion 13).
        FF_RENOVATION && blockedView !== null
        ? RENOVATION_STRINGS.exportNeedsOption(blockedView.viewName, displayLabel(blockedView.display))
        : !fit && typeof recipe.scale === 'number'
          ? STRINGS.exportScaleNoFit(recipe.scale)
          : null
  const warnings = port.unacknowledgedWarnings()
  const glyphs = outcome?.kind === 'downloaded' ? outcome.missingGlyphs : []

  const run = (): void => {
    if (blocked !== null || busy) return
    setBusy(true)
    setOutcome(null)
    port.remember(key, recipe)
    void port.run(recipe, setProgress).then((result) => {
      setBusy(false)
      setProgress(null)
      setOutcome(result)
      if (result.kind === 'downloaded' && result.missingGlyphs.length === 0) onClose()
    })
  }

  return (
    <Modal eyebrow={STRINGS.exportEyebrow} heading={STRINGS.exportHeading} onClose={busy ? undefined : onClose}>
      <div className="bb-export-tabs" role="tablist" data-testid="export-tabs">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'drawing'}
          data-testid="export-tab-drawing"
          className={tab === 'drawing' ? 'active' : undefined}
          onClick={() => {
            setTab('drawing')
          }}
        >
          {STRINGS.exportTabDrawing}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'lists'}
          data-testid="export-tab-lists"
          className={tab === 'lists' ? 'active' : undefined}
          onClick={() => {
            setTab('lists')
          }}
        >
          {STRINGS.exportTabLists}
        </button>
        <button type="button" role="tab" aria-selected="false" disabled title={STRINGS.exportTabComingSoon}>
          {STRINGS.exportTabHandoff}
        </button>
      </div>

      {tab === 'lists' && <ListsPanel origin={origin} unsavedChanges={unsavedChanges} port={port} onClose={onClose} />}

      {tab === 'drawing' && (
        <>
          <fieldset disabled={busy}>
            <legend>{STRINGS.exportGroupViews}</legend>
            <ul className="bb-export-views" data-testid="export-views">
              {views.map((view) => (
                <li key={viewKey(view.ref)}>
                  <label>
                    <input
                      type="checkbox"
                      data-testid={`export-view-${viewKey(view.ref)}`}
                      checked={selected.some((held) => viewKey(held) === viewKey(view.ref))}
                      disabled={isPdf && !selected.some((held) => viewKey(held) === viewKey(view.ref))}
                      onChange={() => {
                        toggle(view.ref)
                      }}
                    />
                    <span>{view.label}</span>
                    <span className="helper">{view.group}</span>
                  </label>
                </li>
              ))}
            </ul>
            {isPdf && selected.length > 0 && <p className="helper">{STRINGS.exportPdfSingleView}</p>}
          </fieldset>

          {FF_RENOVATION && chips.length > 0 && (
            <fieldset disabled={busy || originRef === undefined}>
              <legend>{RENOVATION_STRINGS.exportLayersGroup}</legend>
              <p className="helper" data-testid="export-layers-start">
                {RENOVATION_STRINGS.exportLayersStart(views.find((each) => viewKey(each.ref) === key)?.label ?? '')}
              </p>
              <div className="bb-export-chips" data-testid="export-layer-chips">
                {chips.map((chip) => (
                  <label key={chip.id}>
                    <input
                      type="checkbox"
                      data-testid={`export-layer-${chip.id}`}
                      checked={visible.includes(chip.id)}
                      onChange={() => {
                        toggleChip(chip.id)
                      }}
                    />
                    <span>{chip.name}</span>
                  </label>
                ))}
                {/* Nothing to overlay until #80 and #81 land, so the chip is there and cannot be moved. */}
                <label>
                  <input type="checkbox" data-testid="export-layer-notes" checked={false} disabled />
                  <span>{RENOVATION_STRINGS.exportNotesOverlay}</span>
                </label>
              </div>
              {composition !== null && (
                <details data-testid="export-composition">
                  <summary>{RENOVATION_STRINGS.exportCompositionHeading}</summary>
                  <dl className="bb-export-composition">
                    <div>
                      <dt>{RENOVATION_STRINGS.exportCompositionView}</dt>
                      <dd>{composition.view_name}</dd>
                    </div>
                    <div>
                      <dt>{RENOVATION_STRINGS.exportCompositionOption}</dt>
                      <dd>
                        {composition.design_option_id === null
                          ? RENOVATION_STRINGS.exportCompositionNone
                          : (optionNames[composition.design_option_id] ?? composition.design_option_id)}
                      </dd>
                    </div>
                    <div>
                      <dt>{RENOVATION_STRINGS.exportCompositionDisplay}</dt>
                      <dd>{displayLabel(composition.renovation_display)}</dd>
                    </div>
                    <div>
                      <dt>{RENOVATION_STRINGS.exportCompositionLayerOrder}</dt>
                      <dd>{layerNames(composition.layer_order)}</dd>
                    </div>
                    <div>
                      <dt>{RENOVATION_STRINGS.exportCompositionIncluded}</dt>
                      <dd>{layerNames(composition.included_layers)}</dd>
                    </div>
                    <div>
                      <dt>{RENOVATION_STRINGS.exportCompositionColors}</dt>
                      <dd>{layerNames(composition.color_overrides)}</dd>
                    </div>
                    <div>
                      <dt>{RENOVATION_STRINGS.exportCompositionNotes}</dt>
                      <dd>
                        {composition.notes.overlay
                          ? RENOVATION_STRINGS.exportCompositionOn
                          : RENOVATION_STRINGS.exportCompositionOff}
                      </dd>
                    </div>
                  </dl>
                </details>
              )}
            </fieldset>
          )}

          <fieldset disabled={busy}>
            <legend>{STRINGS.exportGroupFiles}</legend>
            <label>
              <span>{STRINGS.exportFormat}</span>
              <select
                data-testid="export-format"
                value={recipe.format}
                onChange={(event) => {
                  setFormat(event.target.value as Recipe['format'])
                }}
              >
                {FORMATS.map((format) => (
                  <option key={format} value={format}>
                    {format.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
            {recipe.format === 'png' && (
              <label>
                <span>{STRINGS.exportPngSize}</span>
                <select
                  data-testid="export-png-size"
                  value={recipe.pngLongEdge}
                  onChange={(event) => {
                    patch({ pngLongEdge: Number(event.target.value) as Recipe['pngLongEdge'] })
                  }}
                >
                  {PNG_SIZES.map((pixels) => (
                    <option key={pixels} value={pixels}>
                      {STRINGS.exportPngLongEdge(pixels)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              <input
                type="checkbox"
                data-testid="export-title-block"
                checked={recipe.titleBlock}
                onChange={(event) => {
                  patch({ titleBlock: event.target.checked })
                }}
              />
              <span>{STRINGS.exportTitleBlock}</span>
            </label>
            <label>
              <input
                type="checkbox"
                data-testid="export-grid"
                checked={recipe.grid}
                onChange={(event) => {
                  patch({ grid: event.target.checked })
                }}
              />
              <span>{STRINGS.exportGrid}</span>
            </label>
          </fieldset>

          {isPdf && (
            <fieldset disabled={busy}>
              <legend>{STRINGS.exportGroupSheet}</legend>
              <label>
                <span>{STRINGS.exportPageSize}</span>
                <select
                  data-testid="export-page-size"
                  value={recipe.pageSize}
                  onChange={(event) => {
                    patch({ pageSize: event.target.value as Recipe['pageSize'] })
                  }}
                >
                  {PAGE_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>{STRINGS.exportOrientation}</span>
                <select
                  data-testid="export-orientation"
                  value={recipe.orientation}
                  onChange={(event) => {
                    patch({ orientation: event.target.value as Recipe['orientation'] })
                  }}
                >
                  {ORIENTATIONS.map((hold) => (
                    <option key={hold} value={hold}>
                      {hold === 'auto'
                        ? STRINGS.exportOrientationAuto
                        : hold === 'portrait'
                          ? STRINGS.exportOrientationPortrait
                          : STRINGS.exportOrientationLandscape}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>{STRINGS.exportScale}</span>
                <select
                  data-testid="export-scale"
                  value={recipe.scale}
                  onChange={(event) => {
                    const value = event.target.value
                    patch({ scale: value === 'fit' ? 'fit' : (Number(value) as ScaleDenominator) })
                  }}
                >
                  {SCALES.map((scale) => (
                    <option key={scale} value={scale}>
                      {scale === 'fit' ? STRINGS.exportFitToPage : STRINGS.exportScaleRatio(scale)}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>
          )}

          <p className="helper" data-testid="export-unit-line">
            {STRINGS.exportDimensionsIn(UNIT_LABEL[unit])}
          </p>

          <div className="bb-export-notices" data-testid="export-notices">
            <p data-testid="export-notice-privacy">{STRINGS.exportPrivacy}</p>
            <p data-testid="export-notice-warnings">{STRINGS.exportWarningCount(warnings)}</p>
            {unsavedChanges && <p data-testid="export-notice-unsaved">{STRINGS.exportUnsavedNotice}</p>}
            {empty && <p data-testid="export-notice-empty">{STRINGS.exportEmptyViewNotice}</p>}
            {glyphs.length > 0 && (
              <p data-testid="export-notice-glyphs">{STRINGS.exportMissingGlyphNotice(glyphs.join(', '))}</p>
            )}
            <p className="helper" data-testid="export-backup-link">
              {STRINGS.exportBackupLink}
            </p>
          </div>

          {blocked !== null && (
            <p className="bb-export-blocked" data-testid="export-blocked" role="alert">
              {blocked}
              {fixes.length > 0 && (
                <>
                  {' '}
                  {STRINGS.exportScaleNoFitFixes}{' '}
                  {fixes.map((fix, index) => (
                    <button
                      key={`${fix.page}-${fix.orientation}-${fix.scale}`}
                      type="button"
                      data-testid={`export-fix-${index}`}
                      onClick={() => {
                        patch({ pageSize: fix.page, orientation: fix.orientation, scale: fix.scale })
                      }}
                    >
                      {typeof fix.scale === 'number' ? STRINGS.exportFixScale(fix.scale) : STRINGS.exportFixFit}
                      {` (${fix.page}, ${fix.orientation})`}
                    </button>
                  ))}
                </>
              )}
              {FF_RENOVATION && blockedView !== null && onOpenView !== undefined && (
                <>
                  {' '}
                  <button
                    type="button"
                    data-testid="export-open-view"
                    onClick={() => {
                      onOpenView(blockedView.viewId)
                    }}
                  >
                    {RENOVATION_STRINGS.exportOpenView}
                  </button>
                </>
              )}
            </p>
          )}

          {outcome?.kind === 'failed' && (
            <div className="bb-export-failed" data-testid="export-failed" role="alert">
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
              <button type="button" data-testid="export-cancel" onClick={() => port.cancel()}>
                {STRINGS.cancel}
              </button>
            ) : (
              <button type="button" data-testid="export-close" onClick={onClose}>
                {STRINGS.close}
              </button>
            )}
            <button
              type="button"
              className="button primary"
              data-testid="export-run"
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
      )}
    </Modal>
  )
}
