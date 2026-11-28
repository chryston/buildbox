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
import { DisplayListSvg } from '../../drawing/DisplayListSvg'
import { STRINGS } from '../../strings'
import { RENOVATION_STRINGS } from '../../strings/renovation'
import { displayLabel } from '../renovation/displayTheme'
import { DEFAULT_NOTES_SWITCHES, NOTES_SWITCH_LABELS, SHEET_SIZING, fitCheck, notesStatement, suggestionsFor } from '../../../export'
import type {
  DrawingLayerChip,
  ExportProgress,
  NotesSwitches,
  Orientation,
  Recipe,
  RecipeViewRef,
  RecordedComposition,
  ScaleDenominator,
} from '../../../export'

import { ListsPanel } from './ListsPanel'
import { HandoffPanel } from './HandoffPanel'
import { viewKey } from '../../../export'
import type { BlockedView, ExportPort, ExportPreview, ExportRunOutcome } from './port'
import type { Rect } from '../../../derive'
import type { DisplayUnit } from '../../../domain'
import type { ReactNode } from 'react'

/** The unit as the read-only line prints it. `mm`, `cm`, `m`. */
export const UNIT_LABEL: Record<DisplayUnit, string> = { mm: 'mm', cm: 'cm', m: 'm' }

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
  /**
   * Taking the person to where a Backup is downloaded (#85 §3.4). A Handoff Pack cannot be opened
   * again as their work, and the one thing they might want instead lives in the Project Library — so
   * the tab says so and offers the way there, rather than offering a second Backup of its own.
   */
  onOpenBackup(): void
  onClose(): void
}

export const ExportDialog = ({
  origin,
  unit,
  precision,
  unsavedChanges,
  port,
  onOpenView,
  onOpenBackup,
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
    // Annotations on, pins off, Resolved pins off (#83 criterion 2) — the contract's defaults, and
    // the answer for a device that has never exported this view.
    notes: DEFAULT_NOTES_SWITCHES,
  })
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [outcome, setOutcome] = useState<ExportRunOutcome | null>(null)
  // Three tabs, one dialog: `Drawing` writes sheets, `Lists` writes tables (#62), and `Handoff pack`
  // packs both, plus the CSVs, into one archive for the person the work is handed to (#85).
  const [tab, setTab] = useState<'drawing' | 'lists' | 'handoff'>('drawing')

  // The remembered recipe is a device preference read, so it arrives after the first paint. The
  // unit and precision are not remembered: they are the Project's, copied when the dialog opens.
  useEffect(() => {
    let alive = true
    void port.recall(key).then((remembered) => {
      if (!alive || remembered === null) return
      setRecipe({ ...remembered, views: [origin], unit, precision, notes: remembered.notes ?? DEFAULT_NOTES_SWITCHES })
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
    patch({ format })
  }

  // What each selected view holds, in model millimetres, by view key. Measured rather than asked for
  // at run time because a fixed scale that will not fit is a blocking error, and a person finds out
  // about a blocking error by being told — and told *which view*, because a Drawing Set of four views
  // where one is too big for the paper is not a problem with the other three (#85 §1.4).
  const [measured, setMeasured] = useState<ReadonlyMap<string, Rect | null>>(new Map())
  // The measurement depends on which views are chosen and on nothing else — not on the array they
  // arrive in, which every other control in the dialog replaces. Depending on the identity would
  // re-measure on every keystroke and land a state update after the dialog has moved on.
  const selection = selected.map(viewKey).join(',')
  useEffect(() => {
    let alive = true
    if (selection === '') {
      setMeasured(new Map())
      return () => {
        alive = false
      }
    }
    void Promise.all(
      selected.map(async (ref) => [viewKey(ref), (await port.measure(ref)).bounds] as const),
    ).then((rows) => {
      if (alive) setMeasured(new Map(rows))
    })
    return () => {
      alive = false
    }
  }, [port, selection])

  // ---- the page order (#85 §1.2)
  //
  // Before the person moves anything it is the order the picker lists the views, which is every view
  // of one Floor, then the next Floor, then the Item Detail Views — the contract's default, arrived
  // at without the dialog holding a Project of its own. After that it is `recipe.pageOrder`, and the
  // order shown is the order drawn: the same list is written into the recipe before the export runs,
  // so the file's metadata records what the person saw.
  const groupRank = new Map<string, number>()
  for (const view of views) {
    if (!groupRank.has(view.group)) groupRank.set(view.group, groupRank.size)
  }
  const byKey = new Map(selected.map((ref) => [viewKey(ref), ref]))
  const pages: readonly RecipeViewRef[] = (
    recipe.pageOrder ??
    views
      .filter((each) => byKey.has(viewKey(each.ref)))
      .sort((a, b) => groupRank.get(a.group)! - groupRank.get(b.group)!)
      .map((each) => each.ref)
  )
    .map((held) => (typeof held === 'string' ? byKey.get(held) : held))
    .filter((ref): ref is RecipeViewRef => ref !== undefined)

  const labelOf = (ref: RecipeViewRef): string =>
    views.find((each) => viewKey(each.ref) === viewKey(ref))?.label ?? ''

  /** Move one page up or down the set; the views it did not name keep their places. */
  const movePage = (at: number, by: -1 | 1): void => {
    const to = at + by
    if (to < 0 || to >= pages.length) return
    const next = [...pages]
    const held = next[at]!
    next[at] = next[to]!
    next[to] = held
    patch({ pageOrder: next.map(viewKey) })
  }

  /** One page held the way the person said, or the way the recipe's own setting says. */
  const setPageHold = (ref: RecipeViewRef, hold: string): void => {
    const held = { ...recipe.pageOrientations }
    if (hold === 'auto') delete held[viewKey(ref)]
    else held[viewKey(ref)] = hold as Orientation
    patch({ pageOrientations: held })
  }

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

  // ---- the Notes switches (#83 §1)
  //
  // Three chips whose only effect is `recipe.notes`. The saved view, the on-screen Notes overlay, the
  // revision and the history are untouched by them, which is not a rule this file has to enforce —
  // the dialog holds no Project and dispatches nothing — but the switches are the reason the rule is
  // worth stating: a person is allowed to want a sheet with pins on a drawing they look at without
  // pins. `export` reads the switches from the recipe and from nowhere else, which is what lets the
  // same recipe draw the same file a month later.
  const notes = recipe.notes ?? DEFAULT_NOTES_SWITCHES
  const setNotes = (next: Partial<NotesSwitches>): void => {
    const held = { ...notes, ...next }
    // Pins off takes `include Resolved pins` with it (#83 §1.1): a recipe that asked for Resolved
    // pins while asking for no pins describes a sheet that has nothing to label `· Resolved`.
    patch({ notes: held.commentPins ? held : { ...held, includeResolvedPins: false } })
  }

  const togglesKey = JSON.stringify(toggles ?? null)
  const notesKey = JSON.stringify(notes)
  const [composition, setComposition] = useState<RecordedComposition | null>(null)
  useEffect(() => {
    let alive = true
    void port.composition(origin, toggles ?? {}, notes).then((next) => {
      if (alive) setComposition(next)
    })
    return () => {
      alive = false
    }
    // The toggles and the switches are keyed by their own text: every chip replaces the object.
  }, [port, origin, togglesKey, notesKey])

  // The preview is the file rather than an impression of it: `preview` hands back the very display
  // list `composeSheet` gives the Worker, sheet furniture included, so every switch, layer chip and
  // scope change redraws what the download would hold (#83 §3).
  //
  // Keyed by the fields the sheet is actually drawn from — the view, the sheet, the scale, the title
  // block, the grid and the switches. Format, PNG size, units, precision and which *other* views are
  // ticked move no pixel of it, and composing a whole sheet to find that out again is not free.
  const previewRef = originRef ?? origin
  const previewKey = JSON.stringify([
    previewRef,
    recipe.pageSize,
    recipe.orientation,
    recipe.scale,
    recipe.titleBlock,
    recipe.grid,
    recipe.notes,
  ])
  const [preview, setPreview] = useState<ExportPreview | null>(null)
  useEffect(() => {
    let alive = true
    void port.preview(previewRef, recipe).then((next) => {
      if (alive) setPreview(next)
    })
    return () => {
      alive = false
    }
  }, [port, previewKey])

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


  const empty = selected.length > 0 && [...measured.values()].every((held) => held === null)

  // `auto` means either edge may lead, so a page fits if either orientation would hold it; a hold the
  // person forced on that one page narrows it to that edge alone.
  const holdsFor = (ref: RecipeViewRef): readonly Orientation[] => {
    const forced = recipe.pageOrientations?.[viewKey(ref)]
    if (forced !== undefined) return [forced]
    return recipe.orientation === 'auto' ? ['portrait', 'landscape'] : [recipe.orientation]
  }
  // The first page a fixed scale cannot hold, in page order — the one the dialog names (#85 §1.4).
  const noFit =
    recipe.scale === 'fit'
      ? null
      : (pages.find((ref) => {
          const box = measured.get(viewKey(ref))
          return box !== null && box !== undefined && !holdsFor(ref).some((hold) => fitCheck(box, recipe.pageSize, hold, recipe.scale).fits)
        }) ?? null)
  const fixes =
    noFit !== null && recipe.scale !== 'fit'
      ? suggestionsFor(measured.get(viewKey(noFit))!, recipe.pageSize, holdsFor(noFit)[0] ?? 'portrait')
      : []

  const blocked =
    selected.length === 0
      ? STRINGS.exportNeedViews
      : // The flag, not merely `blockedView`: a runtime ternary would leave the renovation sentence in
        // a flag-off bundle, and that copy is what the bundle scan looks for (#69 criterion 13).
        blockedView !== null
        ? RENOVATION_STRINGS.exportNeedsOption(blockedView.viewName, displayLabel(blockedView.display))
        : noFit !== null && typeof recipe.scale === 'number'
          ? STRINGS.exportScaleNoFit(recipe.scale, labelOf(noFit))
          : null
  const warnings = port.unacknowledgedWarnings()
  const glyphs = outcome?.kind === 'downloaded' ? outcome.missingGlyphs : []

  const run = (): void => {
    if (blocked !== null || busy) return
    setBusy(true)
    setOutcome(null)
    // The order the list is showing is the order the pages are drawn in, and it is what the file's
    // metadata will record (#85 §1.2).
    const asRun: Recipe = { ...recipe, pageOrder: pages.map(viewKey) }
    port.remember(key, asRun)
    void port.run(asRun, setProgress).then((result) => {
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
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'handoff'}
          data-testid="export-tab-handoff"
          className={tab === 'handoff' ? 'active' : undefined}
          onClick={() => {
            setTab('handoff')
          }}
        >
          {STRINGS.exportTabHandoff}
        </button>
      </div>

      {tab === 'handoff' && (
        <HandoffPanel
          origin={origin}
          unsavedChanges={unsavedChanges}
          port={port}
          onOpenBackup={onOpenBackup}
          onClose={onClose}
        />
      )}

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
            {pages.length > 1 && (
              <ol className="bb-export-pages" data-testid="export-page-order">
                {pages.map((ref, index) => (
                  <li key={viewKey(ref)} data-testid={`export-page-${viewKey(ref)}`}>
                    <span className="bb-export-page-number">{index + 1}</span>
                    <span className="bb-export-page-label">{labelOf(ref)}</span>
                    <select
                      aria-label={STRINGS.exportPageHold(labelOf(ref))}
                      data-testid={`export-page-hold-${viewKey(ref)}`}
                      value={recipe.pageOrientations?.[viewKey(ref)] ?? 'auto'}
                      onChange={(event) => {
                        setPageHold(ref, event.target.value)
                      }}
                    >
                      <option value="auto">{STRINGS.exportPageHoldAuto}</option>
                      <option value="portrait">{STRINGS.exportPageHoldPortrait}</option>
                      <option value="landscape">{STRINGS.exportPageHoldLandscape}</option>
                    </select>
                    <button
                      type="button"
                      data-testid={`export-page-up-${viewKey(ref)}`}
                      disabled={index === 0}
                      aria-label={STRINGS.exportPageUp(labelOf(ref))}
                      onClick={() => {
                        movePage(index, -1)
                      }}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      data-testid={`export-page-down-${viewKey(ref)}`}
                      disabled={index === pages.length - 1}
                      aria-label={STRINGS.exportPageDown(labelOf(ref))}
                      onClick={() => {
                        movePage(index, 1)
                      }}
                    >
                      ↓
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </fieldset>

          {chips.length > 0 && (
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
                      <dd>{notesStatement(composition.notes)}</dd>
                    </div>
                  </dl>
                </details>
              )}
            </fieldset>
          )}

          <fieldset disabled={busy}>
            <legend>{STRINGS.exportNotesGroup}</legend>
            <div className="bb-export-chips" data-testid="export-notes-switches">
              <label>
                <input
                  type="checkbox"
                  data-testid="export-notes-annotations"
                  checked={notes.viewAnnotations}
                  onChange={(event) => {
                    setNotes({ viewAnnotations: event.target.checked })
                  }}
                />
                <span>{NOTES_SWITCH_LABELS.viewAnnotations}</span>
              </label>
              <label>
                <input
                  type="checkbox"
                  data-testid="export-notes-pins"
                  checked={notes.commentPins}
                  onChange={(event) => {
                    setNotes({ commentPins: event.target.checked })
                  }}
                />
                <span>{NOTES_SWITCH_LABELS.commentPins}</span>
              </label>
              <label>
                {/* Disabled while there are no pins (#83 §1.1): the switch decides what a pin says,
                    and with no pins it decides nothing. */}
                <input
                  type="checkbox"
                  data-testid="export-notes-resolved"
                  checked={notes.includeResolvedPins}
                  disabled={!notes.commentPins}
                  onChange={(event) => {
                    setNotes({ includeResolvedPins: event.target.checked })
                  }}
                />
                <span>{NOTES_SWITCH_LABELS.includeResolvedPins}</span>
              </label>
            </div>
            {preview !== null && (
              // The sheet this recipe would write, drawn from the same display list the Worker
              // serialises (#83 §3). The `viewBox` is the whole sheet, so the preview crops nothing
              // the file keeps and shows nothing the file loses.
              <div className="bb-export-preview" data-testid="export-preview">
                <svg
                  data-testid="export-preview-svg"
                  viewBox={`0 0 ${preview.widthMm} ${preview.heightMm}`}
                  role="img"
                  aria-label={STRINGS.exportPreviewAria}
                >
                  <DisplayListSvg
                    list={preview.list}
                    sizing={SHEET_SIZING}
                    textSpace="list"
                    resolveAsset={() => null}
                  />
                </svg>
              </div>
            )}
          </fieldset>

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
              {blockedView !== null && onOpenView !== undefined && (
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
