/**
 * The `Export…` dialog as a form (#61 §12–§17, criteria 9, 13, 15).
 *
 * What is pinned here is what only the dialog can pin: the defaults a person meets, the sentences
 * that must be on screen before a file exists, the two things that block an export and the one-click
 * fixes that unblock the second, and the fact that the dialog itself writes nothing — it calls
 * `port.remember` and `port.run` and is otherwise inert.
 *
 * The port is a fake. The real one reaches `platform`, `persistence` and `session`, none of which a
 * form test should meet; the byte-for-byte identity of the Worker path and the main-thread path is
 * `src/app`'s and the browsers' concern, not this file's.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ExportDialog } from './ExportDialog'
import { viewKey } from './port'
import type { ExportPort, ExportRunOutcome, ExportableView, ListsOptions } from './port'
import type { QuantityScope } from '../../../derive'
import type { ExportFailure, ExportProgress, ListsRecipe, ListsSummary, Recipe, RecipeViewRef } from '../../../export'

const ORIGIN: RecipeViewRef = { kind: 'plan', viewId: 'v-1' }
const OTHER: RecipeViewRef = { kind: 'plan', viewId: 'v-2' }
/** A 4 m × 3 m Floor: 400 mm wide at 1:10, 40 mm at 1:100, so 1:10 cannot hold A4 and 1:100 can. */
const BOUNDS = { x: 0, y: 0, w: 4000, h: 3000 }

/** A checkbox, read as the input it is. */
const checked = (testId: string): boolean => (screen.getByTestId(testId) as HTMLInputElement).checked

interface Fake {
  readonly port: ExportPort
  readonly runs: Recipe[]
  readonly remembered: Recipe[]
  readonly listsRuns: ListsRecipe[]
  readonly rememberedLists: ListsRecipe[]
  /** Every scope the Lists panel asked about, oldest first: the sentence is asked for, not kept. */
  readonly scopes: QuantityScope[]
  setOutcome(outcome: ExportRunOutcome): void
  /** What the Lists tab is told its scope holds; the notices are answers to this. */
  setListsSummary(summary: ListsSummary): void
  /** The dialog's own progress callback, once a run has started. */
  progress(progress: ExportProgress): void
}

/** Two Floors and no Design Option, which is what every Project this build has is. */
const LISTS_FLOORS: ListsOptions = {
  floors: [
    { id: 'floor-1', label: 'Ground floor' },
    { id: 'floor-2', label: 'Mezzanine' },
  ],
  designOptions: [],
}

const ITEM_SUMMARY: ListsSummary = {
  statement: 'Floor plan · All Floors · Existing only · Existing, Demolition, Proposed · all layers incl. Unlayered',
  items: 3,
  cutList: 0,
  cutListCapable: false,
}

function fakePort(options?: {
  views?: readonly ExportableView[]
  bounds?: { x: number; y: number; w: number; h: number } | null
  remembered?: Recipe | null
  listsOptions?: ListsOptions
  listsSummary?: ListsSummary
  rememberedLists?: ListsRecipe | null
}): Fake {
  const runs: Recipe[] = []
  const remembered: Recipe[] = []
  const listsRuns: ListsRecipe[] = []
  const rememberedLists: ListsRecipe[] = []
  const scopes: QuantityScope[] = []
  let listsSummary: ListsSummary = options?.listsSummary ?? ITEM_SUMMARY
  let outcome: ExportRunOutcome = { kind: 'cancelled' }
  let resolveRun: ((value: ExportRunOutcome) => void) | null = null
  let emit: ((progress: ExportProgress) => void) | null = null
  return {
    runs,
    remembered,
    listsRuns,
    rememberedLists,
    scopes,
    setOutcome(next) {
      outcome = next
      resolveRun?.(next)
      resolveRun = null
    },
    setListsSummary(next) {
      listsSummary = next
    },
    progress(progress) {
      // A progress tick is the Worker talking, not the person clicking, so it arrives outside
      // React's own batching and has to be announced to it.
      act(() => {
        emit?.(progress)
      })
    },
    port: {
      views: () => options?.views ?? [
        { ref: ORIGIN, label: 'Floor plan', group: 'Ground floor' },
        { ref: OTHER, label: 'Second plan', group: 'Ground floor' },
      ],
      measure: () => Promise.resolve({ bounds: options?.bounds === undefined ? BOUNDS : options.bounds }),
      unacknowledgedWarnings: () => 0,
      recall: () => Promise.resolve(options?.remembered ?? null),
      remember: (_key, recipe) => {
        remembered.push(recipe)
      },
      run: (recipe, onProgress) => {
        runs.push(recipe)
        emit = onProgress
        return new Promise<ExportRunOutcome>((resolve) => {
          resolveRun = () => resolve(outcome)
        })
      },
      listsOptions: () => options?.listsOptions ?? LISTS_FLOORS,
      summariseLists: (scope) => {
        scopes.push(scope)
        return Promise.resolve(listsSummary)
      },
      recallLists: () => Promise.resolve(options?.rememberedLists ?? null),
      rememberLists: (_key, recipe) => {
        rememberedLists.push(recipe)
      },
      runLists: (recipe, onProgress) => {
        listsRuns.push(recipe)
        emit = onProgress
        return new Promise<ExportRunOutcome>((resolve) => {
          resolveRun = () => resolve(outcome)
        })
      },
      cancel: vi.fn(),
    },
  }
}

async function open(
  port: ExportPort,
  options?: { unsavedChanges?: boolean; onClose?: () => void; origin?: RecipeViewRef },
): Promise<void> {
  render(
    <ExportDialog
      origin={options?.origin ?? ORIGIN}
      unit="mm"
      precision={0}
      unsavedChanges={options?.unsavedChanges ?? false}
      port={port}
      onClose={options?.onClose ?? (() => {})}
    />,
  )
  // The dialog measures the view and reads the remembered recipe, so both land after the first
  // paint. Awaiting the button settles them inside `act` rather than in the middle of the next
  // assertion.
  await screen.findByTestId('export-run')
}

const RECIPE = (overrides: Partial<Recipe> = {}): Recipe => ({
  views: [ORIGIN],
  format: 'svg',
  pageSize: 'A4',
  orientation: 'auto',
  scale: 'fit',
  pngLongEdge: 2048,
  titleBlock: true,
  grid: false,
  unit: 'mm',
  precision: 0,
  ...overrides,
})

describe('the Export dialog', () => {
  it('opens on the view it was called from, as an SVG with a title block', async () => {
    const { port } = fakePort()
    await open(port)
    expect(screen.getByTestId(`export-view-${viewKey(ORIGIN)}`)).toBeChecked()
    expect(screen.getByTestId('export-format')).toHaveValue('svg')
    expect(screen.getByTestId('export-title-block')).toBeChecked()
    expect(screen.getByTestId('export-grid')).not.toBeChecked()
    expect(screen.getByTestId('export-unit-line')).toHaveTextContent('Dimensions in mm')
  })

  it('offers Lists as a live tab and Handoff pack as one that does nothing yet', async () => {
    const { port } = fakePort()
    await open(port)
    expect(screen.getByTestId('export-tab-drawing')).toBeEnabled()
    expect(screen.getByTestId('export-tab-lists')).toBeEnabled()
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(3)
    expect(tabs[2]).toBeDisabled()
    expect(tabs[2]).toHaveAttribute('title', 'Coming soon')
  })
  it('says what the files carry and how many warnings are unacknowledged', async () => {
    const { port } = fakePort()
    await open(port)
    expect(screen.getByTestId('export-notice-privacy')).toHaveTextContent(
      'Files include the Project name and any label text you typed.',
    )
    expect(screen.getByTestId('export-notice-warnings')).toHaveTextContent(
      '0 unacknowledged warnings in this scope',
    )
    expect(screen.getByTestId('export-backup-link')).toHaveTextContent('Download Backup in the Project Library')
  })

  it('warns about unsaved changes only when there are some', async () => {
    const saved = fakePort()
    const { unmount } = render(
      <ExportDialog origin={ORIGIN} unit="mm" precision={0} unsavedChanges={false} port={saved.port} onClose={() => {}} />,
    )
    expect(screen.queryByTestId('export-notice-unsaved')).toBeNull()
    unmount()
    await open(fakePort().port, { unsavedChanges: true })
    expect(screen.getByTestId('export-notice-unsaved')).toHaveTextContent(
      'Exported from unsaved changes. Download a Backup to keep them.',
    )
  })

  it('says a view with nothing in it still exports', async () => {
    const { port } = fakePort({ bounds: null })
    await open(port)
    await waitFor(() => expect(screen.getByTestId('export-notice-empty')).toBeInTheDocument())
    expect(screen.getByTestId('export-run')).toBeEnabled()
  })

  it('shows the sheet only for PDF, where a page exists', async () => {
    const { port } = fakePort()
    await open(port)
    expect(screen.queryByTestId('export-page-size')).toBeNull()
    fireEvent.change(screen.getByTestId('export-format'), { target: { value: 'pdf' } })
    expect(screen.getByTestId('export-page-size')).toBeInTheDocument()
    expect(screen.getByTestId('export-orientation')).toBeInTheDocument()
    expect(screen.getByTestId('export-scale')).toBeInTheDocument()
  })

  it('shows the PNG size only for PNG, and exports one view at a time as PDF', async () => {
    const { port } = fakePort()
    await open(port)
    expect(screen.queryByTestId('export-png-size')).toBeNull()
    fireEvent.change(screen.getByTestId('export-format'), { target: { value: 'png' } })
    expect(screen.getByTestId('export-png-size')).toHaveValue('2048')
    fireEvent.change(screen.getByTestId('export-format'), { target: { value: 'pdf' } })
    expect(screen.getByTestId('export-notice-privacy')).toBeInTheDocument()
    expect(screen.getByTestId(`export-view-${viewKey(OTHER)}`)).toBeDisabled()
    expect(screen.getByText('PDF exports one view at a time.')).toBeInTheDocument()
  })

  it('blocks an export with no view chosen and says what is missing', async () => {
    const { port } = fakePort()
    await open(port)
    fireEvent.click(screen.getByTestId(`export-view-${viewKey(ORIGIN)}`))
    expect(screen.getByTestId('export-blocked')).toHaveTextContent('Choose at least one view to export.')
    expect(screen.getByTestId('export-run')).toBeDisabled()
  })

  it('blocks a fixed scale that will not fit and offers the fixes', async () => {
    const { port } = fakePort()
    await open(port)
    fireEvent.change(screen.getByTestId('export-format'), { target: { value: 'pdf' } })
    fireEvent.change(screen.getByTestId('export-scale'), { target: { value: '10' } })
    await waitFor(() => expect(screen.getByTestId('export-blocked')).toBeInTheDocument())
    expect(screen.getByTestId('export-blocked')).toHaveTextContent('1:10')
    expect(screen.getByTestId('export-run')).toBeDisabled()
    fireEvent.click(screen.getByTestId('export-fix-0'))
    await waitFor(() => expect(screen.queryByTestId('export-blocked')).toBeNull())
    expect(screen.getByTestId('export-run')).toBeEnabled()
  })

  it('leaves a fixed scale that fits unblocked', async () => {
    const { port } = fakePort()
    await open(port)
    fireEvent.change(screen.getByTestId('export-format'), { target: { value: 'pdf' } })
    fireEvent.change(screen.getByTestId('export-scale'), { target: { value: '100' } })
    await waitFor(() => expect(screen.getByTestId('export-scale')).toHaveValue('100'))
    expect(screen.queryByTestId('export-blocked')).toBeNull()
  })

  it('runs the recipe it shows and remembers it for this view', async () => {
    const fake = fakePort()
    const onClose = vi.fn()
    await open(fake.port, { onClose })
    fireEvent.click(screen.getByTestId('export-grid'))
    fireEvent.click(screen.getByTestId('export-run'))
    await waitFor(() => expect(fake.runs).toHaveLength(1))
    expect(fake.runs[0]).toMatchObject({ views: [ORIGIN], format: 'svg', grid: true, titleBlock: true })
    expect(fake.remembered).toEqual(fake.runs)
    fake.setOutcome({ kind: 'downloaded', files: 2, missingGlyphs: [] })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('stays open when a label could not be drawn, and names it', async () => {
    const fake = fakePort()
    const onClose = vi.fn()
    await open(fake.port, { onClose })
    fireEvent.click(screen.getByTestId('export-run'))
    await waitFor(() => expect(fake.runs).toHaveLength(1))
    fake.setOutcome({ kind: 'downloaded', files: 2, missingGlyphs: ['Bench 🔧'] })
    await waitFor(() => expect(screen.getByTestId('export-notice-glyphs')).toBeInTheDocument())
    expect(screen.getByTestId('export-notice-glyphs')).toHaveTextContent('Bench')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('lists what failed and downloads nothing', async () => {
    const fake = fakePort()
    const onClose = vi.fn()
    await open(fake.port, { onClose })
    fireEvent.click(screen.getByTestId('export-run'))
    await waitFor(() => expect(fake.runs).toHaveLength(1))
    const failures: readonly ExportFailure[] = [
      { output: 'plan.svg', reason: 'out-of-paper' },
    ]
    fake.setOutcome({ kind: 'failed', failures })
    await waitFor(() => expect(screen.getByTestId('export-failed')).toBeInTheDocument())
    expect(screen.getByTestId('export-failed')).toHaveTextContent('Nothing was downloaded.')
    expect(screen.getByTestId('export-failed')).toHaveTextContent('plan.svg: It does not fit the page at that scale.')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('offers Cancel while a run is in flight, and only then', async () => {
    const fake = fakePort()
    await open(fake.port)
    expect(screen.queryByTestId('export-cancel')).toBeNull()
    fireEvent.click(screen.getByTestId('export-run'))
    expect(screen.getByTestId('export-cancel')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('export-cancel'))
    expect(fake.port.cancel).toHaveBeenCalled()
  })

  it('reports progress as each view is written', async () => {
    const fake = fakePort()
    await open(fake.port)
    fireEvent.click(screen.getByTestId('export-run'))
    await waitFor(() => expect(fake.runs).toHaveLength(1))
    fake.progress({ stage: 'drawing', done: 1, total: 2, label: 'Second plan' })
    await waitFor(() => expect(screen.getByTestId('export-run')).toHaveTextContent('Exporting… 1/2'))
    fake.setOutcome({ kind: 'cancelled' })
    await waitFor(() => expect(screen.getByTestId('export-run')).toBeEnabled())
    expect(screen.getByTestId('export-run')).toHaveTextContent('Export')
  })

  it('starts from the recipe this view was last exported with', async () => {
    const fake = fakePort({ remembered: RECIPE({ format: 'pdf', scale: 50, pageSize: 'A3' }) })
    await open(fake.port)
    await waitFor(() => expect(screen.getByTestId('export-format')).toHaveValue('pdf'))
    expect(screen.getByTestId('export-page-size')).toHaveValue('A3')
    expect(screen.getByTestId('export-scale')).toHaveValue('50')
  })

  it('keeps the Project\'s unit and precision over the remembered ones', async () => {
    const fake = fakePort({ remembered: RECIPE({ unit: 'm', precision: 2 }) })
    await open(fake.port)
    await waitFor(() => expect(screen.getByTestId('export-format')).toHaveValue('svg'))
    fireEvent.click(screen.getByTestId('export-run'))
    await waitFor(() => expect(fake.runs).toHaveLength(1))
    expect(fake.runs[0]).toMatchObject({ unit: 'mm', precision: 0 })
  })
})

describe('the Lists tab', () => {
  /** The tab is a tab: the dialog opens on `Drawing`, and `Lists` replaces its body. */
  it('opens on Drawing and shows the tables and the scope when switched to', async () => {
    const fake = fakePort()
    await open(fake.port)
    expect(screen.queryByTestId('export-lists-tables')).toBeNull()

    await openLists()

    expect(checked('export-lists-table-items')).toBe(true)
    expect(await screen.findByTestId('export-lists-no-cabinets')).toBeInTheDocument()
    expect(screen.queryByTestId('export-views')).toBeNull()
    expect(screen.getByTestId('export-lists-statement')).toHaveTextContent('All Floors')
    await waitFor(() => expect(fake.scopes).toHaveLength(1))
    expect(fake.scopes[0]).toMatchObject({
      floorIds: ['floor-1', 'floor-2'],
      designOptionIds: 'existing-only',
    })
  })

  /**
   * The Lists tab's own opening: the panel mounts on the click and then asks for the remembered
   * recipe and the summary, both of which land a microtask later. Settling them inside `act` keeps
   * the assertions below reading a panel that has finished arriving.
   */
  async function openLists(): Promise<void> {
    await act(async () => {
      fireEvent.click(screen.getByTestId('export-tab-lists'))
      for (let tick = 0; tick < 4; tick += 1) await Promise.resolve()
    })
  }

  /** Criterion 5: a table with no rows says so beside the table and is still exportable. */
  it('says 0 rows beside an empty table and exports it anyway', async () => {
    const fake = fakePort()
    await open(fake.port)
    await openLists()
    expect(screen.getByTestId('export-lists-rows-items')).toHaveTextContent('3 rows')
    expect(screen.getByTestId('export-lists-no-cabinets')).toBeInTheDocument()

    fake.setListsSummary({ ...ITEM_SUMMARY, items: 0 })
    fireEvent.click(screen.getByTestId('export-lists-floor-floor-1'))
    await waitFor(() => expect(screen.getByTestId('export-lists-rows-items')).toHaveTextContent('0 rows'))

    fireEvent.click(screen.getByTestId('export-lists-run'))
    await waitFor(() => expect(fake.listsRuns).toHaveLength(1))
    expect(fake.listsRuns[0]?.tables).toEqual(['items'])
  })

  /** Criterion 11: one table is a bare CSV, and the dialog says so before the download. */
  it('warns that a single CSV carries no provenance, and stops when two tables are chosen', async () => {
    const fake = fakePort({
      listsSummary: { ...ITEM_SUMMARY, cutListCapable: true },
    })
    await open(fake.port)
    await openLists()
    expect(screen.queryByTestId('export-lists-notice-single')).toBeNull()

    fireEvent.click(screen.getByTestId('export-lists-table-items'))
    expect(screen.getByTestId('export-lists-notice-single')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('export-lists-table-items'))
    expect(screen.queryByTestId('export-lists-notice-single')).toBeNull()
  })

  /** Criterion 7: the Cut List is the work about to be cut — Existing, with no Design Option in scope. */
  it('narrows the Renovation States to the Cut List default when it is the only table', async () => {
    const fake = fakePort({
      listsSummary: { ...ITEM_SUMMARY, cutListCapable: true },
    })
    await open(fake.port)
    await openLists()
    expect(checked('export-lists-state-existing')).toBe(true)
    expect(checked('export-lists-state-demolition')).toBe(true)
    expect(checked('export-lists-state-proposed')).toBe(true)

    fireEvent.click(screen.getByTestId('export-lists-table-items'))

    expect(checked('export-lists-state-existing')).toBe(true)
    expect(checked('export-lists-state-demolition')).toBe(false)
    expect(checked('export-lists-state-proposed')).toBe(false)
  })

  /** Criterion 11: the recipe is remembered per Project and saved view, and comes back. */
  it('starts from the recipe this view used last, and remembers the one it sends', async () => {
    const fake = fakePort({
      rememberedLists: {
        tables: ['cut-list'],
        scope: {
          floorIds: ['floor-2'],
          designOptionIds: 'existing-only',
          renovationStates: ['existing'],
          drawingLayers: 'all',
        },
      },
      listsSummary: { ...ITEM_SUMMARY, cutListCapable: true },
    })
    await open(fake.port)
    await openLists()

    await waitFor(() => expect(checked('export-lists-floor-floor-2')).toBe(true))
    expect(checked('export-lists-floor-floor-1')).toBe(false)
    expect(checked('export-lists-table-cut-list')).toBe(true)

    fireEvent.click(screen.getByTestId('export-lists-run'))
    await waitFor(() => expect(fake.rememberedLists).toHaveLength(1))
    expect(fake.rememberedLists[0]?.scope.floorIds).toEqual(['floor-2'])
  })

  /** A Floor that leaves the scope takes its rows with it: the sentence is asked for again. */
  it('asks again with the narrowed scope when a Floor leaves it', async () => {
    const fake = fakePort()
    await open(fake.port)
    await openLists()
    await waitFor(() => expect(fake.scopes).toHaveLength(1))

    fireEvent.click(screen.getByTestId('export-lists-floor-floor-1'))

    await waitFor(() => expect(fake.scopes).toHaveLength(2))
    expect(fake.scopes[1]?.floorIds).toEqual(['floor-2'])
  })

  it('reports a failed run by output and reason, and keeps the dialog open', async () => {
    const fake = fakePort()
    const onClose = vi.fn()
    await open(fake.port, { onClose })
    await openLists()
    fireEvent.click(screen.getByTestId('export-lists-run'))
    await waitFor(() => expect(fake.listsRuns).toHaveLength(1))

    fake.setOutcome({
      kind: 'failed',
      failures: [{ output: 'Kitchen_items_20261120.csv', reason: 'empty-tables' }],
    })

    await waitFor(() => expect(screen.getByTestId('export-lists-failed')).toBeInTheDocument())
    expect(screen.getByTestId('export-lists-failed')).toHaveTextContent('Kitchen_items_20261120.csv')
    expect(onClose).not.toHaveBeenCalled()
  })
})
