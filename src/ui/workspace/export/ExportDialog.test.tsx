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
import type { BlockedView, ExportPort, ExportRunOutcome, ExportableView, ListsOptions } from './port'
import type { QuantityScope } from '../../../derive'
import type {
  DrawingLayerChip,
  ExportFailure,
  ExportProgress,
  ListsRecipe,
  ListsSummary,
  Recipe,
  RecipeViewRef,
  RecordedComposition,
} from '../../../export'

const ORIGIN: RecipeViewRef = { kind: 'plan', viewId: 'v-1' }
const OTHER: RecipeViewRef = { kind: 'plan', viewId: 'v-2' }
/** A 4 m × 3 m Floor: 400 mm wide at 1:10, 40 mm at 1:100, so 1:10 cannot hold A4 and 1:100 can. */
const BOUNDS = { x: 0, y: 0, w: 4000, h: 3000 }

/** A checkbox, read as the input it is. */
const checked = (testId: string): boolean => (screen.getByTestId(testId) as HTMLInputElement).checked
const disabled = (testId: string): boolean => (screen.getByTestId(testId) as HTMLInputElement).disabled

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

/** Two Floors, no Design Option and no Drawing Layers, which is what every Project this build has is. */
const LISTS_FLOORS: ListsOptions = {
  floors: [
    { id: 'floor-1', label: 'Ground floor' },
    { id: 'floor-2', label: 'Mezzanine' },
  ],
  designOptions: [],
  layers: [],
  defaultScope: {
    floorIds: ['floor-1', 'floor-2'],
    designOptionIds: 'existing-only',
    renovationStates: ['existing', 'demolition', 'proposed'],
    drawingLayers: 'all',
  },
}

/** The same Project with Drawing Layers, which is what makes the Lists Layer group exist (#73). */
const LISTS_LAYERED: ListsOptions = {
  ...LISTS_FLOORS,
  layers: [
    { id: 'layer-a', label: 'Furniture' },
    { id: 'unlayered', label: 'Unlayered' },
  ],
}

const ITEM_SUMMARY: ListsSummary = {
  statement: 'Floor plan · All Floors · Existing only · Existing, Demolition, Proposed · all layers incl. Unlayered',
  rows: { items: 3, 'cut-list': 0, rooms: 0, walls: 0, openings: 0, 'placed-items': 0, warnings: 0 },
  cutListCapable: false,
  hiddenInView: { count: 0, refs: [] },
}

function fakePort(options?: {
  views?: readonly ExportableView[]
  bounds?: { x: number; y: number; w: number; h: number } | null
  remembered?: Recipe | null
  listsOptions?: ListsOptions
  listsSummary?: ListsSummary
  rememberedLists?: ListsRecipe | null
  /** What the scope's warning count is, as `derive` would have answered it. */
  warnings?: number
  /** The Drawing Layers the originating view offers (#73 §1). */
  chips?: readonly DrawingLayerChip[]
  /** What the composition block is told the sheet will say. */
  composition?: RecordedComposition | null
  /** The view whose Display blocks the Drawing export, if one does (#73 §3). */
  blocked?: BlockedView | null
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
      unacknowledgedWarnings: () => options?.warnings ?? 0,
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
      listsOptions: () => Promise.resolve(options?.listsOptions ?? LISTS_FLOORS),
      drawingLayers: () => Promise.resolve(options?.chips ?? []),
      composition: () => Promise.resolve(options?.composition ?? null),
      blocking: () => Promise.resolve(options?.blocked ?? null),
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
  // The Drawing tab also asks the port for its chips, the composition, the Option names and whether
  // a view blocks the export. All four answer a macrotask later, and they must answer inside `act`
  // rather than in the middle of the next test's assertions.
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0)
    })
  })
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

  /**
   * Criterion 6, the dialog's half: three open warnings is a sentence, not a stop. The count is the
   * same `derive` number the strip and the Warnings List are built from, and Export still runs.
   */
  it('counts three unacknowledged warnings and exports anyway', async () => {
    const fake = fakePort({ warnings: 3 })
    await open(fake.port)
    expect(screen.getByTestId('export-notice-warnings')).toHaveTextContent('3 unacknowledged warnings in this scope')
    expect(screen.getByTestId('export-run')).toBeEnabled()

    fireEvent.click(screen.getByTestId('export-run'))
    await waitFor(() => expect(fake.runs).toHaveLength(1))
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
    // Unchecking the view sends a fresh blocking question to the port; settle it here rather than
    // letting it answer in the middle of the next test.
    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0)
      })
    })
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
   * A beat inside `act`: the panel asks for its counts and the answer arrives a microtask later,
   * and an update that lands outside `act` is an error this repo's setup turns into a failure.
   */
  async function settle(): Promise<void> {
    await act(async () => {
      // The executor form, not `Promise.withResolvers`: the project's lib is ES2022.
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    })
  }

  /**
   * The Lists tab's own opening: the panel mounts on the click and then asks for the remembered
   * recipe and the summary, both of which land a microtask later. Settling them inside `act` keeps
   * the assertions below reading a panel that has finished arriving.
   */
  async function openLists(): Promise<void> {
    await act(async () => {
      fireEvent.click(screen.getByTestId('export-tab-lists'))
    })
    await settle()
  }

  /** Criterion 5: a table with no rows says so beside the table and is still exportable. */
  it('says 0 rows beside an empty table and exports it anyway', async () => {
    const fake = fakePort()
    await open(fake.port)
    await openLists()
    expect(screen.getByTestId('export-lists-rows-items')).toHaveTextContent('3 rows')
    expect(screen.getByTestId('export-lists-no-cabinets')).toBeInTheDocument()

    fake.setListsSummary({ ...ITEM_SUMMARY, rows: { ...ITEM_SUMMARY.rows, items: 0 } })
    fireEvent.click(screen.getByTestId('export-lists-floor-floor-1'))
    await waitFor(() => expect(screen.getByTestId('export-lists-rows-items')).toHaveTextContent('0 rows'))

    fireEvent.click(screen.getByTestId('export-lists-run'))
    await waitFor(() => expect(fake.listsRuns).toHaveLength(1))
    expect(fake.listsRuns[0]?.tables).toEqual(['items'])
  })

  /** Scope 9: the five tables of #68 are offered under the two of #62, each with its own count. */
  it('offers Rooms, Walls, Openings, Placed Items and Warnings List with a row count each', async () => {
    const fake = fakePort({
      listsSummary: {
        ...ITEM_SUMMARY,
        cutListCapable: true,
        rows: { items: 3, 'cut-list': 6, rooms: 0, walls: 2, openings: 1, 'placed-items': 4, warnings: 3 },
      },
    })
    await open(fake.port)
    await openLists()

    // The order is the contract's, and it is the order of the checkboxes: a reader who works down
    // the list works down the ZIP.
    expect(
      [...screen.getByTestId('export-lists-tables').querySelectorAll('input')].map((input) =>
        input.getAttribute('data-testid'),
      ),
    ).toEqual([
      'export-lists-table-items',
      'export-lists-table-cut-list',
      'export-lists-table-rooms',
      'export-lists-table-walls',
      'export-lists-table-openings',
      'export-lists-table-placed-items',
      'export-lists-table-warnings',
    ])
    const list = screen.getByTestId('export-lists-tables')
    expect(list).toHaveTextContent('Item List')
    expect(list).toHaveTextContent('Rooms')
    expect(list).toHaveTextContent('Walls')
    expect(list).toHaveTextContent('Openings')
    expect(list).toHaveTextContent('Placed Items')
    expect(list).toHaveTextContent('Warnings List')
    // Nothing new is on by default: the #62 recipe is untouched by the five that arrived.
    expect(checked('export-lists-table-rooms')).toBe(false)
    expect(checked('export-lists-table-warnings')).toBe(false)
    expect(screen.getByTestId('export-lists-rows-walls')).toHaveTextContent('2 rows')
    expect(screen.getByTestId('export-lists-rows-openings')).toHaveTextContent('1 row')
    expect(screen.getByTestId('export-lists-rows-placed-items')).toHaveTextContent('4 rows')
    expect(screen.getByTestId('export-lists-rows-warnings')).toHaveTextContent('3 rows')
    // Criterion 7: an empty table is an answer beside the checkbox, not a missing one.
    expect(screen.getByTestId('export-lists-rows-rooms')).toHaveTextContent('0 rows')
    expect(screen.getByTestId('export-lists-rows-rooms')).toHaveClass('bb-export-rows-empty')
  })

  /** Scope 9 + criterion 10: the new checkboxes reach the recipe the export is run with. */
  it('sends the tables it was shown, the five new ones included', async () => {
    const fake = fakePort({ listsSummary: { ...ITEM_SUMMARY, cutListCapable: true } })
    await open(fake.port)
    await openLists()

    fireEvent.click(screen.getByTestId('export-lists-table-items'))
    fireEvent.click(screen.getByTestId('export-lists-table-cut-list'))
    fireEvent.click(screen.getByTestId('export-lists-table-rooms'))
    fireEvent.click(screen.getByTestId('export-lists-table-warnings'))
    await settle()

    fireEvent.click(screen.getByTestId('export-lists-run'))
    await waitFor(() => expect(fake.listsRuns).toHaveLength(1))
    expect(fake.listsRuns[0]?.tables).toEqual(['rooms', 'warnings'])
  })

  /**
   * Scope 9: the Warnings List is scoped by Floor and Design Option only, so alone it has nothing
   * for the State and Layer controls to do. They go grey beside a note that says why.
   */
  it('disables the State and Layer controls when the Warnings List is the only table', async () => {
    const fake = fakePort({ listsOptions: LISTS_LAYERED, listsSummary: { ...ITEM_SUMMARY, cutListCapable: true } })
    await open(fake.port)
    await openLists()
    expect(screen.queryByTestId('export-lists-warnings-ignore-scope')).toBeNull()
    expect(disabled('export-lists-state-existing')).toBe(false)

    fireEvent.click(screen.getByTestId('export-lists-table-items'))
    fireEvent.click(screen.getByTestId('export-lists-table-cut-list'))
    fireEvent.click(screen.getByTestId('export-lists-table-warnings'))
    await settle()

    expect(screen.getByTestId('export-lists-warnings-ignore-scope')).toHaveTextContent(
      'Warnings ignore layers and states.',
    )
    expect(disabled('export-lists-state-existing')).toBe(true)
    expect(disabled('export-lists-state-demolition')).toBe(true)
    expect(disabled('export-lists-state-proposed')).toBe(true)
    expect(disabled('export-lists-layer-layer-a')).toBe(true)
    expect(disabled('export-lists-layer-unlayered')).toBe(true)
    // Floors are exactly what that table *is* scoped by, so they stay live. The Design Option select
    // is disabled for a reason of its own — no Project has a second option until #73 — which is not
    // this notice's doing and does not change with the table set.
    expect(disabled('export-lists-floor-floor-1')).toBe(false)
    // And the scope statement is still the sentence of the scope, warnings or no warnings.
    expect(screen.getByTestId('export-lists-statement')).toHaveTextContent('All Floors')

    fireEvent.click(screen.getByTestId('export-lists-run'))
    await waitFor(() => expect(fake.listsRuns).toHaveLength(1))
    expect(fake.listsRuns[0]?.tables).toEqual(['warnings'])
  })

  /** Scope 9: combined with anything else the controls stay live — for the tables that need them. */
  it('leaves the State and Layer controls alone when the Warnings List shares the recipe', async () => {
    const fake = fakePort({ listsOptions: LISTS_LAYERED, listsSummary: { ...ITEM_SUMMARY, cutListCapable: true } })
    await open(fake.port)
    await openLists()

    fireEvent.click(screen.getByTestId('export-lists-table-warnings'))
    await settle()

    expect(screen.queryByTestId('export-lists-warnings-ignore-scope')).toBeNull()
    expect(disabled('export-lists-state-existing')).toBe(false)
    expect(disabled('export-lists-layer-layer-a')).toBe(false)
    expect(checked('export-lists-layer-layer-a')).toBe(true)
    expect(checked('export-lists-table-warnings')).toBe(true)
    expect(checked('export-lists-table-items')).toBe(true)
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
    await settle()
    expect(screen.getByTestId('export-lists-notice-single')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('export-lists-table-items'))
    await settle()
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
    await settle()

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
